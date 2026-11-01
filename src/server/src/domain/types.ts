/**
 * CONTRACT
 *
 * GUARANTEE: ROW_COERCION — toRegistration() converts D1's integer booleans
 *   (0|1) to JS booleans, parses pricing_snapshot from JSON string to
 *   PricingBreakup, and parses contribution_splits from JSON string to
 *   Record<string, number> with a {} fallback on malformed JSON.
 *   Every boolean field on RegistrationRow is number; the same field on
 *   Registration is boolean.
 *
 * GUARANTEE: ROW_COERCION — toPayment() maps all PaymentRow fields including
 *   proof_file_key → proofFileKey, verified_by → verifiedBy, and
 *   verified_at → verifiedAt. Null propagation is preserved exactly.
 *   method and note (0023_payment_method_note — desk collection mode/comment)
 *   pass through unchanged; both null until a desk settlement sets them via
 *   payment.repo.ts settleAtDesk(). Read-path only — no writer besides
 *   settleAtDesk populates them.
 *
 * GUARANTEE: ROW_COERCION — toUser() converts D1's integer boolean is_active
 *   (0|1) to JS boolean. All other fields are passed through as-is.
 *
 * GUARANTEE: ROW_COERCION — toRefund() maps the owner/source snapshot shape:
 *   registrationId/sourcePaymentId are nullable (live links), ownerKind is
 *   'cancelled' when registration_id is null (live row deleted) and 'active'
 *   otherwise. Immutable snapshot fields (originalRegistrationId, regCode,
 *   fullName, email, sourcePaymentAmount, ...) are passed through from the row.
 *
 * GUARANTEE: NO_DATE_OBJECTS — all timestamp fields (created_at, updated_at,
 *   expires_at, used_at, verified_at) are Unix epoch milliseconds (number) in
 *   both row types and domain types. Calendar dates (check_in, check_out)
 *   remain TEXT strings. No Date objects are created or accepted.
 *
 * EXPECTS: pricing_snapshot on RegistrationRow is valid JSON encoding a
 *   PricingBreakup. Malformed JSON will throw at parse time — callers must
 *   ensure snapshots are written correctly on insert.
 *
 * EXPECTS: changes and snapshot on AuditEntryRow are valid JSON (changes may
 *   be null for 'created' actions). Malformed JSON will throw.
 *
 * FAILURE BEHAVIOR: Converters (toRegistration, toAttendee, etc.) throw on
 *   malformed JSON. They do not swallow parse errors.
 */

import type { PricingBreakup, MealPreference, AccommodationType, AttendanceIntent, ParticipationType, Gender, TshirtSize, Tshirt, AdditionalCharge, DeskPaymentMethod } from '@smriti/shared';
import type { RegistrationStatus, PaymentStatus, RefundStatus, AuditAction } from './status.js';

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Mirrors the `registrations` D1 table exactly. Booleans as 0|1. */
export interface RegistrationRow {
  id: number;
  /** 16-char SMRT-prefixed code, public-facing */
  reg_code: string;
  status: RegistrationStatus;

  // Alumni details (Step 1)
  full_name: string;
  branch: string;
  email: string;
  whatsapp: string;
  mobile_alternate: string | null;
  city: string;
  country: string;
  attendance_intent: AttendanceIntent;
  participation_type: ParticipationType;
  gender: Gender | null;
  tshirt_size: TshirtSize | null;

  // Meals (Step 2)
  alumni_meal: string;

  // Accommodation (Step 3)
  accommodation: AccommodationType;
  check_in: string | null;
  check_out: string | null;
  extra_bed: number;            // 0 | 1
  breakfast_adult: number;
  breakfast_child: number;

  // Donation (Step 3)
  donation_amount: number;
  public_ack: number;           // 0 | 1
  ack_display_name: string | null;
  felicitation: number;         // 0 | 1

  // College contributions (Step 5 "Giving Back")
  contribution_splits: string;  // raw JSON: { cause → amount_in_INR }

  // Pricing (frozen at submission)
  pricing_snapshot: string;     // raw JSON: PricingBreakup
  total_amount: number;

  // Notes
  id_note: string | null;

