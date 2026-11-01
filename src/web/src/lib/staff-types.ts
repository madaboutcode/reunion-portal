// Staff API types — mirrors docs/specs/staff-api.spec.md exactly.
// Do not add fields that aren't in the spec; do not rename fields.

import type {
  PagedResponse,
  Tshirt,
  AdditionalCharge,
  Gender,
  TshirtSize,
  DeskPaymentMethod,
  DeskCollectPaymentRequest,
  DeskAddChargeRequest,
} from "@smriti/shared";

export type { Tshirt, AdditionalCharge, Gender, TshirtSize, DeskPaymentMethod, DeskCollectPaymentRequest, DeskAddChargeRequest };

// Per-participation-type stat bucket (C6)
export interface ParticipationTypeStat {
  total: number;
  confirmed: number;
  pending: number;
  pendingVerification: number;
}

// Dashboard stats (R5.1 + C6 — byParticipationType is required)
export interface DashboardStats {
  total: number;
  pending: number;
  pendingVerification: number;
  confirmed: number;
  moneyCollected: number;
  byParticipationType: Record<
    'full_celebration' | 'campus_only' | 'donation_only',
    ParticipationTypeStat
  >;
}

// Registration list item (R6.2)
export interface StaffRegistrationListItem {
  id: number;
  regCode: string;
  fullName: string;
  email: string;
  whatsapp: string;
  branch: string;
  status: string; // 'pending' | 'pending_verification' | 'confirmed'
  attendanceIntent: string; // 'attending' | 'donation_only'
  participationType: string; // 'full_celebration' | 'campus_only' | 'donation_only'
  totalAmount: number;
  photoThumbKey: string | null;
  createdAt: number; // unix ms
}

// Registration list response (R6.2)
export type StaffRegistrationListResponse = PagedResponse<StaffRegistrationListItem>;

// Attendance info within registration detail (R7.1)
export interface AttendanceInfo {
  intent: string;
  participationType: string;
  mealPreference: string;
  tshirtSize: string;
}

// Accommodation info within registration detail (R7.1)
export interface AccommodationInfo {
  type: string;
  checkIn: string; // calendar date TEXT
  checkOut: string; // calendar date TEXT
  extraBed: boolean;
  breakfastAdult: number;
  breakfastChild: number;
}

// Pricing line item within pricingBreakup (R7.1)
export interface PricingLine {
  label: string;
  fee: number;
  free: boolean;
}

// Pricing breakup within registration detail (R7.1)
export interface PricingBreakup {
  base: number;
  collegeContribution: number;
  lines: PricingLine[];
  donation: number;
  total: number;
}

// Full registration detail (R7.1)
export interface StaffRegistrationDetail {
  id: number;
  regCode: string;
  status: string;
  fullName: string;
  email: string;
  whatsapp: string;
  branch: string;
  city: string;
  country: string;
  gender: string | null;
  mobileAlternate: string | null;
  attendance: AttendanceInfo;
  accommodation: AccommodationInfo;
  donation: number;
  publicAck: boolean;
  ackDisplayName: string | null;
  felicitation: boolean;
  contributionSplits?: Record<string, number>;
  pricingBreakup: PricingBreakup;
  totalAmount: number;
  idNote: string | null;
  photoFileKey: string | null;
  photoThumbKey: string | null;
  createdAt: number; // unix ms
  updatedAt: number; // unix ms — used for optimistic locking on edit
}

// Attendee record within detail (R7.1)
export interface AttendeeRecord {
  id: number;
  type: string; // 'spouse' | 'child' | 'guest'
  name: string;
  age: number | null;
  relationship: string | null;
  mealPreference: string;
  tshirtSize: string | null;
}

// Payment record within detail (R7.1)
export interface PaymentRecord {
  id: number;
  amount: number;
  status: string;
  proofFileKey: string | null;
  gatewayRef: string | null;
  verifiedBy: string | null;
  verifiedAt: number | null; // unix ms or null
  createdAt: number; // unix ms
}

// Document record within detail (R7.1)
export interface DocumentRecord {
  id: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  r2Key: string;
}

// Audit entry within detail (R7.1)
export interface AuditEntry {
  action: string;
  actor: string;
  changes: Record<string, unknown> | null;
  createdAt: number; // unix ms
}

