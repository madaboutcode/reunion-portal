/**
 * CONTRACT
 *
 * GUARANTEE: UPLOAD_PROOF — uploadProof() finds the most recent payment record
 *   with status 'payment_pending' for the given registration, stores the proof
 *   file in R2 at key pattern `registrations/{regCode}/proof-{paymentId}.{ext}`,
 *   transitions the payment status to 'pending_verification' with proof_file_key,
 *   transitions the registration status to 'pending_verification', and logs an
 *   audit entry with action 'proof_uploaded' and actor = registration.email.
 *   Returns { status: 'pending_verification', message }.
 *
 * GUARANTEE: NO_PENDING — uploadProof() throws AppError with statusCode 409
 *   when no 'payment_pending' payment record exists for the registration.
 *   Message: 'No pending payment to attach proof to'.
 *
 * GUARANTEE: REG_NOT_FOUND — uploadProof() throws NotFoundError when the
 *   registration identified by regId does not exist.
 *
 * GUARANTEE: STORE_BEFORE_MUTATE — The proof file is stored in R2 via
 *   this.fileStorage.upload() before any DB mutations (payment status,
 *   registration status, audit log). If file storage fails, no status
 *   transitions occur.
 *
 * GUARANTEE: MOST_RECENT_PAYMENT — uploadProof() relies on
 *   IPaymentRepository.findByRegistration() returning payments ordered by
 *   created_at DESC (most recent first). The first element is the target.
 *
 * GUARANTEE: VERIFY_PAYMENT — verifyPayment() transitions the payment from
 *   'pending_verification' → 'verified', recording referenceId in gateway_ref
 *   and stamping verifiedBy/verifiedAt via IPaymentRepository.verify().
 *   actualAmount is required — the caller must always state the verified amount. If
 *   actualAmount exceeds expected, the payment is verified for the expected
 *   amount and the excess is recorded as a 'pending' refund
 *   (IRefundRepository.create()). The overpayment branch runs
 *   paymentRepo.verify() first, then refundRepo.create() once plus a
 *   registration-scoped 'refund_created' audit append, then the
 *   'payment_verified' audit append — the create() INSERT ... SELECT snapshots
 *   the refund's identity/source facts from the live registration and the
 *   just-verified payment. Before verifying, a coverage guard checks
 *   sumVerified + effectiveAmount + otherPendingAmount >= registration.totalAmount
 *   — if not covered and withShortfallPayment is true, auto-creates a balance
 *   payment via createBalancePayment() for the shortfall amount (compound
 *   operation). If not covered and withShortfallPayment is false, throws
 *   AppError 409 ("Uncovered shortfall — create a balance payment first").
 *   The registration transitions to 'confirmed' (and a payment-confirmed
 *   email is sent, fire-and-forget) ONLY when the sum of verified payments
 *   now covers the total; otherwise the registration status is left unchanged.
 *   Appends a 'payment_verified' audit entry with expectedAmount and
 *   actualAmount. Throws AppError 409 if payment status is not
 *   'pending_verification'. Throws AppError 422 if actualAmount <= 0.
 *   Throws NotFoundError if the payment or registration does not exist.
 *
 * GUARANTEE: CREATE_BALANCE — createBalancePayment() creates a new
 *   'payment_pending' record for a registration to cover a verification
 *   shortfall. Throws AppError 409 if a payment_pending record already exists
 *   for the registration (R7.8 invariant). Appends a 'payment_created' audit
 *   entry (reason: partial_verification_shortfall) and sends a payment-link
 *   notification (fire-and-forget, reusing sendAdditionalPayment). Throws
 *   NotFoundError if the registration does not exist.
 *
 * GUARANTEE: COMPLETE_REFUND — completeRefund() transitions a refund from
 *   'pending' → 'completed', recording bankReference, resolvedBy, and
 *   resolvedAt. The 'refund_completed' system-audit insert and the guarded
 *   refund update run in ONE db.batch(). The audit insert is guarded by the
 *   same predicate as the update (INSERT ... SELECT FROM refunds WHERE id = ?
 *   AND status = 'pending') and runs BEFORE the update, so a concurrent
 *   completion produces exactly one winner and one audit row. If the guarded
 *   update changed zero rows, no audit row was written and 409 is returned.
 *   Throws AppError 409 if the refund is already completed. Throws
 *   NotFoundError if the refund does not exist. Works for detached refunds
 *   whose registration/payment was deleted (the completion path never loads
 *   the active registration).
 *
 * GUARANTEE: REJECT_PAYMENT — rejectPayment() transitions the payment from
 *   'pending_verification' → 'payment_pending', transitions the registration
 *   back to 'pending', appends a 'proof_rejected' audit entry, and sends a
 *   payment-rejected email (fire-and-forget). Proof file is NOT deleted from R2
 *   (preserved for audit trail). Throws AppError 409 if payment status is not
 *   'pending_verification'. Throws NotFoundError if the payment does not exist.
 *
 * EXPECTS: The caller (route handler) has already verified that the
 *   authenticated user owns this registration. uploadProof() trusts the
 *   regId it receives and does not perform ownership checks.
 *
 * EXPECTS: verifyPayment() and rejectPayment() callers are staff — staffEmail
 *   is used as the audit actor and for the verification stamp.
 *
 * EXPECTS: IPaymentRepository.updateStatus() accepts an optional fourth
 *   parameter proofFileKey (string | undefined). The concrete D1PaymentRepository
 *   already supports this; the interface contract is kept in sync.
 *
 * FAILURE BEHAVIOR: File storage failures (R2 errors) propagate as thrown
 *   errors. No DB state is modified before the upload succeeds.
 */

