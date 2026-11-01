import type { PricingConfig, AttendanceIntent, ParticipationType, MealPreference, AccommodationType, NonNoneAccommodation, Gender, ContributionCause } from "./types.ts";

// ── Event goals (staff dashboard derivation config) ──────────────────────────
// CONTRACT:
//   GUARANTEES: exports EVENT_GOALS with fullCelebrationTarget=200,
//     campusOnlyTarget=50, registrationTargetDate="2026-07-15",
//     pendingAgeAmberDays=3, eventBudgetTarget=2300000. Typed via EventGoals
//     interface.
//   EXPECTS: consumers treat values as display/derivation inputs only — no cap
//     enforcement anywhere.
//   FAILURE BEHAVIOR: n/a (static config).

export interface EventGoals {
  /** Target number of full-celebration registrations (counted slot basis). */
  fullCelebrationTarget: number;
  /** Target number of campus-only registrations (counted slot basis). */
  campusOnlyTarget: number;
  /** Internal registration target date — ISO date string, "YYYY-MM-DD". */
  registrationTargetDate: string;
  /** Days after which a pending payment is amber-flagged on the staff dashboard. */
  pendingAgeAmberDays: number;
  /** Committee-set event fee budget target (INR), for the reports Budget Progress meter. */
  eventBudgetTarget: number;
}

export const EVENT_GOALS: EventGoals = {
  fullCelebrationTarget: 200,
  campusOnlyTarget: 50,
  registrationTargetDate: "2026-07-15",
  pendingAgeAmberDays: 3,
  eventBudgetTarget: 2300000,
};

export const BRANCHES = [
  "Architecture",
  "Chemical Engineering",
  "Civil Engineering",
  "Computer Science & Engineering",
  "Electrical & Electronics Engineering",
  "Electronics & Communication Engineering",
  "Mechanical Engineering",
  "Production Engineering",
] as const;

export type Branch = typeof BRANCHES[number];

/** Short display names for use in tables and compact UI. */
export const BRANCH_SHORT_NAMES: Record<Branch, string> = {
  "Architecture": "Arch",
  "Chemical Engineering": "Chem",
  "Civil Engineering": "Civil",
  "Computer Science & Engineering": "CSE",
  "Electrical & Electronics Engineering": "EEE",
  "Electronics & Communication Engineering": "ECE",
  "Mechanical Engineering": "ME",
  "Production Engineering": "PE",
};

/** Accent colors for branch sections and filters on the public Who's Coming page. */
export const BRANCH_COLORS: Record<Branch, string> = {
  "Architecture": "#8B6914",
  "Chemical Engineering": "#7361E8",
  "Civil Engineering": "#2C9088",
  "Computer Science & Engineering": "#4D79D6",
  "Electrical & Electronics Engineering": "#C2891B",
  "Electronics & Communication Engineering": "#1F9E8F",
  "Mechanical Engineering": "#C2466A",
  "Production Engineering": "#D9591F",
};

export const PRICING_DEFAULTS: PricingConfig = {
  alumniBaseFee: 8500,
  campusOnlyBaseFee: 5500,
  additionalPersonFee: 2700,
  // Food fees: ₹550 college food (no GST) + ₹2,000 Raviz food × 1.18 GST = ₹2,910
  spouseFee: 2910,
  childFee6to12: 1455, // 50% of adult rate
  childFee12plus: 2910, // same as adult
  guestFee: 2910,
  campusOnlySpouseFee: 550,
  campusOnlyChildFee6to12: 275, // 50% of adult campus rate
  campusOnlyChildFee12plus: 550, // same as adult
  campusOnlyGuestFee: 550,
  childFreeAgeThreshold: 6,
  accommodationEnabled: true,
  accommodationPrivateFee: 12000,
  accommodationSharedDoubleFee: 6000,
  accommodationSharedTripleFee: 4500,
  accommodationExtraBedFee: 1500,
  accommodationChild6to12Fee: 1000,
  accommodationChildBedAge: 12,
  accommodationTaxPercent: 18,
  breakfastAdultFee: 1500,
  breakfastChildFee: 1000,
  platformFeeEnabled: false,
  donationFelicitationThreshold: 50000,
  collegeContributionMinimum: 0,
  tshirtExtraRate: 500,
};

export const COLLEGE_CONTRIBUTION_CHIPS = [500, 1000, 2000, 5000] as const;

export const COLLEGE_CONTRIBUTION_COPY = {
  sectionTitle: "Batch Contribution to College",
  description: "A token of gratitude to our alma mater for its continuous support",
  minimumNote: "₹1,000 is already included in your registration fee",
  projectName: "Batch Contribution to College",
  causePrompt: "Pick a cause and every extra rupee goes directly to it",
  causeRequiredError: "Select a cause for your contribution.",
} as const;

