/**
 * CONTRACT
 *
 * GUARANTEE: DEV_ONLY — These routes are only registered when
 *   c.env.ENVIRONMENT === "development". They are never reachable in
 *   production. The client-side DebugToolsPage that calls these routes
 *   is also stripped from production builds (import.meta.env.DEV gate).
 *
 * GUARANTEE: VERIFY_PAYMENT — POST /debug/verify-payment reads the
 *   registration ID from the Authorization header (Bearer token, decoded
 *   without signature verification — dev shortcut), finds the most recent
 *   payment for that registration, updates payment status to 'verified',
 *   updates registration status to 'confirmed', and returns
 *   { status: "confirmed" }.
 *
 * GUARANTEE: REG_NOT_FOUND — Returns 404 if no registration exists for
 *   the decoded registration ID.
 *
 * GUARANTEE: NO_PAYMENT — Returns 409 if no payment record exists for
 *   the registration.
 *
 * EXPECTS: The token in the Authorization header is a JWT whose payload
 *   contains a numeric `sub` field (registration ID). The signature is NOT
 *   verified — this endpoint is intentionally a dev bypass.
 *
 * EXPECTS: This router is only mounted by index.ts when ENVIRONMENT === "development".
 *
 * FAILURE BEHAVIOR: Missing Authorization header returns 401.
 *   Malformed token (not decodable as base64 JSON) returns 401.
 *   DB errors propagate as thrown errors (caught by global error middleware).
 */

import { requireVar } from '../lib/site-config.js';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { MailgunEmailService } from '../infra/email.service.js';
import { D1AuthRepository } from '../repositories/auth.repo.js';
import { toRegistration, calculateTotal } from '@smriti/shared';
import type { WizardDraft } from '@smriti/shared';

const routes = new Hono<AppEnv>();

