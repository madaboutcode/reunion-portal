/**
 * CONTRACT: Registration-desk HTTP routes (see
 * docs/specs/interfaces/registration-desk-api.ispec.md and
 * docs/specs/access-control.spec.md R6 "registration_desk" section).
 *
 * GUARANTEE: SCOPE_GATE — every route requires a valid staff/admin JWT AND
 *   the registration_desk scope (router-level chain: authMiddleware →
 *   requireRole('staff','admin') → requireScope('registration_desk')). Admin
 *   bypasses scope via the existing requireScope behavior. Attendee JWTs are
 *   rejected (ispec R1/R1.1). The registration_desk scope grants nothing
 *   else. The one aggregate endpoint (GET /stats) returns roster COUNTS only
 *   (totals + present, by participation type) — never registration data — so
 *   it stays within the desk allowlist and reaches no dashboard endpoint.
 *
 * GUARANTEE: BOUNDARY_VALIDATION — query/header/body validation happens at
 *   the HTTP boundary (422 before any service/DB access): empty search query,
 *   missing Idempotency-Key, malformed request body (deskSpotRegistrationSchema
 *   strict allowlist). Unknown body fields are rejected, never stripped.
 *
 * GUARANTEE: SAFE_ERRORS — every error response is `{ error: string }` with
 *   optional `details.fieldErrors` (ispec R6). No stack traces, SQL text,
 *   storage keys, or registration payloads leak.
 *
 * GUARANTEE: PHOTO_NEVER_LEAKS_KEY — the photo endpoint serves image data and
 *   never returns the underlying storage key (registration-desk.spec.md R3.3).
 *   404 when no photo exists or the registration is missing/donation-only.
 *   The optional `size` query is allowlisted to 200 | 560 | 960; 200 serves
 *   the private thumbnail, 560/960 read the private original ONLY inside the
 *   server, resize it through the Images binding to a square face-cropped
 *   JPEG, and return those bytes — the original key/bytes never cross the
 *   route (2026-08-12 plan "Photo variant request"). All responses use
 *   `Cache-Control: private, max-age=86400`. An invalid size is a 422 before
 *   any storage read.
 *
 * GUARANTEE: SPOT_PHOTO_FINALIZE_OFF_RESPONSE_PATH — a freshly created spot
 *   registration with a photo has its pending photo relocated and its
 *   thumbnail generated+published via c.executionCtx.waitUntil(
 *   c.var.registrationService.relocateFiles(id, regCode)) — the SAME method
 *   self-registration uses (registration.routes.ts). This never runs on an
 *   idempotent replay, and never blocks or fails the 200 response — failures
 *   are swallowed inside relocateFiles/PhotoThumbnailService.
 *
 * EXPECTS: c.var.deskService, c.var.deskRepo, c.var.fileStorage,
 *   c.var.registrationRepo, c.var.registrationService, and
 *   c.var.systemAuditRepo are set by the DI middleware in app.ts.
 *
 * FAILURE BEHAVIOR: NotFoundError → 404; AppError → its status (409);
 *   DeskStateError and unexpected errors → 500 through the global error
 *   handler. Validation failures → 422 here (the global handler maps the
 *   shared ValidationError to 400, so desk validation is handled locally).
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { authMiddleware, requireRole, requireScope } from '../middleware/auth.middleware.js';
import { setRequestMeta } from '../infra/request-meta.js';
import { deskSpotRegistrationSchema, deskCollectPaymentSchema, deskAddChargeSchema, REG_CODE_PREFIX } from '@smriti/shared';
import type { DeskSpotRegistrationInput } from '../domain/desk-types.js';

export const registrationDeskRoutes = new Hono<AppEnv>();

registrationDeskRoutes.use('*', authMiddleware, requireRole('staff', 'admin'), requireScope('registration_desk'));

/** Normalizes a pass code: strips hyphens, trims, uppercases. */
function normalizePassCode(raw: string): string {
  return raw.replace(/-/g, '').trim().toUpperCase();
}

function isWellFormedPassCode(code: string): boolean {
  return code.startsWith(REG_CODE_PREFIX) && code.length === 16;
}

/** Maps zod issues to a { field: message } record, first error per field. */
function collectFieldErrors(result: { error: import('zod').ZodError }): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    if (!errors[path]) errors[path] = issue.message;
  }
  return errors;
}

// ---------------------------------------------------------------------------
// GET /staff/desk/search?q=<text>  (ispec R2)
// ---------------------------------------------------------------------------

