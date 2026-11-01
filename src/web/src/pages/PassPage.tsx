import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { lookupByCode, type PassData } from "@/lib/api";
import { isStaff } from "@/lib/auth";
import { useStaffScopes } from "@/hooks/useStaffScopes";
import { formatRegCodeForDisplay } from "@smriti/shared";
import { EntryPassCard } from "@/components/confirmation/EntryPassCard";
import type { ParticipationType } from "@/types/registration";

type PageState = "loading" | "success" | "notfound" | "error";

export default function PassPage() {
  useDocumentTitle("Your Pass");
  const navigate = useNavigate();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [passData, setPassData] = useState<PassData | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // A scanned pass QR opens `/pass#{code}`. Staff at the registration desk
  // (role staff/admin WITH the registration_desk scope) are handed off to the
  // desk detail view instead of the public pass. Everyone else — attendees, and
  // staff without that scope — sees the public pass below.
  const code = globalThis.location?.hash?.slice(1) ?? "";
  const staff = isStaff();
  const { loaded: scopesLoaded, hasScope } = useStaffScopes();
  const deciding = staff && !scopesLoaded; // waiting on the permission fetch
  const redirectToDesk =
    staff && scopesLoaded && !!code && hasScope("registration_desk");

  useEffect(() => {
    if (redirectToDesk) {
      navigate(`/staff/check-in/registration/${code}`, { replace: true });
    }
  }, [redirectToDesk, code, navigate]);

  useEffect(() => {
    // Hold on the loading spinner while we decide (staff scope fetch pending)
    // or while handing off to the desk view — never flash the public pass.
    if (deciding || redirectToDesk) return;

    let alive = true;
    if (!code) {
      setPageState("notfound");
      return;
    }

    lookupByCode(code)
      .then((data) => {
        if (!alive) return;
        setPassData(data);
        setPageState("success");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const status = (err as { status?: number })?.status;
        if (status === 404) {
          setPageState("notfound");
        } else if (status === 429) {
          setPageState("error");
          setErrorMessage("Too many attempts. Please wait a moment and try again.");
        } else {
          setPageState("error");
          setErrorMessage(
            (err as { error?: string })?.error ??
              "Something went wrong while loading your pass.",
          );
        }
      });

    return () => { alive = false; };
  }, [deciding, redirectToDesk, code]);

  if (pageState === "loading") {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-soft-aqua border-t-terracotta rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted">Recognizing your pass...</p>
        </div>
      </div>
    );
  }

  if (pageState === "notfound") {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <h1 className="font-heading text-xl font-bold text-charcoal mb-2">
            Pass Not Recognized
          </h1>
          <p className="text-sm text-muted mb-5">
            We couldn&apos;t find a registration for this pass code. Please
            check the code and try again.
          </p>
        </div>
      </div>
    );
  }

  if (pageState === "error") {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="#DC2626" strokeWidth="1.5" />
              <path d="M8 12h8" stroke="#DC2626" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="font-heading text-xl font-bold text-charcoal mb-2">
            Something went wrong
          </h1>
          <p className="text-sm text-muted mb-5">{errorMessage}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 bg-terracotta text-white rounded-xl text-sm font-semibold cursor-pointer border-0"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Donation-only: thank you, no pass
  if (passData?.attendanceIntent === "donation_only") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#FBF6EC" }}>
        <div className="text-center max-w-sm">
          <h1
            style={{
              fontFamily: "'Playfair Display', Georgia, serif",
              fontSize: 28,
              fontWeight: 700,
              fontStyle: "italic",
              color: "#D76B51",
              marginBottom: 8,
            }}
          >
            Thank You, {passData.name}!
          </h1>
          <p className="text-sm text-muted">
            Your generous contribution means the world to us.
            We&apos;ll keep you updated as the reunion takes shape.
          </p>
        </div>
      </div>
    );
  }

  // Success: render the pass
  const displayCode = formatRegCodeForDisplay(passData!.regCode);

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#FBF6EC" }}>
      <div className="flex flex-col items-center gap-4">
        <EntryPassCard
          reg={displayCode}
          name={passData!.name}
          rawCode={passData!.regCode}
          participationType={passData!.participationType as ParticipationType}
          size="mobile"
        />
        <button
          type="button"
          onClick={() => window.open(`/api/registrations/${passData!.regCode}/pass.pdf`, "_blank")}
          className="px-6 py-3 bg-[linear-gradient(135deg,#5B969C_0%,#4E848A_100%)] text-white rounded-xl text-sm font-semibold cursor-pointer border-0 shadow-[0_4px_12px_rgba(91,150,156,0.3)] hover:brightness-95 transition-all"
        >
          Download Pass (PDF)
        </button>
      </div>
    </div>
  );
}