import type { PricingBreakup } from '@smriti/shared';
import type { D1Database } from '@cloudflare/workers-types';
import type { IRegistrationRepository, IPaymentRepository, IAuditRepository, IAttendeeRepository, IFileStorage, IEmailService, IRefundRepository } from '../repositories/interfaces.js';
import type { FileMetadata } from '../domain/types.js';
import { NotFoundError, AppError } from './errors.js';
import { deriveRegistrationStatus } from '../domain/status.js';
import type { RegistrationStatus } from '../domain/status.js';
import { createLogger, parseLogLevel, type Logger } from '../infra/logger.js';

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'application/pdf': 'pdf',
  };
  return map[mime] ?? 'bin';
}

export class PaymentService {
  private db: D1Database;
  private registrationRepo: IRegistrationRepository;
  private paymentRepo: IPaymentRepository;
  private attendeeRepo: IAttendeeRepository;
  private auditRepo: IAuditRepository;
  private refundRepo: IRefundRepository;
  private fileStorage: IFileStorage;
  private emailService: IEmailService;
  private appBaseUrl: string;
  private authService: { createPaymentLinkUrl(registrationId: number, regCode: string): Promise<string> } | null;
  private log: Logger;

  constructor(deps: {
    db: D1Database;
    registrationRepo: IRegistrationRepository;
    paymentRepo: IPaymentRepository;
    attendeeRepo: IAttendeeRepository;
    auditRepo: IAuditRepository;
    refundRepo: IRefundRepository;
    fileStorage: IFileStorage;
    emailService: IEmailService;
    appBaseUrl: string;
    authService?: { createPaymentLinkUrl(registrationId: number, regCode: string): Promise<string> };
    logLevel?: string;
  }) {
    this.db = deps.db;
    this.registrationRepo = deps.registrationRepo;
    this.paymentRepo = deps.paymentRepo;
    this.attendeeRepo = deps.attendeeRepo;
    this.auditRepo = deps.auditRepo;
    this.refundRepo = deps.refundRepo;
    this.fileStorage = deps.fileStorage;
    this.emailService = deps.emailService;
    this.appBaseUrl = deps.appBaseUrl;
    this.authService = deps.authService ?? null;
    this.log = createLogger('payment', parseLogLevel(deps.logLevel));
  }

