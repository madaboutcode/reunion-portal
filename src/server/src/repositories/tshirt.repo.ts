/**
 * CONTRACT
 *
 * GUARANTEE: FIND_ORDER — findByRegistration() and findAll() return rows
 *   ordered by created_at ASC (insertion order — the included shirt is
 *   typically first, from the migration 0019 backfill).
 *
 * GUARANTEE: DOMAIN_TYPES — all public methods return the shared `Tshirt`
 *   domain type via toTshirt(), never raw TshirtRow objects.
 *
 * GUARANTEE: NO_SQL_INJECTION — all queries use db.prepare().bind().
 *
 * GUARANTEE: CREATE_RETURNS_ROW — create() returns the full inserted Tshirt
 *   (re-selected by last_row_id), not just { id }, so callers have size/
 *   gender/isIncluded without a second round trip.
 *
 * EXPECTS: callers enforce the "at most one is_included=1 row per
 *   registration" invariant — the DB has a partial unique index
 *   (idx_tshirts_one_included) that will reject a second included row.
 *
 * FAILURE BEHAVIOR: All D1 errors propagate as thrown errors.
 *   findByRegistration/findAll return [] when no rows exist.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { ITshirtRepository } from './interfaces.js';
import type { TshirtRow } from '../domain/types.js';
import { toTshirt } from '../domain/types.js';
import type { Tshirt, Gender, TshirtSize } from '@smriti/shared';

export class D1TshirtRepository implements ITshirtRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async findByRegistration(registrationId: number): Promise<Tshirt[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM tshirts WHERE registration_id = ? ORDER BY created_at ASC`)
      .bind(registrationId)
      .all<TshirtRow>();

    return results.map(toTshirt);
  }

  async findAll(): Promise<Tshirt[]> {
    const { results } = await this.db
      .prepare(`SELECT * FROM tshirts ORDER BY created_at ASC`)
      .all<TshirtRow>();

    return results.map(toTshirt);
  }

  async create(data: { registrationId: number; gender: Gender | null; size: TshirtSize; isIncluded: boolean }): Promise<Tshirt> {
    const result = await this.db
      .prepare(
        `INSERT INTO tshirts (registration_id, gender, size, is_included) VALUES (?, ?, ?, ?)`,
      )
      .bind(data.registrationId, data.gender, data.size, data.isIncluded ? 1 : 0)
      .run();

    const row = await this.db
      .prepare(`SELECT * FROM tshirts WHERE id = ?`)
      .bind(result.meta.last_row_id)
      .first<TshirtRow>();

    return toTshirt(row as TshirtRow);
  }

  async update(id: number, data: { gender?: Gender | null; size?: TshirtSize }): Promise<void> {
    const clauses: string[] = [];
    const values: (string | number | null)[] = [];

    if (data.gender !== undefined) {
      clauses.push('gender = ?');
      values.push(data.gender);
    }
    if (data.size !== undefined) {
      clauses.push('size = ?');
      values.push(data.size);
    }
    if (clauses.length === 0) return;

    values.push(id);
    await this.db
      .prepare(`UPDATE tshirts SET ${clauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  async delete(id: number): Promise<void> {
    await this.db.prepare(`DELETE FROM tshirts WHERE id = ?`).bind(id).run();
  }

  async countExtras(registrationId: number): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COUNT(*) as cnt FROM tshirts WHERE registration_id = ? AND is_included = 0`)
      .bind(registrationId)
      .first<{ cnt: number }>();

    return row?.cnt ?? 0;
  }
}
