/**
 * CONTRACT
 *
 * GUARANTEE: AUDIT_CHRONOLOGICAL — findByRegistration returns audit entries
 *   ordered by created_at ASC (chronological). This preserves the causal
 *   sequence of events for audit trail review.
 *
 * GUARANTEE: APPEND_ONLY — append() only inserts. There is no update or delete
 *   operation on audit_log. The audit trail is immutable once written.
 *
 * GUARANTEE: NO_SQL_INJECTION — all queries use db.prepare().bind().
 *   No string interpolation appears in any SQL statement.
 *
 * GUARANTEE: DOMAIN_TYPES — findByRegistration returns AuditEntry[] (domain
 *   type) via toAuditEntry(), never raw AuditEntryRow objects.
 *
 * EXPECTS: entry.snapshot is already a JSON string (produced by createSnapshot()
 *   in domain/audit.ts). This repo stores it verbatim — no re-serialization.
 *
 * EXPECTS: entry.changes is already a JSON string or null. Same as snapshot —
 *   stored verbatim.
 *
 * FAILURE BEHAVIOR: All D1 errors propagate as thrown errors. append() does
 *   not swallow failures — a failed audit write should surface to the caller.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { IAuditRepository } from './interfaces.js';
import type { AuditEntry, NewAuditEntry, AuditEntryRow } from '../domain/types.js';
import { toAuditEntry } from '../domain/types.js';

export class D1AuditRepository implements IAuditRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async append(entry: NewAuditEntry): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO audit_log (registration_id, action, actor, changes, snapshot)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        entry.registration_id,
        entry.action,
        entry.actor,
        entry.changes,
        entry.snapshot,
      )
      .run();
  }

  async findByRegistration(registrationId: number): Promise<AuditEntry[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM audit_log WHERE registration_id = ? ORDER BY created_at ASC`,
      )
      .bind(registrationId)
      .all<AuditEntryRow>();

    return results.map(toAuditEntry);
  }
}