// Detail response wrapper (R7.1, R7.5, R7.6)
export interface StaffRegistrationDetailResponse {
  registration: StaffRegistrationDetail;
  attendees: AttendeeRecord[];
  payments: PaymentRecord[];
  documents: DocumentRecord[];
  audit: AuditEntry[];
  tshirts: Tshirt[];
  additionalCharges: AdditionalCharge[];
}

// ---------------------------------------------------------------------------
// T-shirt & additional charge sub-resource types (R34-R40)
// ---------------------------------------------------------------------------

export type PaymentAction = "none" | "created" | "updated" | "deleted";

export interface AddTshirtRequest {
  gender: Gender | null;
  size: TshirtSize;
  isIncluded: boolean;
}

export interface AddTshirtResponse {
  tshirt: Tshirt;
  totalAmount: number;
  pricingBreakup: PricingBreakup;
  paymentAction: PaymentAction;
  paymentDelta: number | null;
}

export interface UpdateTshirtRequest {
  gender?: Gender | null;
  size?: TshirtSize;
}

export interface UpdateTshirtResponse {
  tshirt: Tshirt;
}

export interface RemoveTshirtResponse {
  totalAmount: number;
  pricingBreakup: PricingBreakup;
  paymentAction: PaymentAction;
  paymentDelta: number | null;
}

export interface AddChargeRequest {
  description: string;
  amount: number;
}

export interface AddChargeResponse {
  charge: AdditionalCharge;
  totalAmount: number;
  pricingBreakup: PricingBreakup;
  paymentAction: PaymentAction;
  paymentDelta: number | null;
}

export interface RemoveChargeResponse {
  totalAmount: number;
  pricingBreakup: PricingBreakup;
  paymentAction: PaymentAction;
  paymentDelta: number | null;
}

// Verify response (R8.4)
export interface VerifyResponse {
  paymentStatus: string;
  registrationStatus: string;
  refundCreated?: { id: number; amount: number };
}

export interface RefundRecord {
  id: number;
  /** Live registration link — null for detached (cancelled) refunds. */
  registrationId: number | null;
  /** Live source-payment link — null for detached (cancelled) refunds. */
  sourcePaymentId: number | null;
  amount: number;
  /** 'overpayment' (excess verified money) | 'cancellation' (staff cancellation). */
  reason: 'overpayment' | 'cancellation';
  /** Staff cancellation reason; null for overpayment refunds. */
  cancellationReason: string | null;
  status: 'pending' | 'completed';
  bankReference: string | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  createdAt: number;
  /** Immutable owner snapshot — survives registration deletion. */
  originalRegistrationId: number;
  originalPaymentId: number;
  regCode: string;
  fullName: string;
  email: string;
  /** Verified amount of the source payment (cancellation refunds). */
  sourcePaymentAmount: number;
  sourcePaymentReference: string | null;
  /** 'active' — live registration exists; 'cancelled' — detached snapshot. */
  ownerKind: 'active' | 'cancelled';
}

export interface RefundListResponse {
  refunds: RefundRecord[];
}

// ---------------------------------------------------------------------------
// Cancellation types (plan tasks/2026-08-03-cancellation-refunds)
// ---------------------------------------------------------------------------

export interface CancelRegistrationRequest {
  /** Required, non-empty after trimming (422 otherwise). */
  reason: string;
}

export interface CancelRegistrationResponse {
  archivedId: number;
  originalRegistrationId: number;
  regCode: string;
  fullName: string;
  totalRefundAmount: number;
  refunds: RefundRecord[];
}

export interface BalancePaymentResponse {
  paymentId: number;
  amount: number;
  status: string;
}

export interface CompleteRefundResponse {
  status: string;
}

// Reject response (R9.4)
export interface RejectResponse {
  paymentStatus: string;
  registrationStatus: string;
}

// Auth endpoints (R3.3, R4.2)
export interface MagicLinkResponse {
  ok: boolean;
  message: string;
}

export interface AuthVerifyResponse {
  token: string;
  role: string;
  redirectTo: string;
  email?: string;
  sub: string;
}

