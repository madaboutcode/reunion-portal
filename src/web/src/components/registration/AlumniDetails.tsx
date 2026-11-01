import { useState, useEffect, useRef } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useStepValidation } from "@/hooks/useStepValidation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { COUNTRIES } from "@/lib/countries";
import { FormField } from "@/components/form/FormField";
import { EstimateSidebar } from "@/components/registration/EstimateSidebar";
import { HeartDoodle } from "@/components/ui/Doodles";
import { BRANCHES } from "@/lib/constants";
import { alumniDetailsSchema } from "@/lib/validation";
import { checkEmail, requestMagicLink } from "@/lib/api";
import type { WizardDraft, Gender } from "@/types/registration";

// ── Country dial codes ─────────────────────────────────────────────────────

const COUNTRY_DIAL_CODES: Record<string, string> = {
  "India": "+91",
  "United States": "+1",
  "United Kingdom": "+44",
  "United Arab Emirates": "+971",
  "Saudi Arabia": "+966",
  "Qatar": "+974",
  "Kuwait": "+965",
  "Bahrain": "+973",
  "Oman": "+968",
  "Singapore": "+65",
  "Malaysia": "+60",
  "Australia": "+61",
  "Canada": "+1",
  "Germany": "+49",
  "France": "+33",
};

// ── Types ──────────────────────────────────────────────────────────────────

