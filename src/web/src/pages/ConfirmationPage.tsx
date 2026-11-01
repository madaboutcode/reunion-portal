// ConfirmationPage — route /confirmation/:id
// Fetches registration data from the API, handles all states:
// loading, expired (no token / 401), not found (404), error,
// pending, pending_verification, success (confirmed).
//
// Special case: status=pending WITH verified payments means the registration was
// previously confirmed and a staff edit created a supplementary payment. In this
// case we show "Additional payment required" instead of the standard pending view.

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getMyRegistration } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { ConfirmationLayout, DonationConfirmationLayout } from "@/components/confirmation";
import { SmritiLogo } from "@/components/ui/SmritiLogo";
import type { RegistrationResponseData } from "@smriti/shared";

type PageState =
  | "loading"
  | "success"
  | "pending"
  | "pending_verification"
  | "expired"
  | "notfound"
  | "error";

export default function ConfirmationPage() {
  useDocumentTitle("Registration Confirmed");

  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [data, setData] = useState<RegistrationResponseData | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

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
      setData(res.registration);

      const status = res.registration.status;
      if (status === "pending") {
        setPageState("pending");
      } else if (status === "pending_verification") {
        setPageState("pending_verification");
      } else {
        setPageState("success");
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
            "Something went wrong while loading your registration.",
        );
      }
    }
  }, []);

  useEffect(() => {
    fetchRegistration();
  }, [fetchRegistration]);

  useEffect(() => {
    if (
      (pageState === "success" ||
        pageState === "pending" ||
        pageState === "pending_verification") &&
      data?.regId &&
      id !== data.regId
    ) {
      navigate(`/confirmation/${data.regId}`, { replace: true });
    }
  }, [data?.regId, id, navigate, pageState]);

  // ── Loading ────────────────────────────────────────────────────────────

  if (pageState === "loading") {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-soft-aqua border-t-terracotta rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted">Loading your registration...</p>
        </div>
      </div>
    );
  }

  // ── Expired / not authenticated ────────────────────────────────────────

  if (pageState === "expired") {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <h1 className="font-heading text-xl font-bold text-charcoal mb-2">
            Session Expired
          </h1>
          <p className="text-sm text-muted mb-5">
            Your session has expired. Sign in with your email to view your
            registration.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="px-5 py-2.5 bg-terracotta text-white rounded-xl text-sm font-semibold cursor-pointer border-0"
          >
            Sign in with your email
          </button>
        </div>
      </div>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────

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
            We couldn&apos;t find your registration details. This can happen if
            you&apos;ve cleared your browser data.
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

  // ── Error ──────────────────────────────────────────────────────────────

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

  // ── Success / Pending / Pending Verification ───────────────────────────

  // data is guaranteed non-null here: all other pageState values return early above
  if (!data) return null;

  // Supplementary payment: registration was confirmed, staff edit cycled it back to pending.
  // Distinguish from fresh pending by the presence of verified payments.
  if (data.status === "pending" && data.hasVerifiedPayments) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="flex justify-center mb-6">
            <SmritiLogo size={72} href="/" />
          </div>
          <div className="bg-white rounded-2xl border border-border-warm p-6 shadow-sm text-center">
            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#D97706"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            </div>
            <h1 className="font-heading text-xl font-bold text-charcoal mb-2">
              Additional payment required
            </h1>
            <p className="text-sm text-muted mb-6 leading-relaxed">
              Your registration was updated and an additional payment is now
              due. Please complete the payment to confirm your spot.
            </p>
            <Link
              to={`/pay/${data.regCode}`}
              className="flex items-center justify-center w-full h-12 rounded-2xl bg-linear-to-br from-terracotta to-[#C45A40] text-sm font-bold text-white shadow-[0_10px_28px_rgba(215,107,81,0.3)] transition hover:brightness-95 no-underline"
            >
              Complete payment
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isDonationOnly = data.attendance.intent === "donation_only";

  if (isDonationOnly) {
    return (
      <DonationConfirmationLayout
        data={data}
        regCode={data.regCode ?? ""}
      />
    );
  }

  const status = data.status as "pending" | "pending_verification" | "confirmed";

  return (
    <ConfirmationLayout
      data={data}
      regCode={data.regCode ?? ""}
      status={status}
      onReset={() => navigate("/register")}
    />
  );
}
