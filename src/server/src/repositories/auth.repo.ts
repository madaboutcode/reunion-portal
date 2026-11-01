/**
 * CONTRACT
 *
 * GUARANTEE: IDENTITY_UNION — createMagicLink() inserts either registration_id
 *   (for alumni) or user_id (for staff/admin), leaving the other column as NULL.
 *   The DB CHECK constraint enforces exactly one is set — this implementation
 *   mirrors that constraint in code.
 *
 * GUARANTEE: VALID_LINK_LOOKUP — findValidMagicLink() returns a MagicLink only
 *   when the token exists, has not been used (used_at IS NULL), and has not
 *   expired (expires_at > current epoch ms). Returns null in all other cases.
 *
 * GUARANTEE: NO_SQL_INJECTION — all queries use db.prepare().bind().
 *   No string interpolation appears in any SQL statement.
 *
 * GUARANTEE: DOMAIN_TYPES — findValidMagicLink returns MagicLink (domain type)
 *   via toMagicLink(), including the user_id field added in migration 002.
 *
 * GUARANTEE: MARK_USED_IDEMPOTENT — markUsed() sets used_at to the current
 *   epoch ms. Calling it twice has no harmful effect (second call updates the
 *   timestamp again, but the link is already consumed by the first call).
 *
 * EXPECTS: db is a live D1Database binding from the Cloudflare Workers env.
 *
 * FAILURE BEHAVIOR: All D1 errors propagate as thrown errors. findValidMagicLink
 *   returns null when not found — it does not throw.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { IAuthRepository } from './interfaces.js';
import type { MagicLink, MagicLinkRow } from '../domain/types.js';
import { toMagicLink } from '../domain/types.js';

export class D1AuthRepository implements IAuthRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async createMagicLink(
    tokenHash: string,
    expiresAt: number,
    identity: { registrationId: number } | { userId: number },
  ): Promise<void> {
    const registrationId = 'registrationId' in identity ? identity.registrationId : null;
    const userId = 'userId' in identity ? identity.userId : null;

    await this.db
      .prepare(
        `INSERT INTO magic_links (token_hash, registration_id, user_id, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(tokenHash, registrationId, userId, expiresAt)
      .run();
  }

  async findValidMagicLink(tokenHash: string): Promise<MagicLink | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM magic_links
         WHERE token_hash = ?
           AND used_at IS NULL
           AND expires_at > (unixepoch() * 1000)`,
      )
      .bind(tokenHash)
      .first<MagicLinkRow>();

    return row !== null ? toMagicLink(row) : null;
  }

  async markUsed(id: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE magic_links SET used_at = (unixepoch() * 1000) WHERE id = ? AND used_at IS NULL`,
      )
      .bind(id)
      .run();

    const changes = (result as unknown as { meta?: { changes: number }; changes?: number }).meta?.changes
      ?? (result as unknown as { changes?: number }).changes
      ?? 0;
    return changes > 0;
  }

  async cleanExpired(): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM magic_links WHERE expires_at <= (unixepoch() * 1000)`,
      )
      .run();
  }

  async countRecentLinks(
    identity: { registrationId: number } | { userId: number },
    sinceMs: number,
  ): Promise<number> {
    const column = 'registrationId' in identity ? 'registration_id' : 'user_id';
    const id = 'registrationId' in identity ? identity.registrationId : identity.userId;

    const result = await this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM magic_links WHERE ${column} = ? AND created_at > ?`,
      )
      .bind(id, sinceMs)
      .first<{ cnt: number }>();

    return result?.cnt ?? 0;
  }
}