  // Files
  photo_file_key: string | null;
  photo_thumb_key: string | null;

  // Timestamps
  created_at: number;
  updated_at: number;
}

/** Parsed domain type — what repositories return and services consume. */
export interface Registration {
  id: number;
  regCode: string;
  status: RegistrationStatus;

  // Alumni details
  fullName: string;
  branch: string;
  email: string;
  whatsapp: string;
  mobileAlternate: string | null;
  city: string;
  country: string;
  attendanceIntent: AttendanceIntent;
  participationType: ParticipationType;
  gender: Gender | null;
  tshirtSize: TshirtSize | null;

  // Meals — 'veg' | 'non_veg' for attendees, 'none' for donation-only
  alumniMeal: string;

  // Accommodation
  accommodation: AccommodationType;
  checkIn: string | null;
  checkOut: string | null;
  extraBed: boolean;
  breakfastAdult: number;
  breakfastChild: number;

  // Donation
  donationAmount: number;
  publicAck: boolean;
  ackDisplayName: string | null;
  felicitation: boolean;

  // College contributions (Step 5 "Giving Back")
  contributionSplits: Record<string, number>;  // cause → amount; key type is string so legacy/unknown causes round-trip

  // Pricing
  pricingSnapshot: PricingBreakup;
  totalAmount: number;

  // Notes
  idNote: string | null;

  // Files
  photoFileKey: string | null;
  photoThumbKey: string | null;

  // Timestamps
  createdAt: number;
  updatedAt: number;
}

/** Insert shape for create(). reg_id is generated by the caller. */
export interface NewRegistration {
  reg_code: string;

  // Alumni details
  full_name: string;
  branch: string;
  email: string;
  whatsapp: string;
  mobile_alternate: string | null;
  city: string;
  country: string;
  attendance_intent: AttendanceIntent;
  participation_type: ParticipationType;
  gender: Gender | null;
  tshirt_size: TshirtSize | null;

  // Meals — 'veg' | 'non_veg' for attendees, 'none' for donation-only
  alumni_meal: string;

  // Accommodation
  accommodation: AccommodationType;
  check_in: string | null;
  check_out: string | null;
  extra_bed: number;            // 0 | 1

  // Donation
  donation_amount: number;
  public_ack: number;           // 0 | 1
  ack_display_name: string | null;
  felicitation: number;         // 0 | 1

  // College contributions (Step 5 "Giving Back")
  contribution_splits: string;  // JSON string: { cause → amount_in_INR }

  // Pricing
  pricing_snapshot: string;     // JSON string
  total_amount: number;

  // Notes
  id_note: string | null;

  // Files
  photo_file_key: string | null;
}

/** Partial update shape for update() method. All fields optional. */
export interface RegistrationUpdate {
  full_name?: string;
  branch?: string;
  email?: string;
  whatsapp?: string;
  mobile_alternate?: string | null;
  city?: string;
  country?: string;
  gender?: Gender | null;
  tshirt_size?: TshirtSize | null;
  attendance_intent?: AttendanceIntent;
  participation_type?: ParticipationType;
  alumni_meal?: MealPreference;
  accommodation?: AccommodationType;
  check_in?: string | null;
  check_out?: string | null;
  extra_bed?: number;
  breakfast_adult?: number;
  breakfast_child?: number;
  donation_amount?: number;
  public_ack?: number;
  ack_display_name?: string | null;
  felicitation?: number;
  id_note?: string | null;
  photo_file_key?: string | null;
  photo_thumb_key?: string | null;
  /** Updated pricing snapshot (JSON string). Set by edit service on cost-affecting changes. */
  pricing_snapshot?: string;
  /** Updated total amount. Set by edit service on cost-affecting changes. */
  total_amount?: number;
  contribution_splits?: string;
}

/** Filters for list() queries. */
export interface RegistrationFilters {
  status?: RegistrationStatus;
  branch?: string;
  email?: string;
  type?: 'attendee' | 'donor';       // maps to attendance_intent
  participationType?: string;          // filters by participation_type column
  search?: string;                     // multi-field LIKE search
  orderBy?: 'created_at';             // only created_at for now
  orderDir?: 'ASC' | 'DESC';          // default DESC
  limit?: number;                      // pagination
  offset?: number;                     // pagination
}

