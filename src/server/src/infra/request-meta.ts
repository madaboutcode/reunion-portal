import type { Context } from 'hono';
import type { AppEnv, RequestMeta, AuthContext } from '../env.js';

const PATH_TO_REQ_TYPE: Record<string, string> = {
  registrations: 'registration',
  payments: 'payment',
  auth: 'auth',
  staff: 'staff',
  admin: 'admin',
  pass: 'pass',
  upload: 'upload',
  config: 'config',
  health: 'health',
};

export function setRequestMeta(c: Context<AppEnv>, meta: Partial<RequestMeta>): void {
  const current = getRequestMeta(c);
  c.set('requestMeta', { ...current, ...meta });
}

export function getRequestMeta(c: Context<AppEnv>): RequestMeta {
  try {
    return c.get('requestMeta') ?? {};
  } catch {
    return {};
  }
}

export function resolveLogContext(c: Context<AppEnv>): Record<string, unknown> {
  const meta = getRequestMeta(c);
  const ctx: Record<string, unknown> = {
    method: c.req.method,
    path: c.req.path,
  };

  if (!meta.reqType) {
    const segment = c.req.path.replace(/^\/api\//, '').split('/')[0];
    ctx.reqType = PATH_TO_REQ_TYPE[segment] ?? segment;
  }

  try {
    const auth: AuthContext | undefined = c.get('auth');
    if (auth) {
      ctx.role = auth.role;
      if (auth.role === 'attendee') ctx.registrationId = auth.registrationId;
      else { ctx.userId = auth.userId; ctx.email = auth.email; }
    }
  } catch { /* auth not set */ }

  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined) ctx[k] = v;
  }

  return ctx;
}
