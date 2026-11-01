/**
 * Single source of truth for registration wizard step metadata and
 * step-index display helpers (labels, "Step N of M", progress %).
 *
 * Navigation skip logic lives in step-config.ts.
 */

export type StepKey =
  | "participation"
  | "about_you"
  | "your_group"
  | "your_stay"
  | "giving_back"
  | "photo_id"
  | "review_pay";

export interface StepDefinition {
  key: StepKey;
  id: number;
  label: string;
  mobileLabel: string;
}

export const STEP_DEFINITIONS: readonly StepDefinition[] = [
  { key: "participation", id: 1, label: "Participation", mobileLabel: "Participation" },
  { key: "about_you", id: 2, label: "About You", mobileLabel: "About You" },
  { key: "your_group", id: 3, label: "Your Group", mobileLabel: "Your Group" },
  { key: "your_stay", id: 4, label: "Your Stay", mobileLabel: "Your Stay" },
  { key: "giving_back", id: 5, label: "Giving Back", mobileLabel: "Giving Back" },
  { key: "photo_id", id: 6, label: "Photo & ID", mobileLabel: "Photo & ID" },
  { key: "review_pay", id: 7, label: "Review", mobileLabel: "Review" },
] as const;

/** Semantic step ID lookup — use this instead of magic numbers. */
export const STEP = Object.fromEntries(
  STEP_DEFINITIONS.map((s) => [s.key, s.id]),
) as Record<StepKey, number>;

export const WIZARD_STEP_COUNT = STEP_DEFINITIONS.length;

/** Numeric wizard steps (excludes "confirmation"). */
export type WizardStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export function isWizardStepNumber(step: number): step is WizardStepNumber {
  return Number.isInteger(step) && step >= 1 && step <= WIZARD_STEP_COUNT;
}

export function getStepDefinition(
  step: number,
  steps: readonly StepDefinition[] = STEP_DEFINITIONS,
): StepDefinition | undefined {
  if (!Number.isInteger(step) || step < 1 || step > steps.length) {
    return undefined;
  }
  return steps[step - 1];
}

export function isStepInBounds(
  step: number,
  steps: readonly StepDefinition[] = STEP_DEFINITIONS,
): boolean {
  return getStepDefinition(step, steps) !== undefined;
}

/** e.g. "Step 2 of 7" */
export function formatStepCount(
  step: number,
  total: number = WIZARD_STEP_COUNT,
): string {
  return `Step ${step} of ${total}`;
}

/** Progressbar aria-label; includes step name when requested (mobile). */
export function formatStepAriaLabel(
  step: number,
  options?: {
    steps?: readonly StepDefinition[];
    includeStepName?: boolean;
  },
): string {
  const steps = options?.steps ?? STEP_DEFINITIONS;
  const base = formatStepCount(step, steps.length);
  if (!options?.includeStepName) {
    return base;
  }
  const def = getStepDefinition(step, steps);
  return def ? `${base}: ${def.mobileLabel}` : base;
}

/** Mobile progress bar fill: 20% at step 1 → 100% at last step. */
export function getMobileProgressPct(
  step: number,
  total: number = WIZARD_STEP_COUNT,
): number {
  if (total <= 1) return 100;
  return ((step - 1) / (total - 1)) * 80 + 20;
}