// Staff access scopes — R14.1.1 / R16.9 (staff-api.spec.md), R3.4
// (access-control.spec.md — the closed scope set includes registration_desk).
export type StaffScope =
  | "dashboard"
  | "registration_desk"
  | "resources"
  | "reports"
  | "allocation"
  | "admin-tools"
  | "bank_txns";

// Permissions object — null means full access to all pages
export interface StaffPermissions {
  scopes: StaffScope[];
}

// Staff user — R15.1 shape (createdBy absent on create response R14.4, optional here)
export interface StaffUser {
  id: number;
  email: string;
  name: string;
  role: string; // 'staff' | 'admin'
  isActive: boolean;
  permissions: StaffPermissions | null; // R14.4.1 — null = full access
  createdBy: number | null;
  createdAt: number; // unix ms
}

// Upload proof on behalf response (R10.4)
export interface UploadProofResponse {
  status: string;
  message: string;
}

// Own-permissions response — GET /api/staff/me/permissions
export interface MyPermissionsResponse {
  permissions: { scopes: string[] } | null;
  role: string;
}

// Query params for list endpoint (R6.1)
export interface ListParams {
  type?: 'attendee' | 'donor';
  status?: string;
  branch?: string;
  search?: string;
  participationType?: string;
  page?: number;
  limit?: number;
}

// Query params for dashboard stats (type filter)
export interface DashboardParams {
  type?: 'attendee' | 'donor';
}

// Resource planning aggregates
export interface ResourceHeadcount {
  alumni: number;
  spouses: number;
  children: number;
  guests: number;
  total: number;
}

// Accommodation by night (R12, decision C6)
export interface AccommodationNightBucket {
  private: number;
  privateByGender: { male: number; female: number; other: number };
  shared_double: { count: number; rooms: number };
  shared_doubleByGender: { male: number; female: number; other: number };
  shared_triple: { count: number; rooms: number };
  shared_tripleByGender: { male: number; female: number; other: number };
  extraBeds: number;
}

// Meals by participation type (R13, decision C7)
export interface MealCatererBucket {
  headcount: number;
  veg: number;
  nonVeg: number;
}

export interface MealsByParticipationType {
  campusDayCaterer: MealCatererBucket;
  ravizBanquet: MealCatererBucket;
}

// Children by age band (R14, decision C4)
export interface ChildrenByAgeBand {
  under6: number;
  age6to12: number;
  age12plus: number;
}

export interface AccommodationGenderBucket {
  total: number;
  male: number;
  female: number;
  other: number;
}

export interface ResourceCounts {
  headcount: ResourceHeadcount;
  accommodation: Record<string, AccommodationGenderBucket>;
  /** Per-night occupancy using [check_in, check_out) interval. Keys: "2026-08-14", "2026-08-15" */
  accommodationByNight: Record<string, AccommodationNightBucket>;
  meals: { veg: number; nonVeg: number };
  /** Meal headcounts split by caterer bucket (campusDayCaterer vs ravizBanquet) */
  mealsByParticipationType: MealsByParticipationType;
  tshirts: Record<string, Record<string, number>>;
  /** Children attendees split into age bands for pricing/planning */
  childrenByAgeBand: ChildrenByAgeBand;
}

export interface ResourcesParams {
  status?: string; // comma-separated statuses
  branch?: string;
}

// Reports analytics
export interface BranchBreakdown {
  branch: string;
  total: number;
  confirmed: number;
  pendingVerification: number;
  pending: number;
  expectedRevenue: number;
  collectedRevenue: number;
}

export interface TimelineEntry {
  date: string;
  count: number;           // total attendees — back-compat, used by existing chart views
  fullCelebration: number; // per-day full_celebration count (additive, B3)
  campusOnly: number;      // per-day campus_only count (additive, B3)
}

export interface RevenueSummary {
  collected: number;
  expected: number;
  pending: number;
}

export interface ContributionAggregate {
  cause: string;
  count: number;
  total: number;
}

export interface DonationTotals {
  count: number;
  total: number;
}

// Geography (R17, B1, B4)
export interface GeographyEntry {
  city: string;
  count: number;
}

export interface CountryEntry {
  country: string;
  count: number;
}

// Donor recognition (R15, R16, B2, B5, T2-10)
export interface PublicDonor {
  displayName: string;
  amount: number;
  felicitationEligible: boolean;
}