// ── Contribution causes ──────────────────────────────────────────────────────
// All cause copy lives here ONLY — the committee may rename causes or add new
// ones; components, pricing labels, and emails must read from this list.

export interface ContributionCauseInfo {
  value: ContributionCause;
  emoji: string;
  label: string;
  tagline: string;
  description: string;
  details: string[];
}

export const CONTRIBUTION_CAUSES: ContributionCauseInfo[] = [
  {
    value: "green_energy",
    emoji: "☀️",
    label: "Green Energy Project",
    tagline: "power the campus with the sun",
    description:
      "TKMCE is building a 400 kWp solar plant in phases. The first 100 kWp is already running on the Mechanical & Architecture block.",
    details: [
      "Phase 1 (100 kWp) is live; Phases 2 & 3 will take campus capacity to 400 kWp — nearly 75% of the college's power needs.",
      "Expected to save the college ₹30–40 lakhs a year in electricity bills.",
      "10% of those savings will fund final-year B.Tech student projects.",
      "Alumni are pitching in ₹1 crore alongside the TKM Trust's ₹1 crore.",
    ],
  },
  {
    // Provisional name & copy — committee to confirm.
    value: "scholarship",
    emoji: "🎓",
    label: "Scholarship Fund",
    tagline: "help a student stay in college",
    description:
      "Supports students from financially struggling families with tuition fees, exam fees, books and other educational expenses.",
    details: [
      "Goes directly toward fees and educational expenses of students who are struggling to pay.",
      "Administered by the college; the batch's contribution is pooled with other alumni support.",
    ],
  },
];

/** Derived from CONTRIBUTION_CAUSES — single source of truth for cause labels. */
export const CONTRIBUTION_CAUSE_LABELS: Record<ContributionCause, string> = Object.fromEntries(
  CONTRIBUTION_CAUSES.map((c) => [c.value, c.label])
) as Record<ContributionCause, string>;

export const CONTRIBUTION_CAUSE_VALUES = CONTRIBUTION_CAUSES.map((c) => c.value) as [
  ContributionCause,
  ...ContributionCause[],
];

export const ACCOMMODATION_VENUE = "The Leela Ashtamudi (Raviz Hotels)";

export const ACCOMMODATION_OPTIONS = [
  { value: "none" as const, label: "Not Needed" },
  { value: "private" as const, label: "Private Room" },
  { value: "shared_double" as const, label: "Shared Room (2 persons)" },
  { value: "shared_triple" as const, label: "Shared Room (3 persons)" },
];

export const CHECKIN_OPTIONS = ["2026-08-14", "2026-08-15"] as const;
export const CHECKOUT_OPTIONS = ["2026-08-16"] as const;

/** Human-readable labels for display — use instead of raw enum values in UI and email. */
export const INTENT_LABELS: Record<AttendanceIntent, string> = {
  attending: "Attending in person",
  donation_only: "Donation only",
};

export const PARTICIPATION_LABELS: Record<ParticipationType, string> = {
  full_celebration: "Full Celebration",
  campus_only: "Campus Celebration",
  donation_only: "Donation Only",
};

export const MEAL_LABELS: Record<MealPreference, string> = {
  veg: "Veg",
  non_veg: "Non-veg",
};

/** Derived from ACCOMMODATION_OPTIONS — single source of truth for accommodation labels. */
export const ACCOMMODATION_LABELS: Record<AccommodationType, string> = Object.fromEntries(
  ACCOMMODATION_OPTIONS.map(o => [o.value, o.label])
) as Record<AccommodationType, string>;

export const ACCOMMODATION_COPY = {
  allocationExplainer:
    "Rooms are assigned by the organizing team closer to the reunion. Your choice here tells us your preference — we'll do our best to match it. We're all batchmates, so don't stress the details. 🙂",
  sharedMatchNote:
    "Picked a shared room? We'll pair you with another batchmate. Want to bunk with someone specific? Just let the organizing team know and we'll try to put you together.",
  extraBedToggleLabel: "Add an extra bed",
  taxDisclaimer:
    "Accommodation prices are exclusive of applicable taxes. Extra beds and paid child charges are also subject to tax.",
  extraBedAutoNote: "We've added an extra bed for your child over 12.",
  noneDescription: "I have my own arrangements",
  sharedUnavailableNote:
    "Shared rooms are for solo attendees — with a spouse, children, or guests, please pick a Private Room.",
  descriptions: {
    private: "A room to yourself or your family.",
    shared_double: "Share with one other batchmate.",
    shared_triple: "Share with two other batchmates.",
  } as Record<NonNoneAccommodation, string>,
} as const;