export interface AlumniDetailsProps {
  data: WizardDraft;
  update: (changes: Partial<WizardDraft>) => void;
  onNext: () => void;
  onBack?: () => void;
  reset?: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function AlumniDetails({ data, update, onNext, onBack, reset }: AlumniDetailsProps) {
  const isMobile = useIsMobile();
  const [waved, setWaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const { errors, validate, clearError } = useStepValidation(alumniDetailsSchema);
  const hasDraft = useRef(Boolean(data.fullName || data.email));

  const [emailGate, setEmailGate] = useState<null | "checking" | "registered" | "sending" | "link-sent">(null);

  const handlePhoneChange = (field: "whatsapp" | "mobileAlternate", value: string) => {
    const trimmedLeading = value.replace(/^\s+/, "");
    const compactValue =
      data.country === "India" && trimmedLeading.startsWith("+91")
        ? `+91${trimmedLeading.slice(3).replace(/\D/g, "").slice(0, 10)}`
        : trimmedLeading;

    update({ [field]: compactValue });
  };

  const handleContinue = async () => {
    if (!validate(data)) return;
    setEmailGate("checking");
    try {
      const registered = await checkEmail(data.email);
      if (registered) {
        setEmailGate("registered");
        return;
      }
    } catch {
      // API failure — let them through
    }
    setEmailGate(null);
    onNext();
  };

  const handleSendLink = async () => {
    setEmailGate("sending");
    await requestMagicLink(data.email);
    setEmailGate("link-sent");
  };

  // Auto-fill WhatsApp dial code when country changes
  useEffect(() => {
    if (!data.country) return;
    const dialCode = COUNTRY_DIAL_CODES[data.country];
    if (!dialCode) return;
    const current = data.whatsapp ?? "";
    const isEmptyOrDialCodeOnly = current === "" || /^\+\d{1,4}$/.test(current);
    if (isEmptyOrDialCodeOnly) {
      update({ whatsapp: dialCode });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.country]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let scrolled = false;
    const onScroll = () => {
      scrolled = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (scrolled) {
          setWaved(true);
          window.removeEventListener("scroll", onScroll);
        }
      }, 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { clearTimeout(timer); window.removeEventListener("scroll", onScroll); };
  }, []);

  const formBody = (
    <div
      className={[
        "bg-surface",
        "rounded-[20px]",
        "border border-border-warm",
        "py-5 px-4 sm:py-8 sm:px-7",
        "shadow-[0_4px_28px_rgba(80,60,40,0.08)]",
      ].join(" ")}
    >
      {/* ── Title ── */}
      <div className="flex items-center gap-2 mb-1">
        <h2 className="font-heading text-[22px] sm:text-[26px] text-charcoal font-bold">
          Tell us about yourself
        </h2>
        <span className={`text-xl inline-block origin-bottom-right ${waved ? "animate-[wave_0.8s_ease_0.5s_both]" : ""}`} aria-hidden="true">👋</span>
      </div>

      {/* ── Subtitle ── */}
      <div className={`flex items-center gap-[6px] ${reset && hasDraft.current ? "mb-2" : "mb-6"}`}>
        <span className="font-accent text-[15px] text-terracotta">
          Let&apos;s start with a few details about you.
        </span>
        <HeartDoodle size={13} color="#D76B51" />
      </div>

      {/* ── Start fresh ── */}
      {reset && hasDraft.current && (
        <div className="mb-4">
          {!confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="text-sm text-subtle hover:text-charcoal transition-colors duration-150 cursor-pointer bg-transparent border-0 p-0 underline decoration-dotted underline-offset-2"
            >
              Returning? Start fresh instead
            </button>
          ) : (
            <div className="flex items-center gap-2 text-sm text-subtle">
              <span>Clear all your progress?</span>
              <button
                type="button"
                onClick={reset}
                className="text-sm font-semibold text-terracotta cursor-pointer bg-transparent border-0 p-0 hover:underline"
              >
                Yes, start over
              </button>
              <span className="text-border">·</span>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="text-sm font-semibold text-subtle cursor-pointer bg-transparent border-0 p-0 hover:underline"
              >
                No, keep it
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Full Name ── */}
      <div className="mb-4">
        <FormField label="Full Name" required error={errors.fullName}>
          <Input
            value={data.fullName}
            onChange={(e) => { update({ fullName: e.target.value }); clearError("fullName"); }}
            placeholder="What should we call you?"
            error={!!errors.fullName}
          />
        </FormField>
      </div>

      {/* ── Branch + Gender ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <FormField label="Branch" required error={errors.branch}>
          <Select
            value={data.branch}
            onChange={(e) => { update({ branch: e.target.value }); clearError("branch"); }}
            options={BRANCHES}
            placeholder="Select your branch"
            error={!!errors.branch}
          />
        </FormField>
        <FormField label="Gender" required error={errors.gender}>
          <Select
            data-testid="gender"
            value={data.gender ?? ""}
            onChange={(e) => { update({ gender: e.target.value as Gender }); clearError("gender"); }}
            options={[
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
            ]}
            placeholder="Select gender"
            error={!!errors.gender}
          />
        </FormField>
      </div>

      {/* ── Email ── */}
      <div className="mb-4">
        <FormField label="Email" required error={errors.email}>
          <Input
            type="email"
            value={data.email}
            onChange={(e) => { update({ email: e.target.value }); clearError("email"); }}
            placeholder="you@example.com"
            error={!!errors.email}
          />
        </FormField>
      </div>

      {/* ── City + Country ── */}
      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField label="City" required error={errors.city}>
          <Input
            value={data.city}
            onChange={(e) => { update({ city: e.target.value }); clearError("city"); }}
            placeholder="Your current city"
            error={!!errors.city}
          />
        </FormField>
        <FormField label="Country">
          <Select
            value={data.country}
            onChange={(e) => update({ country: e.target.value })}
            options={COUNTRIES}
            placeholder="Select your country"
          />
        </FormField>
      </div>

      {/* ── Phone numbers ── */}
      <div className="flex items-start gap-2 bg-soft-aqua/15 border border-soft-aqua/30 rounded-[10px] px-3 py-2 mb-3">
        <span className="text-[14px] leading-none mt-[2px]" aria-hidden="true">📞</span>
        <p className="text-[13px] text-charcoal/80 font-body">Include your country code, e.g. <strong>+91</strong> for India, <strong>+971</strong> for UAE</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-7">
        <FormField label="WhatsApp number" required error={errors.whatsapp}>
          <Input
            type="tel"
            autoComplete="tel"
            value={data.whatsapp}
            onChange={(e) => { handlePhoneChange("whatsapp", e.target.value); clearError("whatsapp"); }}
            placeholder="+91 98765 43210"
            error={!!errors.whatsapp}
          />
        </FormField>
        <FormField label="Mobile (alternate)">
          <Input
            type="tel"
            autoComplete="tel"
            value={data.mobileAlternate ?? ""}
            onChange={(e) => handlePhoneChange("mobileAlternate", e.target.value)}
            placeholder="+91 98765 43210"
          />
        </FormField>
      </div>

      {/* ── Desktop Continue ── */}
      <div className="hidden sm:flex justify-between items-center mt-8 pt-[22px] border-t border-[#f4f4f4]">
        {onBack ? (
          <Button variant="secondary" onClick={onBack}>← Back</Button>
        ) : (
          <span />
        )}
        <Button
          variant="primary"
          size="lg"
          onClick={handleContinue}
          loading={emailGate === "checking"}
          data-testid="step1-continue"
        >
          Continue →
        </Button>
      </div>
    </div>
  );

  const emailModal = (emailGate === "registered" || emailGate === "sending" || emailGate === "link-sent") && (
    <div
      className="fixed inset-0 z-[900] bg-black/40 flex items-center justify-center px-4"
      style={{ animation: "fadeIn 0.15s ease" }}
      onClick={(e) => { if (e.target === e.currentTarget && emailGate !== "sending") setEmailGate(null); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-surface rounded-2xl p-6 max-w-[420px] w-full shadow-xl border border-border-warm text-center"
      >
        <div className="text-3xl mb-3" aria-hidden="true">📧</div>
        <h2 className="font-heading text-lg font-bold text-charcoal mb-2">
          This email is already registered
        </h2>

        {emailGate === "registered" && (
          <>
            <p className="text-sm text-muted mb-6">
              We can send a login link to <strong className="text-charcoal">{data.email}</strong> so you can access your existing registration.
            </p>
            <div className="flex flex-col gap-3">
              <Button variant="primary" size="lg" onClick={handleSendLink} className="w-full">
                Send me a login link
              </Button>
              <button
                type="button"
                onClick={() => setEmailGate(null)}
                className="text-sm font-semibold text-subtle bg-transparent border-0 p-0 cursor-pointer hover:underline"
              >
                Use a different email
              </button>
            </div>
          </>
        )}

        {emailGate === "sending" && (
          <div className="py-4 flex flex-col items-center gap-2">
            <span className="inline-block w-5 h-5 border-2 border-soft-aqua border-t-terracotta rounded-full animate-spin" />
            <p className="text-sm text-muted">Sending login link...</p>
          </div>
        )}

        {emailGate === "link-sent" && (
          <>
            <p className="text-sm text-[#2A7A80] font-medium mb-6">
              Login link sent! Check your inbox (and spam folder).
            </p>
            <button
              type="button"
              onClick={() => setEmailGate(null)}
              className="text-sm font-semibold text-subtle bg-transparent border-0 p-0 cursor-pointer hover:underline"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );

  // ── Mobile Layout ──
  if (isMobile) {
    return (
      <>
        <div className="animate-step-in">
          <div className="px-3.5 py-4">{formBody}</div>
          <div className="h-mobile-bottom-spacer" />
          <div className="fixed fixed-bottom-safe left-0 right-0 bg-white border-t border-border p-3 flex gap-3 z-50 shadow-[0_-4px_24px_rgba(31,42,51,0.1)]">
            {onBack && (
              <Button variant="secondary" onClick={onBack}>← Back</Button>
            )}
            <Button
              variant="primary"
              size="lg"
              onClick={handleContinue}
              loading={emailGate === "checking"}
              className="flex-1"
            >
              Continue →
            </Button>
          </div>
        </div>
        {emailModal}
      </>
    );
  }

  // ── Desktop Layout ──
  return (
    <>
      <div className="max-w-[1100px] mx-auto px-8 pt-8 pb-14 animate-step-in">
        <div className="grid grid-cols-[3fr_2fr] gap-7 items-start">
          {formBody}
          <EstimateSidebar data={data} />
        </div>
      </div>
      {emailModal}
    </>
  );
}