/**
 * Decode a JWT payload without signature verification.
 * Returns the parsed payload object or null on failure.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // Standard base64url → base64 → JSON
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

routes.post('/verify-payment', async (c) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization header' }, 401);
  }

  const token = header.slice(7);
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.sub !== 'string' && typeof payload.sub !== 'number') {
    return c.json({ error: 'Invalid token — cannot decode registration ID' }, 401);
  }

  const registrationId = Number(payload.sub);
  if (!Number.isFinite(registrationId) || registrationId <= 0) {
    return c.json({ error: 'Invalid registration ID in token' }, 401);
  }

  const { registrationService } = c.var;

  // Confirm registration exists
  const result = await registrationService.getByToken(registrationId);
  if (!result) {
    return c.json({ error: 'Registration not found' }, 404);
  }

  // Force-update payment and registration status, bypassing transition guards
  // (debug shortcut — may be in any state when triggered)
  const db = c.env.DB;

  // Find most recent payment
  const { results: paymentRows } = await db
    .prepare('SELECT id, status FROM payments WHERE registration_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(registrationId)
    .all<{ id: number; status: string }>();

  if (paymentRows.length === 0) {
    return c.json({ error: 'No payment record found for this registration' }, 409);
  }

  const payment = paymentRows[0];

  // Update payment to verified
  await db
    .prepare('UPDATE payments SET status = ?, updated_at = (unixepoch() * 1000) WHERE id = ?')
    .bind('verified', payment.id)
    .run();

  // Update registration to confirmed
  await db
    .prepare('UPDATE registrations SET status = ?, updated_at = (unixepoch() * 1000) WHERE id = ?')
    .bind('confirmed', registrationId)
    .run();

  return c.json({ status: 'confirmed' });
});

routes.post('/send-test-email', async (c) => {
  const body = await c.req.json<{ to: string; template?: string }>();
  if (!body.to) {
    return c.json({ error: 'Missing "to" field' }, 400);
  }

  if (!c.env.MAILGUN_API_KEY || !c.env.MAILGUN_DOMAIN) {
    return c.json({ error: 'MAILGUN_API_KEY and MAILGUN_DOMAIN not configured' }, 500);
  }

  const appBaseUrl = requireVar(c.env, 'APP_BASE_URL');
  const mailer = new MailgunEmailService(c.env.MAILGUN_API_KEY, c.env.MAILGUN_DOMAIN, [], undefined, appBaseUrl, requireVar(c.env, 'SENDER_NAME'));

  // Representative family draft — private room, 2 nights, spouse + child age 8, explicit extraBed, donation
  // pricingBreakup is computed by the real engine so line labels and amounts are always accurate
  const previewDraft: WizardDraft = {
    fullName: 'Ravi Kumar',
    branch: 'Computer Science & Engineering',
    gender: 'male',
    email: 'preview@example.com',
    whatsapp: '+919876543210',
    city: 'Kochi',
    country: 'India',
    attendanceIntent: 'attending',
    participationType: 'full_celebration',
    alumniMeal: 'non_veg',
    tshirtSize: 'L',
    spouseName: 'Priya Kumar',
    spouseMeal: 'veg',
    children: [{ id: 'c1', name: 'Arjun Kumar', age: 8, meal: 'non_veg' }],
    guests: [],
    accommodation: 'private',
    extraBed: true,
    checkIn: '2026-08-14',
    checkOut: '2026-08-16',
    donationAmount: '500',
    publicAcknowledgement: false,
    acknowledgementDisplayName: '',
    felicitationConsent: false,
    idFileName: '',
    collegeContribution: 500,
    collegeContributionCause: 'green_energy',
    photoFileName: '',
    idNote: '',
  };
  const previewReg = toRegistration(previewDraft);
  const previewBreakup = calculateTotal(previewReg);
  const previewAccommodation = previewReg.accommodation;

  if (body.template === 'confirmation') {
    await mailer.sendConfirmation(body.to, {
      regId: '999',
      regCode: 'SM26-TEST',
      fullName: previewDraft.fullName,
      totalAmount: previewBreakup.total,
      attendanceIntent: previewDraft.attendanceIntent,
      participationType: previewDraft.participationType,
      alumniMeal: previewDraft.alumniMeal,
      tshirtSize: previewDraft.tshirtSize ?? null,
      spouseName: previewReg.attendees.spouse?.name ?? null,
      childCount: previewReg.attendees.children.length,
      guestCount: previewReg.attendees.guests.length,
      accommodation: previewAccommodation?.type ?? 'none',
      checkIn: previewAccommodation?.checkIn ?? null,
      checkOut: previewAccommodation?.checkOut ?? null,
      extraBed: previewAccommodation?.extraBed ?? false,
      pricingBreakup: previewBreakup,
      paymentUrl: `http://localhost:5173/pay/SM26TEST?code=preview-token`,
    });
  } else if (body.template === 'magic-link') {
    await mailer.sendMagicLink(body.to, {
      token: `${appBaseUrl}/auth/verify?token=test-token-123`,
      expiresIn: 30,
    });
  } else if (body.template === 'payment-confirmed') {
    await mailer.sendPaymentConfirmed(body.to, {
      fullName: previewDraft.fullName,
      regCode: 'SMRTTEST00000001',
      payments: [{ amount: previewBreakup.total, referenceId: 'UTR-TEST-98765', date: Date.now() }],
      branch: previewDraft.branch,
      attendanceIntent: previewDraft.attendanceIntent,
      participationType: previewDraft.participationType,
      alumniMeal: previewDraft.alumniMeal,
      tshirtSize: previewDraft.tshirtSize ?? null,
      spouseName: previewReg.attendees.spouse?.name ?? null,
      childCount: previewReg.attendees.children.length,
      guestCount: previewReg.attendees.guests.length,
      accommodation: previewAccommodation?.type ?? 'none',
      checkIn: previewAccommodation?.checkIn ?? null,
      checkOut: previewAccommodation?.checkOut ?? null,
      extraBed: previewAccommodation?.extraBed ?? false,
      pricingBreakup: previewBreakup,
      passUrl: `${appBaseUrl}/pass#SMRTTEST00000001`,
    });
  } else {
    await mailer.sendTest(body.to, 'Smriti 2026 — Test Email', 'If you can read this, Mailgun is working.');
  }

  return c.json({ ok: true, sent_to: body.to, template: body.template ?? 'plain' });
});

routes.post('/magic-link', async (c) => {
  const body = await c.req.json<{ email: string }>();
  if (!body.email) {
    return c.json({ error: 'Missing "email" field' }, 400);
  }

  const email = body.email.trim().toLowerCase();
  const db = c.env.DB;

  // Resolve identity: users table first, then registrations
  const { results: userRows } = await db
    .prepare('SELECT id, email, role, is_active FROM users WHERE LOWER(email) = ? LIMIT 1')
    .bind(email)
    .all<{ id: number; email: string; role: string; is_active: number }>();

  let identity: { type: 'user'; userId: number; role: string } | { type: 'attendee'; registrationId: number } | null = null;

  if (userRows.length > 0) {
    const user = userRows[0];
    if (!user.is_active) {
      return c.json({ error: 'User is deactivated', email }, 403);
    }
    identity = { type: 'user', userId: user.id, role: user.role };
  } else {
    const { results: regRows } = await db
      .prepare('SELECT id FROM registrations WHERE LOWER(email) = ? ORDER BY created_at DESC LIMIT 1')
      .bind(email)
      .all<{ id: number }>();

    if (regRows.length > 0) {
      identity = { type: 'attendee', registrationId: regRows[0].id };
    }
  }

  if (!identity) {
    return c.json({ error: 'No user or registration found for this email', email }, 404);
  }

  // Generate token and store hash
  const rawToken = crypto.randomUUID();
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawToken));
  const tokenHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  const expiresAt = Date.now() + 10 * 60 * 1000;

  const authRepo = new D1AuthRepository(db);
  if (identity.type === 'user') {
    await authRepo.createMagicLink(tokenHash, expiresAt, { userId: identity.userId });
  } else {
    await authRepo.createMagicLink(tokenHash, expiresAt, { registrationId: identity.registrationId });
  }

  const magicLinkUrl = `http://localhost:5173/auth/verify?token=${rawToken}`;

  return c.json({
    ok: true,
    email,
    identity: identity.type === 'user' ? { type: 'user', role: identity.role } : { type: 'attendee' },
    magicLink: magicLinkUrl,
    expiresIn: '10 minutes',
  });
});

export { routes as debugRoutes };