export interface DonorRecognition {
  publicDonors: PublicDonor[];
  nonPublicCount: number;
  nonPublicTotal: number;
}

export interface BudgetProgressCategory {
  actual: number;
  target: number;
}

export interface BudgetProgress {
  event: BudgetProgressCategory;
  accommodation: BudgetProgressCategory;
}

export interface ReportsResponse {
  branchBreakdown: BranchBreakdown[];
  timeline: TimelineEntry[];
  revenue: RevenueSummary;
  contributions: ContributionAggregate[];
  donations: DonationTotals;
  geography: {
    cities: GeographyEntry[];
    countries: CountryEntry[];
  };
  donorRecognition: DonorRecognition;
  budgetProgress: BudgetProgress;
}

// Query params for export (R13.1)
export interface ExportParams {
  type?: string;
  status?: string;
  branch?: string;
  search?: string;
  participationType?: string;
}

// Users list response (R15.1)
export interface UsersListResponse {
  users: StaffUser[];
}

// Create user request (R14.1)
export interface CreateUserRequest {
  email: string;
  name: string;
  role: "staff";
  permissions?: StaffPermissions | null; // R14.1.1 — omit/null = full access
}

// Update user request (R16.1)
export interface UpdateUserRequest {
  name?: string;
  isActive?: boolean;
  permissions?: StaffPermissions | null; // R16.9 — null restores full access
}

// Resend invite response (R17.5)
export interface ResendInviteResponse {
  ok: boolean;
}

// Generated staff login link response (R18.5)
export interface GenerateLoginLinkResponse {
  link: string;
  expiresIn: number;
}

// ---------------------------------------------------------------------------
// Edit registration types
// ---------------------------------------------------------------------------

export interface EditRegistrationRequest {
  updatedAt: number;
  fields: Partial<{
    fullName: string;
    email: string;
    whatsapp: string;
    mobileAlternate: string | null;
    branch: string;
    city: string;
    country: string;
    gender: string;
    tshirtSize: string;
    alumniMeal: string;
    attendanceIntent: string;
    participationType: string;
    accommodation: string;
    checkIn: string | null;
    checkOut: string | null;
    extraBed: boolean;
    breakfastAdult: number;
    breakfastChild: number;
    donationAmount: number;
    publicAck: boolean;
    ackDisplayName: string | null;
    felicitation: boolean;
    idNote: string | null;
    photoFileKey: string | null;
    contributionSplits: Record<string, number>;
  }>;
  attendees?: Array<{
    type: 'spouse' | 'child' | 'guest';
    name: string | null;
    age: number | null;
    relationship: string | null;
    meal: string;
    isChargeable: boolean;
  }>;
  /** Full t-shirt list (single-save sync) — omit to leave t-shirts unchanged. */
  tshirts?: Array<{
    id?: number;
    gender: Gender | null;
    size: TshirtSize;
    isIncluded: boolean;
  }>;
  /** Full charge list (single-save sync) — omit to leave charges unchanged. */
  additionalCharges?: Array<{
    id?: number;
    description: string;
    amount: number;
  }>;
}

export interface EditRegistrationResponse {
  registration: {
    id: number;
    regCode: string;
    status: string;
    fullName: string;
    email: string;
    updatedAt: number;
  };
  pricingBreakup: PricingBreakup | null;
  paymentDelta: number | null;
  paymentAction: 'none' | 'created' | 'updated' | 'deleted';
  tshirts: Tshirt[];
  additionalCharges: AdditionalCharge[];
}

// ---------------------------------------------------------------------------
// Archive types
// ---------------------------------------------------------------------------

export interface ArchivedRegistration {
  id: number;
  originalId: number;
  regCode: string;
  email: string;
  fullName: string;
  archivedBy: string;
  archivedAt: number;
  snapshot?: unknown; // only on detail view
}

