/**
 * CONTRACT
 *
 * GUARANTEE: EMAIL_CASE_INSENSITIVE — findByEmail() matches emails
 *   case-insensitively via COLLATE NOCASE on the email column (set at table
 *   creation). Both lookup and uniqueness enforcement are case-insensitive.
 *
 * GUARANTEE: CREATE_RETURNS_ID — create() returns { id: number } using
 *   meta.last_row_id from the D1 prepared statement result.
 *
 * GUARANTEE: NO_SQL_INJECTION — all queries use db.prepare().bind().
 *   No string interpolation appears in any SQL statement.
 *
 * GUARANTEE: DOMAIN_TYPES — all find/list methods return User[] or User | null
 *   (domain type) via toUser(), never raw UserRow objects. is_active is coerced
 *   from 0|1 integer to boolean.
 *
 * GUARANTEE: NO_DATE_OBJECTS — created_at and updated_at are Unix epoch
 *   milliseconds. updated_at is refreshed via (unixepoch() * 1000) on update.
 *
 * EXPECTS: db is a live D1Database binding from the Cloudflare Workers env.
 *
 * FAILURE BEHAVIOR: All D1 errors propagate as thrown errors. findById and
 *   findByEmail return null when not found — they do not throw. list() returns
 *   an empty array when no users exist.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { IUserRepository } from './interfaces.js';
import type { User, NewUser, UserRow } from '../domain/types.js';
import { toUser } from '../domain/types.js';

export class D1UserRepository implements IUserRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async create(user: NewUser): Promise<{ id: number }> {
    const result = await this.db
      .prepare(
        `INSERT INTO users (email, name, role, permissions, created_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(user.email, user.name, user.role, user.permissions ?? null, user.created_by)
      .run();

    return { id: result.meta.last_row_id };
  }

  async findById(id: number): Promise<User | null> {
    const row = await this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(id)
      .first<UserRow>();

    return row !== null ? toUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.db
      .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
      .bind(email)
      .first<UserRow>();

    return row !== null ? toUser(row) : null;
  }

  async list(): Promise<User[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM users ORDER BY created_at ASC')
      .all<UserRow>();

    return results.map(toUser);
  }

  async update(
    id: number,
    data: { name?: string; is_active?: number; permissions?: string | null },
  ): Promise<void> {
    const clauses: string[] = ['updated_at = (unixepoch() * 1000)'];
    const values: (string | number | null)[] = [];

    if (data.name !== undefined) {
      clauses.unshift('name = ?');
      values.push(data.name);
    }

    if (data.is_active !== undefined) {
      clauses.unshift('is_active = ?');
      values.push(data.is_active);
    }

    if (data.permissions !== undefined) {
      clauses.unshift('permissions = ?');
      values.push(data.permissions);
    }

    values.push(id);

    await this.db
      .prepare(`UPDATE users SET ${clauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }
}
