/**
 * CONTRACT
 *
 * GUARANTEE: FIND_BY_ID — findById returns a single Payment by internal id,
 *   or null if no row exists with that id. Uses toPayment() for coercion.
 *
 * GUARANTEE: PAYMENT_ORDER — findByRegistration returns payments ordered by
 *   created_at DESC (most recent first). Callers relying on insertion order
 *   must use the returned array index — the database orders by timestamp.
 *
 * GUARANTEE: CREATE_RETURNS_ID — create() returns { id: number } using
 *   meta.last_row_id from the D1 prepared statement result.
 *
 * GUARANTEE: NO_SQL_INJECTION — all queries use db.prepare().bind().
 *   No string interpolation appears in any SQL statement.
 *
 * GUARANTEE: DOMAIN_TYPES — findByRegistration returns Payment[] (domain type)
 *   via toPayment(), never raw PaymentRow objects. New fields (proofFileKey,
 *   verifiedBy, verifiedAt) are populated from the corresponding DB columns
 *   via toPayment() — see domain/types.ts for the coercion contract.
 *
 * GUARANTEE: PROOF_FILE_NULLABLE — create() allows null for proof_file_key,
 *   verified_by, and verified_at. Callers omit these fields by passing null
 *   in the NewPayment object. The INSERT binds null strings/numbers directly
 *   — no coalescing or defaulting in the repo layer.
 *
 * GUARANTEE: UPDATE_PROOF_FILE — updateStatus() accepts an optional
 *   proofFileKey parameter (string | undefined). When provided, the UPDATE
 *   includes proof_file_key = ?. When undefined, proof_file_key is not
 *   touched (preserves existing DB value). This is orthogonal to gatewayData
 *   — both can be provided independently.
 *
 * GUARANTEE: GATEWAY_COLUMNS_PRESERVED — gateway, gateway_ref, and
 *   gateway_response columns remain in INSERT and UPDATE SQL. They are not
 *   removed. For bank transfer payments, callers pass null for these fields.
 *
 * GUARANTEE: DESK_SETTLE_GUARDED — settleAtDesk's UPDATE guards on
 *   status IN ('payment_pending', 'pending_verification'); a payment already
 *   'verified' is untouched (0 rows affected). It never touches the
 *   `gateway` column — desk collection has no payment gateway involved.
 *
 * GUARANTEE: DESK_SETTLE_CLEARS_ONLINE_EVIDENCE — settleAtDesk's UPDATE
 *   always sets proof_file_key, gateway_ref, and gateway_response to NULL,
 *   even when settling a payment that was 'pending_verification' (an online
 *   proof upload the desk collection supersedes). Once a payment settles at
 *   the desk it is definitively an in-person collection — method/note are
 *   the source of truth — so no row can carry both an uploaded bank-transfer
 *   proof AND a desk method/note, which would make it look like the same
 *   payment was both an online transfer and a cash/UPI/bank-transfer desk
 *   collection at once.
 *
 * EXPECTS: updateStatus() caller must validate the transition with
 *   isValidPaymentTransition before calling. This method executes whatever
 *   status it receives.
 *
 * FAILURE BEHAVIOR: All D1 errors propagate as thrown errors. Methods do not
 *   swallow failures.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { DeskPaymentMethod } from '@smriti/shared';
import type { IPaymentRepository } from './interfaces.js';
import type { Payment, NewPayment, PaymentRow, GatewayData } from '../domain/types.js';
import type { PaymentStatus } from '../domain/status.js';
import { toPayment } from '../domain/types.js';

export class D1PaymentRepository implements IPaymentRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async create(payment: NewPayment): Promise<{ id: number }> {
    const result = await this.db
      .prepare(
        `INSERT INTO payments (registration_id, amount, status, gateway, gateway_ref, gateway_response, proof_file_key, verified_by, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        payment.registration_id,
        payment.amount,
        payment.status,
        payment.gateway,
        payment.gateway_ref,
        payment.gateway_response,
        payment.proof_file_key,
        payment.verified_by,
        payment.verified_at,
      )
      .run();

    return { id: result.meta.last_row_id };
  }

  async findById(id: number): Promise<Payment | null> {
    const row = await this.db
      .prepare(`SELECT * FROM payments WHERE id = ?`)
      .bind(id)
      .first<PaymentRow>();

    return row ? toPayment(row) : null;
  }

  async findByRegistration(registrationId: number): Promise<Payment[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM payments WHERE registration_id = ? ORDER BY created_at DESC`,
      )
      .bind(registrationId)
      .all<PaymentRow>();

    return results.map(toPayment);
  }

  async updateStatus(
    id: number,
    status: PaymentStatus,
    gatewayData?: GatewayData,
    proofFileKey?: string,
    verification?: { verifiedBy: string; verifiedAt: number },
  ): Promise<void> {
    const clauses: string[] = ['status = ?', 'updated_at = (unixepoch() * 1000)'];
    const values: (string | number | null)[] = [status];

    if (gatewayData !== undefined) {
      clauses.push('gateway = ?', 'gateway_ref = ?', 'gateway_response = ?');
      values.push(
        gatewayData.gateway ?? null,
        gatewayData.gatewayRef ?? null,
        gatewayData.gatewayResponse ?? null,
      );
    }

    if (proofFileKey !== undefined) {
      clauses.push('proof_file_key = ?');
      values.push(proofFileKey);
    }

    if (verification !== undefined) {
      clauses.push('verified_by = ?', 'verified_at = ?');
      values.push(verification.verifiedBy, verification.verifiedAt);
    }

    values.push(id);

    await this.db
      .prepare(`UPDATE payments SET ${clauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  async verify(
    id: number,
    amount: number,
    gatewayRef: string,
    verifiedBy: string,
    verifiedAt: number,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE payments
         SET status = 'verified',
             amount = ?,
             gateway_ref = ?,
             verified_by = ?,
             verified_at = ?,
             updated_at = (unixepoch() * 1000)
         WHERE id = ? AND status = 'pending_verification'`,
      )
      .bind(amount, gatewayRef, verifiedBy, verifiedAt, id)
      .run();
  }

  async settleAtDesk(
    id: number,
    args: {
      amount: number;
      method: DeskPaymentMethod;
      note: string | null;
      verifiedBy: string;
      verifiedAt: number;
    },
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE payments
         SET status = 'verified',
             amount = ?,
             method = ?,
             note = ?,
             verified_by = ?,
             verified_at = ?,
             proof_file_key = NULL,
             gateway_ref = NULL,
             gateway_response = NULL,
             updated_at = (unixepoch() * 1000)
         WHERE id = ? AND status IN ('payment_pending', 'pending_verification')`,
      )
      .bind(args.amount, args.method, args.note, args.verifiedBy, args.verifiedAt, id)
      .run();
  }

  async findPendingByRegistration(registrationId: number): Promise<Payment | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM payments WHERE registration_id = ? AND status = 'payment_pending' LIMIT 1`,
      )
      .bind(registrationId)
      .first<PaymentRow>();

    return row ? toPayment(row) : null;
  }

  async deletePending(paymentId: number): Promise<void> {
    // Guard: only delete payment_pending records — never touch frozen payments
    await this.db
      .prepare(`DELETE FROM payments WHERE id = ? AND status = 'payment_pending'`)
      .bind(paymentId)
      .run();
  }

  async updatePendingAmount(paymentId: number, newAmount: number): Promise<void> {
    // Guard: only update payment_pending records — never touch frozen payments
    await this.db
      .prepare(
        `UPDATE payments SET amount = ?, updated_at = (unixepoch() * 1000) WHERE id = ? AND status = 'payment_pending'`,
      )
      .bind(newAmount, paymentId)
      .run();
  }

  async sumVerifiedByRegistration(registrationId: number): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE registration_id = ? AND status = 'verified'`,
      )
      .bind(registrationId)
      .first<{ total: number }>();

    return row?.total ?? 0;
  }

  async sumVerified(filters?: { type?: 'attendee' | 'donor' }): Promise<number> {
    const conditions: string[] = [`p.status = 'verified'`];
    const bindings: unknown[] = [];

    if (filters?.type === 'attendee') {
      conditions.push(`r.participation_type IN ('full_celebration', 'campus_only')`);
    } else if (filters?.type === 'donor') {
      conditions.push(`r.participation_type = 'donation_only'`);
    }

    const where = ` WHERE ${conditions.join(' AND ')}`;
    const sql =
      `SELECT COALESCE(SUM(p.amount), 0) as total FROM payments p` +
      ` JOIN registrations r ON p.registration_id = r.id${where}`;

    const row = await this.db
      .prepare(sql)
      .bind(...bindings)
      .first<{ total: number }>();

    return row?.total ?? 0;
  }

  async sumVerifiedByBranch(
    filters?: { type?: 'attendee' | 'donor' },
  ): Promise<Array<{ branch: string; collected: number }>> {
    const conditions: string[] = [`p.status = 'verified'`];
    const bindings: unknown[] = [];

    if (filters?.type === 'attendee') {
      conditions.push(`r.participation_type IN ('full_celebration', 'campus_only')`);
    } else if (filters?.type === 'donor') {
      conditions.push(`r.participation_type = 'donation_only'`);
    }

    const where = ` WHERE ${conditions.join(' AND ')}`;
    const sql =
      `SELECT r.branch, COALESCE(SUM(p.amount), 0) as collected FROM payments p` +
      ` JOIN registrations r ON p.registration_id = r.id${where} GROUP BY r.branch`;

    const { results } = await this.db
      .prepare(sql)
      .bind(...bindings)
      .all<{ branch: string; collected: number }>();

    return results;
  }
}
