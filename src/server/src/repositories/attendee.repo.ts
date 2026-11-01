/**
 * CONTRACT
 *
 * GUARANTEE: ATTENDEE_FIND_PARSED — findByRegistration() returns Attendee
 *   objects with isChargeable coerced from D1's 0|1 integer to a JS boolean
 *   via toAttendee(). No raw row types are returned from public methods.
 *
 * GUARANTEE: ATTENDEE_REPLACE_ATOMIC — replaceForRegistration() executes
 *   DELETE + all INSERTs in a single db.batch() call. If any statement fails,
 *   D1 rolls back the entire batch — the attendee list is never left in a
 *   partial state.
 *
 * GUARANTEE: NO_SQL_INJECTION — all SQL uses parameterized prepared statements
 *   with .bind(). No string interpolation appears in any query.
 *
 * EXPECTS: db is a live D1Database binding from the Cloudflare Workers env.
 *
 * FAILURE BEHAVIOR: All methods propagate D1 errors as thrown exceptions.
 *   findByRegistration returns an empty array when no attendees exist.
 */

import type { Attendee, NewAttendee, AttendeeRow } from '../domain/types.js';
import { toAttendee } from '../domain/types.js';
import type { IAttendeeRepository } from './interfaces.js';

export class D1AttendeeRepository implements IAttendeeRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async findByRegistration(registrationId: number): Promise<Attendee[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM attendees WHERE registration_id = ?')
      .bind(registrationId)
      .all<AttendeeRow>();

    return results.map(toAttendee);
  }

  async replaceForRegistration(
    registrationId: number,
    attendees: NewAttendee[],
  ): Promise<void> {
    const deleteStmt = this.db
      .prepare('DELETE FROM attendees WHERE registration_id = ?')
      .bind(registrationId);

    const insertStmts = attendees.map((a) =>
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
        .bind(
          registrationId,
          a.type,
          a.name,
          a.age,
          a.relationship,
          a.meal,
          a.is_chargeable,
        ),
    );

    await this.db.batch([deleteStmt, ...insertStmts]);
  }

  async countGrouped(
    filters?: { statuses?: string[]; branch?: string },
  ): Promise<Array<{ type: string; meal: string; count: number }>> {
    // participation_type is the source of truth for all attendee aggregates;
    // attendance_intent is a legacy alias — align with buildRegistrationConditions.
    const conditions: string[] = [
      `r.participation_type IN ('full_celebration', 'campus_only')`,
    ];
    const bindings: unknown[] = [];

    if (filters?.statuses !== undefined && filters.statuses.length > 0) {
      const placeholders = filters.statuses.map(() => '?').join(', ');
      conditions.push(`r.status IN (${placeholders})`);
      bindings.push(...filters.statuses);
    }

    if (filters?.branch !== undefined) {
      conditions.push(`r.branch = ?`);
      bindings.push(filters.branch);
    }

    const where = ` WHERE ${conditions.join(' AND ')}`;
    const sql =
      `SELECT a.type, a.meal, COUNT(*) as cnt FROM attendees a` +
      ` JOIN registrations r ON a.registration_id = r.id${where}` +
      ` GROUP BY a.type, a.meal`;

    const { results } = await this.db
      .prepare(sql)
      .bind(...bindings)
      .all<{ type: string; meal: string; cnt: number }>();

    return results.map((row) => ({ type: row.type, meal: row.meal, count: row.cnt }));
  }

  // The two event nights (T2-11: both keys must always be present)
  private static readonly NIGHTS = ['2026-08-14', '2026-08-15'] as const;

  private buildRegistrationConditions(
    filters?: { statuses?: string[]; branch?: string },
  ): { conditions: string[]; bindings: unknown[] } {
    const conditions: string[] = [
      `r.participation_type IN ('full_celebration', 'campus_only')`,
    ];
    const bindings: unknown[] = [];

    if (filters?.statuses !== undefined && filters.statuses.length > 0) {
      const placeholders = filters.statuses.map(() => '?').join(', ');
      conditions.push(`r.status IN (${placeholders})`);
      bindings.push(...filters.statuses);
    }

    if (filters?.branch !== undefined) {
      conditions.push(`r.branch = ?`);
      bindings.push(filters.branch);
    }

    return { conditions, bindings };
  }

  async accommodationByNight(
    filters?: { statuses?: string[]; branch?: string },
  ): Promise<Record<string, {
    private: number;
    privateByGender: { male: number; female: number; other: number };
    shared_double: { count: number; rooms: number };
    shared_doubleByGender: { male: number; female: number; other: number };
    shared_triple: { count: number; rooms: number };
    shared_tripleByGender: { male: number; female: number; other: number };
    extraBeds: number;
  }>> {
    // Initialize both night buckets to zero before populating (T2-11)
    const zeroGender = () => ({ male: 0, female: 0, other: 0 });
    const zero = () => ({
      private: 0,
      privateByGender: zeroGender(),
      shared_double: { count: 0, rooms: 0 },
      shared_doubleByGender: zeroGender(),
      shared_triple: { count: 0, rooms: 0 },
      shared_tripleByGender: zeroGender(),
      extraBeds: 0,
    });
    const result: Record<string, ReturnType<typeof zero>> = {
      '2026-08-14': zero(),
      '2026-08-15': zero(),
    };

    const { conditions, bindings } = this.buildRegistrationConditions(filters);
    // Exclude NULL check_in (C1) and accommodation='none'
    conditions.push(`r.check_in IS NOT NULL`);
    conditions.push(`r.accommodation != 'none'`);

    // Per-night occupancy via [check_in, check_out) interval (decision C6).
    // GROUP BY accommodation AND gender to produce the gender breakdown.
    const nightQueries = D1AttendeeRepository.NIGHTS.map((night) => {
      const nightConditions = [...conditions, `r.check_in <= ?`, `r.check_out > ?`];
      const nightBindings = [...bindings, night, night];

      const sql =
        `SELECT r.accommodation,` +
        ` CASE WHEN r.gender = 'male' THEN 'male'` +
        `      WHEN r.gender = 'female' THEN 'female'` +
        `      ELSE 'other' END AS gender_group,` +
        ` SUM(r.extra_bed) AS extra_beds,` +
        ` COUNT(*) AS cnt` +
        ` FROM registrations r` +
        ` WHERE ${nightConditions.join(' AND ')}` +
        ` GROUP BY r.accommodation, gender_group`;

      return this.db
        .prepare(sql)
        .bind(...nightBindings)
        .all<{ accommodation: string; gender_group: string; extra_beds: number; cnt: number }>();
    });

    const [night14Results, night15Results] = await Promise.all(nightQueries);

    const applyNight = (
      night: string,
      rows: Array<{ accommodation: string; gender_group: string; extra_beds: number; cnt: number }>,
    ) => {
      const bucket = result[night];
      if (!bucket) return;
      for (const row of rows) {
        const n = row.cnt;
        const g = row.gender_group as 'male' | 'female' | 'other';
        const eb = row.extra_beds ?? 0;
        if (row.accommodation === 'private') {
          bucket.private += n;
          bucket.privateByGender[g] += n;
          bucket.extraBeds += eb;
        } else if (row.accommodation === 'shared_double') {
          bucket.shared_double.count += n;
          bucket.shared_doubleByGender[g] += n;
        } else if (row.accommodation === 'shared_triple') {
          bucket.shared_triple.count += n;
          bucket.shared_tripleByGender[g] += n;
        }
      }

      bucket.shared_double.rooms = Object.values(bucket.shared_doubleByGender)
        .reduce((rooms, count) => rooms + Math.ceil(count / 2), 0);
      bucket.shared_triple.rooms = Object.values(bucket.shared_tripleByGender)
        .reduce((rooms, count) => rooms + Math.ceil(count / 3), 0);
    };

    applyNight('2026-08-14', night14Results.results);
    applyNight('2026-08-15', night15Results.results);

    return result;
  }

  async mealsByParticipationType(
    filters?: { statuses?: string[]; branch?: string },
  ): Promise<{
    campusDayCaterer: { headcount: number; veg: number; nonVeg: number };
    ravizBanquet: { headcount: number; veg: number; nonVeg: number };
  }> {
    const { conditions: baseConditions, bindings: baseBindings } =
      this.buildRegistrationConditions(filters);

    // Query 1: Alumni meals grouped by participation_type (from registrations table)
    const alumniWhere = baseConditions.join(' AND ');
    const alumniSql =
      `SELECT r.participation_type, r.alumni_meal, COUNT(*) AS cnt` +
      ` FROM registrations r` +
      ` WHERE ${alumniWhere}` +
      ` GROUP BY r.participation_type, r.alumni_meal`;

    // Query 2: Attendee meals grouped by parent participation_type (JOIN attendees → registrations)
    const attendeeWhere = baseConditions.map((c) => c).join(' AND ');
    const attendeeSql =
      `SELECT r.participation_type, a.meal, COUNT(*) AS cnt` +
      ` FROM attendees a` +
      ` JOIN registrations r ON a.registration_id = r.id` +
      ` WHERE ${attendeeWhere}` +
      ` GROUP BY r.participation_type, a.meal`;

    const [alumniResults, attendeeResults] = await Promise.all([
      this.db
        .prepare(alumniSql)
        .bind(...baseBindings)
        .all<{ participation_type: string; alumni_meal: string; cnt: number }>(),
      this.db
        .prepare(attendeeSql)
        .bind(...baseBindings)
        .all<{ participation_type: string; meal: string; cnt: number }>(),
    ]);

    const campusDayCaterer = { headcount: 0, veg: 0, nonVeg: 0 };
    const ravizBanquet = { headcount: 0, veg: 0, nonVeg: 0 };

    const applyMeal = (
      bucket: { headcount: number; veg: number; nonVeg: number },
      meal: string,
      count: number,
    ) => {
      bucket.headcount += count;
      if (meal === 'veg') bucket.veg += count;
      else bucket.nonVeg += count;
    };

    // Alumni rows
    for (const row of alumniResults.results) {
      const pt = row.participation_type;
      const cnt = row.cnt;
      const meal = row.alumni_meal;
      if (pt === 'full_celebration' || pt === 'campus_only') {
        applyMeal(campusDayCaterer, meal, cnt);
      }
      if (pt === 'full_celebration') {
        applyMeal(ravizBanquet, meal, cnt);
      }
    }

    // Attendee rows
    for (const row of attendeeResults.results) {
      const pt = row.participation_type;
      const cnt = row.cnt;
      const meal = row.meal;
      if (pt === 'full_celebration' || pt === 'campus_only') {
        applyMeal(campusDayCaterer, meal, cnt);
      }
      if (pt === 'full_celebration') {
        applyMeal(ravizBanquet, meal, cnt);
      }
    }

    return { campusDayCaterer, ravizBanquet };
  }

  async childrenByAgeBand(
    filters?: { statuses?: string[]; branch?: string },
  ): Promise<{ under6: number; age6to12: number; age12plus: number }> {
    const { conditions, bindings } = this.buildRegistrationConditions(filters);
    conditions.push(`a.type = 'child'`);

    const where = conditions.join(' AND ');

    // Single GROUP BY query with CASE expression for age bands (decision C4):
    //   under6   = age < 6 OR age IS NULL
    //   age6to12 = 6 <= age <= 12
    //   age12plus = age > 12
    const sql =
      `SELECT` +
      ` SUM(CASE WHEN a.age IS NULL OR a.age < 6 THEN 1 ELSE 0 END) AS under6,` +
      ` SUM(CASE WHEN a.age >= 6 AND a.age <= 12 THEN 1 ELSE 0 END) AS age6to12,` +
      ` SUM(CASE WHEN a.age > 12 THEN 1 ELSE 0 END) AS age12plus` +
      ` FROM attendees a` +
      ` JOIN registrations r ON a.registration_id = r.id` +
      ` WHERE ${where}`;

    const row = await this.db
      .prepare(sql)
      .bind(...bindings)
      .first<{ under6: number | null; age6to12: number | null; age12plus: number | null }>();

    return {
      under6: row?.under6 ?? 0,
      age6to12: row?.age6to12 ?? 0,
      age12plus: row?.age12plus ?? 0,
    };
  }
}
