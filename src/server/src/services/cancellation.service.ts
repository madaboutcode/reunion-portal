/**
 * CONTRACT
 *
 * GUARANTEE: CANCEL_REASON — cancel() rejects a blank reason (after trimming)
 *   with AppError 422. The service owns the cancellation timestamp and staff
 *   identity; the reason is stored on each cancellation refund and in the
 *   archive snapshot.
 *
 * GUARANTEE: CANCEL_NOT_FOUND — cancel() throws NotFoundError (404) when no
 *   registration exists with the given id. A registration that was already
 *   archived or cancelled is reported as AppError 409 ('Registration has
 *   already been archived or cancelled'), not a misleading 404 — the archived
 *   row is the evidence the id was once live (plan §4 step 3, defect 8).
 *
 * GUARANTEE: CANCEL_PENDING_VERIFICATION — cancel() throws AppError 409 when
 *   any payment of the registration is 'pending_verification'. Cancellation
 *   must not decide whether an unreviewed proof represents received money.
 *   The check runs at read time AND is re-encoded atomically inside the batch
 *   (see CANCEL_ATOMIC), so a payment that moves to pending_verification
 *   between the read and the batch still aborts the cancellation.
 *
 * GUARANTEE: REFUND_PER_VERIFIED_PAYMENT — cancel() creates exactly one
 *   'cancellation' refund per VERIFIED payment, for the payment's full
 *   amount, computed from the LIVE payment state inside the batch
 *   (INSERT ... SELECT FROM payments WHERE status = 'verified'). A payment
 *   that becomes verified between the read and the batch is refunded — it is
 *   never deleted without a cancellation refund. Unpaid 'payment_pending'
 *   amounts are never refunded. totalRefundAmount is the sum of the verified
 *   payment amounts.
 *
 * GUARANTEE: DUPLICATE_CANCELLATION — a repeated or concurrent cancellation
 *   of the same registration is rejected with 409. The unique
 *   archived_registrations.original_id index (and the partial unique
 *   cancellation-refund index) fail the batch, and the constraint error is
 *   mapped to AppError 409 — no duplicate archive or refund history.
 *
 * GUARANTEE: LEGACY_SNAPSHOT_MATERIALIZE — pre-existing refunds of this
 *   registration (overpayment rows written before the 0020 rollout can carry
 *   NULL identity/source snapshot fields; they read via the live-row COALESCE
 *   fallback while active — plan §6 "Migration compatibility") are updated in
 *   the batch from the live registration and source-payment rows BEFORE those
 *   rows are deleted. Only NULL fields are filled (COALESCE); existing
 *   snapshot values are preserved, so the detached rows carry their own
 *   identity/source facts and toRefund() keeps reading them. Cancellation
 *   refunds inserted by this same batch are already fully snapshotted by
 *   their INSERT ... SELECT and are a no-op for this UPDATE.
 *
 * GUARANTEE: CANCEL_ATOMIC — cancel() executes ONE db.batch() containing:
 *   archive insert, cancellation refund inserts (from live verified payments),
 *   legacy-snapshot materialization UPDATE (fills NULL snapshot fields on
 *   pre-existing refunds before the live rows are deleted),
 *   system-audit inserts (registration_cancelled + one
 *   cancellation_refund_created per created refund), roommate-preference
 *   cleanup in both FK directions, magic-link delete, payment_pending delete,
 *   payment delete, registration delete. Every statement is guarded by
 *   NOT EXISTS (a pending_verification payment for the registration), so if a
 *   payment moves to pending_verification between the read and the batch, the
 *   whole batch is a no-op and the archive canary result (zero rows inserted)
 *   is reported as 409 with no state mutated. If any statement fails the whole
 *   batch rolls back.
 *
 * GUARANTEE: AUDIT_SAME_BATCH — cancellation and cancellation-refund events
 *   are written to system_audit_log inside the same db.batch(). Cancellation
 *   never calls the post-commit systemAuditRepo.append(). The target for both
 *   event kinds is the ORIGINAL registration id (valid after the active row
 *   is deleted). The refund-created event is computed FROM the inserted
 *   cancellation refund rows (read-your-writes inside the batch), so the
 *   audit always matches the created refunds. Details carry the reg code,
 *   reason, refund amounts and source payment ids — never generated
 *   archive/refund ids (unknown until the batch returns).
 *
 * GUARANTEE: SNAPSHOT_COMPLETE — the archived snapshot contains top-level
 *   keys: registration, attendees, documents, auditLog, payments, tshirts,
 *   additionalCharges, roommatePreferences, refunds (existing refunds PLUS
 *   the proposed cancellation refund source-payment facts — no generated
 *   refund ids), bankTransactionLinks, bankTransactions, cancellation
 *   { reason, actor, timestamp, refundTotal }. No magic-link token hashes are
 *   copied. The snapshot is assembled in memory from the read-time state
 *   (plan §4 step 5) and stored once by the archive INSERT; the batch does
 *   not rewrite it.
 *
 * GUARANTEE: SET_NULL_LINKS — refund rows are inserted with live
 *   registration_id/source_payment_id; the batch then deletes the payments
 *   and the registration, so the migrated ON DELETE SET NULL behavior
 *   detaches the refund rows. The response refunds are the created
 *   cancellation refunds re-read by immutable original_registration_id
 *   (ownerKind 'cancelled').
 *
 * FAILURE BEHAVIOR: All other errors propagate as thrown errors. D1 batch
 *   failures roll back all statements.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type {
  IRegistrationRepository,
  IPaymentRepository,
  IAuditRepository,
  IAttendeeRepository,
  IDocumentRepository,
  IRefundRepository,
  ITshirtRepository,
  IAdditionalChargeRepository,
} from '../repositories/interfaces.js';
import type { CancelRegistrationResponse } from '../domain/types.js';
import { NotFoundError, AppError } from './errors.js';
import { loadRoommatePreferences, loadBankLinkSnapshot } from './snapshot-data.js';

/**
 * The ONLY UNIQUE constraints the cancellation batch can hit are the two
 * duplicate-cancellation guards, and SQLite reports them as
 * 'UNIQUE constraint failed: <indexed columns>':
 *   - uq_archived_original_id            → archived_registrations.original_id
 *   - uq_refund_cancellation_once (partial) → refunds.original_registration_id,
 *                                             refunds.source_payment_original_id
 * FALLBACK-OK: tasks/2026-08-03-cancellation-refunds.plan.md §4 step 3 + §9,
 * and src/server/src/db/schema.sql lines 149-151 & 223 — the batch writes
 * only archived_registrations, refunds (INSERT ... SELECT) and system_audit_log
 * (no unique constraint); registrations is only DELETEd. A constraint error on
 * any OTHER index would be an unreasoned state and must propagate loudly, so
 * the mapping to 'already archived or cancelled' 409 matches ONLY these two
 * named guards — an unrelated unique failure is never reclassified.
 */
