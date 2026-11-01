/**
 * CONTRACT
 *
 * GUARANTEE: CREATE_RETURNS_ID — create() returns { id: number } using
 *   meta.last_row_id from the D1 prepared statement result. Overpayment
 *   inserts snapshot identity/source-payment facts from the live registration
 *   and source payment in the same statement (INSERT ... SELECT) — the
 *   caller's NewRefund shape is unchanged.
 *
 * GUARANTEE: CREATE_EXACTLY_ONE_ROW — create() checks meta.changes and throws
 *   RefundCreateNoRowsError when the INSERT ... SELECT wrote zero rows (the
 *   source payment disappeared or no longer belongs to the registration). It
 *   never returns a bogus last_row_id for an insert that wrote nothing, so
 *   PaymentService cannot audit or report a refund that does not exist.
 *
 * GUARANTEE: NO_SQL_INJECTION — all queries use db.prepare().bind().
 *   No string interpolation of values appears in any SQL statement.
 *
 * GUARANTEE: DOMAIN_TYPES — findById/list/listWithRegistration/
 *   findByRegistration/findByOriginalRegistration return Refund domain type(s)
 *   via toRefund(), never raw RefundRow objects.
 *
 * GUARANTEE: LIST_ORDER — list(), findByRegistration() and
 *   findByOriginalRegistration() return refunds ordered by created_at DESC
 *   (most recent first).
 *
 * GUARANTEE: DETACHED_OWNERS — listWithRegistration() reads all display
 *   fields (fullName, regCode, email, ownerKind) from the refund row itself
 *   — no JOIN against registrations. Detached refunds (live registration or
 *   payment deleted) are returned with ownerKind 'cancelled'.
 *
 * GUARANTEE: LIVE_ROW_FALLBACK — findById/list/listWithRegistration/
 *   findByRegistration/findByOriginalRegistration SELECT with LEFT JOINs and
 *   COALESCE, so an active refund whose snapshot columns are still NULL (0020
 *   expand/backfill rollout, plan §6 "Migration compatibility") reads its
 *   identity/source facts from the live registration and payment rows.
 *   CancellationService materializes those NULL columns from the live rows in
 *   the same batch before deleting them. Detached rows cannot use the
 *   fallback — toRefund() rejects a detached row with missing snapshot fields
 *   explicitly.
 *
 * GUARANTEE: ORIGINAL_ID_LOOKUP — findByOriginalRegistration() filters on the
 *   immutable original_registration_id column, so refunds remain readable
 *   after the active registration row is deleted.
 *
 * EXPECTS: the overpayment flow only creates refunds for payments that exist
 *   (the payment being verified). The INSERT ... SELECT joins payments and
 *   registrations; a missing row means the insert inserts nothing.
 *
 * FAILURE BEHAVIOR: All D1 errors propagate as thrown errors. Methods do not
 *   swallow failures.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { IRefundRepository } from './interfaces.js';
import type { Refund, NewRefund, RefundRow } from '../domain/types.js';
import { toRefund } from '../domain/types.js';
import { RefundCreateNoRowsError } from '../services/errors.js';

export class D1RefundRepository implements IRefundRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /** SELECT shape shared by every reader. Live-row fallback (plan §6
   *  "Migration compatibility"): active refunds COALESCE the 0020 snapshot
   *  columns from the live registration/payment rows during the expand/backfill
   *  rollout; detached rows (registration_id NULL) must carry the snapshot
   *  themselves or toRefund() rejects them. The fallback covers EVERY nullable
   *  source-payment snapshot column — identity, amount, reference, gateway,
   *  created/verified stamps and proof key — so a legacy active row reads the
   *  live payment's facts, never fabricated NULLs. */
  private readonly refundSelect = `
    SELECT
      rf.id,
      rf.registration_id,
      COALESCE(rf.original_registration_id, reg.id) AS original_registration_id,
      COALESCE(rf.reg_code, reg.reg_code) AS reg_code,
      COALESCE(rf.full_name, reg.full_name) AS full_name,
      COALESCE(rf.email, reg.email) AS email,
      rf.source_payment_id,
      COALESCE(rf.source_payment_original_id, pay.id) AS source_payment_original_id,
      COALESCE(rf.source_payment_amount, pay.amount) AS source_payment_amount,
      COALESCE(rf.source_payment_reference, pay.gateway_ref) AS source_payment_reference,
      COALESCE(rf.source_payment_gateway, pay.gateway) AS source_payment_gateway,
      COALESCE(rf.source_payment_created_at, pay.created_at) AS source_payment_created_at,
      COALESCE(rf.source_payment_verified_by, pay.verified_by) AS source_payment_verified_by,
      COALESCE(rf.source_payment_verified_at, pay.verified_at) AS source_payment_verified_at,
      COALESCE(rf.source_payment_proof_key, pay.proof_file_key) AS source_payment_proof_key,
      rf.amount,
      rf.reason,
      rf.cancellation_reason,
      rf.status,
      rf.bank_reference,
      rf.resolved_by,
      rf.resolved_at,
      rf.created_at
    FROM refunds rf
    LEFT JOIN registrations reg ON reg.id = rf.registration_id
    LEFT JOIN payments pay ON pay.id = rf.source_payment_id`;

  async create(refund: NewRefund): Promise<{ id: number }> {
    // Overpayment refunds snapshot the registrant identity and the source
    // payment facts from the live rows, so the refund stays understandable
    // if the registration is later deleted.
    const result = await this.db
      .prepare(
        `INSERT INTO refunds (
           registration_id, source_payment_id, amount, status, reason,
           original_registration_id, reg_code, full_name, email,
           source_payment_original_id, source_payment_amount, source_payment_reference,
           source_payment_gateway, source_payment_created_at, source_payment_verified_by,
           source_payment_verified_at, source_payment_proof_key
         )
         SELECT
           ?, ?, ?, ?, 'overpayment',
           r.id, r.reg_code, r.full_name, r.email,
           p.id, p.amount, p.gateway_ref, p.gateway, p.created_at, p.verified_by,
           p.verified_at, p.proof_file_key
         FROM registrations r
         JOIN payments p ON p.id = ?
         WHERE r.id = ? AND p.registration_id = r.id`,
      )
      .bind(
        refund.registration_id,
        refund.source_payment_id,
        refund.amount,
        refund.status,
        refund.source_payment_id,
        refund.registration_id,
      )
      .run();

    // The INSERT ... SELECT can write zero rows when the source payment has
    // disappeared or no longer belongs to the registration (the JOIN is empty).
    // meta.last_row_id would then be a stale/bogus value — fail loudly instead
    // of letting PaymentService audit and return a refund that does not exist
    // (CREATE_EXACTLY_ONE_ROW). Exactly-one is asserted, not assumed.
    if (result.meta.changes !== 1) {
      throw new RefundCreateNoRowsError(refund.registration_id, refund.source_payment_id, result.meta.changes);
    }

    return { id: result.meta.last_row_id as number };
  }

  async findById(id: number): Promise<Refund | null> {
    const row = await this.db
      .prepare(`${this.refundSelect} WHERE rf.id = ?`)
      .bind(id)
      .first<RefundRow>();

    return row ? toRefund(row) : null;
  }

  async list(filters?: { status?: string }): Promise<Refund[]> {
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (filters?.status !== undefined) {
      conditions.push('rf.status = ?');
      bindings.push(filters.status);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const sql = `${this.refundSelect}${where} ORDER BY rf.created_at DESC`;

    const { results } = await this.db
      .prepare(sql)
      .bind(...bindings)
      .all<RefundRow>();

    return results.map(toRefund);
  }

  async listWithRegistration(filters?: { status?: string }): Promise<Refund[]> {
    // Live-or-snapshot owner mapping: no JOIN against registrations. Active
    // refunds keep their live links; detached refunds read the immutable
    // snapshot fields copied at creation time.
    return this.list(filters);
  }

  async findByRegistration(registrationId: number): Promise<Refund[]> {
    const { results } = await this.db
      .prepare(`${this.refundSelect} WHERE rf.registration_id = ? ORDER BY rf.created_at DESC`)
      .bind(registrationId)
      .all<RefundRow>();
    return results.map(toRefund);
  }

  async findByOriginalRegistration(originalRegistrationId: number): Promise<Refund[]> {
    const { results } = await this.db
      .prepare(`${this.refundSelect} WHERE rf.original_registration_id = ? ORDER BY rf.created_at DESC`)
      .bind(originalRegistrationId)
      .all<RefundRow>();
    return results.map(toRefund);
  }
}
