/**
 * CONTRACT: Feature-flag configuration routes (runtime-feature-flags.ispec.md).
 *
 * GUARANTEE: PUBLIC_SNAPSHOT — GET /config/features is unauthenticated,
 *   always 200 (even on storage failure, via featureFlagService.resolve()'s
 *   fallback), Cache-Control: no-store, and returns every public catalog
 *   key exactly once as a boolean (ispec R1, R1.1, R1.3, R1.4).
 *
 * GUARANTEE: ADMIN_ONLY — every /admin/config/features route requires a
 *   valid JWT with role=admin, enforced by authMiddleware + requireRole
 *   ('admin') at the router level (ispec R2.5).
 *
 * GUARANTEE: ATOMIC_UPDATE — PUT /admin/config/features validates the full
 *   submission before persisting anything; a 422 leaves every value
 *   unchanged (ispec R3.1-R3.5).
 *
 * EXPECTS: c.var.featureFlagService is set by app.ts DI middleware.
 *
 * FAILURE BEHAVIOR: 503 { error, code: 'CONFIG_UNAVAILABLE' } on storage
 *   failure — thrown as AppError by the service and rendered by the shared
 *   error middleware. 422 { error, code: 'INVALID_FLAG_UPDATE', details }
 *   on validation failure — caught here so the response can carry the
 *   structured `details` array (the shared AppError branch does not).
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import { FeatureFlagValidationError } from '../services/feature-flag.service.js';

export const publicConfigRoutes = new Hono<AppEnv>();

publicConfigRoutes.get('/features', async (c) => {
  const snapshot = await c.var.featureFlagService.resolve();
  c.header('Cache-Control', 'no-store');
  return c.json({ flags: snapshot.publicValues(), resolvedAt: Date.now() });
});

export const adminConfigRoutes = new Hono<AppEnv>();

adminConfigRoutes.use('*', authMiddleware, requireRole('admin'));

adminConfigRoutes.get('/features', async (c) => {
  const config = await c.var.featureFlagService.getAdminConfig();
  return c.json(config);
});

adminConfigRoutes.put('/features', async (c) => {
  const auth = c.var.auth;
  const actor = auth.role === 'admin' ? auth.email : 'unknown';
  const body = await c.req.json<{ changes?: unknown }>().catch(() => ({ changes: undefined }));

  try {
    const config = await c.var.featureFlagService.update(body.changes, actor);
    return c.json(config);
  } catch (err) {
    if (err instanceof FeatureFlagValidationError) {
      return c.json(
        { error: 'Invalid feature flag update', code: 'INVALID_FLAG_UPDATE', details: err.details },
        422,
      );
    }
    throw err;
  }
});