registrationDeskRoutes.get('/search', async (c) => {
  const q = c.req.query('q') ?? '';
  if (!q.trim()) {
    return c.json({ error: 'Search query is required' }, 422);
  }
  setRequestMeta(c, { reqType: 'desk:search' });
  const thumbsBaseUrl = c.env.PUBLIC_THUMBS_URL ?? '/api/public/photos';
  const response = await c.var.deskService.search(q, thumbsBaseUrl);
  return c.json(response);
});

// ---------------------------------------------------------------------------
// GET /staff/desk/stats  — live roster counts for the desk footer
// ---------------------------------------------------------------------------

registrationDeskRoutes.get('/stats', async (c) => {
  setRequestMeta(c, { reqType: 'desk:stats' });
  const stats = await c.var.deskService.getStats();
  return c.json(stats);
});

// ---------------------------------------------------------------------------
// GET /staff/desk/lookup?code=<regCode>  (ispec R3)
// ---------------------------------------------------------------------------

registrationDeskRoutes.get('/lookup', async (c) => {
  const code = normalizePassCode(c.req.query('code') ?? '');
  if (!isWellFormedPassCode(code)) {
    // Unknown or malformed code -> 404, no existence leak (ispec R3.2).
    return c.json({ error: 'Attendee not found' }, 404);
  }
  setRequestMeta(c, { reqType: 'desk:lookup', regCode: code });
  const response = await c.var.deskService.lookupByCode(code);
  return c.json(response);
});

// ---------------------------------------------------------------------------
// GET /staff/desk/registrations/:id/photo  (ispec R3.3)
// ---------------------------------------------------------------------------

/** Allowlisted photo sizes (2026-08-12 plan "Photo variant request"). 200 is
 *  the existing private thumbnail; 560 (mobile) and 960 (desktop) are
 *  server-resized square face-cropped JPEGs. Anything else is rejected before
 *  any storage read — an invalid size never selects arbitrary storage. */
const DESK_PHOTO_SIZES = new Set(['200', '560', '960']);

/** Private 24-hour cache for all desk photo responses (plan Data Models). */
const DESK_PHOTO_CACHE_CONTROL = 'private, max-age=86400';

registrationDeskRoutes.get('/registrations/:id/photo', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Attendee not found' }, 404);
  }
  const requestedSize = c.req.query('size') ?? '200';
  if (!DESK_PHOTO_SIZES.has(requestedSize)) {
    return c.json({ error: 'Invalid photo size' }, 422);
  }
  setRequestMeta(c, { reqType: 'desk:photo', regId: id, photoSize: requestedSize });

  const reg = await c.var.registrationRepo.findById(id);
  if (!reg || reg.participationType === 'donation_only' || !reg.photoThumbKey) {
    return c.json({ error: 'Photo not found' }, 404);
  }

  if (requestedSize === '200') {
    const file = await c.var.fileStorage.get(reg.photoThumbKey);
    if (!file) {
      return c.json({ error: 'Photo not found' }, 404);
    }
    // Never returns the storage key — only image data (spec R3.3).
    return new Response(file.body, {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Length': String(file.size),
        'Cache-Control': DESK_PHOTO_CACHE_CONTROL,
      },
    });
  }

  // Larger variants: the private ORIGINAL is read only inside the server and
  // resized through the Images binding to a square face-cropped JPEG. Neither
  // the original key nor the original bytes cross the route (plan Data Models
  // — 560/960). The client keeps the already-loaded 200px thumbnail when this
  // fails, so a 500 here is honest but non-fatal.
  if (!reg.photoFileKey) {
    return c.json({ error: 'Photo not found' }, 404);
  }
  const images = c.env.IMAGES;
  if (!images) {
    return c.json({ error: 'Image processing is not configured' }, 500);
  }
  const original = await c.var.fileStorage.get(reg.photoFileKey);
  if (!original) {
    return c.json({ error: 'Photo not found' }, 404);
  }

  const size = Number(requestedSize);
  const outputHandle = await images
    .input(original.body)
    .transform({ width: size, height: size, fit: 'cover', gravity: 'face' })
    .output({ format: 'image/jpeg', quality: 80 });
  const resized = await outputHandle.response().arrayBuffer();

  return new Response(resized, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(resized.byteLength),
      'Cache-Control': DESK_PHOTO_CACHE_CONTROL,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /staff/desk/registrations/:id/present  (ispec R4)
// ---------------------------------------------------------------------------

registrationDeskRoutes.post('/registrations/:id/present', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Attendee not found' }, 404);
  }
  const auth = c.var.auth;
  const staffAuth = auth as { role: 'staff' | 'admin'; userId: number; email: string };
  setRequestMeta(c, { reqType: 'desk:checkin', regId: id, userId: staffAuth.userId });

  const response = await c.var.deskService.checkIn(id, {
    userId: staffAuth.userId,
    email: staffAuth.email,
  });
  return c.json(response);
});

