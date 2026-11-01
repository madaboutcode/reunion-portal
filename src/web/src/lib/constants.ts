export {
  BRANCHES,
  BRANCH_COLORS,
  BRANCH_SHORT_NAMES,
  PRICING_DEFAULTS,
  formatRegCodeForDisplay,
  ACCOMMODATION_OPTIONS,
  ACCOMMODATION_VENUE,
  CHECKIN_OPTIONS,
  CHECKOUT_OPTIONS,
  INTENT_LABELS,
  MEAL_LABELS,
  ACCOMMODATION_LABELS,
  ACCOMMODATION_COPY,
  getAccommodationCatalog,
  GENDER_LABELS,
  generateId,
  formatINR,
  COLLEGE_CONTRIBUTION_CHIPS,
  COLLEGE_CONTRIBUTION_COPY,
  CONTRIBUTION_CAUSES,
  CONTRIBUTION_CAUSE_LABELS,
  CONTRIBUTION_CAUSE_VALUES,
  EVENT_GOALS,
} from "@smriti/shared";

export type { AccommodationCatalogEntry, Branch, ContributionCauseInfo, EventGoals } from "@smriti/shared";

import { INTENT_LABELS } from "@smriti/shared";

export const INTENT_OPTIONS = [
  { value: "attending" as const, icon: "🎓", label: INTENT_LABELS.attending, sub: "I'll be there in person on August 15" },
  { value: "donation_only" as const, icon: "❤️", label: INTENT_LABELS.donation_only, sub: "I want to contribute to the cause" },
  // "not_sure" hidden from UI — type preserved in shared schema for existing DB records
];

export { STEP_DEFINITIONS, WIZARD_STEP_COUNT } from "./wizard-steps";
export type { StepDefinition, WizardStepNumber } from "./wizard-steps";

export const PARTICIPATION_LABELS: Record<string, string> = {
  full_celebration: "Full Celebration",
  campus_only: "Campus Celebration",
  donation_only: "Donation Only",
};
