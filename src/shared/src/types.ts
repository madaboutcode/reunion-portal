export interface PricingConfig {
  alumniBaseFee: number;
  additionalPersonFee: number;
  spouseFee?: number;
  childFee6to12?: number;
  childFee12plus?: number;
  guestFee?: number;
  childFreeAgeThreshold: number;
  accommodationEnabled: boolean;
  accommodationPrivateFee?: number;
  accommodationSharedDoubleFee?: number;
  accommodationSharedTripleFee?: number;
  accommodationExtraBedFee?: number;
  accommodationChild6to12Fee?: number;
  accommodationChildBedAge?: number;
  accommodationTaxPercent?: number;
  breakfastAdultFee?: number;
  breakfastChildFee?: number;
  campusOnlyBaseFee?: number;
  /** Additional person fees when participationType is campus_only (college food only). */
  campusOnlySpouseFee?: number;
  campusOnlyChildFee6to12?: number;
  campusOnlyChildFee12plus?: number;
  campusOnlyGuestFee?: number;
  platformFeeEnabled: boolean;
  platformFeeFlat?: number;
  platformFeePercent?: number;
  donationFelicitationThreshold: number;
  collegeContributionMinimum: number;
  tshirtExtraRate?: number;
}

export interface Tshirt {
  id: number;
  registrationId: number;
  gender: Gender | null;
  size: TshirtSize;
  isIncluded: boolean;
  createdAt: number;
}

export interface AdditionalCharge {
  id: number;
  registrationId: number;
  description: string;
  amount: number;
  createdBy: number;
  createdAt: number;
}

export interface PricingExtras {
  tshirts?: Array<{ isIncluded: boolean }>;
  additionalCharges?: Array<{ description: string; amount: number }>;
}

export interface PricingLineItem {
  label: string;
  fee: number;
  free: boolean;
  /**
   * Which budget bucket this line belongs to, for the reports revenue-by-category
   * split. Optional because historical registrations submitted before this field
   * existed have frozen `pricing_snapshot` JSON without it — callers must fall
   * back to label matching for those (see `isAccommodationLine()` in pricing.ts).
   */
  category?: "accommodation" | "event";
}

export interface PricingBreakup {
  base: number;
  collegeContribution: number;
  lines: PricingLineItem[];
  donation: number;
  total: number;
}

export interface AttendeeCounts {
  veg: number;
  nonveg: number;
  total: number;
}

export type AttendanceIntent = "attending" | "donation_only";
export type ContributionCause = "green_energy" | "scholarship";
export type ParticipationType = "full_celebration" | "campus_only" | "donation_only";
export type MealPreference = "veg" | "non_veg";
export type AccommodationType = "none" | "private" | "shared_double" | "shared_triple";
export type Gender = "male" | "female";
export type TshirtSize = "2XS" | "XS" | "S" | "M" | "L" | "XL" | "2XL" | "3XL" | "4XL" | "5XL" | "6XL";

export interface ChildAttendee {
  id: string;
  name: string;
  age: number;
  meal: MealPreference;
}

export interface GuestAttendee {
  id: string;
  name: string;
  relationship: string;
  meal: MealPreference;
}

export type NonNoneAccommodation = Exclude<AccommodationType, "none">;

export interface WizardDraft {
  fullName: string;
  branch: string;
  gender: Gender;
  email: string;
  whatsapp: string;
  mobileAlternate?: string;
  city: string;
  country: string;
  attendanceIntent: AttendanceIntent;
  participationType: ParticipationType;
  alumniMeal: MealPreference;
  tshirtSize?: TshirtSize;
  spouseName: string;
  spouseMeal: MealPreference;
  children: ChildAttendee[];
  guests: GuestAttendee[];
  accommodation: AccommodationType;
  extraBed: boolean;
  checkIn: string;
  checkOut: string;
  donationAmount: string;
  publicAcknowledgement: boolean;
  acknowledgementDisplayName: string;
  felicitationConsent: boolean;
  idFileName: string;
  idNote: string;
  idFileKey?: string;
  idFileType?: string;
  idFileSizeBytes?: number;
  collegeContribution: number;
  collegeContributionCause: ContributionCause | "";
  photoFileName: string;
  photoFileKey?: string;
  photoFileType?: string;
  photoFileSizeBytes?: number;
}

export interface Registration {
  contact: {
    fullName: string;
    branch: string;
    gender: Gender;
    email: string;
    whatsapp: string;
    mobileAlternate?: string;
    city: string;
    country: string;
  };
  attendance: {
    intent: AttendanceIntent;
    participationType: ParticipationType;
    alumniMeal?: MealPreference;
    tshirtSize?: TshirtSize;
  };
  attendees: {
    spouse?: { name: string; meal: MealPreference };
    children: ChildAttendee[];
    guests: GuestAttendee[];
  };
  accommodation?: {
    type: NonNoneAccommodation;
    checkIn: string;
    checkOut: string;
    extraBed: boolean;
    breakfastAdult?: number;
    breakfastChild?: number;
  };
  donation?: {
    amount: number;
    publicAcknowledgement: boolean;
    acknowledgementDisplayName?: string;
    felicitationConsent: boolean;
  };
  idDocument?: {
    fileKey: string;
    fileType: string;
    sizeBytes: number;
    fileName: string;
    note: string;
  };
  // College contribution keyed by cause — supports multi-cause splits even though
  // the wizard UI currently captures one amount + one cause. All amounts are > 0.
  contributionSplits?: Partial<Record<ContributionCause, number>>;
  photo?: {
    fileKey: string;
    fileType: string;
    sizeBytes: number;
    fileName: string;
  };
}

/** The exact registration fields consumed by pricing. */
export interface PricingRegistration {
  attendance: Registration["attendance"];
  attendees: {
    spouse?: Pick<NonNullable<Registration["attendees"]["spouse"]>, "name" | "meal">;
    children: Array<Pick<ChildAttendee, "name" | "age" | "meal">>;
    guests: Array<Pick<GuestAttendee, "name" | "meal">>;
  };
  accommodation?: Registration["accommodation"];
  donation?: Pick<NonNullable<Registration["donation"]>, "amount">;
  contributionSplits?: Registration["contributionSplits"];
}
