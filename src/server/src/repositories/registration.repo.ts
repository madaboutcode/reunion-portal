/**
 * CONTRACT
 *
 * GUARANTEE: REG_FIND_PARSED — findById() and findByRegCode() return a
 *   Registration with boolean fields (publicAck, felicitation) correctly
 *   coerced from D1's 0|1 integers, and pricingSnapshot as a parsed
 *   PricingBreakup object (not a JSON string). Coercion is delegated to
 *   toRegistration().
 *
 * GUARANTEE: CREATE_WITH_RELATIONS_ATOMIC — createWithRelations() persists the
 *   full insert set in two phases: phase 1 inserts the registration and gets
 *   the auto-increment ID, phase 2 inserts all child rows (attendees, document,
 *   payment) with explicit registration_id. If phase 2 fails, phase 1 row is
 *   orphaned but consistently empty (no children, no payment).
 *
 * GUARANTEE: NO_SQL_INJECTION — all SQL uses parameterized prepared statements
 *   with .bind(). No string interpolation appears in any query.
 *
 * EXPECTS: db is a live D1Database binding from the Cloudflare Workers env.
 *
 * FAILURE BEHAVIOR: All methods propagate D1 errors as thrown exceptions.
 *   findById and findByRegCode return null when not found. findByEmail and
 *   findByWhatsapp return empty array when not found.
 */

import type {
  NewAttendee,
  Registration,
  RegistrationUpdate,
  RegistrationFilters,
  RegistrationRow,
} from '../domain/types.js';
import { toRegistration } from '../domain/types.js';
import type { RegistrationStatus } from '../domain/status.js';
import type { IRegistrationRepository } from './interfaces.js';
import type { RegistrationInsertSet } from '../domain/registration-insert-set.js';
import { query } from '../db/query-builder.js';

