import { createInitialData } from "@/lib/pricing";
import { getDisabledSteps } from "@/lib/step-config";
import type { WizardState, WizardStep } from "@/types/registration";
import type { ParticipationType } from "@smriti/shared";
import { WIZARD_STEP_COUNT } from "@/lib/wizard-steps";

/** Clamp saved step when participation skip rules make it invalid (R19 resume). */
export function clampResumeStep(
  participationType: ParticipationType,
  requestedStep: number,
): WizardStep {
  const disabled = getDisabledSteps({
    participationType,
    currentStep: 1,
  } as WizardState);

  if (
    requestedStep >= 1 &&
    requestedStep <= WIZARD_STEP_COUNT &&
    !disabled.has(requestedStep)
  ) {
    return requestedStep as WizardStep;
  }

  for (let step = Math.min(requestedStep, WIZARD_STEP_COUNT); step >= 1; step--) {
    if (!disabled.has(step)) {
      return step as WizardStep;
    }
  }

  return 1;
}

export function buildInitialWizardState(
  saved: Partial<WizardState> | null,
): WizardState {
  const defaults = createInitialData();
  const merged = { ...defaults, ...saved } as WizardState;

  const rawStep = saved?.currentStep;
  const requested =
    typeof rawStep === "number" ? rawStep : Number.parseInt(String(rawStep), 10);

  const currentStep =
    saved && Number.isFinite(requested) && requested >= 1
      ? clampResumeStep(merged.participationType, requested)
      : 1;

  const stepNum = typeof currentStep === "number" ? currentStep : 1;
  const maxReachedStep = Math.max(stepNum, saved?.maxReachedStep ?? 1);

  return { ...merged, currentStep, maxReachedStep };
}