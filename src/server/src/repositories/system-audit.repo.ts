/**
 * CONTRACT
 *
 * GUARANTEE: APPEND_ONLY — append() only inserts. There is no update or delete
 *   operation on system_audit_log. The system audit trail is immutable once
 *   written.
 *
 * GUARANTEE: NO_SQL_INJECTION — all queries use db.prepare().bind().
 *   No string interpolation appears in any SQL statement.
 *
 * GUARANTEE: OPTIONAL_FIELDS — target_type, target_id, and details are all
 *   nullable. When not provided in the entry, null is bound for those columns.
 *
 * GUARANTEE: NO_DATE_OBJECTS — created_at is Unix epoch milliseconds, set via
 *   the DB DEFAULT (unixepoch() * 1000) on insert.
 *
 * EXPECTS: db is a live D1Database binding from the Cloudflare Workers env.
 *
 * FAILURE BEHAVIOR: All D1 errors propagate as thrown errors. append() does
 *   not swallow failures — a failed audit write should surface to the caller.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { ISystemAuditRepository } from './interfaces.js';
import type { SystemAuditAction } from '../domain/types.js';

export class D1SystemAuditRepository implements ISystemAuditRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async append(entry: {
    action: SystemAuditAction;
    actor: string;
    targetType?: string;
    targetId?: number;
    details?: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO system_audit_log (action, actor, target_type, target_id, details)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.action,
        entry.actor,
        entry.targetType ?? null,
        entry.targetId ?? null,
        entry.details ?? null,
      )
      .run();
  }
}
