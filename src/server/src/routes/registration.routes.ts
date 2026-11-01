import { Hono } from 'hono';
import { REG_CODE_PREFIX } from '@smriti/shared';
import type { AppEnv } from '../env.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { requireFeatureFlag } from '../middleware/require-feature-flag.js';
import { ForbiddenError } from '../services/errors.js';
import { rateLimitByCategory } from '../middleware/rate-limit.js';
import { setRequestMeta } from '../infra/request-meta.js';

const routes = new Hono<AppEnv>();

routes.post(
  '/registrations',
  requireFeatureFlag('registration_accept_new', {
    disabledStatus: 403,
    disabledBody: { error: 'Registration is currently closed', code: 'REGISTRATION_CLOSED' },
  }),
  rateLimitByCategory("mutation"),
  async (c) => {
  const body = await c.req.json();
  setRequestMeta(c, { reqType: 'registration:submit', email: body?.email, fullName: body?.fullName });
  const result = await c.var.registrationService.submit(body);
  // Relocate uploaded files to registrations/{regCode}/ in the background.
  // Response returns immediately; relocation runs via waitUntil.
  c.executionCtx.waitUntil(
    c.var.registrationService.relocateFiles(Number(result.regId), result.regCode),
  );
  return c.json(result, 201);
});

routes.get('/registrations/me', authMiddleware, async (c) => {
  const auth = c.get('auth');
  if (auth.role !== 'attendee') throw new ForbiddenError();
  const regId = auth.registrationId;
  const [result, pendingPayment, verifiedTotal] = await Promise.all([
    c.var.registrationService.getByToken(regId),
    c.var.paymentRepo.findPendingByRegistration(regId),
    c.var.paymentRepo.sumVerifiedByRegistration(regId),
  ]);
  return c.json({
    registration: {
      ...result.registration,
      pendingPaymentAmount: pendingPayment?.amount ?? null,
      hasVerifiedPayments: verifiedTotal > 0,
      verifiedPaymentAmount: verifiedTotal,
    },
  });
});

routes.get('/registrations/check-email', rateLimitByCategory("query"), async (c) => {
  const email = c.req.query('email');
  setRequestMeta(c, { reqType: 'registration:check-email', email: email ?? undefined });
  if (!email || typeof email !== 'string' || email.trim() === '') {
    return c.json({ error: 'Missing email parameter' }, 400);
  }

  const existing = await c.var.registrationRepo.findByEmail(email.trim().toLowerCase());
  return c.json({ registered: existing.length > 0 });
});

routes.get('/registrations/:id', authMiddleware, async (c) => {
  const auth = c.get('auth');
  if (auth.role !== 'attendee') throw new ForbiddenError();
  const param = c.req.param('id')!;
  if (!/^\d+$/.test(param)) throw new ForbiddenError();
  const regId = Number(param);
  if (auth.registrationId !== regId) throw new ForbiddenError();
  const [result, pendingPayment, verifiedTotal] = await Promise.all([
    c.var.registrationService.getByToken(regId),
    c.var.paymentRepo.findPendingByRegistration(regId),
    c.var.paymentRepo.sumVerifiedByRegistration(regId),
  ]);
  return c.json({
    registration: {
      ...result.registration,
      pendingPaymentAmount: pendingPayment?.amount ?? null,
      hasVerifiedPayments: verifiedTotal > 0,
      verifiedPaymentAmount: verifiedTotal,
    },
  });
});

routes.post('/registrations/lookup', rateLimitByCategory("query"), async (c) => {
  setRequestMeta(c, { reqType: 'registration:lookup' });
  const { regCode } = await c.req.json();
  if (typeof regCode !== 'string' || !regCode.trim()) {
    return c.json({ error: 'regCode is required' }, 400);
  }
  const normalized = regCode.replace(/-/g, '').trim().toUpperCase();
  if (!normalized.startsWith(REG_CODE_PREFIX) || normalized.length !== 16) {
    return c.json({ error: 'Invalid pass code format' }, 400);
  }
  const result = await c.var.registrationService.getPassData(normalized);
  return c.json(result);
});

export { routes as registrationRoutes };
