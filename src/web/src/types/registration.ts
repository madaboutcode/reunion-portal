export type {
  PricingConfig,
  PricingLineItem,
  PricingBreakup,
  AttendeeCounts,
  AttendanceIntent,
  ContributionCause,
  ParticipationType,
  MealPreference,
  AccommodationType,
  ChildAttendee,
  GuestAttendee,
  Registration,
  WizardDraft,
  Gender,
  TshirtSize,
} from "@smriti/shared";

import type { WizardDraft } from "@smriti/shared";

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | "confirmation";

export interface WizardState extends WizardDraft {
  currentStep: WizardStep;
  maxReachedStep: number;
}
