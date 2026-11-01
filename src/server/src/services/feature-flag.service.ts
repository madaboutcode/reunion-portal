/**
 * CONTRACT
 *
 * GUARANTEE: SNAPSHOT_ONE_PER_REQUEST — resolve()/resolveStrict() memoize
 *   their result on the service instance. The service is constructed fresh
 *   per HTTP request (app.ts DI middleware), so one instance never outlives
 *   one request — every isEnabled()/publicValues()/adminValues() call
 *   within a request sees the same resolved snapshot (feature-flags.spec.md
 *   R5, R5.1).
 *
 * GUARANTEE: FAIL_OPEN_TO_FAILURE_VALUE — resolve() never throws. A D1 read
 *   failure logs a warning and every catalog key falls back to its
 *   catalogued failureValue (feature-flags.spec.md R5.4, R4.4).
 *
 * GUARANTEE: STRICT_PROPAGATES — resolveStrict() is the admin-facing
 *   opposite of resolve(): on read failure it throws
 *   AppError('Configuration unavailable', 503, 'CONFIG_UNAVAILABLE') rather
 *   than silently substituting fallback values, so an admin never mistakes
 *   a fallback view for a persisted one (runtime-feature-flags.ispec.md
 *   R2.4).
 *
 * GUARANTEE: UPDATE_VALIDATES_BEFORE_WRITING — update() fully validates the
 *   submission (shape, catalog membership, no duplicate keys, boolean
 *   values) before any read or write. A validation failure throws
 *   FeatureFlagValidationError and persists nothing
 *   (runtime-feature-flags.ispec.md R3.1, R3.2, R3.4, R3.5).
 *
 * GUARANTEE: UPDATE_MINIMAL — only values that actually differ from the
 *   current effective value are persisted and audited. A submission where
 *   every value is already the current value persists nothing and appends
 *   no audit entry (runtime-feature-flags.ispec.md R3.6).
 *
 * EXPECTS: flagRepo.findAll() may return rows for keys outside
 *   FEATURE_FLAG_CATALOG (R1.3) — this service ignores them.
 *
 * FAILURE BEHAVIOR: resolveStrict()/getAdminConfig()/update() throw
 *   AppError(..., 503, 'CONFIG_UNAVAILABLE') on any D1 failure. update()
 *   throws FeatureFlagValidationError (carrying `.details`) on any
 *   structurally invalid submission. Both are mapped to HTTP responses by
 *   the route layer (config.routes.ts).
 */

import {
  FEATURE_FLAG_CATALOG,
  getPublicFlagKeys,
} from '@smriti/shared';
import type { FeatureFlagKey, PublicFeatureFlagKey } from '@smriti/shared';
import type { IFeatureFlagRepository, ISystemAuditRepository } from '../repositories/interfaces.js';
import type { FeatureFlagOverride, FeatureFlagAuditEntry } from '../domain/feature-flag-types.js';
import { AppError } from './errors.js';
import { createLogger } from '../infra/logger.js';

const log = createLogger('feature-flags');

const AUDIT_LIMIT = 50;
const MAX_CHANGES = 100;

export interface AdminFeatureFlag {
  key: FeatureFlagKey;
  label: string;
  description: string;
  group: string;
  enabled: boolean;
  defaultValue: boolean;
  failureValue: boolean;
  source: 'default' | 'override';
  exposure: string;
  enforcement: string;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface AdminConfigResponse {
  flags: AdminFeatureFlag[];
  audit: FeatureFlagAuditEntry[];
}

export interface FeatureFlagValidationDetail {
  path: string;
  message: string;
}

export class FeatureFlagValidationError extends Error {
  details: FeatureFlagValidationDetail[];

  constructor(details: FeatureFlagValidationDetail[]) {
    super('Invalid feature flag update');
    this.details = details;
    this.name = 'FeatureFlagValidationError';
  }
}

export interface FeatureFlagSnapshot {
  isEnabled(key: FeatureFlagKey): boolean;
  publicValues(): Record<PublicFeatureFlagKey, boolean>;
  adminValues(): AdminFeatureFlag[];
}

const CATALOG_KEYS = Object.keys(FEATURE_FLAG_CATALOG) as FeatureFlagKey[];

function buildSnapshot(overrides: Map<string, FeatureFlagOverride>, useFailureValues: boolean): FeatureFlagSnapshot {
  const effective = new Map<FeatureFlagKey, boolean>();

  for (const key of CATALOG_KEYS) {
    const def = FEATURE_FLAG_CATALOG[key];
    if (useFailureValues) {
      effective.set(key, def.failureValue);
      continue;
    }
    const override = overrides.get(key);
    effective.set(key, override ? override.enabled === 1 : def.defaultValue);
  }

  return {
    isEnabled(key) {
      return effective.get(key) ?? FEATURE_FLAG_CATALOG[key].failureValue;
    },
    publicValues() {
      const result = {} as Record<PublicFeatureFlagKey, boolean>;
      for (const key of getPublicFlagKeys()) {
        result[key] = effective.get(key) ?? FEATURE_FLAG_CATALOG[key].failureValue;
      }
      return result;
    },
    adminValues() {
      return CATALOG_KEYS.map((key) => {
        const def = FEATURE_FLAG_CATALOG[key];
        const override = overrides.get(key);
        return {
          key,
          label: def.label,
          description: def.description,
          group: def.group,
          enabled: effective.get(key) ?? def.failureValue,
          defaultValue: def.defaultValue,
          failureValue: def.failureValue,
          source: override ? 'override' : 'default',
          exposure: def.exposure,
          enforcement: def.enforcement,
          updatedAt: override?.updated_at ?? null,
          updatedBy: override?.updated_by ?? null,
        };
      });
    },
  };
}

export class FeatureFlagService {
  private flagRepo: IFeatureFlagRepository;
  private memo: FeatureFlagSnapshot | null = null;

