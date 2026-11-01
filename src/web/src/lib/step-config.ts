import type { WizardState, WizardStep } from "@/types/registration";
import { WIZARD_STEP_COUNT } from "@/lib/wizard-steps";

/**
 * Derives the set of step numbers (1-7) that should be skipped in the
 * current wizard flow. Pure function — no side effects.
 *
 * Disabled rules, all conditional on participationType:
 *   - donation_only → steps 3 (Your Group) and 4 (Your Stay) are skipped
 *   - campus_only   → step 4 (Your Stay) is skipped
 *   - full_celebration → no steps skipped
 */
export function getDisabledSteps(state: WizardState): Set<number> {
  const disabled = new Set<number>();

  if (state.participationType === "donation_only") {
    disabled.add(3); // Your Group
    disabled.add(4); // Your Stay
  } else if (state.participationType === "campus_only") {
    disabled.add(4); // Your Stay
  }

  return disabled;
}

/**
 * Returns the next non-disabled step, or "confirmation" if nothing remains.
 * Skips steps listed in `disabledSteps`.
 */
export function resolveNextStep(
  step: WizardStep,
  disabledSteps: Set<number>,
): WizardStep {
  if (step === "confirmation") return "confirmation";
  if (step === WIZARD_STEP_COUNT) return "confirmation";

  let next = (step as number) + 1;
  while (next <= WIZARD_STEP_COUNT && disabledSteps.has(next)) {
    next++;
  }
  // All remaining steps are disabled — skip to confirmation
  if (next > WIZARD_STEP_COUNT) return "confirmation";
  return next as WizardStep;
}

/**
 * Returns the previous non-disabled step.
 * From "confirmation", finds the last non-disabled step (walking down from 7).
 * Falls back to step 1 if all steps are disabled.
 */
export function resolveBackStep(
  step: WizardStep,
  disabledSteps: Set<number>,
): WizardStep {
  if (step === "confirmation") {
    let prev = WIZARD_STEP_COUNT;
    while (prev >= 1 && disabledSteps.has(prev)) {
      prev--;
    }
    return (prev >= 1 ? prev : 1) as WizardStep;
  }

  let prev = (step as number) - 1;
  while (prev >= 1 && disabledSteps.has(prev)) {
    prev--;
  }
  return (Math.max(prev, 1)) as WizardStep;
}
