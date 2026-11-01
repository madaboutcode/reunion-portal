/**
 * CONTRACT
 *
 * GUARANTEE: OVERRIDES_ONLY — findAll() returns persisted override rows
 *   exactly as stored. No catalog merge happens here (feature-flags.spec.md
 *   R2) — that is the service's job.
 *
 * GUARANTEE: AUDIT_SCOPED — findRecentAudit() reads only system_audit_log
 *   rows with action='feature_flags_updated', newest first, and parses the
 *   `details` JSON column into the changes array (runtime-feature-flags
 *   .ispec.md R2.3). A row whose details is missing or fails to parse is
 *   skipped rather than thrown, so one corrupt row can't break the whole
 *   admin page.
 *
 * GUARANTEE: APPLY_ATOMIC — applyChanges() writes every flag UPSERT and the
 *   one audit row in a SINGLE db.batch() call. Partial writes are
 *   impossible.
 *
 * GUARANTEE: NO_SQL_INJECTION — all queries use db.prepare().bind().
 *
 * EXPECTS: db is a live D1Database. feature_flags has columns
 *   (name TEXT PK, enabled INTEGER, updated_at INTEGER, updated_by TEXT) —
 *   migrations 0018 + 0024. system_audit_log is append-only
 *   (system-audit.repo.ts).
 *
 * FAILURE BEHAVIOR: All D1 errors propagate as thrown errors. findAll() /
 *   findRecentAudit() return [] when no rows exist.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { FeatureFlagOverride, FeatureFlagAuditEntry } from '../domain/feature-flag-types.js';
import type { IFeatureFlagRepository } from './interfaces.js';

interface SystemAuditRow {
  actor: string;
  created_at: number;
  details: string | null;
}

export class D1FeatureFlagRepository implements IFeatureFlagRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async findAll(): Promise<FeatureFlagOverride[]> {
    const { results } = await this.db
      .prepare('SELECT name, enabled, updated_at, updated_by FROM feature_flags')
      .all<FeatureFlagOverride>();
    return results;
  }

  async findRecentAudit(limit: number): Promise<FeatureFlagAuditEntry[]> {
    const { results } = await this.db
      .prepare(
        `SELECT actor, created_at, details FROM system_audit_log
         WHERE action = 'feature_flags_updated'
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .bind(limit)
      .all<SystemAuditRow>();

    const entries: FeatureFlagAuditEntry[] = [];
    for (const row of results) {
      if (!row.details) continue;
      try {
        const parsed = JSON.parse(row.details) as { changes?: unknown };
        if (!Array.isArray(parsed.changes)) continue;
        entries.push({ actor: row.actor, changedAt: row.created_at, changes: parsed.changes as FeatureFlagAuditEntry['changes'] });
      } catch {
        continue;
      }
    }
    return entries;
  }

  async applyChanges(
    changes: Array<{ key: string; enabled: boolean }>,
    actor: string,
    auditDetails: string,
  ): Promise<void> {
    const now = Date.now();

    const upsertStmts = changes.map((change) =>
      this.db
        .prepare(
          `INSERT INTO feature_flags (name, enabled, updated_at, updated_by)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET
             enabled = excluded.enabled,
             updated_at = excluded.updated_at,
             updated_by = excluded.updated_by`,
        )
        .bind(change.key, change.enabled ? 1 : 0, now, actor),
    );

    const auditStmt = this.db
      .prepare(
        `INSERT INTO system_audit_log (action, actor, target_type, details)
         VALUES ('feature_flags_updated', ?, 'feature_flags', ?)`,
      )
      .bind(actor, auditDetails);

    await this.db.batch([...upsertStmts, auditStmt]);
  }
}
