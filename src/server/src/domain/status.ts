/**
 * CONTRACT
 *
 * GUARANTEE: STATUS_TRANSITIONS — valid registration transitions:
 *   pending → pending_verification → confirmed (forward path)
 *   pending_verification → pending (rejection path — staff rejects proof)
 *   confirmed → pending (staff edit creates new payment obligation)
 *   pending → confirmed (delta==0 after edit, no payment needed)
 *   All others are rejected.
 *
 * GUARANTEE: PAYMENT_TRANSITIONS — valid payment transitions:
 *   payment_pending → pending_verification → verified (forward path)
 *   pending_verification → payment_pending (rejection path — staff rejects proof)
 *   All others rejected.
 *
 * GUARANTEE: REFUND_STATUS — RefundStatus is 'pending' | 'completed'. A refund
 *   is created pending and only ever transitions to completed (guarded UPDATE).
 *   There is no soft-cancelled refund status.
 *
 * EXPECTS: Callers must check isValidTransition before mutating
 *   registration status in DB. Calling updateStatus with an invalid
 *   transition is a caller bug — the repository will still execute it
 *   if called directly.
 *
 * EXPECTS: Callers must check isValidPaymentTransition before mutating
 *   payment status in DB.
 *
 * FAILURE BEHAVIOR: Both validators return false (not throw) for invalid
 *   transitions. Throwing is the caller's responsibility.
 */

export type RegistrationStatus = 'pending' | 'pending_verification' | 'confirmed';

export type PaymentStatus = 'payment_pending' | 'pending_verification' | 'verified';

export type RefundStatus = 'pending' | 'completed';

export type AuditAction =
  | 'created'
  | 'updated'
  | 'payment_created'
  | 'proof_uploaded'
  | 'proof_rejected'
  | 'proof_uploaded_by_staff'
  | 'payment_verified'
  | 'amended'
  | 'payment_amended'
  | 'photo_replaced'
  | 'registration_archived'
  | 'refund_created'
  | 'refund_completed'
  | 'tshirt_added'
  | 'tshirt_updated'
  | 'tshirt_removed'
  | 'charge_added'
  | 'charge_removed'
  | 'tshirt_synced'
  | 'charge_synced'
  | 'desk_payment_collected';

/**
 * Returns true only for valid registration status transitions:
 *   pending → pending_verification (proof uploaded)
 *   pending → confirmed (delta==0 after staff edit, no payment needed)
 *   pending_verification → confirmed (staff approves proof)
 *   pending_verification → pending (staff rejects proof)
 *   confirmed → pending (staff edit creates new payment obligation)
 *
 * Self-transitions and all other combinations are intentionally rejected
 * — they indicate a caller error.
 */
export function isValidTransition(
  from: RegistrationStatus,
  to: RegistrationStatus,
): boolean {
  const allowed: Record<RegistrationStatus, ReadonlyArray<RegistrationStatus>> = {
    pending: ['pending_verification', 'confirmed'],
    pending_verification: ['confirmed', 'pending'],
    confirmed: ['pending'],
  };
  return (allowed[from] as ReadonlyArray<RegistrationStatus>).includes(to);
}

/**
 * Returns true for valid payment status transitions:
 * - payment_pending    → pending_verification  (proof uploaded)
 * - pending_verification → verified             (committee approved)
 *
 * All other transitions are rejected. Self-transitions are intentionally
 * rejected — they indicate a caller error.
 */
export function isValidPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): boolean {
  const allowed: Record<PaymentStatus, ReadonlyArray<PaymentStatus>> = {
    payment_pending: ['pending_verification'],
    pending_verification: ['verified', 'payment_pending'],
    verified: [],
  };
  return (allowed[from] as ReadonlyArray<PaymentStatus>).includes(to);
}

/**
 * Derives registration status from the current state of all payments.
 * Registration status is a projection — not independent state.
 *
 * Rules (evaluated in order):
 *   1. If sum of verified payment amounts >= totalAmount → 'confirmed'
 *   2. If any payment is 'pending_verification' → 'pending_verification'
 *   3. Otherwise → 'pending'
 */
export function deriveRegistrationStatus(
  payments: ReadonlyArray<{ status: PaymentStatus; amount: number }>,
  totalAmount: number,
): RegistrationStatus {
  const sumVerified = payments
    .filter(p => p.status === 'verified')
    .reduce((sum, p) => sum + p.amount, 0);

  if (sumVerified >= totalAmount) return 'confirmed';
  if (payments.some(p => p.status === 'pending_verification')) return 'pending_verification';
  return 'pending';
}