// ---------------------------------------------------------------------------
// POST /staff/desk/registrations/:id/absent  (ispec R4.5 — undo check-in)
// ---------------------------------------------------------------------------
//
// Symmetric to /present. Desk operators make mistakes (wrong row scanned,
// attendee turned out not to be who they claimed). The undo clears the
// checked_in_at/checked_in_by columns, writes a separate audit action
// ('attendee_check_in_undone'), and is idempotent — a repeat undo on an
// already-absent registration is a no-op, no second audit row.

registrationDeskRoutes.post('/registrations/:id/absent', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Attendee not found' }, 404);
  }
  const auth = c.var.auth;
  const staffAuth = auth as { role: 'staff' | 'admin'; userId: number; email: string };
  setRequestMeta(c, { reqType: 'desk:checkin-undo', regId: id, userId: staffAuth.userId });

  const response = await c.var.deskService.unmarkPresent(id, {
    userId: staffAuth.userId,
    email: staffAuth.email,
  });
  return c.json(response);
});

// ---------------------------------------------------------------------------
// POST /staff/desk/registrations/:id/payment  — collect payment in person
// (desk-payment-collection plan, req #1). Settles the FULL outstanding
// balance; there is no partial-amount field by design.
// ---------------------------------------------------------------------------

registrationDeskRoutes.post('/registrations/:id/payment', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Attendee not found' }, 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 422);
  }

  const parsed = deskCollectPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: collectFieldErrors(parsed) } },
      422,
    );
  }

  const auth = c.var.auth;
  const staffAuth = auth as { role: 'staff' | 'admin'; userId: number; email: string };
  setRequestMeta(c, { reqType: 'desk:collect-payment', regId: id, userId: staffAuth.userId });

  const response = await c.var.deskService.settleDeskPayment(
    id,
    parsed.data.method,
    parsed.data.note,
    { userId: staffAuth.userId, email: staffAuth.email },
  );
  return c.json(response);
});

// ---------------------------------------------------------------------------
// POST /staff/desk/registrations/:id/charge  — add an ad-hoc charge
// (desk-payment-collection plan, req #2). Reuses the same charge pipeline the
// staff dashboard uses, and sends the same additional-payment/revised-payment
// notification the staff edit page sends for a cost-affecting save.
// ---------------------------------------------------------------------------

registrationDeskRoutes.post('/registrations/:id/charge', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Attendee not found' }, 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 422);
  }

  const parsed = deskAddChargeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: collectFieldErrors(parsed) } },
      422,
    );
  }

  const auth = c.var.auth;
  const staffAuth = auth as { role: 'staff' | 'admin'; userId: number; email: string };
  setRequestMeta(c, { reqType: 'desk:add-charge', regId: id, userId: staffAuth.userId });

  const response = await c.var.deskService.addDeskCharge(
    id,
    parsed.data.description,
    parsed.data.amount,
    { userId: staffAuth.userId, email: staffAuth.email },
  );
  return c.json(response);
});

// ---------------------------------------------------------------------------
// POST /staff/desk/registrations  (ispec R5 — spot registration)
// ---------------------------------------------------------------------------

registrationDeskRoutes.post('/registrations', async (c) => {
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim() ?? '';
  if (!idempotencyKey) {
    return c.json({ error: 'Idempotency-Key is required' }, 422);
  }
  setRequestMeta(c, { reqType: 'desk:spot-registration' });

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 422);
  }

  const parsed = deskSpotRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: collectFieldErrors(parsed) } },
      422,
    );
  }

  const auth = c.var.auth;
  const staffAuth = auth as { role: 'staff' | 'admin'; userId: number; email: string };
  const result = await c.var.deskService.createSpotRegistration(
    parsed.data as DeskSpotRegistrationInput,
    { userId: staffAuth.userId, email: staffAuth.email },
    idempotencyKey,
  );

  // Finalize the photo off the response path — the SAME step self-registration
  // runs via registration.routes.ts: relocateFiles() moves the pending photo
  // from photos/pending/ to registrations/{regCode}/photo.{ext}, then
  // generates and publishes the thumbnail from the relocated key. Only for a
  // freshly created registration with a photo — an idempotent replay already
  // went through this on the original request that created the row.
  // Failure is swallowed inside relocateFiles/PhotoThumbnailService and can
  // never fail the spot registration itself (already committed above).
  if (!result.replay && parsed.data.photoFileKey) {
    const registrationId = result.body.registration.id;
    const regCode = result.body.registration.regCode;
    c.executionCtx.waitUntil(
      c.var.registrationService.relocateFiles(registrationId, regCode),
    );
  }

  return c.json(result.body);
});