const DUPLICATE_GUARD_RE =
  /UNIQUE constraint failed: (archived_registrations\.original_id|refunds\.original_registration_id, refunds\.source_payment_original_id)/;

/**
 * Guard fragment re-encoded on every batch statement. Encloses the
 * pending_verification rejection atomically: if any payment of the
 * registration is pending_verification when the batch executes, each guarded
 * statement is a no-op and the archive canary result reports 409.
 */
function noPendingVerificationGuardSql(): string {
  return `NOT EXISTS (
    SELECT 1 FROM payments WHERE registration_id = ? AND status = 'pending_verification'
  )`;
}

export class CancellationService {
  private readonly db: D1Database;
  private readonly registrationRepo: IRegistrationRepository;
  private readonly paymentRepo: IPaymentRepository;
  private readonly attendeeRepo: IAttendeeRepository;
  private readonly auditRepo: IAuditRepository;
  private readonly documentRepo: IDocumentRepository;
  private readonly refundRepo: IRefundRepository;
  private readonly tshirtRepo: ITshirtRepository;
  private readonly chargeRepo: IAdditionalChargeRepository;

  constructor(deps: {
    db: D1Database;
    registrationRepo: IRegistrationRepository;
    paymentRepo: IPaymentRepository;
    attendeeRepo: IAttendeeRepository;
    auditRepo: IAuditRepository;
    documentRepo: IDocumentRepository;
    refundRepo: IRefundRepository;
    tshirtRepo: ITshirtRepository;
    chargeRepo: IAdditionalChargeRepository;
  }) {
    this.db = deps.db;
    this.registrationRepo = deps.registrationRepo;
    this.paymentRepo = deps.paymentRepo;
    this.attendeeRepo = deps.attendeeRepo;
    this.auditRepo = deps.auditRepo;
    this.documentRepo = deps.documentRepo;
    this.refundRepo = deps.refundRepo;
    this.tshirtRepo = deps.tshirtRepo;
    this.chargeRepo = deps.chargeRepo;
  }

