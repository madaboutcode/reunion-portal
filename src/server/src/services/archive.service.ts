/**
 * CONTRACT
 *
 * GUARANTEE: ARCHIVE_NO_REAL_PAYMENTS — archive() throws AppError 409 if any
 *   payment record with status other than 'payment_pending' exists. A bare
 *   payment_pending stub (no proof, no verification) is silently deleted
 *   during the archive batch — it represents no real money movement.
 *
 * GUARANTEE: ARCHIVE_FORCE_NO_BYPASS — options.force does NOT bypass the
 *   payment guard (ARCHIVE_NO_REAL_PAYMENTS). Paid registrations — those with
 *   a verified or pending_verification payment — must use the cancellation
 *   route, which preserves the source payment for the refund. force only
 *   records `forceArchived: true` in the snapshot for API compatibility;
 *   it never allows deleting money-backed payment records.
 *
 * GUARANTEE: ARCHIVE_NOT_FOUND — archive() throws NotFoundError (404) if no
 *   registration exists with the given id.
 *
 * GUARANTEE: ARCHIVE_SNAPSHOT — The snapshot stored in archived_registrations
 *   includes: full registration object, attendees array, audit_log entries,
 *   id_documents array, payments array, tshirts, additionalCharges,
 *   roommatePreferences (both FK directions), refunds, bankTransactionLinks
 *   (payment→transaction associations), and bankTransactions (linked
 *   transaction identity/amounts) — all serialised as JSON. When force=true,
 *   the snapshot also includes `forceArchived: true`.
 *
 * GUARANTEE: ARCHIVE_ATOMIC — The archive operation uses db.batch() to execute
 *   in a single D1 transaction:
 *     1. INSERT into archived_registrations
 *     2. DELETE from payments WHERE status = 'payment_pending' (stubs only)
 *     3. DELETE from magic_links WHERE registration_id = id
 *     4. DELETE from roommate_preferences WHERE registration_id = id
 *     5. DELETE from roommate_preferences WHERE preferred_registration_id = id
 *     6. DELETE from registrations WHERE id = id (CASCADE handles children)
 *   The payment guard (ARCHIVE_NO_REAL_PAYMENTS) is re-encoded INSIDE the
 *   batch: every statement carries `NOT EXISTS (a non-payment_pending payment
 *   for this registration)`, and the archive INSERT is the canary. If a
 *   payment moves to pending_verification or verified between the read (step
 *   2) and the batch, every statement becomes a no-op, the INSERT changes zero
 *   rows, and the canary check reports AppError 409 with no state mutated —
 *   the verified payment is never deleted without its refund trail. The batch
 *   also deletes ONLY payment_pending stubs, so a payment that slips past the
 *   read-time guard can never be destroyed by the DELETE. Roommate-preference
 *   rows must be deleted in both FK directions before the registration DELETE
 *   — the table has no ON DELETE CASCADE, so a live reference would fail the
 *   foreign-key constraint. If any statement fails the batch is rolled back.
 *
 * EXPECTS:
 *   - registrationRepo.findById(id) returns the registration or null
 *   - paymentRepo.findByRegistration(id) returns all payment records
 *   - attendeeRepo.findByRegistration(id) returns all attendees
 *   - auditRepo.findByRegistration(id) returns the audit log
 *   - documentRepo.findByRegistration(id) returns id_documents
 *   - refundRepo.findByRegistration(id) returns existing refunds (none can
 *     exist here: refunds require verified source payments, which the guard
 *     rejects — the key is present in the snapshot as an empty array)
 *   - tshirtRepo / chargeRepo return the registration's shirts and charges
 *   - The db.batch() INSERT for archived_registrations is the source of truth
 *     for the archivedId — the archivedRepo is NOT used by this service (reads
 *     are the route layer's responsibility via c.var.archivedRepo).
 *
 * FAILURE BEHAVIOR: All errors propagate. D1 batch failures roll back all
 *   statements.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { IRegistrationRepository, IPaymentRepository, IAuditRepository, IAttendeeRepository, IDocumentRepository, IRefundRepository, ITshirtRepository, IAdditionalChargeRepository } from '../repositories/interfaces.js';
import { NotFoundError, AppError } from './errors.js';
import { loadRoommatePreferences, loadBankLinkSnapshot } from './snapshot-data.js';

export class ArchiveService {
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

  async archive(
    registrationId: number,
    staffEmail: string,
    options: { force?: boolean } = {},
  ): Promise<{ archivedId: number }> {
    const force = options.force === true;

    // 1. Load registration — 404 if not found
    const registration = await this.registrationRepo.findById(registrationId);
    if (!registration) {
      throw new NotFoundError('Registration not found');
    }

    // 2. Payment guard — applied ALWAYS, even with force. A registration with
    //    real payment activity (verified or pending_verification) must go
    //    through the cancellation route so the source payment survives for
    //    the refund. Deleting it here would destroy the money trail.
    const payments = await this.paymentRepo.findByRegistration(registrationId);
    const realPayments = payments.filter((p) => p.status !== 'payment_pending');
    if (realPayments.length > 0) {
      throw new AppError(
        'Cannot archive a registration with active payment records (pending_verification or verified). Use cancellation to refund the paid amount.',
        409,
      );
    }

    // 3. Build snapshot: fetch all related data
    const [attendees, auditEntries, documents, refunds, tshirts, charges, roommatePreferences, bankLinks] =
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

    const snapshotData: Record<string, unknown> = {
      registration,
      attendees,
      auditLog: auditEntries,
      documents,
      payments,
      tshirts,
      additionalCharges: charges,
      roommatePreferences,
      refunds,
      bankTransactionLinks: bankLinks.bankTransactionLinks,
      bankTransactions: bankLinks.bankTransactions,
    };
    if (force) {
      snapshotData.forceArchived = true;
    }
    const snapshot = JSON.stringify(snapshotData);

    // 4. Execute atomic batch. The read-time guard (step 2) is re-encoded on
    //    EVERY statement: `NOT EXISTS (a non-payment_pending payment)` means a
    //    payment that moves to pending_verification/verified between the read
    //    and the batch turns the whole batch into a no-op. The archive INSERT
    //    is the canary — zero rows inserted means the guard failed and the
    //    409 is reported with no state mutated. Payments are deleted ONLY as
    //    payment_pending stubs; a real payment can never be destroyed here.
    const guard = `NOT EXISTS (
      SELECT 1 FROM payments WHERE registration_id = ? AND status != 'payment_pending'
    )`;

    const insertStmt = this.db
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

    const deleteStubsStmt = this.db
      .prepare(`DELETE FROM payments WHERE registration_id = ? AND status = 'payment_pending' AND ${guard}`)
      .bind(registrationId, registrationId);

    const deleteMagicLinksStmt = this.db
      .prepare(`DELETE FROM magic_links WHERE registration_id = ? AND ${guard}`)
      .bind(registrationId, registrationId);

    const deleteRoommateOutgoingStmt = this.db
      .prepare(`DELETE FROM roommate_preferences WHERE registration_id = ? AND ${guard}`)
      .bind(registrationId, registrationId);

    const deleteRoommateIncomingStmt = this.db
      .prepare(`DELETE FROM roommate_preferences WHERE preferred_registration_id = ? AND ${guard}`)
      .bind(registrationId, registrationId);

    const deleteRegistrationStmt = this.db
      .prepare(`DELETE FROM registrations WHERE id = ? AND ${guard}`)
      .bind(registrationId, registrationId);

    const [insertResult] = await this.db.batch([
      insertStmt,
      deleteStubsStmt,
      deleteMagicLinksStmt,
      deleteRoommateOutgoingStmt,
      deleteRoommateIncomingStmt,
      deleteRegistrationStmt,
    ]);

    // 4a. Canary: a non-payment_pending payment appeared between the read and
    //     the batch. Every statement was a no-op; report the conflict with no
    //     state mutated.
    if (insertResult.meta.changes === 0) {
      throw new AppError(
        'Cannot archive a registration with active payment records (pending_verification or verified). Use cancellation to refund the paid amount.',
        409,
      );
    }

    return { archivedId: insertResult.meta.last_row_id as number };
  }
}
