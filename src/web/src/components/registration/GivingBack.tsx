import { useState } from "react";
import { useStepValidation } from "@/hooks/useStepValidation";
import { givingBackSchema } from "@/lib/validation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/form/FormField";
import { WizardStepLayout } from "@/components/registration/WizardStepLayout";
import {
  COLLEGE_CONTRIBUTION_CHIPS,
  COLLEGE_CONTRIBUTION_COPY,
  CONTRIBUTION_CAUSES,
  PRICING_DEFAULTS,
  formatINR,
} from "@/lib/constants";
import type { WizardDraft } from "@/types/registration";
import type { ContributionCause } from "@/types/registration";

// ── Types ──────────────────────────────────────────────────────────────────

export interface GivingBackProps {
  data: WizardDraft;
  onChange: (updates: Partial<WizardDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DONATION_CHIPS = [5000, 10000, 20000, 25000, 50000, 100000] as const;

function formatDonationChipLabel(amount: number): string {
  if (amount >= 100000) return "₹1,00,000";
  return formatINR(amount);
}

// ── CausePicker sub-component ──────────────────────────────────────────────

interface CausePickerProps {
  selected: ContributionCause | "";
  onSelect: (cause: ContributionCause) => void;
  error: string | undefined;
}

function CausePicker({ selected, onSelect, error }: CausePickerProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpand = (value: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [value]: !prev[value] }));
  };

  return (
    <div>
      {CONTRIBUTION_CAUSES.map((cause) => {
        const isSelected = selected === cause.value;
        const isExpanded = expanded[cause.value] ?? false;

        return (
          <div
            key={cause.value}
            role="radio"
            aria-checked={isSelected}
            tabIndex={0}
            data-testid={`cause-${cause.value}`}
            onClick={() => onSelect(cause.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(cause.value);
              }
            }}
            className={[
              "mb-[10px] overflow-hidden rounded-[14px] border-2 cursor-pointer transition-all duration-150",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/60",
              isSelected
                ? "border-terracotta bg-terracotta-light"
                : "border-border bg-white hover:border-terracotta/40",
            ].join(" ")}
          >
            {/* Card head */}
            <div className="flex items-start gap-3 px-4 py-[14px]">
              <span className="text-2xl leading-none mt-0.5" aria-hidden="true">
                {cause.emoji}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[15px] text-charcoal leading-snug m-0">
                  {cause.label}{" "}
                  <span className="font-accent text-[16px] text-terracotta font-normal not-italic">
                    — {cause.tagline}
                  </span>
                </p>
                <p className="text-[13px] text-subtle leading-[1.5] mt-1 m-0">
                  {cause.description}
                </p>
              </div>
              {/* Radio indicator */}
              <div
                className={[
                  "flex-shrink-0 w-[18px] h-[18px] rounded-full border-2 mt-0.5",
                  "flex items-center justify-center",
                  isSelected ? "border-terracotta" : "border-border",
                ].join(" ")}
                aria-hidden="true"
              >
                {isSelected && (
                  <div className="w-[10px] h-[10px] rounded-full bg-terracotta" />
                )}
              </div>
            </div>

            {/* Know more toggle */}
            <button
              type="button"
              onClick={(e) => toggleExpand(cause.value, e)}
              className="border-0 bg-transparent text-terracotta font-semibold text-[12.5px] px-4 pb-3 cursor-pointer font-body leading-none min-h-[44px] flex items-center"
              aria-expanded={isExpanded}
            >
              {isExpanded ? "Know less ▴" : "Know more ▾"}
            </button>

            {/* Expandable details */}
            {isExpanded && (
              <div className="px-4 pb-4">
                <ul className="list-disc pl-[18px] m-0 space-y-1">
                  {cause.details.map((detail, i) => (
                    <li key={i} className="text-[12.5px] text-subtle leading-[1.7]">
                      {detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}

      {/* Cause error */}
      {error && (
        <p className="text-[12.5px] text-error mt-1">⚠ {error}</p>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function GivingBack({ data, onChange, onNext, onBack }: GivingBackProps) {
  const isDonationOnly = data.participationType === "donation_only";
  const felicitationThreshold = PRICING_DEFAULTS.donationFelicitationThreshold;

  // Validation — givingBackSchema handles both donation_only and attending paths
  const { errors, validate, clearError } = useStepValidation(givingBackSchema);

  // ── College contribution handlers ────────────────────────────────────────

  const handleCollegeChip = (amount: number) => {
    onChange({ collegeContribution: amount });
    clearError("collegeContribution");
  };

  const handleCollegeAmountChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    const parsed = parseInt(digits, 10);
    onChange({ collegeContribution: isNaN(parsed) ? 0 : parsed });
    clearError("collegeContribution");
  };

  const handleCauseSelect = (cause: ContributionCause) => {
    onChange({ collegeContributionCause: cause });
    clearError("collegeContributionCause");
  };

  // ── Donation handlers ────────────────────────────────────────────────────

  const handleDonationChip = (amount: number) => {
    onChange({ donationAmount: String(amount) });
    clearError("donationAmount");
  };

  const handleDonationAmountChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    onChange({ donationAmount: digits });
    clearError("donationAmount");
  };

  // ── Continue ─────────────────────────────────────────────────────────────

  const handleContinue = () => {
    if (!validate(data)) return;
    onNext();
  };

  // ── Derived display values ───────────────────────────────────────────────

  const collegeContribution = data.collegeContribution ?? 0;
  const activeCollegeChip =
    collegeContribution > 0 &&
    (COLLEGE_CONTRIBUTION_CHIPS as readonly number[]).includes(collegeContribution)
      ? collegeContribution
      : null;

  const donationAmountNum = parseInt(data.donationAmount ?? "", 10);
  const showFelicitation =
    !isNaN(donationAmountNum) && donationAmountNum >= felicitationThreshold;

  const activeDonationChip =
    !isNaN(donationAmountNum) &&
    (DONATION_CHIPS as readonly number[]).includes(donationAmountNum)
      ? donationAmountNum
      : null;

  const stepTitle = isDonationOnly ? "Donation" : "Giving Back";

  // ── Form body ────────────────────────────────────────────────────────────

  const formContent = (
    <div className="animate-step-in">
      {/* ── Title ── */}
      <div className="flex items-center gap-2">
        <h2 className="font-heading font-bold text-charcoal text-[22px] sm:text-[26px] m-0">
          {stepTitle}
        </h2>
        <span className="text-xl" aria-hidden="true">
          {isDonationOnly ? "💝" : "🎁"}
        </span>
      </div>
      <p className="font-accent text-base text-terracotta italic mb-5">
        {isDonationOnly
          ? "Make a difference — your donation helps make this reunion special."
          : "Give back a little, make it a lot more special."}
      </p>

      {/* ── Section A: Batch Contribution to College ── */}
      <Card className="mb-4" padding={false}>
        <CardHeader
          icon={<span className="text-lg" aria-hidden="true">🏛️</span>}
          title={COLLEGE_CONTRIBUTION_COPY.sectionTitle}
          accent="var(--color-soft-aqua)"
        />
        <div className="p-5">
          <p className="text-sm text-subtle leading-[1.5] mb-1">
            {isDonationOnly
              ? COLLEGE_CONTRIBUTION_COPY.description + "."
              : `${COLLEGE_CONTRIBUTION_COPY.description}. ${COLLEGE_CONTRIBUTION_COPY.minimumNote} — increase it to make a bigger impact.`}
          </p>

          {/* Cause prompt + picker — pick first, then how much */}
          <p className="text-sm text-subtle leading-[1.5] mb-3">
            {COLLEGE_CONTRIBUTION_COPY.causePrompt}.
          </p>
          <CausePicker
            selected={data.collegeContributionCause ?? ""}
            onSelect={handleCauseSelect}
            error={errors.collegeContributionCause}
          />

          {/* Amount input */}
          <div className="mt-4 mb-3">
            <FormField
              label="Additional contribution"
              error={errors.collegeContribution}
            >
              <Input
                prefix="₹"
                inputMode="numeric"
                data-testid="college-contribution"
                value={collegeContribution > 0 ? String(collegeContribution) : ""}
                onChange={(e) => handleCollegeAmountChange(e.target.value)}
                placeholder="0"
                error={!!errors.collegeContribution}
                className="w-[180px]"
              />
            </FormField>
          </div>

          {/* Quick-select chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            {COLLEGE_CONTRIBUTION_CHIPS.map((amount: number) => {
              const active = activeCollegeChip === amount;
              return (
                <button
                  key={amount}
                  type="button"
                  onClick={() => handleCollegeChip(amount)}
                  className={[
                    "px-4 py-2",
                    "rounded-xl border-2",
                    "text-sm font-semibold font-body",
                    "cursor-pointer transition-all duration-150",
                    active
                      ? "border-soft-aqua bg-soft-aqua-light text-[#2a7a80]"
                      : "border-border bg-white text-charcoal hover:border-soft-aqua/60",
                  ].join(" ")}
                >
                  {formatINR(amount)}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ── Section B: Reunion Donation ── */}
      <Card className="mb-4" padding={false}>
        <CardHeader
          icon={<span className="text-lg" aria-hidden="true">💛</span>}
          title="Give Back to the Reunion"
          accent="var(--color-terracotta)"
        />
        <div className="p-5">
          <p className="text-sm text-subtle leading-[1.6] mb-4">
            The registration fee covers the basics. If you'd like to chip in a
            little more — better food, more activities, goodies for everyone —
            any amount helps. It's optional, and every rupee goes straight into
            making this reunion more memorable for the whole batch.
          </p>

          {/* Donation amount input */}
          <div className="mb-3">
            <FormField
              label="Donation amount"
              error={errors.donationAmount}
            >
              <Input
                prefix="₹"
                inputMode="numeric"
                data-testid="donation-amount"
                value={data.donationAmount ?? ""}
                onChange={(e) => handleDonationAmountChange(e.target.value)}
                placeholder="0"
                error={!!errors.donationAmount}
                className="w-[180px]"
              />
            </FormField>
          </div>

          {/* Quick-select chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            {DONATION_CHIPS.map((amount) => {
              const active = activeDonationChip === amount;
              return (
                <button
                  key={amount}
                  type="button"
                  onClick={() => handleDonationChip(amount)}
                  className={[
                    "px-3.5 py-2",
                    "rounded-xl border-2",
                    "text-[13px] font-semibold font-body",
                    "cursor-pointer transition-all duration-150",
                    active
                      ? "border-terracotta bg-terracotta-light text-terracotta"
                      : "border-border bg-white text-charcoal hover:border-terracotta/50",
                  ].join(" ")}
                >
                  {formatDonationChipLabel(amount)}
                </button>
              );
            })}
          </div>

          {/* Felicitation note + consent — shown when donation ≥ threshold */}
          {showFelicitation && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
              <p className="text-[13px] text-amber-800 leading-[1.5] mb-2">
                🏅 Contributions of{" "}
                <strong>{formatINR(felicitationThreshold)} and above</strong>{" "}
                are eligible for on-stage felicitation at the reunion.
              </p>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={data.felicitationConsent ?? false}
                  onChange={(e) =>
                    onChange({ felicitationConsent: e.target.checked })
                  }
                  className="mt-0.5 w-4 h-4 rounded accent-amber-600 cursor-pointer flex-shrink-0"
                />
                <span className="text-[13px] text-amber-800 leading-[1.5]">
                  I consent to being felicitated on stage at the event.
                </span>
              </label>
            </div>
          )}

          {/* Public acknowledgement checkbox */}
          <div className="mb-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={data.publicAcknowledgement ?? false}
                onChange={(e) =>
                  onChange({ publicAcknowledgement: e.target.checked })
                }
                className="mt-0.5 w-4 h-4 rounded accent-terracotta cursor-pointer flex-shrink-0"
              />
              <span className="text-sm text-charcoal leading-[1.5]">
                I consent to my name being listed as a contributor on the event
                programme.
              </span>
            </label>
          </div>

          {/* Display name — only when public acknowledgement is checked */}
          {data.publicAcknowledgement && (
            <div className="ml-[26px]">
              <FormField label="Name to display on programme">
                <Input
                  value={data.acknowledgementDisplayName ?? ""}
                  onChange={(e) =>
                    onChange({ acknowledgementDisplayName: e.target.value })
                  }
                  placeholder={data.fullName ?? "Your full name"}
                  className="max-w-sm"
                />
              </FormField>
            </div>
          )}
        </div>
      </Card>

    </div>
  );

  return (
    <WizardStepLayout data={data} onBack={onBack} onNext={handleContinue}>
      {formContent}
    </WizardStepLayout>
  );
}