  async uploadProof(
    regId: number,
    fileData: ArrayBuffer,
    metadata: FileMetadata,
    utr?: string,
  ): Promise<{ status: 'pending_verification'; message: string }> {
    const reg = await this.registrationRepo.findById(regId);
    if (!reg) throw new NotFoundError('Registration not found');

    const payments = await this.paymentRepo.findByRegistration(regId);
    const pendingPayment = payments[0];
    if (!pendingPayment || pendingPayment.status !== 'payment_pending') {
      throw new AppError('No pending payment to attach proof to', 409);
    }

    const ext = metadata.mimeType ? extFromMime(metadata.mimeType) : (metadata.fileName.split('.').pop() ?? 'bin');
    const r2Key = `registrations/${reg.regCode}/proof-${pendingPayment.id}.${ext}`;
    await this.fileStorage.upload(r2Key, fileData, metadata);

    const gatewayData = utr ? { gatewayRef: utr } : undefined;
    await this.paymentRepo.updateStatus(pendingPayment.id, 'pending_verification', gatewayData, r2Key);
    const allPaymentsNow = await this.paymentRepo.findByRegistration(regId);
    const derivedStatus = deriveRegistrationStatus(allPaymentsNow, reg.totalAmount);
    if (derivedStatus !== reg.status) {
      await this.registrationRepo.updateStatus(regId, derivedStatus);
    }

    const snapshot = JSON.stringify({ registration: reg, attendees: [] });
    await this.auditRepo.append({
      registration_id: regId,
      action: 'proof_uploaded',
      actor: reg.email,
      changes: JSON.stringify({
        paymentId: pendingPayment.id,
        proofFileKey: r2Key,
        ...(utr && { utr }),
      }),
      snapshot,
    });

    return {
      status: 'pending_verification',
      message: 'Payment proof uploaded, awaiting verification',
    };
  }