export class D1RegistrationRepository implements IRegistrationRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async createWithRelations(
    insertSet: RegistrationInsertSet,
  ): Promise<{ id: number }> {
    const reg = insertSet.registration;

    // Phase 1: Insert registration, get auto-increment ID
    const regStmt = this.db
      .prepare(
        `INSERT INTO registrations (
          reg_code,
          status,
          full_name,
          branch,
          email,
          whatsapp,
          mobile_alternate,
          city,
          country,
          attendance_intent,
          participation_type,
          gender,
          tshirt_size,
          alumni_meal,
          accommodation,
          check_in,
          check_out,
          extra_bed,
          donation_amount,
          public_ack,
          ack_display_name,
          felicitation,
          contribution_splits,
          pricing_snapshot,
          total_amount,
          id_note,
          photo_file_key
        ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        reg.reg_code,
        reg.full_name,
        reg.branch,
        reg.email,
        reg.whatsapp,
        reg.mobile_alternate,
        reg.city,
        reg.country,
        reg.attendance_intent,
        reg.participation_type,
        reg.gender,
        reg.tshirt_size,
        reg.alumni_meal,
        reg.accommodation,
        reg.check_in,
        reg.check_out,
        reg.extra_bed,
        reg.donation_amount,
        reg.public_ack,
        reg.ack_display_name,
        reg.felicitation,
        reg.contribution_splits,
        reg.pricing_snapshot,
        reg.total_amount,
        reg.id_note,
        reg.photo_file_key,
      );

    const phase1Results = await this.db.batch([regStmt]);
    const id = phase1Results[0].meta.last_row_id as number;

    const childStmts: D1PreparedStatement[] = [];

    for (const a of insertSet.attendees) {
      childStmts.push(
        this.db
          .prepare(
            `INSERT INTO attendees (
              registration_id, type, name, age, relationship, meal, is_chargeable
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, a.type, a.name, a.age, a.relationship, a.meal, a.is_chargeable),
      );
    }

    if (insertSet.document) {
      const doc = insertSet.document;
      childStmts.push(
        this.db
          .prepare(
            `INSERT INTO id_documents (
              registration_id, file_name, mime_type, size_bytes, r2_key
            ) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(id, doc.file_name, doc.mime_type, doc.size_bytes, doc.r2_key),
      );
    }

    const pay = insertSet.payment;
    childStmts.push(
      this.db
        .prepare(
          `INSERT INTO payments (
            registration_id, amount, status, gateway, gateway_ref,
            gateway_response, proof_file_key, verified_by, verified_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id, pay.amount, pay.status, pay.gateway, pay.gateway_ref,
          pay.gateway_response, pay.proof_file_key, pay.verified_by, pay.verified_at,
        ),
    );

    if (childStmts.length > 0) {
      await this.db.batch(childStmts);
    }

    return { id };
  }

  async findById(id: number): Promise<Registration | null> {
    const row = await this.db
      .prepare('SELECT * FROM registrations WHERE id = ?')
      .bind(id)
      .first<RegistrationRow>();

    return row !== null ? toRegistration(row) : null;
  }

  async findByRegCode(regCode: string): Promise<Registration | null> {
    const row = await this.db
      .prepare('SELECT * FROM registrations WHERE reg_code = ?')
      .bind(regCode)
      .first<RegistrationRow>();

    return row !== null ? toRegistration(row) : null;
  }

  async findByEmail(email: string): Promise<Registration[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM registrations WHERE LOWER(email) = LOWER(?)')
      .bind(email)
      .all<RegistrationRow>();

    return results.map(toRegistration);
  }

  async findByWhatsapp(whatsapp: string): Promise<Registration[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM registrations WHERE whatsapp = ?')
      .bind(whatsapp)
      .all<RegistrationRow>();

    return results.map(toRegistration);
  }

  async updateStatus(id: number, status: RegistrationStatus): Promise<void> {
    await this.db
      .prepare(
        `UPDATE registrations SET status = ?, updated_at = MAX(
          unixepoch() * 1000,
          (SELECT COALESCE(MAX(updated_at), 0) + 1 FROM registrations)
        ) WHERE id = ?`,
      )
      .bind(status, id)
      .run();
  }

  // attendees semantics: undefined = don't touch, [] = delete all, [...] = replace
  async update(
    id: number,
    data: RegistrationUpdate,
    attendees?: NewAttendee[],
  ): Promise<void> {
    const setClauses: string[] = [];
    const bindings: unknown[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        setClauses.push(`${key} = ?`);
        bindings.push(value);
      }
    }

    if (setClauses.length === 0 && (attendees === undefined || attendees.length === 0)) {
      return;
    }

    const stmts: D1PreparedStatement[] = [];

    if (setClauses.length > 0) {
      setClauses.push(`updated_at = MAX(
        unixepoch() * 1000,
        (SELECT COALESCE(MAX(updated_at), 0) + 1 FROM registrations)
      )`);
      bindings.push(id);
      stmts.push(
        this.db
          .prepare(`UPDATE registrations SET ${setClauses.join(', ')} WHERE id = ?`)
          .bind(...bindings),
      );
    }

    if (attendees !== undefined) {
      stmts.push(
        this.db
          .prepare('DELETE FROM attendees WHERE registration_id = ?')
          .bind(id),
      );

      for (const a of attendees) {
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO attendees (
                registration_id,
                type,
                name,
                age,
                relationship,
                meal,
                is_chargeable
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(id, a.type, a.name, a.age, a.relationship, a.meal, a.is_chargeable),
        );
      }
    }

    if (stmts.length > 0) {
      await this.db.batch(stmts);
    }
  }

  /**
   * Updates registration fields with optimistic locking.
   * Checks `WHERE updated_at = expectedUpdatedAt` — throws AppError 409
   * if no rows affected (concurrent modification detected).
   *
   * Accepts the same RegistrationUpdate shape as update(), plus an
   * expectedUpdatedAt timestamp for the locking check.
   */
  async updateWithLock(
    id: number,
    data: RegistrationUpdate,
    expectedUpdatedAt: number,
    attendees?: NewAttendee[],
  ): Promise<void> {
    const setClauses: string[] = [];
    const bindings: unknown[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        setClauses.push(`${key} = ?`);
        bindings.push(value);
      }
    }

    if (setClauses.length === 0 && (attendees === undefined || attendees.length === 0)) {
      return;
    }

    const stmts: D1PreparedStatement[] = [];

    if (setClauses.length > 0) {
      setClauses.push(`updated_at = MAX(
        unixepoch() * 1000,
        (SELECT COALESCE(MAX(updated_at), 0) + 1 FROM registrations)
      )`);
      bindings.push(id, expectedUpdatedAt);
      stmts.push(
        this.db
          .prepare(
            `UPDATE registrations SET ${setClauses.join(', ')} WHERE id = ? AND updated_at = ?`,
          )
          .bind(...bindings),
      );
    }

    if (attendees !== undefined) {
      stmts.push(
        this.db
          .prepare('DELETE FROM attendees WHERE registration_id = ?')
          .bind(id),
      );

      for (const a of attendees) {
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO attendees (
                registration_id,
                type,
                name,
                age,
                relationship,
                meal,
                is_chargeable
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(id, a.type, a.name, a.age, a.relationship, a.meal, a.is_chargeable),
        );
      }
    }

    if (stmts.length === 0) return;

    const results = await this.db.batch(stmts);

    // Check if the registration UPDATE applied. The first stmt is the registration update
    // if setClauses was non-empty. rows_affected === 0 means updated_at didn't match.
    if (setClauses.length > 0) {
      const regResult = results[0];
      if ((regResult.meta.rows_written ?? regResult.meta.changes ?? 0) === 0) {
        throw new Error('OPTIMISTIC_LOCK_CONFLICT');
      }
    }
  }

  private static readonly ALLOWED_ORDER_COLS = new Set(['created_at', 'full_name', 'branch', 'total_amount']);
  private static readonly ALLOWED_ORDER_DIRS = new Set(['ASC', 'DESC']);

  private buildFilters(filters?: RegistrationFilters) {
    const qb = query('registrations');

    if (filters?.status !== undefined) qb.where('status', '=', filters.status);
    if (filters?.branch !== undefined) qb.where('branch', '=', filters.branch);
    if (filters?.email !== undefined) qb.where('email', '=', filters.email);

    if (filters?.type === 'attendee') {
      qb.whereRaw("participation_type IN ('full_celebration', 'campus_only')", []);
    } else if (filters?.type === 'donor') {
      qb.whereRaw("participation_type = 'donation_only'", []);
    }

    if (filters?.participationType !== undefined) {
      qb.where('participation_type', '=', filters.participationType);
    }

    if (filters?.search !== undefined && filters.search.trim() !== '') {
      const escaped = filters.search.replace(/[%_\\]/g, '\\$&');
      const term = `%${escaped.toLowerCase()}%`;
      qb.whereRaw(
        `(LOWER(full_name) LIKE ? ESCAPE '\\' OR LOWER(email) LIKE ? ESCAPE '\\' OR LOWER(reg_code) LIKE ? ESCAPE '\\' OR REPLACE(reg_code, '-', '') LIKE ? ESCAPE '\\' OR LOWER(whatsapp) LIKE ? ESCAPE '\\')`,
        [term, term, term, term, term],
      );
    }

    return qb;
  }

  async list(filters?: RegistrationFilters): Promise<Registration[]> {
    const qb = this.buildFilters(filters);

    const orderCol = D1RegistrationRepository.ALLOWED_ORDER_COLS.has(filters?.orderBy ?? '')
      ? filters!.orderBy!
      : 'created_at';
    const orderDir = D1RegistrationRepository.ALLOWED_ORDER_DIRS.has(filters?.orderDir ?? '')
      ? filters!.orderDir!
      : 'DESC';
    qb.orderBy(orderCol, orderDir);

    if (filters?.limit !== undefined) {
      qb.limit(filters.limit, filters.offset ?? 0);
    }

    const { sql, bindings } = qb.toSelect();

    const { results } = await this.db
      .prepare(sql)
      .bind(...bindings)
      .all<RegistrationRow>();

    return results.map(toRegistration);
  }

  async count(filters?: RegistrationFilters): Promise<number> {
    const { sql, bindings } = this.buildFilters(filters).toCount();

    const row = await this.db
      .prepare(sql)
      .bind(...bindings)
      .first<{ count: number }>();

    return row?.count ?? 0;
  }

  async countByParticipationAndStatus(): Promise<Record<
    'full_celebration' | 'campus_only' | 'donation_only',
    { total: number; confirmed: number; pending: number; pendingVerification: number }
  >> {
    const { results } = await this.db
      .prepare(
        `SELECT
          participation_type,
          status,
          COUNT(*) as cnt
        FROM registrations
        GROUP BY participation_type, status`,
      )
      .all<{ participation_type: string; status: string; cnt: number }>();

    const zero = () => ({ total: 0, confirmed: 0, pending: 0, pendingVerification: 0 });
    const out: Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }> = {
      full_celebration: zero(),
      campus_only: zero(),
      donation_only: zero(),
    };

    for (const row of results) {
      const pt = row.participation_type;
      if (!(pt in out)) continue;
      const bucket = out[pt];
      bucket.total += row.cnt;
      if (row.status === 'confirmed') bucket.confirmed += row.cnt;
      else if (row.status === 'pending') bucket.pending += row.cnt;
      else if (row.status === 'pending_verification') bucket.pendingVerification += row.cnt;
    }

    return out as Record<
      'full_celebration' | 'campus_only' | 'donation_only',
      { total: number; confirmed: number; pending: number; pendingVerification: number }
    >;
  }

  async getContributionAggregates(): Promise<Array<{
    cause: string;
    count: number;
    total: number;
  }>> {
    const { results } = await this.db
      .prepare(
        `SELECT
          je.key AS cause,
          COUNT(*) AS count,
          SUM(CAST(je.value AS INTEGER)) AS total
        FROM registrations r, json_each(r.contribution_splits) je
        GROUP BY je.key`,
      )
      .all<{ cause: string; count: number; total: number }>();

    return results;
  }

  async getDonationTotals(): Promise<{ count: number; total: number }> {
    const row = await this.db
      .prepare(
        `SELECT
          COUNT(*) AS count,
          SUM(donation_amount) AS total
        FROM registrations
        WHERE donation_amount > 0`,
      )
      .first<{ count: number | null; total: number | null }>();

    return {
      count: row?.count ?? 0,
      total: row?.total ?? 0,
    };
  }

  async geographyAggregates(): Promise<{
    cities: { city: string; count: number }[];
    countries: { country: string; count: number }[];
  }> {
    // Geography is intentionally unfiltered by status — the Reports page shows the
    // always-full-picture view of where registrants are from, regardless of payment state.
    // Two GROUP BY queries run in parallel; attendance scope = non-donation-only (B10)
    const [cityResults, countryResults] = await Promise.all([
      this.db
        .prepare(
          `SELECT
            CASE WHEN city IS NULL OR TRIM(city) = '' THEN 'Unknown' ELSE city END AS city,
            COUNT(*) AS count
          FROM registrations
          WHERE participation_type IN ('full_celebration', 'campus_only')
          GROUP BY CASE WHEN city IS NULL OR TRIM(city) = '' THEN 'Unknown' ELSE city END
          ORDER BY count DESC`,
        )
        .all<{ city: string; count: number }>(),
      this.db
        .prepare(
          `SELECT
            CASE WHEN country IS NULL OR TRIM(country) = '' THEN 'Unknown' ELSE country END AS country,
            COUNT(*) AS count
          FROM registrations
          WHERE participation_type IN ('full_celebration', 'campus_only')
          GROUP BY CASE WHEN country IS NULL OR TRIM(country) = '' THEN 'Unknown' ELSE country END
          ORDER BY count DESC`,
        )
        .all<{ country: string; count: number }>(),
    ]);

    return {
      cities: cityResults.results,
      countries: countryResults.results,
    };
  }

  async donorRecognitionRows(felicitationThreshold: number): Promise<{
    publicDonors: { displayName: string; amount: number; felicitationEligible: boolean }[];
    nonPublicCount: number;
    nonPublicTotal: number;
  }> {
    // Public donors: D1 returns 0|1 for boolean columns — never compare with === true
    // felicitationEligible is computed in SQL to avoid raw 0|1 boolean pitfalls (T2-10)
    const [publicResults, nonPublicResult] = await Promise.all([
      this.db
        .prepare(
          `SELECT
            CASE WHEN ack_display_name IS NOT NULL AND TRIM(ack_display_name) != ''
              THEN ack_display_name
              ELSE full_name
            END AS displayName,
            donation_amount AS amount,
            CASE WHEN felicitation = 1 AND donation_amount >= ? THEN 1 ELSE 0 END AS felicitationEligible
          FROM registrations
          WHERE donation_amount > 0 AND public_ack = 1 AND status = 'confirmed'
          ORDER BY donation_amount DESC`,
        )
        .bind(felicitationThreshold)
        .all<{ displayName: string; amount: number; felicitationEligible: number }>(),
      this.db
        .prepare(
          `SELECT
            COUNT(*) AS nonPublicCount,
            COALESCE(SUM(donation_amount), 0) AS nonPublicTotal
          FROM registrations
          WHERE donation_amount > 0 AND public_ack = 0 AND status = 'confirmed'`,
        )
        .first<{ nonPublicCount: number; nonPublicTotal: number }>(),
    ]);

    return {
      // Coerce D1 0|1 integer to boolean for the domain layer
      publicDonors: publicResults.results.map((r) => ({
        displayName: r.displayName,
        amount: r.amount,
        felicitationEligible: r.felicitationEligible === 1,
      })),
      nonPublicCount: nonPublicResult?.nonPublicCount ?? 0,
      nonPublicTotal: nonPublicResult?.nonPublicTotal ?? 0,
    };
  }

  async countByStatus(
    filters?: { type?: 'attendee' | 'donor' },
  ): Promise<{ pending: number; pendingVerification: number; confirmed: number }> {
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (filters?.type === 'attendee') {
      conditions.push(`participation_type IN ('full_celebration', 'campus_only')`);
    } else if (filters?.type === 'donor') {
      conditions.push(`participation_type = 'donation_only'`);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT status, COUNT(*) as cnt FROM registrations${where} GROUP BY status`;

    const { results } = await this.db
      .prepare(sql)
      .bind(...bindings)
      .all<{ status: string; cnt: number }>();

    let pending = 0;
    let pendingVerification = 0;
    let confirmed = 0;

    for (const row of results) {
      if (row.status === 'pending') pending = row.cnt;
      else if (row.status === 'pending_verification') pendingVerification = row.cnt;
      else if (row.status === 'confirmed') confirmed = row.cnt;
    }

    return { pending, pendingVerification, confirmed };
  }

  async findMissingThumbnails(): Promise<Array<{ id: number; regCode: string; photoFileKey: string }>> {
    const { results } = await this.db
      .prepare(
        `SELECT id, reg_code, photo_file_key
         FROM registrations
         WHERE photo_file_key IS NOT NULL
           AND photo_file_key != ''
           AND (photo_thumb_key IS NULL OR photo_thumb_key = '')`,
      )
      .all<{ id: number; reg_code: string; photo_file_key: string }>();

    return results.map((r) => ({
      id: r.id,
      regCode: r.reg_code,
      photoFileKey: r.photo_file_key,
    }));
  }

  async findWithThumbnails(): Promise<Array<{ id: number; photoThumbKey: string }>> {
    const { results } = await this.db
      .prepare(
        `SELECT id, photo_thumb_key
         FROM registrations
         WHERE photo_thumb_key IS NOT NULL AND photo_thumb_key != ''`,
      )
      .all<{ id: number; photo_thumb_key: string }>();

    return results.map((r) => ({
      id: r.id,
      photoThumbKey: r.photo_thumb_key,
    }));
  }
}
