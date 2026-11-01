/**
 * CONTRACT: Feature-flag routes — authenticated read of runtime feature flags.
 *
 * Part of the debug-tools layered defense (access-control.spec.md G8, option b):
 * the client's staging-only /debug/* gate reads `debug_tools` here, so debug
 * tooling is reachable only for an authenticated admin AND an enabled D1 flag.
 *
 * GUARANTEE: AUTH_REQUIRED — all routes require a valid JWT with role=admin,
 *   enforced by authMiddleware + requireRole('admin') at the router level.
 *   Unauthenticated → 401; attendee/staff role → 403.
 *
 * GUARANTEE: FAIL_CLOSED — every non-affirmative case reads as disabled:
 *   unknown flag name → { enabled: false }; missing feature_flags table or
 *   any query failure → { enabled: false } (logged), never a thrown 500.
 *   A consumer can only see `enabled: true` from a real enabled=1 row.
 *
 * EXPECTS: c.env.DB is a D1 database; the feature_flags table is created by
 *   migration 0018_feature_flags.sql (name TEXT PK, enabled INTEGER 0|1).
 *
 * FAILURE BEHAVIOR: 400 for a malformed flag name. Query errors degrade to
 *   { enabled: false } rather than propagating (see FAIL_CLOSED).
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import { createLogger } from '../infra/logger.js';

const log = createLogger('feature-flags');

export const featureFlagsRoutes = new Hono<AppEnv>();

featureFlagsRoutes.use('*', authMiddleware, requireRole('admin'));

const FLAG_NAME_RE = /^[a-z0-9_-]{1,64}$/;

featureFlagsRoutes.get('/:name', async (c) => {
  const name = c.req.param('name');
  if (!FLAG_NAME_RE.test(name)) {
    return c.json({ error: 'Invalid flag name' }, 400);
  }

  try {
    const row = await c.env.DB.prepare('SELECT enabled FROM feature_flags WHERE name = ?')
      .bind(name)
      .first<{ enabled: number }>();
    return c.json({ name, enabled: row?.enabled === 1 });
  } catch (err) {
    // Fail closed: a missing table or query failure reads as "disabled".
    log.warn('feature flag read failed, treating as disabled', {
      name,
      error: (err as Error).message,
    });
    return c.json({ name, enabled: false });
  }
});