export interface AccommodationCatalogEntry {
  value: NonNoneAccommodation;
  label: string;
  description: string;
  basis: "room" | "head";
  perNight: number;
  breakfastFor: number;
}

export function getAccommodationCatalog(
  config: PricingConfig = PRICING_DEFAULTS,
): AccommodationCatalogEntry[] {
  return [
    {
      value: "private",
      label: ACCOMMODATION_LABELS["private"],
      description: ACCOMMODATION_COPY.descriptions["private"],
      basis: "room",
      perNight: config.accommodationPrivateFee ?? 0,
      breakfastFor: 2,
    },
    {
      value: "shared_double",
      label: ACCOMMODATION_LABELS["shared_double"],
      description: ACCOMMODATION_COPY.descriptions["shared_double"],
      basis: "head",
      perNight: config.accommodationSharedDoubleFee ?? 0,
      // per head: breakfast for the booker only — roommates book (and get) their own
      breakfastFor: 1,
    },
    {
      value: "shared_triple",
      label: ACCOMMODATION_LABELS["shared_triple"],
      description: ACCOMMODATION_COPY.descriptions["shared_triple"],
      basis: "head",
      perNight: config.accommodationSharedTripleFee ?? 0,
      // per head: breakfast for the booker only — roommates book (and get) their own
      breakfastFor: 1,
    },
  ];
}

// ── Cost breakdown (display data for the registration cost breakdown UI) ─────

export interface CostCategory {
  label: string;
  amount: number | null;
}

export const COST_CATEGORIES: CostCategory[] = [
  { label: "Welcome Kit & Teachers Recognition", amount: 1500 },
  { label: "Food Arrangements (Buffet Lunch @ TKMCE & Dinner @ Raviz)", amount: 3185 },
  { label: "Event Arrangements at College", amount: 500 },
  { label: "Musical Concert & DJ Party", amount: 1250 },
  { label: "Event Arrangements at Raviz Hotel", amount: 3250 },
  { label: "Management, Logistics & Contingency", amount: 750 },
];

export const SPONSORSHIP_ADJUSTMENT = {
  label: "Sponsorship Adjustment",
  amount: -2500,
};

export const COST_TOTAL_BEFORE_SPONSORSHIP = COST_CATEGORIES.reduce(
  (sum, c) => sum + (c.amount ?? 0),
  0,
);

export const SPONSORSHIP_NOTE =
  "DJ & violin concert at Raviz is sponsored and not included in the registration fee.";

export const COST_TOTAL_NOTE =
  "Estimated cost per person is ₹8,435. Net contribution is ₹8,000 (₹7,500 + ₹500 college contribution). The difference is covered by batch savings and sponsorship support.";

export const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
};

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function formatINR(n: number): string {
  return "₹" + n.toLocaleString("en-IN");
}

export function formatINRFixed(n: number): string {
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Payment details (base64-encoded — decoded at render time via atob) ──────

export const PAYMENT_UPI_VPA_B64 = "eW91cmFzc29jaWF0aW9uQGJhbms="; // yourassociation@bank (PLACEHOLDER: replace with your UPI ID, base64-encoded)
export const PAYMENT_PAYEE_NAME = "YOUR ALUMNI ASSOCIATION";
export const PAYMENT_UPI_MCC = "8398"; // Educational services
export const PAYMENT_UPI_ORG_ID = "000000"; // PLACEHOLDER: your bank's NPCI org ID (bank-specific; the original used the SBI value)
export const PAYMENT_BANK_DETAILS_B64 =
  "QmFuazogWW91ciBCYW5rIE5hbWUKQWNjb3VudCBOYW1lOiBZT1VSIEFMVU1OSSBBU1NPQ0lBVElPTgpBY2NvdW50IE51bWJlcjogMDAwMDAwMDAwMDAwCklGU0MgQ29kZTogWFhYWDAwMDAwMDAKU1dJRlQgQ29kZTogWFhYWFhYWFgwMDAKQnJhbmNoOiBZb3VyIEJyYW5jaCwgWW91ciBDaXR5CkNvdW50cnk6IEluZGlhCkN1cnJlbmN5OiBJTlIKUHVycG9zZSBvZiBQYXltZW50IENvZGU6IFAwMTAyClB1cnBvc2Ugb2YgUGF5bWVudDogVHJhdmVsIC0gQWx1bW5pIHJldW5pb24gcmVnaXN0cmF0aW9uCkJlbmVmaWNpYXJ5IE5hdGlvbmFsaXR5OiBJbmRpYW4=";
