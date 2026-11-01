/**
 * CONTRACT
 *
 * GUARANTEE: CODE_GATE — When the URL contains ?code=, the page renders a
 *   minimal centered card ("Your secure payment link") with a single
 *   "Continue to Payment Advice" button. verifyMagicLink is NEVER called on
 *   mount — only on explicit button click. On success: saveAuth is called,
 *   code param is stripped from URL, then getMyRegistration() loads the page.
 *   On verify failure: if a valid session already exists (getToken() is
 *   non-null), the bad code is stripped and the existing session is used
 *   instead — the expired wall is NOT shown. Otherwise the code is stripped
 *   and the Expired Wall is shown.
 *
 * GUARANTEE: SESSION — When no ?code= param is present, requires a valid JWT
 *   (getToken()). Calls getMyRegistration() to load registration data. If the
 *   fetch returns 401/403 → Expired Wall.
 *
 * GUARANTEE: EXPIRED_WALL — When there is no valid session, renders the
 *   Expired Wall: heading "This payment link has expired", reassuring copy,
 *   and a single "Email me a fresh payment link" button. On click →
 *   requestPaymentLink(regCode). On success: button replaced with "Sent!
 *   Check your inbox — and your spam folder." On error: shows retry.
 *
 * GUARANTEE: NOT_FOUND — A 404 from getMyRegistration() shows "Registration
 *   not found" with a link back to /pay/:regCode.
 *
 * GUARANTEE: CANONICALIZE — If the fetched registration's regCode does not
 *   match the :regCode URL param (case-sensitive), the URL is replaced with
 *   /pay/{registration.regCode}/advice before any content is rendered.
 *
 * GUARANTEE: NON_PENDING_REDIRECT — If registration status is
 *   pending_verification or confirmed, redirects (replace) to
 *   /confirmation/:regId. Advice content is never shown for non-pending
 *   registrations.
 *
 * GUARANTEE: PRINT — In the ready state, window.print() fires exactly once
 *   per page load, after the document has rendered. The on-screen Print
 *   button and "Back to payment page" link are always available but never
 *   appear in print output (`.screen-only` + `@media print`).
 *
 * GUARANTEE: DOCUMENT_CONTENT — Renders payer + reference, an itemized table
 *   (base fee, college contribution, non-zero line items, donation if > 0),
 *   summary rows (total / already paid / amount payable now), full bank
 *   transfer details as a definition list, a generation timestamp in IST, and
 *   the fixed disclaimer text. All amounts are formatted with
 *   formatINRFixed().
 *
 * EXPECTS:
 * - Route is /pay/:regCode/advice.
 * - Access requires either a ?code= magic token or an existing JWT.
 * - getMyRegistration() returns the caller's own registration; regCode in the
 *   URL is a display/route concern, not an authorization boundary.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getMyRegistration, requestPaymentLink } from "@/lib/api";
import { getToken, saveAuth } from "@/lib/auth";
import { verifyMagicLink } from "@/lib/staff-api";
import { getPaymentBankDetails, formatINRFixed } from "@smriti/shared";
import type { RegistrationResponseData, BankFields } from "@smriti/shared";
import { SmritiLogo } from "@/components/ui/SmritiLogo";

// ── Page state ──────────────────────────────────────────────────────────────

type PageState =
  | "codegate"
  | "loading"
  | "expired"
  | "notfound"
  | "error"
  | "ready";

interface AdviceData {
  regCode: string;
  regId: string;
  fullName: string;
  pricingBreakup: RegistrationResponseData["pricingBreakup"];
  verifiedPaymentAmount: number;
  pendingPaymentAmount: number;
}

function extractAdviceData(reg: RegistrationResponseData): AdviceData {
  return {
    regCode: reg.regCode,
    regId: reg.regId,
    fullName: reg.contact.fullName,
    pricingBreakup: reg.pricingBreakup,
    verifiedPaymentAmount: reg.verifiedPaymentAmount,
    pendingPaymentAmount: reg.pendingPaymentAmount ?? reg.pricingBreakup.total,
  };
}

function formatGeneratedAt(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")} IST`;
}

const BANK_LABELS: { key: keyof BankFields; label: string }[] = [
  { key: "bank", label: "Beneficiary bank name" },
  { key: "accountName", label: "Account holder name" },
  { key: "accountNumber", label: "Account number" },
  { key: "ifscCode", label: "IFSC code" },
  { key: "swiftCode", label: "SWIFT/BIC code" },
  { key: "branch", label: "Branch" },
  { key: "country", label: "Country" },
  { key: "currency", label: "Currency" },
  { key: "purposeOfPaymentCode", label: "Purpose-of-payment code" },
  { key: "purposeOfPayment", label: "Purpose-of-payment description" },
];

const PRINT_STYLES = `
@media print {
  @page { size: A4 portrait; margin: 12mm 15mm; }
  .screen-only, .test-env-banner { display: none !important; }
  *, *::before, *::after {
    background: transparent !important;
    box-shadow: none !important;
  }
  body { background: #fff !important; }
  .advice-page-wrapper {
    padding: 0 !important;
    margin: 0 !important;
    min-height: 0 !important;
  }
  .advice-doc {
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    padding: 4mm 0 !important;
    margin: 0 auto !important;
    max-width: none !important;
    font-size: 11px;
    line-height: 1.35;
  }
  .advice-doc h1 { font-size: 20px; margin-bottom: 2px; }
  .advice-doc h2 { font-size: 12px; margin-bottom: 4px; }
  .advice-section { margin-bottom: 8px !important; }
  .advice-item-row td { padding-top: 3px !important; padding-bottom: 3px !important; }
  .advice-summary-row { padding-top: 1px; padding-bottom: 1px; }
  .advice-item-row, .advice-summary-row, .advice-bank-row {
    break-inside: avoid;
  }
  h1, h2 { break-after: avoid; }
  .advice-logo { margin-bottom: 4px !important; }
  .advice-logo img, .advice-logo svg { width: 40px !important; height: 40px !important; }
}
`;

// ── Component ───────────────────────────────────────────────────────────────

export default function PaymentAdvicePage() {
  useDocumentTitle("Payment Advice");

  const navigate = useNavigate();
  const { regCode: regCodeParam } = useParams<{ regCode?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const codeParam = searchParams.get("code");

  const initialState = ((): PageState => {
    if (codeParam) return "codegate";
    if (getToken()) return "loading";
    return "expired";
  })();

  const [pageState, setPageState] = useState<PageState>(initialState);
  const [data, setData] = useState<AdviceData | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [resendError, setResendError] = useState("");

  const printedRef = useRef(false);

  const { fields: bankFields } = getPaymentBankDetails();

  // ── Fetch registration ──────────────────────────────────────────────────

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

      // Canonicalize URL if regCode param doesn't match — fix the URL
      // but continue processing (React Router won't remount for a param change)
      if (regCodeParam && reg.regCode !== regCodeParam) {
        navigate(`/pay/${reg.regCode}/advice`, { replace: true });
      }

      if (reg.status === "pending_verification" || reg.status === "confirmed") {
        navigate(`/confirmation/${reg.regId}`, { replace: true });
        return;
      }

      setData(extractAdviceData(reg));
      setPageState("ready");
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        setPageState("expired");
      } else if (status === 404) {
        setPageState("notfound");
      } else {
        setPageState("error");
        setErrorMessage(
          (err as { error?: string })?.error ??
            "We couldn't load your payment advice.",
        );
      }
    }
  }, [navigate, regCodeParam]);

  useEffect(() => {
    if (initialState === "loading") {
      fetchRegistration();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Code gate: user clicks "Continue to Payment Advice" ───────────────

  const handleCodeContinue = useCallback(async () => {
    if (!codeParam) return;

    setPageState("loading");

    try {
      const response = await verifyMagicLink(codeParam);
      saveAuth(response.token, response.sub ?? "");

      const next = new URLSearchParams(searchParams);
      next.delete("code");
      setSearchParams(next, { replace: true });

      await fetchRegistration();
    } catch {
      // Verify failed — if a valid session already exists, fall back to it
      // instead of showing the expired wall.
      const next = new URLSearchParams(searchParams);
      next.delete("code");
      setSearchParams(next, { replace: true });

      if (getToken()) {
        await fetchRegistration();
      } else {
        setPageState("expired");
      }
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

  // ── Trigger print once, after ready state renders ──────────────────────

  useEffect(() => {
    if (pageState === "ready" && !printedRef.current) {
      printedRef.current = true;
      window.print();
    }
  }, [pageState]);

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
              Tap the button below to view your payment advice.
            </p>
            <button
              type="button"
              onClick={handleCodeContinue}
              className="w-full h-12 rounded-2xl border-0 bg-linear-to-br from-terracotta to-[#C45A40] px-5 text-sm font-bold text-white shadow-[0_10px_28px_rgba(215,107,81,0.3)] transition hover:brightness-95 cursor-pointer"
            >
              Continue to Payment Advice
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
          <p className="text-sm text-muted">Loading your payment advice...</p>
        </div>
      </div>
    );
  }

  // ── Expired wall ──────────────────────────────────────────────────────

  if (pageState === "expired") {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="text-center max-w-sm" role="alert">
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
        <div className="text-center max-w-sm" role="alert">
          <h1 className="font-heading text-xl font-bold text-charcoal mb-2">
            Registration not found
          </h1>
          <p className="text-sm text-muted mb-5">
            We couldn&apos;t find your registration details.
          </p>
          <a
            href={`/pay/${regCodeParam ?? ""}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-terracotta text-white rounded-xl text-sm font-semibold no-underline"
          >
            Back to payment page
          </a>
        </div>
      </div>
    );
  }

  // ── Service error ─────────────────────────────────────────────────────

  if (pageState === "error") {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="text-center max-w-sm" role="alert">
          <h1 className="font-heading text-xl font-bold text-charcoal mb-2">
            We couldn&apos;t load your payment advice
          </h1>
          <p className="text-sm text-muted mb-5">{errorMessage}</p>
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={fetchRegistration}
              className="px-5 py-2.5 bg-terracotta text-white rounded-xl text-sm font-semibold cursor-pointer border-0"
            >
              Retry
            </button>
            <a
              href={`/pay/${regCodeParam ?? ""}`}
              className="text-sm text-charcoal/60 hover:text-charcoal underline"
            >
              Back to payment page
            </a>
          </div>
        </div>
      </div>
    );
  }



  // ── Ready (main document) ───────────────────────────────────────────

  if (!data) return null;

  return <AdviceDocument data={data} bankFields={bankFields} />;
}

// ── AdviceDocument ────────────────────────────────────────────────────────

interface AdviceDocumentProps {
  data: AdviceData;
  bankFields: BankFields;
}

export function AdviceDocument({ data, bankFields }: AdviceDocumentProps) {
  const { pricingBreakup } = data;

  // lines[] already contains contribution items with descriptive labels.
  // collegeContribution is a metadata aggregate, not a separate addend.
  const itemRows: { label: string; amount: number }[] = [
    { label: "Base registration fee", amount: pricingBreakup.base },
    ...pricingBreakup.lines
      .filter((line) => line.fee > 0)
      .map((line) => ({ label: line.label, amount: line.fee })),
  ];
  if (pricingBreakup.donation > 0) {
    itemRows.push({ label: "Donation", amount: pricingBreakup.donation });
  }

  return (
    <div className="advice-page-wrapper min-h-screen bg-page py-10 px-5">
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

      {/* ── Screen-only controls ── */}
      <div className="screen-only max-w-[700px] mx-auto mb-5 flex items-center justify-between">
        <a
          href={`/pay/${data.regCode}`}
          className="text-sm text-charcoal/60 hover:text-charcoal underline"
        >
          ← Back to payment page
        </a>
        <button
          type="button"
          onClick={() => window.print()}
          className="px-4 py-2 bg-terracotta text-white rounded-xl text-sm font-semibold cursor-pointer border-0"
        >
          Print
        </button>
      </div>

      {/* ── Document ── */}
      <div className="advice-doc max-w-[700px] mx-auto bg-white rounded-2xl border border-border-warm shadow-sm p-8 sm:p-10">
        {/* Heading */}
        <div className="advice-section text-center mb-8">
          <div className="flex justify-center mb-3 advice-logo">
            <SmritiLogo size={64} />
          </div>
          <h1 className="font-heading text-2xl font-bold text-charcoal mb-1">
            Payment Advice
          </h1>
          <p className="text-sm text-muted">TKMCE 2006 Alumni Association</p>
          <p className="text-sm text-muted">Smriti 2026</p>
        </div>

        {/* Payer + reference */}
        <div className="advice-section mb-8">
          <h2 className="sr-only">Payer</h2>
          <p className="text-sm text-charcoal font-semibold">{data.fullName}</p>
          <p className="text-sm text-muted">Payment reference: {data.regCode}</p>
        </div>

        {/* Itemization */}
        <div className="advice-section mb-6">
          <h2 className="font-heading text-base font-bold text-charcoal mb-3">
            Itemization
          </h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border-warm">
                <th className="text-left py-2 font-semibold text-charcoal">Description</th>
                <th className="text-right py-2 font-semibold text-charcoal">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {itemRows.map((row, i) => (
                <tr key={i} className="advice-item-row border-b border-border-warm/50">
                  <td className="py-2 text-charcoal">{row.label}</td>
                  <td className="py-2 text-right text-charcoal font-mono">
                    {formatINRFixed(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div className="advice-section mb-8 space-y-2">
          <div className="advice-summary-row flex items-center justify-between text-sm">
            <span className="text-charcoal">Registration total</span>
            <span className="font-mono font-semibold text-charcoal">
              {formatINRFixed(pricingBreakup.total)}
            </span>
          </div>
          <div className="advice-summary-row flex items-center justify-between text-sm">
            <span className="text-charcoal">Already paid</span>
            <span className="font-mono font-semibold text-charcoal">
              {formatINRFixed(data.verifiedPaymentAmount)}
            </span>
          </div>
          <div className="advice-summary-row flex items-center justify-between text-base border-t border-border-warm pt-2 mt-2">
            <span className="font-bold text-charcoal">Amount payable now</span>
            <span className="font-mono font-bold text-terracotta">
              {formatINRFixed(data.pendingPaymentAmount)}
            </span>
          </div>
        </div>

        {/* Bank details */}
        <div className="advice-section mb-8">
          <h2 className="font-heading text-base font-bold text-charcoal mb-3">
            Bank transfer details
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {BANK_LABELS.map(({ key, label }) => (
              <div key={key} className="advice-bank-row">
                <dt className="text-muted text-xs">{label}</dt>
                <dd className="text-charcoal font-mono break-all">
                  {bankFields[key]}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Generated date */}
        <p className="text-xs text-subtle mb-4">
          Generated on {formatGeneratedAt()}
        </p>

        {/* Disclaimer */}
        <p className="text-xs text-subtle leading-relaxed border-t border-border-warm pt-4">
          This is a payment advice for Smriti 2026 registration fees, collected
          by TKMCE 2006 Alumni Association from its members. Not a tax
          invoice; no GST applies.
        </p>
      </div>
    </div>
  );
}
