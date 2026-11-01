/**
 * CONTRACT
 *
 * GUARANTEE: RENDER_PENDING — When registration status is "pending", renders
 *   the Smriti logo (links to /), payment progress indicator, total amount
 *   prominently, UPI section with deep-link CTA (mobile) and QR code encoding
 *   full UPI URI, bank details (collapsible), and proof upload area using the
 *   shared FileUpload component with preview. An explicit "Submit Proof" button
 *   appears only after a file is selected.
 *
 * GUARANTEE: RENDER_PAYMENT_OPTIONS — Both UPI and bank transfer details are
 *   always shown regardless of country or intent. The attendee chooses.
 *
 * GUARANTEE: UPI_URI — Generates a complete `upi://pay?...` URI with pa, pn,
 *   am, cu, tr (regCode), and tn fields. QR encodes this URI, not a URL.
 *   On mobile, primary CTA opens the URI directly.
 *
 * GUARANTEE: UPLOAD — File selection stores the file locally. The upload to
 *   uploadPaymentProof() is only triggered on explicit "Submit Proof" button
 *   click. UTR is sent alongside the file if provided. On success, immediately
 *   redirects to /confirmation/:regId. Auth token is required for upload.
 *
 * GUARANTEE: PERSIST — On browser refresh, re-fetches registration from the
 *   server via getMyRegistration(). The displayed state is derived from the
 *   server-registered status, not localStorage.
 *
 * GUARANTEE: CODE_GATE — When the URL contains ?code=, the page renders a
 *   minimal centered card ("Your secure payment link") with a single "Continue
 *   to Payment" button. verifyMagicLink is NEVER called on mount — only on
 *   explicit button click. On success: saveAuth is called, code param is
 *   stripped from URL, then getMyRegistration() loads the payment page. On
 *   verify failure (401): code param is stripped, Expired Wall is shown.
 *
 * GUARANTEE: SESSION — When no ?code= param is present, requires a valid JWT
 *   (getToken()). Calls getMyRegistration() to load registration data. If the
 *   fetch returns 401 → Expired Wall.
 *
 * GUARANTEE: EXPIRED_WALL — When there is no valid session (no code, no JWT,
 *   or verify/fetch 401), renders the Expired Wall: heading "This payment link
 *   has expired", reassuring copy, and a single "Email me a fresh payment link"
 *   button. On click → requestPaymentLink(regCode). On success: button replaced
 *   with "Sent! Check your inbox — and your spam folder." On error: shows retry.
 *
 * GUARANTEE: ALREADY_PAID — After data loads, if status is pending_verification
 *   or confirmed, navigates to /confirmation/:regId (replace).
 *
 * GUARANTEE: RETURN_DETECTION — Uses visibilitychange/focus events to detect
 *   return from UPI app and highlights the proof upload section.
 *
 * GUARANTEE: EMAIL_NOTICE — When the URL has ?new=1 (set by the post-registration
 *   redirect), an inline informational banner notes that a link to this page was
 *   also emailed, so the attendee can return anytime. It never blocks payment
 *   content. The param is stripped on load so refreshes and revisits don't show it.
 *
 * EXPECTS:
 * - Route is /pay/:regCode.
 * - Access requires either a ?code= magic token (single-use, 4-hour) or an
 *   existing JWT in localStorage. regCode is part of the URL path.
 * - uploadPaymentProof(regCode, file, utr?) is idempotent for the same payment
 *   record (replaces previous proof). regCode is obtained from the fetched
 *   registration data, not from the URL. Auth is required for upload.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useStepAnimation } from "@/hooks/useStepAnimation";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useIsIOS } from "@/hooks/useIsIOS";
import { useReturnFromApp } from "@/hooks/useReturnFromApp";
import { getMyRegistration, uploadPaymentProof, requestPaymentLink } from "@/lib/api";
import { getToken, saveAuth } from "@/lib/auth";
import { verifyMagicLink } from "@/lib/staff-api";
import {
  formatINR,
  PAYMENT_UPI_VPA_B64,
  PAYMENT_PAYEE_NAME,
  PAYMENT_UPI_ORG_ID,
  getPaymentBankDetails,
  decodePaymentConstant,
  buildUpiUri,
  buildUpiNote,
  buildUpiQrUri,
  buildAppUpiUri,
} from "@smriti/shared";
import type { BankFields } from "@smriti/shared";
import { BankDetailsPanel, CopyField } from "@/components/payment/BankDetailsPanel";
import type { UpiApp } from "@smriti/shared";
import { FileUpload } from "@/components/ui/FileUpload";
import { PaymentProgress } from "@/components/ui/PaymentProgress";
import { SmritiLogo } from "@/components/ui/SmritiLogo";
import { QRCode } from "@/components/confirmation/QRCode";
import { UpiLogo } from "@/components/ui/UpiLogo";
import { PhonePeLogo } from "@/components/ui/PhonePeLogo";
import { GPayLogo } from "@/components/ui/GPayLogo";

// UPI toggle — set to true when UPI daily limits are resolved and app payments work reliably.
// When false, only bank transfer is shown (as primary, non-collapsible).
const SHOW_UPI = false;
// Minimal shape for what this page actually needs — no PII exposure in regCode path
interface PaymentData {
  regCode: string;
  regId: string;
  status: "pending" | "pending_verification" | "confirmed";
  /** Amount owed for the current payment_pending record. Falls back to pricingBreakup.total for fresh registrations. */
  pendingPaymentAmount: number;
}

