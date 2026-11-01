/**
 * CONTRACT: Server-side enforcement of a behavioral feature flag
 *   (feature-flags.spec.md R5.2, R5.4).
 *
 * GUARANTEE: FAIL_CLOSED — resolves the flag through
 *   c.var.featureFlagService.resolve(), which never throws and falls back
 *   to the flag's catalogued failureValue on storage failure. A disabled or
 *   unresolvable flag returns `disabledStatus`/`disabledBody` and never
 *   calls next() — no route body runs and no side effect happens.
 *
 * EXPECTS: c.var.featureFlagService is set by app.ts DI middleware and
 *   runs before this middleware in the chain.
 */

import type { MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from '../env.js';
import type { FeatureFlagKey } from '@smriti/shared';

export function requireFeatureFlag(
  key: FeatureFlagKey,
  options: {
    disabledStatus: ContentfulStatusCode;
    disabledBody: { error: string; code: string };
  },
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const snapshot = await c.var.featureFlagService.resolve();
    if (!snapshot.isEnabled(key)) {
      return c.json(options.disabledBody, options.disabledStatus);
    }
    await next();
  };
}