  async verifyPayment(
    paymentId: number,
    referenceId: string,
    staffEmail: string,
    actualAmount: number,
    withShortfallPayment?: boolean,
  ): Promise<{
    paymentStatus: 'verified';
    registrationStatus: 'confirmed' | 'pending' | 'pending_verification';
    refundCreated?: { id: number; amount: number };
    shortfallCreated?: { paymentId: number; amount: number };
  }> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) throw new NotFoundError('Payment not found');

    if (payment.status !== 'pending_verification') {
      throw new AppError('Payment is not pending verification', 409);
    }

    const actual = actualAmount;
    if (actual <= 0) {
      throw new AppError('Actual amount must be greater than zero', 422);
    }

    let effectiveAmount: number;
    let excess = 0;
    if (actual <= payment.amount) {
      effectiveAmount = actual;
    } else {
      effectiveAmount = payment.amount;
      excess = actual - payment.amount;
    }

    const reg = await this.registrationRepo.findById(payment.registrationId);
    if (!reg) throw new NotFoundError('Registration not found');

    const sumVerified = await this.paymentRepo.sumVerifiedByRegistration(payment.registrationId);
    const allPayments = await this.paymentRepo.findByRegistration(payment.registrationId);
    const outstandingAmount = allPayments
      .filter(p => p.id !== paymentId && (p.status === 'payment_pending' || p.status === 'pending_verification'))
      .reduce((sum, p) => sum + p.amount, 0);

    let shortfallCreated: { paymentId: number; amount: number } | undefined;
    if (sumVerified + effectiveAmount + outstandingAmount < reg.totalAmount) {
      if (!withShortfallPayment) {
        throw new AppError('Uncovered shortfall — create a balance payment first', 409);
      }
      const shortfall = reg.totalAmount - sumVerified - effectiveAmount - outstandingAmount;
      try {
        shortfallCreated = await this.createBalancePayment(payment.registrationId, shortfall, staffEmail, paymentId);
      } catch (err) {
        if (err instanceof AppError && err.statusCode === 409) {
          // A pending payment already exists — its amount is already in outstandingAmount, proceed
        } else {
          throw err;
        }
      }
    }

    await this.paymentRepo.verify(paymentId, effectiveAmount, referenceId, staffEmail, Date.now());

    let refundCreated: { id: number; amount: number } | undefined;
    if (excess > 0) {
      const refundResult = await this.refundRepo.create({
        registration_id: payment.registrationId,
        source_payment_id: paymentId,
        amount: excess,
        status: 'pending',
      });
      refundCreated = { id: refundResult.id, amount: excess };

      const refundSnapshot = JSON.stringify({ registration: reg, attendees: [] });
      await this.auditRepo.append({
        registration_id: payment.registrationId,
        action: 'refund_created',
        actor: staffEmail,
        changes: JSON.stringify({
          refundId: refundResult.id,
          amount: excess,
          sourcePaymentId: paymentId,
          expectedAmount: payment.amount,
          actualAmount: actual,
        }),
        snapshot: refundSnapshot,
      });
    }

    const snapshot = JSON.stringify({ registration: reg, attendees: [] });
    await this.auditRepo.append({
      registration_id: payment.registrationId,
      action: 'payment_verified',
      actor: staffEmail,
      changes: JSON.stringify({
        paymentId,
        referenceId,
        expectedAmount: payment.amount,
        actualAmount: actual,
        from: 'pending_verification',
        to: 'verified',
      }),
      snapshot,
    });

    const freshPayments = await this.paymentRepo.findByRegistration(payment.registrationId);
    const derivedStatus = deriveRegistrationStatus(freshPayments, reg.totalAmount);
    if (derivedStatus !== reg.status) {
      await this.registrationRepo.updateStatus(payment.registrationId, derivedStatus);
    }
    let registrationStatus = derivedStatus;

    if (derivedStatus === 'confirmed') {
      try {
        const attendees = await this.attendeeRepo.findByRegistration(reg.id);
        const spouse = attendees.find(a => a.type === 'spouse');
        const childCount = attendees.filter(a => a.type === 'child').length;
        const guestCount = attendees.filter(a => a.type === 'guest').length;

        let pricingBreakup: PricingBreakup;
        try {
          pricingBreakup = reg.pricingSnapshot;
        } catch {
          pricingBreakup = { base: 0, lines: [], donation: 0, collegeContribution: 0, total: effectiveAmount };
        }

        // Query refunds so the email can show actual amounts paid (not
        // effective amounts) and any pending refunds. Refund records link
        // back to their source payment via sourcePaymentId.
        let allRefunds: import('../domain/types.js').Refund[] = [];
        try {
          allRefunds = await this.refundRepo.findByRegistration(payment.registrationId);
        } catch {
          // refund query failure shouldn't block the email
        }

        // Build a map: paymentId → total refund amount for that payment.
        const refundByPayment = new Map<number, number>();
        for (const r of allRefunds) {
          // FALLBACK-OK: 0020 migration §3 — source_payment_id is NULL only for
          // detached rows whose live payment was deleted (SET NULL). Deletion
          // happens only via archive/cancellation, both of which reject or
          // refund a live registration, so during this verification the
          // registration is still live and no refund here is detached; an
          // unreachable detached row simply cannot be attributed to a payment
          // in this email and is skipped.
          if (r.sourcePaymentId === null) continue;
          refundByPayment.set(r.sourcePaymentId, (refundByPayment.get(r.sourcePaymentId) ?? 0) + r.amount);
        }

        // allPayments was fetched before paymentRepo.verify() ran, so the
        // current payment still shows its pre-verification status/amount.
        // For each payment, actual amount = effective + refund for that payment.
        const verifiedPayments = allPayments
          .filter(p => p.id === paymentId || p.status === 'verified')
          .map(p => {
            if (p.id === paymentId) {
              // Current payment: we have `actual` in scope — use it directly
              return { amount: actual, referenceId, date: p.createdAt };
            }
            // Previously verified: effective is in p.amount, add back any refund
            const refundAmount = refundByPayment.get(p.id) ?? 0;
            return { amount: p.amount + refundAmount, referenceId: p.gatewayRef ?? '—', date: p.createdAt };
          });

        const pendingRefunds = allRefunds
          .filter(r => r.status === 'pending')
          .map(r => ({ amount: r.amount }));

        await this.emailService.sendPaymentConfirmed(reg.email, {
          fullName: reg.fullName,
          regCode: reg.regCode,
          payments: verifiedPayments,
          branch: reg.branch,
          attendanceIntent: reg.attendanceIntent,
          participationType: reg.participationType,
          alumniMeal: reg.alumniMeal,
          tshirtSize: reg.tshirtSize,
          spouseName: spouse?.name ?? null,
          childCount,
          guestCount,
          accommodation: reg.accommodation,
          checkIn: reg.checkIn,
          checkOut: reg.checkOut,
          extraBed: reg.extraBed,
          pricingBreakup,
          passUrl: `${this.appBaseUrl}/pass#${reg.regCode}`,
          refunds: pendingRefunds.length > 0 ? pendingRefunds : undefined,
        });
        this.log.info('Payment confirmed email sent', { to: reg.email, regCode: reg.regCode });
      } catch (err) {
        this.log.error('Payment confirmed email failed', { to: reg.email, error: String(err) });
      }
    }

    return { paymentStatus: 'verified', registrationStatus, refundCreated, shortfallCreated };
  }

  async createBalancePayment(
    registrationId: number,
    amount: number,
    staffEmail: string,
    sourcePaymentId: number,
  ): Promise<{ paymentId: number; amount: number }> {
    const reg = await this.registrationRepo.findById(registrationId);
    if (!reg) throw new NotFoundError('Registration not found');

    const existing = await this.paymentRepo.findPendingByRegistration(registrationId);
    if (existing) throw new AppError('A pending payment already exists', 409);

    const result = await this.paymentRepo.create({
      registration_id: registrationId,
      amount,
      status: 'payment_pending',
      gateway: null,
      gateway_ref: null,
      gateway_response: null,
      proof_file_key: null,
      verified_by: null,
      verified_at: null,
    });

    const snapshot = JSON.stringify({ registration: reg, attendees: [] });
    await this.auditRepo.append({
      registration_id: registrationId,
      action: 'payment_created',
      actor: staffEmail,
      changes: JSON.stringify({ amount, reason: 'partial_verification_shortfall', sourcePaymentId }),
      snapshot,
    });

    try {
      let paymentUrl = `${this.appBaseUrl}/pay/${reg.regCode}`;
      if (this.authService) {
        try {
          paymentUrl = await this.authService.createPaymentLinkUrl(reg.id, reg.regCode);
        } catch (linkErr) {
          this.log.warn('Payment link generation failed, falling back', { error: String(linkErr) });
        }
      }
      await this.emailService.sendAdditionalPayment(reg.email, {
        fullName: reg.fullName,
        amount,
        breakup: reg.pricingSnapshot ?? { base: 0, lines: [], donation: 0, collegeContribution: 0, total: amount },
        paymentLink: paymentUrl,
      });
      this.log.info('Balance payment notification sent', { to: reg.email });
    } catch (err) {
      this.log.error('Balance payment notification failed', { to: reg.email, error: String(err) });
    }

    return { paymentId: result.id, amount };
  }

  async completeRefund(
    refundId: number,
    bankReference: string,
    staffEmail: string,
  ): Promise<{ status: 'completed' }> {
    const refund = await this.refundRepo.findById(refundId);
    if (!refund) throw new NotFoundError('Refund not found');

    if (refund.status !== 'pending') {
      throw new AppError('Refund is already completed', 409);
    }

    // One atomic batch: the system-audit insert PLUS the guarded update. The
    // audit INSERT ... SELECT is guarded by the same predicate as the update
    // (refund still pending) and must run BEFORE the update: statements in a
    // D1 batch execute sequentially in one transaction, so an audit insert
    // after the UPDATE would see status='completed' and insert nothing. With
    // audit-first ordering a concurrent/repeat completion yields exactly one
    // winner — the loser's audit insert writes zero rows AND its update
    // changes zero rows, and the zero-row check below reports 409 with no
    // audit row (plan §4 "PaymentService.completeRefund()", steps 3-4).
    const auditStmt = this.db
      .prepare(
        `INSERT INTO system_audit_log (action, actor, target_type, target_id, details)
         SELECT ?, ?, 'refund', ?, ?
         FROM refunds WHERE id = ? AND status = 'pending'`,
      )
      .bind(
        'refund_completed',
        staffEmail,
        refundId,
        JSON.stringify({ refundId, amount: refund.amount, bankReference }),
        refundId,
      );

    const updateStmt = this.db
      .prepare(
        `UPDATE refunds
         SET status = 'completed',
             resolved_by = ?,
             resolved_at = (unixepoch() * 1000),
             bank_reference = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(staffEmail, bankReference, refundId);

    const [, updateResult] = await this.db.batch([auditStmt, updateStmt]);
    const changed = updateResult.meta.changes;
    if (changed === 0) {
      throw new AppError('Refund is already completed', 409);
    }

    return { status: 'completed' };
  }

  async rejectPayment(
    paymentId: number,
    comment: string,
    staffEmail: string,
  ): Promise<{ paymentStatus: 'payment_pending'; registrationStatus: RegistrationStatus }> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) throw new NotFoundError('Payment not found');

    if (payment.status !== 'pending_verification') {
      throw new AppError('Payment is not pending verification', 409);
    }

    await this.paymentRepo.updateStatus(paymentId, 'payment_pending');

    const reg = await this.registrationRepo.findById(payment.registrationId);
    if (!reg) throw new NotFoundError('Registration not found');

    const rejectPayments = await this.paymentRepo.findByRegistration(payment.registrationId);
    const derivedRejectStatus = deriveRegistrationStatus(rejectPayments, reg.totalAmount);
    if (derivedRejectStatus !== reg.status) {
      await this.registrationRepo.updateStatus(payment.registrationId, derivedRejectStatus);
    }

    const snapshot = JSON.stringify({ registration: reg, attendees: [] });
    await this.auditRepo.append({
      registration_id: payment.registrationId,
      action: 'proof_rejected',
      actor: staffEmail,
      changes: JSON.stringify({ comment, paymentId, from: 'pending_verification', to: 'payment_pending' }),
      snapshot,
    });

    try {
      let paymentUrl = `${this.appBaseUrl}/pay/${reg.regCode}`;
      if (this.authService) {
        try {
          paymentUrl = await this.authService.createPaymentLinkUrl(reg.id, reg.regCode);
        } catch (linkErr) {
          this.log.warn('Payment link generation failed for rejection email, falling back to plain URL', { error: String(linkErr) });
        }
      }

      await this.emailService.sendPaymentRejected(reg.email, {
        fullName: reg.fullName,
        regId: String(payment.registrationId),
        regCode: reg.regCode,
        comment,
        attendanceIntent: reg.attendanceIntent,
        paymentUrl,
      });
      this.log.info('Payment rejected email sent', { to: reg.email, regId: payment.registrationId });
    } catch (err) {
      this.log.error('Payment rejected email failed', { to: reg.email, error: String(err) });
    }

    return { paymentStatus: 'payment_pending', registrationStatus: derivedRejectStatus };
  }
}
