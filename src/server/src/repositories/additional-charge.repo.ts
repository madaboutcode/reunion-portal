/**
 * CONTRACT
 *
 * GUARANTEE: FIND_ORDER — findByRegistration() returns rows ordered by
 *   created_at ASC.
 *
 * GUARANTEE: DOMAIN_TYPES — all public methods return the shared
 *   `AdditionalCharge` domain type via toAdditionalCharge(), never raw
 *   AdditionalChargeRow objects.
 *
 * GUARANTEE: NO_SQL_INJECTION — all queries use db.prepare().bind().
 *
 * GUARANTEE: CREATE_RETURNS_ROW — create() returns the full inserted charge
 *   (re-selected by last_row_id).
 *
 * EXPECTS: callers validate amount > 0 before calling create() for a clear
 *   error message — the DB also enforces CHECK(amount > 0) as the source of
 *   truth (R9), so a caller bypassing validation still cannot insert a
 *   non-positive amount.
 *
 * FAILURE BEHAVIOR: All D1 errors propagate as thrown errors (including the
 *   CHECK constraint violation on a non-positive amount). findByRegistration
 *   returns [] when no rows exist.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { IAdditionalChargeRepository } from './interfaces.js';
import type { AdditionalChargeRow } from '../domain/types.js';
import { toAdditionalCharge } from '../domain/types.js';
import type { AdditionalCharge } from '@smriti/shared';

export class D1AdditionalChargeRepository implements IAdditionalChargeRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async findByRegistration(registrationId: number): Promise<AdditionalCharge[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM additional_charges WHERE registration_id = ? ORDER BY created_at ASC`)
      .bind(registrationId)
      .all<AdditionalChargeRow>();

    return results.map(toAdditionalCharge);
  }

  async create(data: { registrationId: number; description: string; amount: number; createdBy: number }): Promise<AdditionalCharge> {
    const result = await this.db
      .prepare(
        `INSERT INTO additional_charges (registration_id, description, amount, created_by) VALUES (?, ?, ?, ?)`,
      )
      .bind(data.registrationId, data.description, data.amount, data.createdBy)
      .run();

    const row = await this.db
      .prepare(`SELECT * FROM additional_charges WHERE id = ?`)
      .bind(result.meta.last_row_id)
      .first<AdditionalChargeRow>();

    return toAdditionalCharge(row as AdditionalChargeRow);
  }

  async delete(id: number): Promise<void> {
    await this.db.prepare(`DELETE FROM additional_charges WHERE id = ?`).bind(id).run();
  }
}
