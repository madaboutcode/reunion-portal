/**
 * CONTRACT
 *
 * GUARANTEE: ENUMERATION_SAFE — POST /magic-link always returns 200 regardless
 *   of whether the email exists, is deactivated, or causes an internal error.
 *   The caller cannot distinguish "email sent" from "no identity found".
 *
 * GUARANTEE: TOKEN_VALIDATION — GET /verify returns 401 with
 *   { "error": "Invalid or expired link" } for any invalid, expired, or
 *   already-used token. Returns 200 with { token, role, redirectTo } on success.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { AuthError } from '../services/errors.js';
import { rateLimitByCategory } from '../middleware/rate-limit.js';
import { createLogger } from '../infra/logger.js';
import { setRequestMeta } from '../infra/request-meta.js';

const log = createLogger('auth');

export const authRoutes = new Hono<AppEnv>();

// POST /magic-link
// R3 — Requests a magic link for any role (staff, admin, or attendee).
authRoutes.post('/magic-link', rateLimitByCategory("auth"), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'email is required' }, 400);
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).email !== 'string'
  ) {
    return c.json({ error: 'email is required' }, 400);
  }

  const email = (body as Record<string, unknown>).email as string;
  const rawReturnTo = (body as Record<string, unknown>).returnTo;
  const returnTo = typeof rawReturnTo === 'string' && rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//')
    ? rawReturnTo
    : undefined;
  setRequestMeta(c, { reqType: 'auth:magic-link', email });

  // Always return 200 — never reveal whether email exists (R3.3)
  try {
    await c.var.authService.requestMagicLink(email, returnTo);
  } catch (err) {
    log.error('Magic link request failed (suppressed for enumeration safety)', { error: (err as Error).message });
  }

  return c.json(
    { ok: true, message: 'If an account exists, a login link has been sent.' },
    200,
  );
});

// POST /payment-link
// Requests a fresh payment magic link for a registration identified by regCode.
// Enumeration-safe: always returns 200 regardless of whether the regCode exists.
authRoutes.post('/payment-link', rateLimitByCategory("auth"), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'regCode is required' }, 400);
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).regCode !== 'string' ||
    !(body as Record<string, unknown>).regCode
  ) {
    return c.json({ error: 'regCode is required' }, 400);
  }

  const regCode = (body as Record<string, unknown>).regCode as string;
  setRequestMeta(c, { reqType: 'auth:payment-link', regCode });

  // Always return 200 — never reveal whether registration exists
  try {
    await c.var.authService.requestPaymentLink(regCode);
  } catch (err) {
    log.error('Payment link request failed (suppressed for enumeration safety)', { error: (err as Error).message });
  }

  return c.json(
    { ok: true, message: 'If a registration exists, a payment link has been sent to the registered email.' },
    200,
  );
});

// GET /verify
// R4 — Verifies a magic link token and issues a JWT.
authRoutes.get('/verify', rateLimitByCategory("auth"), async (c) => {
  setRequestMeta(c, { reqType: 'auth:verify' });
  const token = c.req.query('token');

  if (!token) {
    return c.json({ error: 'token is required' }, 400);
  }

  try {
    const { jwt, role, redirectTo, email, sub } = await c.var.authService.verifyMagicLink(token);

    const response: Record<string, unknown> = { token: jwt, role, redirectTo, sub };
    if (email) response.email = email;

    return c.json(response, 200);
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json({ error: 'Invalid or expired link' }, 401);
    }
    throw err;
  }
});