  async cancel(
    registrationId: number,
    reason: string,
    staffEmail: string,
  ): Promise<CancelRegistrationResponse> {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw new AppError('Cancellation reason is required', 422);
    }

    // 1. Load the registration. A missing row whose original id exists in
    //    archived_registrations was already archived/cancelled — that is a
    //    known conflict (409), not a plain 404.
    const registration = await this.registrationRepo.findById(registrationId);
    if (!registration) {
      const alreadyArchived = await this.db
        .prepare(`SELECT id FROM archived_registrations WHERE original_id = ?`)
        .bind(registrationId)
        .first<{ id: number }>();
      if (alreadyArchived) {
        throw new AppError('Registration has already been archived or cancelled', 409);
      }
      throw new NotFoundError('Registration not found');
    }

    const payments = await this.paymentRepo.findByRegistration(registrationId);

    // 2. Guard: never cancel while a proof is unreviewed (read-time fast
    //    path; the batch re-encodes this atomically).
    if (payments.some((p) => p.status === 'pending_verification')) {
      throw new AppError(
        'Cannot cancel a registration with a payment awaiting verification. Verify or reject the proof first.',
        409,
      );
    }

    // 3. One cancellation refund per verified payment. Unpaid payment_pending
    //    amounts are not money received and are not refunded. The refunds are
    //    computed from LIVE state inside the batch; the read-time set only
    //    drives the snapshot and the informational response fields.
    const readVerifiedPayments = payments.filter((p) => p.status === 'verified');
    const readRefundTotal = readVerifiedPayments.reduce((sum, p) => sum + p.amount, 0);

    const timestamp = Date.now();

    // 4. Build the complete archive snapshot in memory.
    const [attendees, auditEntries, documents, existingRefunds, tshirts, charges, roommatePreferences, bankLinks] =
      await Promise.all([
        this.attendeeRepo.findByRegistration(registrationId),
        this.auditRepo.findByRegistration(registrationId),
        this.documentRepo.findByRegistration(registrationId),
        this.refundRepo.findByRegistration(registrationId),
        this.tshirtRepo.findByRegistration(registrationId),
        this.chargeRepo.findByRegistration(registrationId),
        loadRoommatePreferences(this.db, registrationId),
        loadBankLinkSnapshot(this.db, payments.map((p) => p.id)),
      ]);

    // Proposed refund data carries source-payment facts — not generated
    // refund ids (unknown until the batch returns).
    const proposedRefunds = readVerifiedPayments.map((p) => ({
      amount: p.amount,
      sourcePaymentId: p.id,
      reason: 'cancellation' as const,
      cancellationReason: trimmedReason,
    }));

    const snapshot = JSON.stringify({
      registration,
      attendees,
      documents,
      auditLog: auditEntries,
      payments,
      tshirts,
      additionalCharges: charges,
      roommatePreferences,
      refunds: [...existingRefunds, ...proposedRefunds],
      bankTransactionLinks: bankLinks.bankTransactionLinks,
      bankTransactions: bankLinks.bankTransactions,
      cancellation: {
        reason: trimmedReason,
        actor: staffEmail,
        timestamp,
        refundTotal: readRefundTotal,
      },
    });

    const guard = noPendingVerificationGuardSql();

    // 5. Build the atomic batch. Refund inserts come BEFORE the payment and
    //    registration deletes so the live links resolve at insert time and
    //    the migrated ON DELETE SET NULL detaches them afterward. The
    //    materialization UPDATE then fills the NULL snapshot fields on
    //    pre-existing (legacy overpayment) refunds from the live rows, before
    //    the deletes, so the detached rows stay readable. Every statement
    //    carries the pending_verification guard so a state change between
    //    read and batch turns the whole batch into a no-op.
    const statements = [
      this.archiveInsertStatement(registrationId, registration, snapshot, staffEmail, guard),
      this.cancellationRefundInsertStatement(registrationId, trimmedReason, guard),
      this.refundSnapshotMaterializeStatement(registrationId, guard),
      this.cancelledAuditStatement(staffEmail, registrationId, registration, trimmedReason, guard),
      this.refundCreatedAuditStatement(staffEmail, registrationId, trimmedReason, guard),
      this.db
        .prepare(`DELETE FROM roommate_preferences WHERE registration_id = ? AND ${guard}`)
        .bind(registrationId, registrationId),
      this.db
        .prepare(`DELETE FROM roommate_preferences WHERE preferred_registration_id = ? AND ${guard}`)
        .bind(registrationId, registrationId),
      this.db
        .prepare(`DELETE FROM magic_links WHERE registration_id = ? AND ${guard}`)
        .bind(registrationId, registrationId),
      this.db
        .prepare(`DELETE FROM payments WHERE registration_id = ? AND status = 'payment_pending' AND ${guard}`)
        .bind(registrationId, registrationId),
      this.db
        .prepare(`DELETE FROM payments WHERE registration_id = ? AND ${guard}`)
        .bind(registrationId, registrationId),
      this.db
        .prepare(`DELETE FROM registrations WHERE id = ? AND ${guard}`)
        .bind(registrationId, registrationId),
    ];

