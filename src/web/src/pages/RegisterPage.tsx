import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import WizardShell from "@/components/WizardShell";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getMyRegistration } from "@/lib/api";
import { clearAuth, getToken } from "@/lib/auth";
import { SmritiLogo } from "@/components/ui/SmritiLogo";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { formatRegCodeForDisplay, type RegistrationResponseData } from "@smriti/shared";

type ExistingRegistrationState =
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "found"; registration: RegistrationResponseData };

export default function RegisterPage() {
  useDocumentTitle("Registration");
  const navigate = useNavigate();
  const showPage = useFeatureFlag("registration_show_page");
  const acceptNew = useFeatureFlag("registration_accept_new");
  const [existing, setExisting] = useState<ExistingRegistrationState>(() =>
    getToken() ? { kind: "checking" } : { kind: "none" },
  );

  useEffect(() => {
    if (!getToken()) {
      setExisting({ kind: "none" });
      return;
    }

    let alive = true;
    getMyRegistration()
      .then((res) => {
        if (!alive) return;
        if (res.registration.status === "confirmed") {
          setExisting({ kind: "found", registration: res.registration });
          return;
        }
        if (
          res.registration.status === "pending" ||
          res.registration.status === "pending_verification"
        ) {
          navigate(`/pay/${res.registration.regCode}`);
          return;
        }
        setExisting({ kind: "none" });
      })
      .catch((err: unknown) => {
        const status = (err as { status?: number })?.status;
        if (status === 401) clearAuth();
        if (alive) setExisting({ kind: "none" });
      });

    return () => {
      alive = false;
    };
  }, [navigate]);

  if (!showPage) {
    return <RegistrationClosed />;
  }

  if (existing.kind === "checking") {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-soft-aqua border-t-terracotta rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted">Checking your registration...</p>
        </div>
      </div>
    );
  }

  if (existing.kind === "found") {
    return (
      <ExistingRegistrationChoice
        registration={existing.registration}
        onViewPass={() =>
          navigate(`/confirmation/${existing.registration.regId}`)
        }
        onNewRegistration={acceptNew ? () => navigate("/new") : undefined}
      />
    );
  }

  if (!acceptNew) {
    return <RegistrationClosed />;
  }

  return <WizardShell />;
}

function RegistrationClosed() {
  return (
    <div className="min-h-screen bg-page relative overflow-hidden">
      <div className="relative z-10 min-h-screen flex items-center justify-center px-5 py-10">
        <section className="w-full max-w-[560px] rounded-[28px] border border-white/70 bg-[rgba(253,251,247,0.9)] p-6 text-center shadow-[0_24px_60px_rgba(79,56,31,0.12)] backdrop-blur-sm sm:p-8">
          <div className="mx-auto mb-5 flex justify-center">
            <SmritiLogo size={118} href="/" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-terracotta">
            Registration closed
          </p>
          <h1 className="mt-3 font-heading text-[2rem] leading-tight text-charcoal sm:text-[2.35rem]">
            Registrations are closed
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted sm:text-base">
            Registration for Smriti 2026 is no longer open. If you&apos;ve already
            registered, you can view your reunion pass.
          </p>
          <div className="mt-7">
            <a
              href="/pass"
              className="inline-flex h-12 items-center rounded-2xl border-0 bg-linear-to-br from-terracotta to-[#C45A40] px-8 text-sm font-bold text-white shadow-[0_10px_28px_rgba(215,107,81,0.3)] transition hover:brightness-95"
            >
              View your pass
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function ExistingRegistrationChoice({
  registration,
  onViewPass,
  onNewRegistration,
}: {
  registration: RegistrationResponseData;
  onViewPass: () => void;
  onNewRegistration?: () => void;
}) {
  const displayCode = formatRegCodeForDisplay(registration.regCode);

  return (
    <div className="min-h-screen bg-page relative overflow-hidden">
      <div className="relative z-10 min-h-screen flex items-center justify-center px-5 py-10">
        <section className="w-full max-w-[560px] rounded-[28px] border border-white/70 bg-[rgba(253,251,247,0.9)] p-6 text-center shadow-[0_24px_60px_rgba(79,56,31,0.12)] backdrop-blur-sm sm:p-8">
          <div className="mx-auto mb-5 flex justify-center">
            <SmritiLogo size={118} href="/" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2A7A80]">
            Registration found
          </p>
          <h1 className="mt-3 font-heading text-[2rem] leading-tight text-charcoal sm:text-[2.35rem]">
            You&apos;re already registered
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted sm:text-base">
            Use your reunion pass for check-in, or start a fresh registration if
            you&apos;re registering another batchmate.
          </p>

          <div className="mx-auto mt-6 max-w-sm rounded-2xl border border-border-warm bg-white/78 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-subtle">
              Pass code
            </div>
            <div className="mt-1 font-mono text-[15px] font-bold tracking-[0.08em] text-charcoal">
              {displayCode}
            </div>
          </div>

          <div className={`mt-7 grid gap-3 ${onNewRegistration ? "sm:grid-cols-2" : ""}`}>
            <button
              type="button"
              onClick={onViewPass}
              className="h-12 rounded-2xl border-0 bg-linear-to-br from-terracotta to-[#C45A40] px-5 text-sm font-bold text-white shadow-[0_10px_28px_rgba(215,107,81,0.3)] transition hover:brightness-95"
            >
              See pass
            </button>
            {onNewRegistration && (
              <button
                type="button"
                onClick={onNewRegistration}
                className="h-12 rounded-2xl border border-border bg-white px-5 text-sm font-bold text-charcoal transition hover:border-terracotta"
              >
                New registration
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
