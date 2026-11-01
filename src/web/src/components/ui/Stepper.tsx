import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  STEP_DEFINITIONS,
  formatStepAriaLabel,
  formatStepCount,
  getMobileProgressPct,
  isStepInBounds,
  type StepDefinition,
} from "@/lib/wizard-steps";

export type { StepDefinition };

export interface StepperProps {
  /** 1-based position in the active steps array. */
  currentStep: number;
  /** Active step definitions (pre-filtered — no disabled steps). Defaults to STEP_DEFINITIONS. */
  steps?: readonly StepDefinition[];
  /** Called when a completed or current step is clicked. Receives the step's id. */
  onStepClick?: (stepId: number) => void;
  /** Highest step index (1-based in active array) the user has reached. Steps up to this show as completed even if currentStep is lower (editing). */
  maxReachedStep?: number;
}

// ── SVG Icons (keyed by step id) ──────────────────────────────────────────

const PARTICIPATION_ICON = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M4 6h16M4 12h16M4 18h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="18" cy="18" r="3" stroke="currentColor" strokeWidth="1.5" />
    <path d="M16.5 18l1 1 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PERSON_ICON = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M4 20v-1c0-2.8 3.6-4.5 8-4.5s8 1.7 8 4.5v1"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const GROUP_ICON = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="16" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" />
    <path
      d="M2 20v-.5c0-2.5 3-4 7-4s7 1.5 7 4v.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <path
      d="M16.5 15.5c2.5.3 5 1.5 5 3.5v1"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

const BUILDING_ICON = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="3" y="13" width="18" height="7" rx="2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M3 16h18M7 13V9a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const UPLOAD_ICON = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M12 9v6M9 12l3-3 3 3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const RECEIPT_ICON = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M3 10h18M3 14h18M7 6V4M17 6V4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const CHECKMARK_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path
      d="M5 13l4 4L19 7"
      stroke="#2A7A80"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const HEART_ICON = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path
      d="M12 21C12 21 3 14.5 3 8.5C3 5.4 5.4 3 8.5 3C10.1 3 11.6 3.8 12 5C12.4 3.8 13.9 3 15.5 3C18.6 3 21 5.4 21 8.5C21 14.5 12 21 12 21Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const STEP_ICONS: Record<number, (size: number) => ReactNode> = {
  1: PARTICIPATION_ICON,
  2: PERSON_ICON,
  3: GROUP_ICON,
  4: BUILDING_ICON,
  5: HEART_ICON,
  6: UPLOAD_ICON,
  7: RECEIPT_ICON,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function getDesktopCircleColor(
  n: number,
  currentStep: number,
  maxReached: number,
): string {
  if (n === currentStep)
    return "bg-terracotta border-terracotta shadow-[0_3px_10px_rgba(215,107,81,0.25)]";
  if (n <= maxReached) return "bg-soft-aqua border-soft-aqua";
  return "bg-transparent border-[rgba(200,180,150,0.3)]";
}

function getDesktopIconColor(
  n: number,
  currentStep: number,
  maxReached: number,
): string {
  if (n === currentStep) return "text-white";
  if (n <= maxReached) return "";
  return "text-[#B8A898]";
}

function getDesktopLabelClass(
  n: number,
  currentStep: number,
  maxReached: number,
): string {
  if (n === currentStep) return "text-terracotta font-bold";
  if (n <= maxReached) return "text-[#2A7A80] font-semibold";
  return "text-[#B8A898]";
}

function getLineClass(
  n: number,
  currentStep: number,
  maxReached: number,
): string {
  if (n < currentStep || n < maxReached) return "border-soft-aqua border-solid";
  return "border-dashed border-[rgba(200,180,150,0.3)]";
}

// ── Component ──────────────────────────────────────────────────────────────

export function Stepper({
  currentStep,
  steps = [...STEP_DEFINITIONS],
  onStepClick,
  maxReachedStep,
}: StepperProps) {
  const effectiveMax = maxReachedStep ?? currentStep;
  const isMobile = useIsMobile();

  if (!isStepInBounds(currentStep, steps)) {
    return null;
  }

  // ── Mobile ───────────────────────────────────────────────────────────────

  if (isMobile) {
    const currentStepData = steps[currentStep - 1];
    const progressPct = getMobileProgressPct(currentStep, steps.length);
    const CurrentIcon = STEP_ICONS[currentStepData.id];

    return (
      <div
        className="px-5 pt-[10px] pb-[12px] animate-[fadeIn_0.3s_ease_0.1s_both]"
        role="progressbar"
        aria-valuenow={currentStep}
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-label={formatStepAriaLabel(currentStep, {
          steps,
          includeStepName: true,
        })}
      >
        {/* Top row: icon + name | step count */}
        <div className="flex justify-between items-center mb-[7px]">
          <div className="flex items-center gap-[6px]">
            <span className="text-terracotta">{CurrentIcon?.(16)}</span>
            <span className="text-sm text-charcoal font-semibold leading-none">
              {currentStepData.mobileLabel}
            </span>
          </div>
          <span className="text-sm text-subtle">
            {formatStepCount(currentStep, steps.length)}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-[3px] bg-[rgba(200,180,150,0.2)] rounded-[2px] overflow-hidden">
          <div
            className="h-full rounded-[2px] bg-linear-to-r from-soft-aqua to-terracotta"
            style={{
              width: `${progressPct}%`,
              transition: "width 0.45s ease",
            }}
          />
        </div>
      </div>
    );
  }

  // ── Desktop ──────────────────────────────────────────────────────────────

  return (
    <div
      className="pt-5 pb-4 animate-[fadeIn_0.3s_ease_0.1s_both]"
      role="progressbar"
      aria-valuenow={currentStep}
      aria-valuemin={1}
      aria-valuemax={steps.length}
      aria-label={formatStepAriaLabel(currentStep, { steps })}
    >
      <div className="max-w-[820px] mx-auto px-8 flex items-start">
        {steps.map((step, i) => {
          const n = i + 1;
          const done = n !== currentStep && n <= effectiveMax;
          const clickable = onStepClick && n <= effectiveMax;
          const IconRenderer = STEP_ICONS[step.id];

          return (
            <div key={step.id} className="contents">
              {/* Step circle + label */}
              <div
                className={[
                  "flex flex-col items-center gap-[6px] shrink-0",
                  clickable ? "cursor-pointer" : "",
                ].join(" ")}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-label={clickable ? `Go to ${step.label.replace("\n", " ")}` : undefined}
                onClick={clickable ? () => onStepClick(step.id) : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onStepClick(step.id); } } : undefined}
              >
                <div
                  className={[
                    "w-[38px] h-[38px] rounded-full",
                    "border-2",
                    "flex items-center justify-center",
                    "transition-all duration-300",
                    getDesktopCircleColor(n, currentStep, effectiveMax),
                  ].join(" ")}
                >
                  {done ? (
                    CHECKMARK_ICON
                  ) : (
                    <span className={getDesktopIconColor(n, currentStep, effectiveMax)}>
                      {IconRenderer?.(18)}
                    </span>
                  )}
                </div>
                <span
                  className={[
                    "text-sm text-center whitespace-pre-line leading-[1.3]",
                    getDesktopLabelClass(n, currentStep, effectiveMax),
                  ].join(" ")}
                >
                  {step.label}
                </span>
              </div>

              {/* Connecting line (not after last step) */}
              {i < steps.length - 1 && (
                <div
                  className={[
                    "flex-1 mt-[18px] mx-1",
                    "border-t-2",
                    "transition-all duration-300",
                    getLineClass(n, currentStep, effectiveMax),
                  ].join(" ")}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