    // 6. Execute — one transaction.
    let archivedId: number;
    try {
      const [insertResult] = await this.db.batch(statements);
      // 6a. Canary: the archive insert is the first statement. If a payment
      //     moved to pending_verification between the read and the batch, the
      //     guard made EVERY statement a no-op and this insert changed zero
      //     rows — report the conflict with no state mutated.
      if (insertResult.meta.changes === 0) {
        throw new AppError(
          'Cannot cancel a registration with a payment awaiting verification. Verify or reject the proof first.',
          409,
        );
      }
      archivedId = insertResult.meta.last_row_id as number;
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof Error && DUPLICATE_GUARD_RE.test(err.message)) {
        throw new AppError('Registration has already been archived or cancelled', 409);
      }
      throw err;
    }

    // 7. Return the archived identity and the pending cancellation refunds
    //    (re-read by immutable original_registration_id — the response carries
    //    the generated refund ids the in-batch audit deliberately omitted).
    //    totalRefundAmount is the sum of the ACTUALLY created refunds, which
    //    can exceed the read-state sum when a payment was verified between
    //    the read and the batch.
    const refunds = (await this.refundRepo.findByOriginalRegistration(registrationId))
      .filter((r) => r.reason === 'cancellation');
    const totalRefundAmount = refunds.reduce((sum, r) => sum + r.amount, 0);

    return {
      archivedId,
      originalRegistrationId: registrationId,
      regCode: registration.regCode,
      fullName: registration.fullName,
      totalRefundAmount,
      refunds,
    };
  }

  private archiveInsertStatement(
    registrationId: number,
    registration: { regCode: string; email: string; fullName: string },
    snapshot: string,
    staffEmail: string,
    guard: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO archived_registrations (original_id, reg_code, email, full_name, snapshot, archived_by)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE ${guard}`,
      )
      .bind(
        registrationId,
        registration.regCode,
        registration.email,
        registration.fullName,
        snapshot,
        staffEmail,
        registrationId,
      );
  }

  /** One INSERT ... SELECT per VERIFIED payment, computed from live payment
   *  state at batch time. The snapshot fields are filled from the live
   *  registration row, so a payment verified between the read and the batch
   *  still produces a fully-populated refund. */
  private cancellationRefundInsertStatement(
    registrationId: number,
    cancellationReason: string,
    guard: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO refunds (
           registration_id, source_payment_id, amount, reason, cancellation_reason, status,
           original_registration_id, reg_code, full_name, email,
           source_payment_original_id, source_payment_amount, source_payment_reference,
           source_payment_gateway, source_payment_created_at, source_payment_verified_by,
           source_payment_verified_at, source_payment_proof_key
         )
         SELECT r.id, p.id, p.amount, 'cancellation', ?, 'pending',
           r.id, r.reg_code, r.full_name, r.email,
           p.id, p.amount, p.gateway_ref, p.gateway, p.created_at, p.verified_by,
           p.verified_at, p.proof_file_key
         FROM payments p
         JOIN registrations r ON r.id = p.registration_id
         WHERE p.registration_id = ? AND p.status = 'verified'
           AND ${guard}`,
      )
      .bind(cancellationReason, registrationId, registrationId);
  }

  /** Materializes the identity/source-payment snapshot fields on pre-existing
   *  refunds of this registration. Overpayment rows written before the 0020
   *  rollout can have NULL snapshot columns — they read via the repository's
   *  live-row COALESCE fallback while the registration is active (plan §6
   *  "Migration compatibility"). This UPDATE runs inside the batch AFTER the
   *  live rows still exist and BEFORE they are deleted, filling only the NULL
   *  fields (COALESCE) from the live registration and source payment, so the
   *  detached rows carry their own facts and toRefund() keeps reading them.
   *  Existing snapshot values are preserved. Cancellation refunds inserted
   *  earlier in this batch are already fully snapshotted by their INSERT ...
   *  SELECT — they match the WHERE clause but have no NULL fields to fill, so
   *  the UPDATE is a no-op for them. Guarded like every other statement: a
   *  payment that moved to pending_verification between the read and the batch
   *  leaves this UPDATE a no-op too, so the 409 path mutates nothing. */
  private refundSnapshotMaterializeStatement(registrationId: number, guard: string) {
    return this.db
      .prepare(
        `UPDATE refunds
         SET
           original_registration_id = COALESCE(original_registration_id, (SELECT id FROM registrations WHERE id = refunds.registration_id)),
           reg_code = COALESCE(reg_code, (SELECT reg_code FROM registrations WHERE id = refunds.registration_id)),
           full_name = COALESCE(full_name, (SELECT full_name FROM registrations WHERE id = refunds.registration_id)),
           email = COALESCE(email, (SELECT email FROM registrations WHERE id = refunds.registration_id)),
           source_payment_original_id = COALESCE(source_payment_original_id, (SELECT id FROM payments WHERE id = refunds.source_payment_id)),
           source_payment_amount = COALESCE(source_payment_amount, (SELECT amount FROM payments WHERE id = refunds.source_payment_id)),
           source_payment_reference = COALESCE(source_payment_reference, (SELECT gateway_ref FROM payments WHERE id = refunds.source_payment_id)),
           source_payment_gateway = COALESCE(source_payment_gateway, (SELECT gateway FROM payments WHERE id = refunds.source_payment_id)),
           source_payment_created_at = COALESCE(source_payment_created_at, (SELECT created_at FROM payments WHERE id = refunds.source_payment_id)),
           source_payment_verified_by = COALESCE(source_payment_verified_by, (SELECT verified_by FROM payments WHERE id = refunds.source_payment_id)),
           source_payment_verified_at = COALESCE(source_payment_verified_at, (SELECT verified_at FROM payments WHERE id = refunds.source_payment_id)),
           source_payment_proof_key = COALESCE(source_payment_proof_key, (SELECT proof_file_key FROM payments WHERE id = refunds.source_payment_id))
         WHERE registration_id = ?
           AND ${guard}`,
      )
      .bind(registrationId, registrationId);
  }

  private cancelledAuditStatement(
    staffEmail: string,
    registrationId: number,
    registration: { regCode: string },
    reason: string,
    guard: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO system_audit_log (action, actor, target_type, target_id, details)
         SELECT 'registration_cancelled', ?, 'registration', ?,
           json_object(
             'regCode', ?,
             'reason', ?,
             'refundTotal', COALESCE((SELECT SUM(amount) FROM refunds WHERE original_registration_id = ? AND reason = 'cancellation'), 0),
             'refunds', COALESCE((SELECT json_group_array(json_object('amount', amount, 'sourcePaymentId', source_payment_id)) FROM refunds WHERE original_registration_id = ? AND reason = 'cancellation'), json_array())
           )
         WHERE ${guard}`,
      )
      .bind(
        staffEmail,
        registrationId,
        registration.regCode,
        reason,
        registrationId,
        registrationId,
        registrationId,
      );
  }

  /** One 'cancellation_refund_created' row per created cancellation refund,
   *  read from the just-inserted refunds (same transaction), so the audit
   *  always matches the refunds. */
  private refundCreatedAuditStatement(
    staffEmail: string,
    registrationId: number,
    cancellationReason: string,
    guard: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO system_audit_log (action, actor, target_type, target_id, details)
         SELECT 'cancellation_refund_created', ?, 'registration', ?,
           json_object(
             'regCode', (SELECT reg_code FROM registrations WHERE id = ?),
             'amount', amount,
             'sourcePaymentId', source_payment_id,
             'cancellationReason', ?
           )
         FROM refunds
         WHERE original_registration_id = ? AND reason = 'cancellation'
           AND ${guard}`,
      )
      .bind(staffEmail, registrationId, registrationId, cancellationReason, registrationId, registrationId);
  }
}
