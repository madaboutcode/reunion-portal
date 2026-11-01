/**
 * CONTRACT: Registration-desk persistence (see
 * docs/specs/interfaces/registration-desk-api.ispec.md).
 *
 * GUARANTEE: NARROW_QUERIES — searchCandidates, findOverviewRow, and
 *   findTshirts return only the documented desk columns (DeskSearchRow /
 *   DeskOverviewRow / DeskTshirtRow). No email, donation, pricing snapshot,
 *   storage key, or additional_charges column is selected; the desk boundary
 *   is enforced at the SQL layer, not by filtering a dashboard payload.
 *   findOverviewRow/findOverviewByCode select `whatsapp` (R1.2/R3.6 — the
 *   one permitted contact field) but still never select `email`.
 *   searchCandidates selects `photo_thumb_key` (for the `hasPhoto` flag, R2.5)
 *   and `updated_at` (for `photosVersion`) — the raw key itself is never
 *   returned in a response, only reduced to a boolean by the mapper.
 *   findTshirts orders included-first (is_included DESC) then by row id,
 *   independent of insertion timing.
 *
 * GUARANTEE: ELIGIBILITY_FILTER — searchCandidates selects only
 *   full_celebration / campus_only registrations. Donation-only rows never
 *   reach the search ranker (registration-desk.spec.md R3.2).
 *
 * GUARANTEE: MARK_PRESENT_GUARDED — markPresent batches the conditional audit
 *   INSERT and UPDATE (`WHERE id = ? AND checked_in_at IS NULL`). `wrote: true` means
 *   this call performed the check-in; `wrote: false` means the registration
 *   was already present (idempotent repeat or concurrent check-in) — no
 *   second mutation and no updated_at bump on the no-op path.
 *
 * GUARANTEE: SPOT_CREATE_ATOMIC — createSpotRegistration writes the
 *   registration, attendees, payment_pending, actor-scoped idempotency
 *   response, and audit row in ONE db.batch. A duplicate key UNIQUE
 *   violation rolls back the whole batch (no orphan registration, no partial
 *   payment). This is the concurrency guard behind the idempotency contract
 *   (ispec R5.5/R5.6, spec "concurrent submission" edge case).
 *
 * GUARANTEE: NO_SQL_INJECTION — every query uses db.prepare().bind() with
 *   parameterized statements; LIKE terms are escaped with `ESCAPE '\'`.
 *
 * EXPECTS: db is a live D1Database binding.
 *
 * FAILURE BEHAVIOR: D1 errors propagate as thrown exceptions. findOverviewRow
 *   and findIdempotency return null when no row matches. markPresent never
 *   throws for an already-present registration.
 *
 * KNOWN LIMITATIONS: searchCandidates is not capped in SQL — the service
 *   applies rankDeskSearch's 20-result cap after ranking. A very broad query
 *   (e.g. a single common letter) may scan many eligible rows; acceptable at
 *   venue scale and bounded by the LIKE pre-filter.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type {
  DeskIdempotencyRow,
  DeskOverviewRow,
  DeskSearchRow,
  DeskStatsRow,
  DeskTshirtRow,
  DeskWallImageRow,
} from '../domain/desk-types.js';
import type { IDeskRepository } from './interfaces.js';
import type { RegistrationInsertSet } from '../domain/registration-insert-set.js';

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLike(term: string): string {
  return term.replace(/[%_\\]/g, '\\$&');
}

export class D1DeskRepository implements IDeskRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async searchCandidates(query: string): Promise<DeskSearchRow[]> {
    const q = escapeLike(query.trim().toLowerCase());
    const term = `%${q}%`;

    const { results } = await this.db
      .prepare(
        `SELECT id, full_name, reg_code, branch, participation_type,
                checked_in_at, checked_in_by, photo_thumb_key, updated_at
         FROM registrations
         WHERE participation_type IN ('full_celebration', 'campus_only')
           AND (LOWER(full_name) LIKE ? ESCAPE '\\' OR reg_code LIKE ? ESCAPE '\\')`,
      )
      .bind(term, term)
      .all<DeskSearchRow>();

    return results;
  }

  async listWallImageRows(): Promise<DeskWallImageRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, photo_thumb_key
         FROM registrations
         WHERE photo_thumb_key IS NOT NULL
           AND participation_type IN ('full_celebration', 'campus_only')
         ORDER BY id`,
      )
      .all<DeskWallImageRow>();

    return results;
  }

  async countStats(): Promise<DeskStatsRow[]> {
    // One grouped pass over the eligible roster. `checked_in` counts rows whose
    // checked_in_at is set (SUM of a 0/1 predicate). Donation-only is excluded
    // — it can never be checked in, so it has no place in a check-in count.
    const { results } = await this.db
      .prepare(
        `SELECT participation_type,
                COUNT(*) AS total,
                SUM(CASE WHEN checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checked_in
         FROM registrations
         WHERE participation_type IN ('full_celebration', 'campus_only')
         GROUP BY participation_type`,
      )
      .all<DeskStatsRow>();

    return results;
  }

  async findOverviewRow(id: number): Promise<DeskOverviewRow | null> {
    const row = await this.db
      .prepare(
        `SELECT id, reg_code, full_name, branch, participation_type,
                alumni_meal, accommodation, check_in, check_out,
                photo_thumb_key, checked_in_at, checked_in_by, status, total_amount,
                whatsapp
         FROM registrations
         WHERE id = ?`,
      )
      .bind(id)
      .first<DeskOverviewRow>();

    return row ?? null;
  }

  async findOverviewByCode(regCode: string): Promise<DeskOverviewRow | null> {
    const row = await this.db
      .prepare(
        `SELECT id, reg_code, full_name, branch, participation_type,
                alumni_meal, accommodation, check_in, check_out,
                photo_thumb_key, checked_in_at, checked_in_by, status, total_amount,
                whatsapp
         FROM registrations
         WHERE reg_code = ?`,
      )
      .bind(regCode)
      .first<DeskOverviewRow>();

    return row ?? null;
  }

  async findTshirts(registrationId: number): Promise<DeskTshirtRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT size, gender, is_included
         FROM tshirts
         WHERE registration_id = ?
         ORDER BY is_included DESC, id ASC`,
      )
      .bind(registrationId)
      .all<DeskTshirtRow>();

    return results;
  }

  async markPresent(
    id: number,
    checkedInAt: number,
    checkedInBy: number,
    actorEmail: string,
  ): Promise<{ wrote: boolean }> {
    // `checkedInAt` feeds BOTH the audit row's `details.checkedInAt` (below)
    // and the UPDATE's `checked_in_at` column (below) from this one JS value
    // — keep it that way. The public desk-roster endpoint emits the same
    // number from either source (registrations.checked_in_at in full mode,
    // details.checkedInAt in delta mode) and the LED wall dedups arrivals
    // across the two with `===`. If either side is ever computed separately
    // in SQL (e.g. `unixepoch() * 1000`) instead of from this shared value,
    // a check-in that lands in the gap between a poll's cursor read and its
    // roster read reports two different timestamps for the same person in
    // full vs. delta mode, and the wall double-spotlights them.
    const details = JSON.stringify({ checkedInAt, checkedInBy });
    const audit = this.db
      .prepare(
        `INSERT INTO system_audit_log (action, actor, target_type, target_id, details)
         SELECT 'attendee_checked_in', ?, 'registration', id, ?
         FROM registrations
         WHERE id = ? AND checked_in_at IS NULL`,
      )
      .bind(actorEmail, details, id);
    const update = this.db
      .prepare(
        `UPDATE registrations
         SET checked_in_at = ?,
             checked_in_by = ?,
             updated_at = MAX(
               unixepoch() * 1000,
               (SELECT COALESCE(MAX(updated_at), 0) + 1 FROM registrations)
             )
         WHERE id = ? AND checked_in_at IS NULL`,
      )
      .bind(checkedInAt, checkedInBy, id);

    const [, result] = await this.db.batch([audit, update]);
    const changed = result.meta.changes;
    return { wrote: changed > 0 };
  }

  async markAbsent(
    id: number,
    actorEmail: string,
  ): Promise<{ wrote: boolean }> {
    // Symmetric with markPresent: only write when there IS something to clear,
    // so a repeat undo (or an undo on a never-checked-in registration) is a
    // no-op and does not stamp a second audit row.
    const audit = this.db
      .prepare(
        `INSERT INTO system_audit_log (action, actor, target_type, target_id, details)
         SELECT 'attendee_check_in_undone', ?, 'registration', id, NULL
         FROM registrations
         WHERE id = ? AND checked_in_at IS NOT NULL`,
      )
      .bind(actorEmail, id);
    const update = this.db
      .prepare(
        `UPDATE registrations
         SET checked_in_at = NULL,
             checked_in_by = NULL,
             updated_at = MAX(
               unixepoch() * 1000,
               (SELECT COALESCE(MAX(updated_at), 0) + 1 FROM registrations)
             )
         WHERE id = ? AND checked_in_at IS NOT NULL`,
      )
      .bind(id);

    const [, result] = await this.db.batch([audit, update]);
    const changed = result.meta.changes;
    return { wrote: changed > 0 };
  }

  async findIdempotency(actorId: number, key: string): Promise<DeskIdempotencyRow | null> {
    const row = await this.db
      .prepare(
        `SELECT id, actor_id, idem_key, fingerprint, response, created_at
         FROM desk_idempotency
         WHERE actor_id = ? AND idem_key = ?`,
      )
      .bind(actorId, key)
      .first<DeskIdempotencyRow>();

    return row ?? null;
  }

  async pruneIdempotency(olderThanMs: number): Promise<void> {
    await this.db
      .prepare('DELETE FROM desk_idempotency WHERE created_at < ?')
      .bind(olderThanMs)
      .run();
  }

  async createSpotRegistration(
    data: RegistrationInsertSet,
    idempotency: {
      actorId: number;
      key: string;
      fingerprint: string;
      regCode: string;
      participationType: 'full_celebration' | 'campus_only';
      amountDue: number;
      actorEmail: string;
    },
  ): Promise<{ id: number }> {
    const reg = data.registration;

    const stmts: D1PreparedStatement[] = [];

    stmts.push(
      this.db
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
        ),
    );

    stmts.push(
      this.db
        .prepare(
          `INSERT INTO system_audit_log (action, actor, target_type, target_id, details)
           SELECT 'spot_registration_created', ?, 'registration', id, ?
           FROM registrations WHERE reg_code = ?`,
        )
        .bind(
          idempotency.actorEmail,
          JSON.stringify({
            regCode: idempotency.regCode,
            participationType: idempotency.participationType,
          }),
          idempotency.regCode,
        ),
    );

    for (const a of data.attendees) {
      // The registration row was inserted by statement 0 in the SAME batch;
      // D1 batch statements execute sequentially in one transaction and see
      // each other's writes, so the subselect resolves the new id.
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO attendees (
              registration_id, type, name, age, relationship, meal, is_chargeable
            ) VALUES ((SELECT id FROM registrations WHERE reg_code = ?), ?, ?, ?, ?, ?, ?)`,
          )
          .bind(reg.reg_code, a.type, a.name, a.age, a.relationship, a.meal, a.is_chargeable),
      );
    }

    const pay = data.payment;
    stmts.push(
      this.db
        .prepare(
          `INSERT INTO payments (
            registration_id, amount, status, gateway, gateway_ref,
            gateway_response, proof_file_key, verified_by, verified_at
          ) VALUES ((SELECT id FROM registrations WHERE reg_code = ?), ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          reg.reg_code,
          pay.amount,
          pay.status,
          pay.gateway,
          pay.gateway_ref,
          pay.gateway_response,
          pay.proof_file_key,
          pay.verified_by,
          pay.verified_at,
        ),
    );

    stmts.push(
      this.db
        .prepare(
          `INSERT INTO desk_idempotency (actor_id, idem_key, fingerprint, response)
           VALUES (?, ?, ?, json_object(
             'registration', json_object(
               'id', (SELECT id FROM registrations WHERE reg_code = ?),
               'regCode', ?,
               'participationType', ?,
               'payment', json_object('state', 'payment_pending', 'amountDue', ?),
               'checkIn', json_object('present', json('false'), 'checkedInAt', json('null')),
               'passUrl', ?
             )
           ))`,
        )
        .bind(
          idempotency.actorId,
          idempotency.key,
          idempotency.fingerprint,
          idempotency.regCode,
          idempotency.regCode,
          idempotency.participationType,
          idempotency.amountDue,
          `/pass#${idempotency.regCode}`,
        ),
    );

    // One batch = one transaction. The registration row is statement 0; its
    // last_row_id is the new registration id.
    const results = await this.db.batch(stmts);
    const id = results[0].meta.last_row_id as number;

    return { id };
  }
}
