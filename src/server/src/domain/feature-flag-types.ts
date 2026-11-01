/**
 * CONTRACT: Feature flag persistence types (feature-flags.spec.md).
 *
 * GUARANTEE: OVERRIDE_ONLY — FeatureFlagOverride carries a persisted
 *   override row's raw shape only. It has no catalog metadata (label,
 *   description, default, exposure, enforcement) — the service merges
 *   those in from FEATURE_FLAG_CATALOG (feature-flags.spec.md R2).
 *
 * GUARANTEE: D1_BOOLEAN — enabled is 0|1 as stored in D1. The service
 *   layer coerces it to boolean; this file does not (src/server/CLAUDE.md
 *   D1-boolean convention).
 */

export interface FeatureFlagOverride {
  name: string;
  enabled: number;
  updated_at: number | null;
  updated_by: string | null;
}

export interface FeatureFlagAuditChange {
  key: string;
  from: boolean;
  to: boolean;
}

export interface FeatureFlagAuditEntry {
  actor: string;
  changedAt: number;
  changes: FeatureFlagAuditChange[];
}
