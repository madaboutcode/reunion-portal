import type { Context, Next, MiddlewareHandler } from 'hono';
import { verifyToken } from '../infra/jwt.js';
import type { JwtRole } from '../infra/jwt.js';
import type { AppEnv } from '../env.js';
import { createLogger } from '../infra/logger.js';

const log = createLogger('auth');

export async function authMiddleware(c: Context<AppEnv>, next: Next): Promise<void> {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    log.warn('Missing authorization header', { method: c.req.method, path: c.req.path });
    c.res = c.json({ error: 'Missing authorization header' }, 401);
    return;
  }

  const token = header.slice(7);
  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (payload.role === 'attendee') {
      c.set('auth', { role: 'attendee', registrationId: Number(payload.sub) });
    } else {
      c.set('auth', { role: payload.role as 'staff' | 'admin', userId: Number(payload.sub), email: payload.email as string });
    }
    await next();
  } catch (err) {
    log.warn('JWT verification failed', { method: c.req.method, path: c.req.path, error: (err as Error).message });
    c.res = c.json({ error: 'Invalid or expired token' }, 401);
  }
}

export function requireRole(...roles: JwtRole[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!roles.includes(auth.role)) {
      c.res = c.json({ error: 'Insufficient permissions' }, 403);
      return;
    }
    await next();
  };
}

const SCOPE_CACHE_TTL_MS = 300_000;

interface ScopeCacheEntry {
  scopes: string[] | null;
  expiresAt: number;
}

const scopeCache = new Map<number, ScopeCacheEntry>();

export const _scopeCache = scopeCache;

async function resolveScopes(c: Context<AppEnv>, userId: number): Promise<string[] | null> {
  const cached = scopeCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.scopes;
  }

  const row = await c.env.DB.prepare('SELECT permissions FROM users WHERE id = ?')
    .bind(userId)
    .first<{ permissions: string | null }>();

  let scopes: string[] | null;
  if (!row) {
    // R3.5: a deleted user with a valid JWT must be denied, not granted full access.
    log.warn('requireScope: no user row for valid JWT', { userId });
    scopes = [];
  } else if (row.permissions) {
    try {
      const parsed = JSON.parse(row.permissions) as { scopes?: string[] };
      scopes = parsed.scopes ?? null;
    } catch (err) {
      // R3.5: malformed permissions JSON must deny, not grant full access.
      log.warn('requireScope: malformed permissions JSON', {
        userId,
        error: (err as Error).message,
      });
      scopes = [];
    }
  } else {
    // R2.1: permissions IS NULL on an existing row = full access
    // (the default for unscoped staff accounts). Distinct from the
    // missing-row and parse-failure cases above, which fail closed.
    scopes = null;
  }

  // R4.4: the corrected [] is cached, so a deleted/corrupted user stays
  // denied for the TTL window instead of re-querying per request.
  scopeCache.set(userId, { scopes, expiresAt: Date.now() + SCOPE_CACHE_TTL_MS });
  return scopes;
}

export function requireScope(scope: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');

    if (auth.role !== 'staff' && auth.role !== 'admin') {
      c.res = c.json({ error: 'Insufficient permissions' }, 403);
      return;
    }

    if (auth.role === 'admin') {
      await next();
      return;
    }

    const scopes = await resolveScopes(c, auth.userId);

    if (scopes === null || scopes.includes(scope)) {
      await next();
      return;
    }

    log.warn('Scope check failed', { userId: auth.userId, scope, path: c.req.path });
    c.res = c.json({ error: 'Insufficient permissions' }, 403);
  };
}