export interface ArchivedListResponse {
  data: ArchivedRegistration[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ArchiveResponse {
  ok: boolean;
  archivedId: number;
}

// ---------------------------------------------------------------------------
// Bank transaction types
// ---------------------------------------------------------------------------

export interface LinkedBankPayment {
  paymentId: number;
  registrationId: number;
  regCode: string;
  fullName: string;
  amount: number;
  status: string;
  linkId: number;
}

export interface BankTransaction {
  id: number;
  txnHash: string;
  txnDate: string;
  txnDateIso: string;
  valueDate: string;
  description: string;
  refNo: string | null;
  branchCode: string | null;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
  txnType: 'credit' | 'debit';
  comment: string | null;
  importBatch: string;
  createdAt: number;
  linkedPayments: LinkedBankPayment[];
}

export interface ImportBankStatementResponse {
  imported: number;
  skipped: number;
  total: number;
}

export interface BankTransactionListResponse {
  transactions: BankTransaction[];
  total: number;
  page: number;
  limit: number;
}

export interface BankTransactionParams {
  type?: 'credit' | 'debit';
  reconciled?: boolean;
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}

export interface BankTransactionSummary {
  totalCreditPaise: number;
  totalDebitPaise: number;
  latestBalancePaise: number;
  transactionCount: number;
}

// ---------------------------------------------------------------------------
// Allocation types (roommate-preferences.spec.md, staff-api.spec.md R27-R30)
// ---------------------------------------------------------------------------

export interface AllocationRegistration {
  id: number;
  regCode: string;
  fullName: string;
  branch: string;
  gender: string;
  email: string;
  whatsapp: string;
  photoThumbUrl: string | null;
  accommodationType: string; // 'shared_double' | 'shared_triple' | 'private'
  checkIn: string | null;
  checkOut: string | null;
  status: string; // 'pending' | 'pending_verification' | 'confirmed' (R27.7)
  pendingAmount: number | null; // rupees, null when status is 'confirmed' (R27.8)
  updatedAt: number; // unix ms — concurrency token for accommodation conversion (R27.9/R41.4)
  preferenceCount: number;
  incomingPreferenceCount: number;
  preferences: PreferenceEntry[];
  prefsVersion: number | null;
}

export interface AllocationListResponse {
  registrations: AllocationRegistration[];
  total: number;
}

// Accommodation conversion response (staff-api R41.8)
export interface ConvertAccommodationResponse {
  accommodationType: string;
  status: string;
  pendingAmount: number | null;
  updatedAt: number;
}

// Payment-link generation response (staff-api R42.1)
export interface AllocationPaymentLinkResponse {
  link: string;
}

export interface PreferenceEntry {
  preferredRegistrationId: number;
  regCode: string;
  fullName: string;
  branch: string;
  gender: string;
  preferenceOrder: number;
  isMutual: boolean;
}

export interface PreferencesResponse {
  preferences: PreferenceEntry[];
  // Optimistic-lock token: MAX(updated_at) over this registration's preference
  // rows, ms epoch; null when there are no preferences (staff-api R28.6).
  version: number | null;
}

// ---------------------------------------------------------------------------
// Quick-add donor types
// ---------------------------------------------------------------------------

export interface CreateDonorRequest {
  fullName: string;
  branch: string;
  donationAmount: number;
  email?: string;
  whatsapp?: string;
  gender?: 'male' | 'female';
  city?: string;
  country?: string;
  publicAck?: boolean;
  ackDisplayName?: string;
  felicitation?: boolean;
}

export interface CreateDonorResponse {
  id: number;
  regCode: string;
}

// ---------------------------------------------------------------------------
// Registration Desk types (registration-desk-api.ispec.md)
// ---------------------------------------------------------------------------

/** Desk payment state — exactly two values (ispec R3.1). */
export type DeskPaymentState = "payment_pending" | "confirmed";

export interface DeskCheckInState {
  present: boolean;
  checkedInAt: number | null; // unix ms
}

// Search result item (ispec R2, R2.5)
export interface DeskSearchResult {
  id: number;
  fullName: string;
  branch: string;
  regCode: string;
  participationType: string; // 'full_celebration' | 'campus_only'
  /** True when a public thumbnail exists (ispec R2.5) — see DeskSearchResponse.thumbsBaseUrl. */
  hasPhoto: boolean;
  checkIn: DeskCheckInState;
}

export interface DeskSearchResponse {
  results: DeskSearchResult[];
  /** Public thumbnail CDN base URL (mirrors public Who's Coming, ispec R2.5). */
  thumbsBaseUrl: string;
  /** Cache-busting version — max(updated_at) across returned rows. */
  photosVersion: number;
}

// T-shirt row within the overview (spec R3.4) — display only, never amount/price.
export interface DeskOverviewTshirt {
  size: string;
  gender: string | null;
  isIncluded: boolean;
}

// Narrow attendee overview (ispec R3)
export interface DeskAttendeeOverview {
  id: number;
  fullName: string;
  regCode: string;
  branch: string;
  participationType: string;
  photo: { available: boolean; url: string | null };
  /** Primary registrant's stored WhatsApp number — helpdesk contact (spec R1.2/R3.6). */
  whatsapp: string;
  mealPreference: string;
  accommodation: {
    type: string;
    checkIn: string | null;
    checkOut: string | null;
  } | null;
  /** Distinct assigned room numbers across nights, sorted ascending; [] when none (spec R3.7). */
  rooms: string[];
  additionalAttendees: {
    spouse: Array<{ name: string | null; mealPreference: string }>;
    children: Array<{ name: string | null; age: number | null; mealPreference: string }>;
    guests: Array<{ name: string | null; mealPreference: string }>;
  };
  payment: { state: DeskPaymentState; amountDue?: number };
  checkIn: DeskCheckInState;
  /** Included shirt(s) first (spec R3.4). */
  tshirts: DeskOverviewTshirt[];
}

export interface DeskLookupResponse {
  attendee: DeskAttendeeOverview;
}

export interface DeskCheckInResponse {
  checkIn: DeskCheckInState;
}

/** Per-type headline: registrations of one participation type and how many are
 *  present. */
export interface DeskTypeCount {
  total: number;
  checkedIn: number;
}

/** Live desk roster counts (GET /api/staff/desk/stats). Counts only — no
 *  registration data. `total`/`checkedIn` are overall across the eligible
 *  types; `byType` breaks the same figures down. Donation-only is never
 *  counted. */
export interface DeskStatsResponse {
  total: number;
  checkedIn: number;
  byType: {
    full_celebration: DeskTypeCount;
    campus_only: DeskTypeCount;
  };
}

// Spot-registration request body (ispec R5) — only the allowed fields.
export interface DeskSpotRegistrationRequest {
  fullName: string;
  whatsapp: string;
  branch: string;
  participationType: "full_celebration" | "campus_only";
  alumniMeal: "veg" | "non_veg";
  photoFileKey: string;
  email: string;
  donationAmount?: number;
  spouse?: { name: string; mealPreference: "veg" | "non_veg" };
  children: Array<{ name: string; age: number; mealPreference: "veg" | "non_veg" }>;
  guests: Array<{ name: string; mealPreference: "veg" | "non_veg" }>;
}

export interface DeskSpotRegistrationResponse {
  registration: {
    id: number;
    regCode: string;
    participationType: string;
    payment: { state: "payment_pending"; amountDue: number };
    checkIn: DeskCheckInState;
    passUrl: string;
  };
}

// Desk payment collection + additional-charge responses
// (desk-payment-collection plan, req #1/#2) — both return the fresh
// allowlisted overview so the caller updates state with no extra refetch.

export interface DeskCollectPaymentResponse {
  attendee: DeskAttendeeOverview;
}

export interface DeskAddChargeResponse {
  attendee: DeskAttendeeOverview;
}

// Admin feature-flag config (runtime-feature-flags.ispec.md) — mirrors
// AdminFeatureFlag / FeatureFlagAuditEntry / AdminConfigResponse from
// src/server/src/services/feature-flag.service.ts and
// src/server/src/domain/feature-flag-types.ts. Not exported from
// @smriti/shared (server-only response shapes), so defined here.

export interface AdminFeatureFlag {
  key: string;
  label: string;
  description: string;
  group: string;
  enabled: boolean;
  defaultValue: boolean;
  failureValue: boolean;
  source: "default" | "override";
  exposure: string;
  enforcement: string;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface FeatureFlagAuditChange {
  key: string;
  from: boolean;
  to: boolean;
}

export interface FeatureFlagAuditEntry {
  actor: string;
  changedAt: number;
  changes: FeatureFlagAuditChange[];
}

export interface AdminConfigResponse {
  flags: AdminFeatureFlag[];
  audit: FeatureFlagAuditEntry[];
}

export interface FeatureFlagChangeRequest {
  key: string;
  enabled: boolean;
}