// ── Page state ──────────────────────────────────────────────────────────────

type PageState = "codegate" | "loading" | "expired" | "notfound" | "error" | "pending";

// ── Component ───────────────────────────────────────────────────────────────

export default function BankTransferPage() {
  useDocumentTitle("Bank Transfer Payment");

  const navigate = useNavigate();
  const { regCode: regCodeParam } = useParams<{ regCode?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Captured once on mount — the param is stripped right after, but the banner
  // stays visible for the rest of this visit.
  const [showEmailNotice] = useState(() => searchParams.get("new") === "1");

  // Capture code param on mount — needed for code gate and expired wall resend.
  // The param is stripped after use, but the value is preserved in this ref.
  const codeParam = searchParams.get("code");

  useEffect(() => {
    if (searchParams.has("new")) {
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Determine initial state:
  // - code param present → show code gate (DO NOT call verify yet)
  // - no code, has token → loading (proceed to fetch)
  // - no code, no token → expired
  const initialState = ((): PageState => {
    if (codeParam) return "codegate";
    if (getToken()) return "loading";
    return "expired";
  })();

  const [pageState, setPageState] = useState<PageState>(initialState);
  const [data, setData] = useState<PaymentData | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // Expired wall resend state
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [resendError, setResendError] = useState("");

  // Upload state
  const [uploadState, setUploadState] = useState<
    "idle" | "uploading" | "done" | "error"
  >("idle");
  const [uploadError, setUploadError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [utr, setUtr] = useState("");

  // ── Fetch registration (called after session is established) ──────────

  const fetchRegistration = useCallback(async () => {
    setPageState("loading");
    setErrorMessage("");

    const token = getToken();
    if (!token) {
      setPageState("expired");
      return;
    }

    try {
      const res = await getMyRegistration();
      const reg = res.registration;
      const paymentData: PaymentData = {
        regCode: reg.regCode,
        regId: reg.regId,
        status: reg.status,
        // For supplementary payments, show the pending payment delta, not the full total.
        // Fallback to pricingBreakup.total for fresh registrations where they're equal.
        pendingPaymentAmount: reg.pendingPaymentAmount ?? reg.pricingBreakup.total,
      };
      setData(paymentData);

      switch (paymentData.status) {
        case "pending":
          setPageState("pending");
          break;
        case "pending_verification":
        case "confirmed":
          navigate(`/confirmation/${paymentData.regId}`, { replace: true });
          break;
        default:
          setPageState("pending");
      }
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 401) {
        setPageState("expired");
      } else if (status === 404) {
        setPageState("notfound");
      } else {
        setPageState("error");
        setErrorMessage(
          (err as { error?: string })?.error ??
            "Something went wrong while loading your payment details.",
        );
      }
    }
  }, [navigate]);

  // Trigger fetch on mount when we already have a session (no code gate).
  useEffect(() => {
    if (initialState === "loading") {
      fetchRegistration();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Code gate: user clicks "Continue to Payment" ─────────────────────

  const handleCodeContinue = useCallback(async () => {
    if (!codeParam) return;

    setPageState("loading");

    try {
      const response = await verifyMagicLink(codeParam);
      // Store auth — sub comes from response
      saveAuth(response.token, response.sub ?? "");

      // Strip the code param from URL (security hygiene)
      const next = new URLSearchParams(searchParams);
      next.delete("code");
      setSearchParams(next, { replace: true });

      // Proceed to load registration via the new JWT
      await fetchRegistration();
    } catch {
      // Verify failed — strip code param and show expired wall
      const next = new URLSearchParams(searchParams);
      next.delete("code");
      setSearchParams(next, { replace: true });
      setPageState("expired");
    }
  }, [codeParam, fetchRegistration, searchParams, setSearchParams]);

  // ── Expired wall: request a fresh payment link ─────────────────────────

  const handleResendLink = useCallback(async () => {
    if (!regCodeParam) return;
    setResendState("sending");
    setResendError("");
    try {
      await requestPaymentLink(regCodeParam);
      setResendState("sent");
    } catch {
      setResendState("error");
      setResendError("Something went wrong. Please try again.");
    }
  }, [regCodeParam]);

  // ── File select handler — stores file locally, does NOT upload ────────

  const handleFileSelect = useCallback((file: File | null) => {
    setSelectedFile(file);
    setUploadError("");
    if (uploadState === "error") setUploadState("idle");
  }, [uploadState]);

  // ── Submit proof handler — triggered by explicit button click ─────────

  const handleSubmitProof = useCallback(async () => {
    if (!selectedFile) return;

    setUploadState("uploading");
    setUploadError("");

    try {
      await uploadPaymentProof(data!.regCode, selectedFile, utr || undefined);
      setUploadState("done");
      navigate(`/confirmation/${data!.regId}`, { replace: true });
    } catch (err: unknown) {
      setUploadState("error");
      setUploadError(
        (err as { error?: string })?.error ??
          "Failed to upload proof. Please try again.",
      );
    }
  }, [data, navigate, selectedFile, utr]);

  // ── Derived values ────────────────────────────────────────────────────

  const { raw: bankDetailsRaw, fields: bankFields } = getPaymentBankDetails();
  const upiId = decodePaymentConstant(PAYMENT_UPI_VPA_B64);

  // ── Code gate ─────────────────────────────────────────────────────────

  if (pageState === "codegate") {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center px-5">
        <div className="w-full max-w-sm text-center">
          <div className="flex justify-center mb-6">
            <SmritiLogo size={72} href="/" />
          </div>
          <div className="bg-white rounded-2xl border border-border-warm p-6 shadow-sm">
            <h1 className="font-heading text-xl font-bold text-charcoal mb-2">
              Your secure payment link
            </h1>
            <p className="text-sm text-muted mb-6">
              Tap the button below to open your payment page.
            </p>
            <button
              type="button"
              onClick={handleCodeContinue}
              className="w-full h-12 rounded-2xl border-0 bg-linear-to-br from-terracotta to-[#C45A40] px-5 text-sm font-bold text-white shadow-[0_10px_28px_rgba(215,107,81,0.3)] transition hover:brightness-95 cursor-pointer"
            >
              Continue to Payment
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────

  if (pageState === "loading") {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-soft-aqua border-t-terracotta rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted">Loading your payment details...</p>
        </div>
      </div>
    );
  }

  // ── Expired wall ──────────────────────────────────────────────────────

  if (pageState === "expired") {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="flex justify-center mb-5">
            <SmritiLogo size={64} href="/" />
          </div>
          <h1 className="font-heading text-xl font-bold text-charcoal mb-2">
            This payment link has expired
          </h1>
          <p className="text-sm text-muted mb-6">
            Payment links are valid for a few hours. We can send a fresh one
            to your registered email.
          </p>

          {resendState === "sent" ? (
            <p className="text-sm font-semibold text-[#2A7A80] bg-[#E4F3F4]/80 border border-[#2A7A80]/20 rounded-xl px-4 py-3">
              Sent! Check your inbox — and your spam folder.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={handleResendLink}
                disabled={resendState === "sending" || !regCodeParam}
                className="px-5 py-2.5 bg-terracotta text-white rounded-xl text-sm font-semibold cursor-pointer border-0 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {resendState === "sending"
                  ? "Sending..."
                  : "Email me a fresh payment link"}
              </button>
              {resendState === "error" && (
                <p className="mt-3 text-xs text-red-600">{resendError}</p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────────

  if (pageState === "notfound") {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-[rgba(200,180,150,0.2)] flex items-center justify-center mx-auto mb-4">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="#9CA3AF"
                strokeWidth="1.5"
              />
              <path
                d="M12 8v4M12 16h.01"
                stroke="#9CA3AF"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <h1 className="font-heading text-xl font-bold text-charcoal mb-2">
            Registration not found
          </h1>
          <p className="text-sm text-muted mb-5">
            We couldn&apos;t find your registration details.
          </p>
          <button
            type="button"
            onClick={() => navigate("/register")}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-terracotta text-white rounded-xl text-sm font-semibold cursor-pointer border-0"
          >
            Start a new registration
          </button>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────

  if (pageState === "error") {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="#DC2626"
                strokeWidth="1.5"
              />
              <path
                d="M8 12h8"
                stroke="#DC2626"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <h1 className="font-heading text-xl font-bold text-charcoal mb-2">
            Something went wrong
          </h1>
          <p className="text-sm text-muted mb-5">{errorMessage}</p>
          <button
            type="button"
            onClick={fetchRegistration}
            className="px-5 py-2.5 bg-terracotta text-white rounded-xl text-sm font-semibold cursor-pointer border-0"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ── Pending (main payment page) ───────────────────────────────────────

  // data is guaranteed non-null here — all other states return early
  if (!data) return null;

  return (
    <PendingView
      data={data}
      showEmailNotice={showEmailNotice}
      uploadState={uploadState}
      uploadError={uploadError}
      selectedFile={selectedFile}
      utr={utr}
      onUtrChange={setUtr}
      onFileSelect={handleFileSelect}
      onSubmitProof={handleSubmitProof}
      bankDetailsRaw={bankDetailsRaw}
      bankFields={bankFields}
      upiId={upiId}
    />
  );
}

// ── PendingView ─────────────────────────────────────────────────────────────
// Extracted so useStepAnimation can be called unconditionally at the top of this
// component without conflicting with BankTransferPage's early returns.

interface PendingViewProps {
  data: PaymentData;
  showEmailNotice: boolean;
  uploadState: "idle" | "uploading" | "done" | "error";
  uploadError: string;
  selectedFile: File | null;
  utr: string;
  onUtrChange: (value: string) => void;
  onFileSelect: (file: File | null) => void;
  onSubmitProof: () => void;
  bankDetailsRaw: string;
  bankFields: BankFields;
  upiId: string;
}

const UPI_APPS: { app: UpiApp; label: string; icon: React.ReactNode }[] = [
  { app: "phonepe", label: "PhonePe", icon: <PhonePeLogo size={20} /> },
];

function GPayOverlay({
  upiId,
  amount,
  onClose,
}: {
  upiId: string;
  amount: string;
  onClose: () => void;
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyValue = useCallback((field: string, value: string) => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopiedField(field);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopiedField(null), 1500);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-white rounded-t-2xl shadow-2xl animate-in slide-in-from-bottom duration-300 px-6 pt-5 pb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <GPayLogo size={20} />
            <span className="font-heading text-base font-bold text-charcoal">
              Pay with Google Pay
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-charcoal/8 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="text-xs text-muted mb-4">
          Open Google Pay, tap <strong>New payment</strong>, enter the UPI ID and amount below.
        </p>

        <div className="space-y-3 mb-5">
          <div className="rounded-xl border border-border-warm bg-page/60 p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle mb-1">
              UPI ID
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-bold font-mono text-charcoal">{upiId}</span>
              <button
                type="button"
                onClick={() => copyValue("upi", upiId)}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-soft-aqua/30 text-xs font-bold text-[#2A7A80] hover:bg-soft-aqua/50 transition-colors cursor-pointer"
              >
                {copiedField === "upi" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-border-warm bg-page/60 p-3.5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle mb-1">
              Amount
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-base font-bold font-mono text-charcoal">{amount}</span>
              <button
                type="button"
                onClick={() => copyValue("amount", amount.replace(/[^\d.]/g, ""))}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-soft-aqua/30 text-xs font-bold text-[#2A7A80] hover:bg-soft-aqua/50 transition-colors cursor-pointer"
              >
                {copiedField === "amount" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </div>

        <a
          href="gpay://upi"
          className="flex items-center justify-center gap-2.5 w-full h-12 rounded-xl text-sm font-bold no-underline bg-charcoal text-white hover:brightness-110 transition"
        >
          <GPayLogo size={18} />
          Open Google Pay
        </a>
      </div>
    </div>,
    document.body,
  );
}

function UpiAppButtons({
  upiInput,
  upiId,
  amount,
}: {
  upiInput: Parameters<typeof buildAppUpiUri>[0];
  upiId: string;
  amount: string;
}) {
  const [showGPayOverlay, setShowGPayOverlay] = useState(false);

  return (
    <div id="upi-app-buttons" className="flex flex-col gap-2 mb-3">
      <button
        type="button"
        onClick={() => setShowGPayOverlay(true)}
        className="flex items-center justify-center gap-2.5 w-full h-11 rounded-xl px-4 text-sm font-bold no-underline transition hover:brightness-95 bg-charcoal/8 text-charcoal border border-border-warm cursor-pointer"
      >
        <GPayLogo size={18} />
        Pay with Google Pay
      </button>
      {showGPayOverlay && (
        <GPayOverlay
          upiId={upiId}
          amount={amount}
          onClose={() => setShowGPayOverlay(false)}
        />
      )}
      {UPI_APPS.map(({ app, label, icon }) => (
        <a
          key={app}
          href={buildAppUpiUri(upiInput, app)}
          className="flex items-center justify-center gap-2.5 w-full h-11 rounded-xl px-4 text-sm font-bold no-underline transition hover:brightness-95 bg-charcoal/8 text-charcoal border border-border-warm"
        >
          {icon}
          Pay with {label}
        </a>
      ))}
    </div>
  );
}

function PendingView({
  data,
  showEmailNotice,
  uploadState,
  uploadError,
  selectedFile,
  utr,
  onUtrChange,
  onFileSelect,
  onSubmitProof,
  bankDetailsRaw,
  bankFields,
  upiId,
}: PendingViewProps) {
  const anim = useStepAnimation();
  const isMobile = useIsMobile();
  const isIOS = useIsIOS();
  const step2Ref = useRef<HTMLDivElement>(null);
  const [showProofPrompt, setShowProofPrompt] = useState(false);
  const totalAmount = data.pendingPaymentAmount;

  useReturnFromApp(() => {
    setShowProofPrompt(true);
    step2Ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  const upiInput = {
    vpa: upiId,
    payeeName: PAYMENT_PAYEE_NAME,
  };
  // Deep links carry no amount (apps require user entry for unsigned intents);
  // the QR carries amount + regCode note + NPCI org id for bank-side matching.
  const upiUri = buildUpiUri(upiInput);
  const upiQrUri = buildUpiQrUri({
    vpa: upiId,
    payeeName: PAYMENT_PAYEE_NAME,
    amountInr: totalAmount,
    note: buildUpiNote(data.regCode),
    orgId: PAYMENT_UPI_ORG_ID,
  });

  return (
    <div className="min-h-screen bg-page relative overflow-hidden">
      {/* Hero backdrop gradient */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-soft-aqua/30 via-transparent to-transparent" />
      </div>

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-5 py-10">
        <div className="w-full max-w-[560px]">

          {/* ── Logo ── */}
          <div className="flex justify-center mb-5">
            <SmritiLogo size={90} href="/" />
          </div>

          {/* ── Payment Progress ── */}
          <div className="mb-6">
            <PaymentProgress currentStatus="pending" />
          </div>

          {/* ── Email notice — informational only, shown once for new registrations ── */}
          {showEmailNotice && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-[#2A7A80]/20 bg-[#E4F3F4]/60 px-4 py-3">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 mt-0.5 text-[#2A7A80]"
                aria-hidden="true"
              >
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M22 4l-10 8L2 4" />
              </svg>
              <p className="text-sm text-charcoal/80 leading-snug">
                We&apos;ve emailed you a link to this page, so you can come back
                anytime. Our emails sometimes land in spam — if you find it
                there, move it to your inbox so payment updates reach you.
              </p>
            </div>
          )}

          {/* ── Amount Due ── */}
          <div className="text-center mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-subtle mb-1">
              Amount Due
            </p>
            <p
              className="text-[2.5rem] font-bold leading-none text-charcoal sm:text-[3rem]"
              style={{ fontFamily: "var(--font-body)" }}
            >
              {formatINR(totalAmount)}
            </p>
          </div>

          {/* ── Step 1 card ── */}
          <div className="bg-white rounded-2xl border border-border-warm p-5 shadow-sm sm:p-6">
            {/* Step header */}
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`step-circle-anim shrink-0 w-7 h-7 rounded-full bg-soft-aqua flex items-center justify-center sm:w-9 sm:h-9${anim.circle1Visible ? " visible" : ""}`}
              >
                <span className="font-bold text-sm text-charcoal">1</span>
              </div>
              <h2 className="font-heading text-lg font-bold text-charcoal min-h-[1.4em] flex items-center">
                <span>{anim.title1}</span>
                {!anim.title1Done && (
                  <span className="typing-cursor" aria-hidden="true" />
                )}
              </h2>
            </div>

            {/* Animated content area */}
            <div className={`step-content-grid${anim.content1Expanded ? " expanded" : ""}`}>
              <div>
                {/* Subtitle */}
                <p className="text-sm text-muted mb-4 ml-[calc(1.75rem+0.75rem)] sm:ml-[calc(2.25rem+0.75rem)]">
                  Send <span className="font-bold text-charcoal">{formatINR(totalAmount)}</span> to this account{SHOW_UPI ? ":" : " via bank transfer:"}
                </p>

                {/* UPI — preferred, shown first (when enabled) */}
                {SHOW_UPI && (
                <div className="rounded-xl border border-[#2A7A80]/20 bg-[#E4F3F4]/40 p-4 mb-4">
                  <h3 className="font-heading text-sm font-bold text-charcoal mb-3 flex items-center gap-2">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                    UPI Payment
                  </h3>

                  {/* Mobile deep-link CTAs */}
                  {isMobile && (
                    <>
                      {isIOS && (
                        <UpiAppButtons upiInput={upiInput} upiId={upiId} amount={formatINR(totalAmount)} />
                      )}
                      <a
                        href={upiUri}
                        className={`flex items-center justify-center gap-2.5 w-full h-11 rounded-xl px-4 text-sm font-bold no-underline transition hover:brightness-95 mb-3 ${
                          isIOS
                            ? "bg-charcoal/8 text-charcoal border border-border-warm"
                            : "bg-linear-to-br from-terracotta to-[#C45A40] text-white shadow-[0_8px_20px_rgba(215,107,81,0.25)]"
                        }`}
                      >
                        <UpiLogo size={16} />
                        Pay with UPI
                      </a>
                    </>
                  )}

                  {/* QR Code */}
                  <div className="flex flex-col items-center mb-3">
                    <p className="text-xs text-muted mb-2">
                      {isMobile ? "Or scan from another device" : "Scan with any UPI app to pay"}
                    </p>
                    <button
                      type="button"
                      className="p-2 bg-white rounded-lg border border-border-warm cursor-pointer hover:border-soft-aqua transition-colors"
                      onClick={() => {
                        if (!isMobile) return;
                        if (isIOS) {
                          document.getElementById("upi-app-buttons")?.scrollIntoView({ behavior: "smooth", block: "center" });
                        } else {
                          window.location.href = upiUri;
                        }
                      }}
                      aria-label={isMobile ? "Tap to pay with UPI" : undefined}
                    >
                      <QRCode value={upiQrUri} size={160} />
                    </button>
                  </div>

                  {/* Payment summary */}
                  <div className="rounded-lg border border-border-warm bg-white/80 px-4 py-3">
                    <dl className="space-y-3">
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">
                          Payee
                        </dt>
                        <dd className="text-sm font-medium text-charcoal">
                          {PAYMENT_PAYEE_NAME}
                        </dd>
                      </div>
                      <CopyField label="UPI ID" value={upiId} />
                      <CopyField label="Your Ref" value={data.regCode} />
                      <p className="text-[11px] text-muted leading-snug -mt-1">
                        Mention this in the payment remarks for quick verification
                      </p>
                    </dl>
                  </div>
                </div>
                )}

                {/* Bank Account Details — primary when UPI is off, collapsible when UPI is on */}
                {SHOW_UPI ? (
                <details className="group rounded-xl border border-border-warm bg-white/60">
                  <summary className="flex items-center justify-between p-4 cursor-pointer text-sm font-semibold text-charcoal select-none list-none [&::-webkit-details-marker]:hidden">
                    <span>Bank account details</span>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="transition-transform duration-200 group-open:rotate-180"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </summary>
                  <div className="px-4 pb-4">
                    <BankDetailsPanel
                      bankFields={bankFields}
                      bankDetailsRaw={bankDetailsRaw}
                      regCode={data.regCode}
                    />
                  </div>
                </details>
                ) : (
                <div className="rounded-xl border border-border-warm bg-white/60 p-4">
                  <h3 className="font-heading text-sm font-bold text-charcoal mb-4">
                    Bank account details
                  </h3>
                  <BankDetailsPanel
                    bankFields={bankFields}
                    bankDetailsRaw={bankDetailsRaw}
                    regCode={data.regCode}
                  />
                </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Print Payment Advice link ── */}
          <div className="mt-3 text-center">
            <a
              href={`/pay/${data.regCode}/advice`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-charcoal/60 hover:text-charcoal transition-colors no-underline"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9V2h12v7" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              Print Payment Advice
            </a>
          </div>

          {/* ── Dashed connector ── */}
          <div className="flex flex-col items-center py-1" aria-hidden="true">
            <div className="w-px h-6 border-l-2 border-dashed border-border-warm" />
            <svg
              width="16"
              height="10"
              viewBox="0 0 16 10"
              fill="none"
              className="text-border-warm -mt-px"
              aria-hidden="true"
            >
              <path
                d="M1 1l7 7 7-7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {/* ── Step 2 card ── */}
          <div
            ref={step2Ref}
            className={`bg-white rounded-2xl border p-5 shadow-sm sm:p-6 transition-colors duration-500 ${
              showProofPrompt ? "border-terracotta/50" : "border-border-warm"
            }`}
          >
            {/* Step header */}
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`step-circle-anim shrink-0 w-7 h-7 rounded-full bg-soft-aqua flex items-center justify-center sm:w-9 sm:h-9${anim.circle2Visible ? " visible" : ""}`}
              >
                <span className="font-bold text-sm text-charcoal">2</span>
              </div>
              <h2 className="font-heading text-lg font-bold text-charcoal min-h-[1.4em] flex items-center">
                <span>{anim.title2}</span>
                {!anim.title2Done && (
                  <span className="typing-cursor" aria-hidden="true" />
                )}
              </h2>
            </div>

            {/* Animated content area */}
            <div className={`step-content-grid${anim.content2Expanded ? " expanded" : ""}`}>
              <div>
                {/* Subtitle */}
                <p className="text-sm text-muted mb-4 ml-[calc(1.75rem+0.75rem)] sm:ml-[calc(2.25rem+0.75rem)]">
                  {showProofPrompt
                    ? "Payment step completed? Upload proof so we can verify."
                    : "Once you’ve made the transfer, upload a screenshot or receipt."}
                </p>

                <FileUpload
                  preview={true}
                  onFileSelect={onFileSelect}
                  accept=".jpg,.jpeg,.png,.pdf"
                  maxSizeMB={5}
                  disabled={uploadState === "uploading"}
                  uploading={uploadState === "uploading"}
                  error={uploadState === "error" ? uploadError : undefined}
                />

                {/* UTR / reference input */}
                <div className="mt-4">
                  <label
                    htmlFor="utr-input"
                    className="block text-xs font-semibold uppercase tracking-[0.08em] text-subtle mb-1.5"
                  >
                    {SHOW_UPI ? "UPI Reference / UTR" : "Transaction Reference / UTR"} <span className="font-normal normal-case tracking-normal">(optional)</span>
                  </label>
                  <input
                    id="utr-input"
                    type="text"
                    value={utr}
                    onChange={(e) => onUtrChange(e.target.value)}
                    placeholder="e.g. 412345678901"
                    disabled={uploadState === "uploading"}
                    className="w-full h-10 px-3 rounded-xl border border-border-warm bg-white text-sm text-charcoal font-mono placeholder:text-muted/50 focus:outline-none focus:border-soft-aqua focus:ring-1 focus:ring-soft-aqua/50 disabled:opacity-60"
                  />
                </div>

                {/* Submit Proof button — visible only when a file is selected */}
                {selectedFile !== null && (
                  <button
                    type="button"
                    onClick={onSubmitProof}
                    disabled={uploadState === "uploading"}
                    className="mt-4 w-full h-12 rounded-2xl border-0 bg-linear-to-br from-terracotta to-[#C45A40] px-5 text-sm font-bold text-white shadow-[0_10px_28px_rgba(215,107,81,0.3)] transition hover:brightness-95 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {uploadState === "uploading" ? "Uploading..." : "Submit Proof"}
                  </button>
                )}

                {/* Verification note */}
                <p className="mt-4 text-xs text-subtle leading-relaxed text-center">
                  We&apos;ll verify your payment within 24–48 hours. Check your email — including spam — for the status link.
                </p>
              </div>
            </div>
          </div>

          {/* ── Connect nudge ── */}
          <div className="mt-6 text-center">
            <Link
              to="/connect"
              className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors no-underline"
            >
              While you wait, stay connected →
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