  constructor(deps: { flagRepo: IFeatureFlagRepository; systemAuditRepo: ISystemAuditRepository }) {
    this.flagRepo = deps.flagRepo;
    // systemAuditRepo is accepted for DI-shape consistency with other
    // services; audit writes for flag changes are bundled atomically inside
    // flagRepo.applyChanges() instead (see feature-flag.repo.ts
    // APPLY_ATOMIC), so it is not called directly here.
    void deps.systemAuditRepo;
  }

  async resolve(): Promise<FeatureFlagSnapshot> {
    if (this.memo) return this.memo;
    try {
      const overrides = await this.flagRepo.findAll();
      this.memo = buildSnapshot(new Map(overrides.map((o) => [o.name, o])), false);
    } catch (err) {
      log.warn('feature flag read failed, using failure values', { error: (err as Error).message });
      this.memo = buildSnapshot(new Map(), true);
    }
    return this.memo;
  }

  async resolveStrict(): Promise<FeatureFlagSnapshot> {
    if (this.memo) return this.memo;
    try {
      const overrides = await this.flagRepo.findAll();
      this.memo = buildSnapshot(new Map(overrides.map((o) => [o.name, o])), false);
      return this.memo;
    } catch (err) {
      log.error('feature flag read failed (strict)', { error: (err as Error).message });
      throw new AppError('Configuration unavailable', 503, 'CONFIG_UNAVAILABLE');
    }
  }

  async getAdminConfig(): Promise<AdminConfigResponse> {
    const snapshot = await this.resolveStrict();
    let audit: FeatureFlagAuditEntry[];
    try {
      audit = await this.flagRepo.findRecentAudit(AUDIT_LIMIT);
    } catch (err) {
      log.error('feature flag audit read failed', { error: (err as Error).message });
      throw new AppError('Configuration unavailable', 503, 'CONFIG_UNAVAILABLE');
    }
    return { flags: snapshot.adminValues(), audit };
  }

  async update(rawChanges: unknown, actor: string): Promise<AdminConfigResponse> {
    const changes = this.validate(rawChanges);

    const snapshot = await this.resolveStrict();

    const effectiveChanges: Array<{ key: FeatureFlagKey; enabled: boolean; from: boolean; to: boolean }> = [];
    for (const change of changes) {
      const current = snapshot.isEnabled(change.key);
      if (current !== change.enabled) {
        effectiveChanges.push({ key: change.key, enabled: change.enabled, from: current, to: change.enabled });
      }
    }

    if (effectiveChanges.length === 0) {
      return this.getAdminConfig();
    }

    const auditDetails = JSON.stringify({
      changes: effectiveChanges.map(({ key, from, to }) => ({ key, from, to })),
    });

    try {
      await this.flagRepo.applyChanges(
        effectiveChanges.map(({ key, enabled }) => ({ key, enabled })),
        actor,
        auditDetails,
      );
    } catch (err) {
      log.error('feature flag update failed', { error: (err as Error).message });
      throw new AppError('Configuration unavailable', 503, 'CONFIG_UNAVAILABLE');
    }

    this.memo = null;
    return this.getAdminConfig();
  }

  private validate(rawChanges: unknown): Array<{ key: FeatureFlagKey; enabled: boolean }> {
    if (!Array.isArray(rawChanges) || rawChanges.length === 0 || rawChanges.length > MAX_CHANGES) {
      throw new FeatureFlagValidationError([
        { path: 'changes', message: `changes must contain 1-${MAX_CHANGES} entries` },
      ]);
    }

    const catalogKeys = new Set<string>(CATALOG_KEYS);
    const seenKeys = new Set<string>();
    const details: FeatureFlagValidationDetail[] = [];
    const validated: Array<{ key: FeatureFlagKey; enabled: boolean }> = [];

    rawChanges.forEach((entry, i) => {
      const key = (entry as { key?: unknown } | null)?.key;
      const enabled = (entry as { enabled?: unknown } | null)?.enabled;

      if (typeof key !== 'string' || !catalogKeys.has(key)) {
        details.push({ path: `changes.${i}.key`, message: 'Unknown feature flag' });
        return;
      }
      if (seenKeys.has(key)) {
        details.push({ path: `changes.${i}.key`, message: 'Duplicate key' });
        return;
      }
      if (typeof enabled !== 'boolean') {
        details.push({ path: `changes.${i}.enabled`, message: 'enabled must be a boolean' });
        return;
      }
      seenKeys.add(key);
      validated.push({ key: key as FeatureFlagKey, enabled });
    });

    if (details.length > 0) {
      throw new FeatureFlagValidationError(details);
    }

    return validated;
  }
}
