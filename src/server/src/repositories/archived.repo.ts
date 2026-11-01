/**
 * CONTRACT
 *
 * GUARANTEE: CREATE_RETURNS_ID — create() inserts a row into archived_registrations
 *   and returns the new autoincrement id via meta.last_row_id.
 *
 * GUARANTEE: SNAPSHOT_STORED_AS_JSON — The snapshot field is stored as a JSON
 *   string and parsed back to an object on read (findById, list).
 *
 * GUARANTEE: LIST_PAGED — list() returns a paginated result with { items, total }.
 *   total is a separate COUNT query. items are ordered by archived_at DESC.
 *
 * GUARANTEE: LIST_SEARCH — list() supports optional search filtering on
 *   full_name, email, and reg_code (case-insensitive LIKE).
 *
 * GUARANTEE: NO_SQL_INJECTION — all queries use db.prepare().bind().
 *   No string interpolation appears in any SQL statement.
 *
 * FAILURE BEHAVIOR: All D1 errors propagate as thrown errors. findById returns
 *   null when no row exists with that id.
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface ArchivedRegistration {
  id: number;
  originalId: number;
  regCode: string;
  email: string;
  fullName: string;
  snapshot: unknown;
  archivedBy: string;
  archivedAt: number;
}

interface ArchivedRegistrationRow {
  id: number;
  original_id: number;
  reg_code: string;
  email: string;
  full_name: string;
  snapshot: string;
  archived_by: string;
  archived_at: number;
}

function toArchivedRegistration(row: ArchivedRegistrationRow): ArchivedRegistration {
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(row.snapshot);
  } catch {
    snapshot = row.snapshot;
  }
  return {
    id: row.id,
    originalId: row.original_id,
    regCode: row.reg_code,
    email: row.email,
    fullName: row.full_name,
    snapshot,
    archivedBy: row.archived_by,
    archivedAt: row.archived_at,
  };
}

export interface IArchivedRepository {
  create(data: {
    originalId: number;
    regCode: string;
    email: string;
    fullName: string;
    snapshot: string;
    archivedBy: string;
  }): Promise<number>;

  list(filters: {
    search?: string;
    page: number;
    limit: number;
  }): Promise<{ items: ArchivedRegistration[]; total: number }>;

  findById(id: number): Promise<ArchivedRegistration | null>;
}

export class D1ArchivedRepository implements IArchivedRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async create(data: {
    originalId: number;
    regCode: string;
    email: string;
    fullName: string;
    snapshot: string;
    archivedBy: string;
  }): Promise<number> {
    const result = await this.db
      .prepare(
        `INSERT INTO archived_registrations (original_id, reg_code, email, full_name, snapshot, archived_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        data.originalId,
        data.regCode,
        data.email,
        data.fullName,
        data.snapshot,
        data.archivedBy,
      )
      .run();

    return result.meta.last_row_id as number;
  }

  async list(filters: {
    search?: string;
    page: number;
    limit: number;
  }): Promise<{ items: ArchivedRegistration[]; total: number }> {
    const offset = (filters.page - 1) * filters.limit;

    let whereSql = '';
    const bindings: (string | number)[] = [];

    if (filters.search && filters.search.trim() !== '') {
      const escaped = filters.search.replace(/[%_\\]/g, '\\$&');
      const term = `%${escaped.toLowerCase()}%`;
      whereSql = `WHERE (LOWER(full_name) LIKE ? ESCAPE '\\' OR LOWER(email) LIKE ? ESCAPE '\\' OR LOWER(reg_code) LIKE ? ESCAPE '\\')`;
      bindings.push(term, term, term);
    }

    const countSql = `SELECT COUNT(*) as total FROM archived_registrations ${whereSql}`;
    const itemsSql = `SELECT * FROM archived_registrations ${whereSql} ORDER BY archived_at DESC LIMIT ? OFFSET ?`;

    const [countRow, { results }] = await Promise.all([
      this.db
        .prepare(countSql)
        .bind(...bindings)
        .first<{ total: number }>(),
      this.db
        .prepare(itemsSql)
        .bind(...bindings, filters.limit, offset)
        .all<ArchivedRegistrationRow>(),
    ]);

    return {
      items: results.map(toArchivedRegistration),
      total: countRow?.total ?? 0,
    };
  }

  async findById(id: number): Promise<ArchivedRegistration | null> {
    const row = await this.db
      .prepare(`SELECT * FROM archived_registrations WHERE id = ?`)
      .bind(id)
      .first<ArchivedRegistrationRow>();

    return row ? toArchivedRegistration(row) : null;
  }
}