// ---------------------------------------------------------------------------
// Attendee
// ---------------------------------------------------------------------------

/** Mirrors the `attendees` D1 table exactly. */
export interface AttendeeRow {
  id: number;
  registration_id: number;
  type: 'spouse' | 'child' | 'guest';
  name: string | null;
  age: number | null;
  relationship: string | null;
  meal: MealPreference;
  is_chargeable: number;        // 0 | 1
  created_at: number;
}

/** Parsed domain type. */
export interface Attendee {
  id: number;
  registrationId: number;
  type: 'spouse' | 'child' | 'guest';
  name: string | null;
  age: number | null;
  relationship: string | null;
  meal: MealPreference;
  isChargeable: boolean;
  createdAt: number;
}

/** Insert shape for replaceForRegistration(). */
export interface NewAttendee {
  registration_id: number;
  type: 'spouse' | 'child' | 'guest';
  name: string | null;
  age: number | null;
  relationship: string | null;
  meal: MealPreference;
  is_chargeable: number;        // 0 | 1
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

/** Mirrors the `payments` D1 table exactly. */
export interface PaymentRow {
  id: number;
  registration_id: number;
  amount: number;
  status: PaymentStatus;
  gateway: string | null;
  gateway_ref: string | null;
  gateway_response: string | null;  // JSON blob or null
  proof_file_key: string | null;
  verified_by: string | null;
  verified_at: number | null;
  method: DeskPaymentMethod | null;
  note: string | null;
  created_at: number;
  updated_at: number;
}

/** Parsed domain type. No 0/1 coercion needed — no boolean columns. */
export interface Payment {
  id: number;
  registrationId: number;
  amount: number;
  status: PaymentStatus;
  gateway: string | null;
  gatewayRef: string | null;
  gatewayResponse: string | null;
  proofFileKey: string | null;
  verifiedBy: string | null;
  verifiedAt: number | null;
  method: DeskPaymentMethod | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Insert shape for create(). */
export interface NewPayment {
  registration_id: number;
  amount: number;
  status: PaymentStatus;
  gateway: string | null;
  gateway_ref: string | null;
  gateway_response: string | null;
  proof_file_key: string | null;
  verified_by: string | null;
  verified_at: number | null;
}

/** Partial update data for updateStatus(). */
export interface GatewayData {
  gateway?: string;
  gatewayRef?: string;
  gatewayResponse?: string;
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

/** 'overpayment' refunds arise from excess verified money; 'cancellation'
 *  refunds arise from the staff cancellation flow. */
export type RefundReason = 'overpayment' | 'cancellation';

/** 'active' means the live registration row still exists; 'cancelled' means
 *  the registration (and usually the source payment) has been deleted and the
 *  refund is detached, identified only by its immutable snapshot fields. */
export type RefundOwnerKind = 'active' | 'cancelled';

/**
 * Mirrors the `refunds` D1 table exactly (0020_cancellation_refunds rebuild).
 * registration_id / source_payment_id are NULLABLE live links (ON DELETE
 * SET NULL); the original_* and identity/source fields are immutable
 * snapshots that survive deletion.
 *
 * The identity/source snapshot columns are NULLABLE at the DB boundary
 * (0020 expand/backfill keeps pre-deploy overpayment writers working —
 * see plan §6 "Migration compatibility"). Readers must provide the live-row
 * fallback for active rows and reject malformed detached rows; toRefund()
 * enforces this.
 */
export interface RefundRow {
  id: number;
  registration_id: number | null;
  original_registration_id: number | null;
  reg_code: string | null;
  full_name: string | null;
  email: string | null;
  source_payment_id: number | null;
  source_payment_original_id: number | null;
  source_payment_amount: number | null;
  source_payment_reference: string | null;
  source_payment_gateway: string | null;
  source_payment_created_at: number | null;
  source_payment_verified_by: string | null;
  source_payment_verified_at: number | null;
  source_payment_proof_key: string | null;
  amount: number;
  reason: RefundReason;
  cancellation_reason: string | null;
  status: RefundStatus;
  bank_reference: string | null;
  resolved_by: string | null;
  resolved_at: number | null;
  created_at: number;
}

/**
 * Parsed domain type — the owner/source-mapped shape served to clients.
 * The existing flat fields (registrationId, sourcePaymentId, fullName,
 * regCode) remain; registrationId/sourcePaymentId are null only when the
 * live rows have been deleted. No nested-only shape is exposed.
 */
export interface Refund {
  id: number;
  registrationId: number | null;
  sourcePaymentId: number | null;
  amount: number;
  reason: RefundReason;
  cancellationReason: string | null;
  status: RefundStatus;
  bankReference: string | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  createdAt: number;
  originalRegistrationId: number;
  originalPaymentId: number;
  regCode: string;
  fullName: string;
  email: string;
  sourcePaymentAmount: number;
  sourcePaymentReference: string | null;
  ownerKind: RefundOwnerKind;
}

/** Insert shape for create() (overpayment path). The repository snapshots
 *  identity/source-payment facts from the live registration and payment. */
export interface NewRefund {
  registration_id: number;
  source_payment_id: number;
  amount: number;
  status: 'pending';
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/** Staff cancellation request. The reason is trimmed and must be non-empty. */
export interface CancelRegistrationRequest {
  reason: string;
}

/** Result of a staff cancellation. refunds are the pending cancellation
 *  refunds (one per verified payment), detached from the deleted live rows. */
export interface CancelRegistrationResponse {
  archivedId: number;
  originalRegistrationId: number;
  regCode: string;
  fullName: string;
  totalRefundAmount: number;
  refunds: Refund[];
}

// ---------------------------------------------------------------------------
// Tshirt
// ---------------------------------------------------------------------------

/** Mirrors the `tshirts` D1 table exactly. Booleans as 0|1. */
export interface TshirtRow {
  id: number;
  registration_id: number;
  gender: Gender | null;
  size: string;
  is_included: number;          // 0 | 1
  created_at: number;
}

/** Insert shape for create(). */
export interface NewTshirt {
  registration_id: number;
  gender: Gender | null;
  size: string;
  is_included: number;          // 0 | 1
}

// ---------------------------------------------------------------------------
// Additional Charge
// ---------------------------------------------------------------------------

/** Mirrors the `additional_charges` D1 table exactly. */
export interface AdditionalChargeRow {
  id: number;
  registration_id: number;
  description: string;
  amount: number;
  created_by: number;
  created_at: number;
}

/** Insert shape for create(). */
export interface NewAdditionalCharge {
  registration_id: number;
  description: string;
  amount: number;
  created_by: number;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** Mirrors the `audit_log` D1 table exactly. */
export interface AuditEntryRow {
  id: number;
  registration_id: number;
  action: AuditAction;
  actor: string | null;
  changes: string | null;    // JSON: { field: { old: x, new: y } } or null for 'created'
  snapshot: string;          // JSON: full Registration domain type
  created_at: number;
}

/** The shape stored in the snapshot column — full registration state + attendees. */
export interface AuditSnapshot {
  registration: Registration;
  attendees: Attendee[];
}

/** Parsed domain type. */
export interface AuditEntry {
  id: number;
  registrationId: number;
  action: AuditAction;
  actor: string | null;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  snapshot: AuditSnapshot;
  createdAt: number;
}

/** Insert shape for append(). */
export interface NewAuditEntry {
  registration_id: number;
  action: AuditAction;
  actor: string | null;
  changes: string | null;    // JSON string
  snapshot: string;          // JSON string of Registration
}

// ---------------------------------------------------------------------------
// ID Document
// ---------------------------------------------------------------------------

/** Mirrors the `id_documents` D1 table exactly. */
export interface IdDocumentRow {
  id: number;
  registration_id: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  r2_key: string;
  created_at: number;
}

/** Parsed domain type. No 0/1 coercion needed. */
export interface IdDocument {
  id: number;
  registrationId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  r2Key: string;
  createdAt: number;
}

/** Insert shape for create(). */
export interface NewIdDocument {
  registration_id: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  r2_key: string;
}

/** Metadata passed to IFileStorage.upload(). */
export interface FileMetadata {
  mimeType: string;
  fileName: string;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Magic Link
// ---------------------------------------------------------------------------

/** Mirrors the `magic_links` D1 table exactly. */
export interface MagicLinkRow {
  id: number;
  token_hash: string;
  registration_id: number | null;
  user_id: number | null;
  expires_at: number;
  used_at: number | null;
  created_at: number;
}

/** Parsed domain type. No 0/1 coercion needed. */
export interface MagicLink {
  id: number;
  tokenHash: string;
  registrationId: number | null;
  userId: number | null;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// User (staff/admin)
// ---------------------------------------------------------------------------

/** Mirrors the `users` D1 table exactly. Booleans as 0|1. */
export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: 'staff' | 'admin';
  is_active: number;
  permissions: string | null;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}

export type StaffScope = 'dashboard' | 'resources' | 'reports' | 'allocation' | 'admin-tools' | 'bank_txns' | 'registration_desk';
export interface UserPermissions {
  scopes: StaffScope[];
}

/** Parsed domain type — what repositories return and services consume. */
export interface User {
  id: number;
  email: string;
  name: string;
  role: 'staff' | 'admin';
  isActive: boolean;
  permissions: UserPermissions | null;
  createdBy: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Insert shape for create(). */
export interface NewUser {
  email: string;
  name: string;
  role: 'staff' | 'admin';
  permissions?: string | null;
  created_by: number | null;
}

// ---------------------------------------------------------------------------
// System Audit
// ---------------------------------------------------------------------------

export type SystemAuditAction =
  | 'login_requested' | 'login_succeeded' | 'login_failed'
  | 'staff_created' | 'staff_updated' | 'login_link_generated'
  | 'registration_viewed' | 'file_viewed' | 'export_downloaded'
  | 'payment_link_sent' | 'payment_link_generated'
  | 'registration_archived'
  | 'registration_cancelled'
  | 'cancellation_refund_created'
  | 'refund_completed'
  | 'preferences_updated' | 'preferences_deleted' | 'preferences_cleaned'
  | 'statuses_reconciled' | 'room_inventory_updated'
  | 'bank_txn_imported' | 'bank_txn_commented'
  | 'bank_txn_linked' | 'bank_txn_unlinked'
  | 'attendee_checked_in' | 'spot_registration_created'
  | 'room_created' | 'room_updated' | 'room_assignment_created'
  | 'feature_flags_updated'
  | 'memory_story_deleted'
  | 'memory_story_hidden'
  | 'memory_story_unhidden'
  | 'memory_story_hide_notification_failed';

// ---------------------------------------------------------------------------
// Converters — coerce D1 row shapes into domain types
// ---------------------------------------------------------------------------

export function toRegistration(row: RegistrationRow): Registration {
  return {
    id: row.id,
    regCode: row.reg_code,
    status: row.status,

    fullName: row.full_name,
    branch: row.branch,
    email: row.email,
    whatsapp: row.whatsapp,
    mobileAlternate: row.mobile_alternate,
    city: row.city,
    country: row.country,
    attendanceIntent: row.attendance_intent,
    participationType: row.participation_type,
    gender: row.gender,
    tshirtSize: row.tshirt_size,

    alumniMeal: row.alumni_meal,

    accommodation: row.accommodation,
    checkIn: row.check_in,
    checkOut: row.check_out,
    extraBed: row.extra_bed !== 0,
    breakfastAdult: row.breakfast_adult,
    breakfastChild: row.breakfast_child,

    donationAmount: row.donation_amount,
    publicAck: row.public_ack !== 0,
    ackDisplayName: row.ack_display_name,
    felicitation: row.felicitation !== 0,

    contributionSplits: (() => {
      try {
        const parsed = JSON.parse(row.contribution_splits);
        return (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
          ? parsed as Record<string, number>
          : {};
      } catch {
        return {};
      }
    })(),

    pricingSnapshot: JSON.parse(row.pricing_snapshot) as PricingBreakup,
    totalAmount: row.total_amount,

    idNote: row.id_note,

    photoFileKey: row.photo_file_key,
    photoThumbKey: row.photo_thumb_key,

    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toAttendee(row: AttendeeRow): Attendee {
  return {
    id: row.id,
    registrationId: row.registration_id,
    type: row.type,
    name: row.name,
    age: row.age,
    relationship: row.relationship,
    meal: row.meal,
    isChargeable: row.is_chargeable !== 0,
    createdAt: row.created_at,
  };
}

export function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    registrationId: row.registration_id,
    amount: row.amount,
    status: row.status,
    gateway: row.gateway,
    gatewayRef: row.gateway_ref,
    gatewayResponse: row.gateway_response,
    proofFileKey: row.proof_file_key,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    method: row.method,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toTshirt(row: TshirtRow): Tshirt {
  return {
    id: row.id,
    registrationId: row.registration_id,
    gender: row.gender,
    size: row.size as TshirtSize,
    isIncluded: row.is_included !== 0,
    createdAt: row.created_at,
  };
}

export function toAdditionalCharge(row: AdditionalChargeRow): AdditionalCharge {
  return {
    id: row.id,
    registrationId: row.registration_id,
    description: row.description,
    amount: row.amount,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function toRefund(row: RefundRow): Refund {
  // Required immutable snapshot fields. Active rows get these from the live
  // registration/payment via the repository's COALESCE fallback (plan §6
  // "Migration compatibility"). A detached row (live registration deleted)
  // with any required field still NULL is malformed legacy data — reject it
  // loudly instead of silently constructing an invalid non-null domain value.
  if (
    row.original_registration_id === null ||
    row.reg_code === null ||
    row.full_name === null ||
    row.email === null ||
    row.source_payment_original_id === null ||
    row.source_payment_amount === null
  ) {
    throw new Error(
      `Refund ${row.id} is missing immutable owner/source snapshot fields ` +
        `(original_registration_id=${String(row.original_registration_id)}, ` +
        `reg_code=${String(row.reg_code)}, full_name=${String(row.full_name)}, ` +
        `email=${String(row.email)}, ` +
        `source_payment_original_id=${String(row.source_payment_original_id)}, ` +
        `source_payment_amount=${String(row.source_payment_amount)}). ` +
        'Detached refund rows must carry their snapshot at creation time.',
    );
  }

  return {
    id: row.id,
    registrationId: row.registration_id,
    sourcePaymentId: row.source_payment_id,
    amount: row.amount,
    reason: row.reason,
    cancellationReason: row.cancellation_reason,
    status: row.status,
    bankReference: row.bank_reference,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    originalRegistrationId: row.original_registration_id,
    originalPaymentId: row.source_payment_original_id,
    regCode: row.reg_code,
    fullName: row.full_name,
    email: row.email,
    sourcePaymentAmount: row.source_payment_amount,
    sourcePaymentReference: row.source_payment_reference,
    ownerKind: row.registration_id === null ? 'cancelled' : 'active',
  };
}

export function toAuditEntry(row: AuditEntryRow): AuditEntry {
  return {
    id: row.id,
    registrationId: row.registration_id,
    action: row.action,
    actor: row.actor,
    changes: row.changes !== null
      ? JSON.parse(row.changes) as Record<string, { old: unknown; new: unknown }>
      : null,
    snapshot: JSON.parse(row.snapshot) as AuditSnapshot,
    createdAt: row.created_at,
  };
}

export function toIdDocument(row: IdDocumentRow): IdDocument {
  return {
    id: row.id,
    registrationId: row.registration_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    r2Key: row.r2_key,
    createdAt: row.created_at,
  };
}

export function toMagicLink(row: MagicLinkRow): MagicLink {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    registrationId: row.registration_id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdAt: row.created_at,
  };
}

export function parsePermissions(raw: string | null): UserPermissions | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { scopes?: unknown };
    if (parsed && Array.isArray(parsed.scopes)) {
      return { scopes: parsed.scopes as StaffScope[] };
    }
    return null;
  } catch {
    return null;
  }
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.is_active === 1,
    permissions: parsePermissions(row.permissions),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
