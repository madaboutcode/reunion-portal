/**
 * CONTRACT
 *
 * GUARANTEES:
 *   - AUTH_GUARD — All routes require a valid JWT with role 'staff' or 'admin'
 *     and the 'allocation' scope (admins and full-access staff bypass the
 *     scope check — see requireScope). Missing/invalid token returns 401.
 *     Wrong role returns 403. Missing scope returns 403.
 *
 *   - LIST_ELIGIBLE — GET /registrations (spec staff-api.spec.md R27) returns
 *     every registration with accommodation IN ('shared_double',
 *     'shared_triple', 'private'), flat and ungrouped, with outgoing/incoming
 *     preference counts, status, updatedAt, and pendingAmount. Includes each
 *     registration's full outgoing preferences inline (with isMutual computed
 *     via a JS pair-set, not per-row correlated subquery) and a prefsVersion
 *     (MAX updated_at over that registration's preference rows). This
 *     eliminates the client's N+1 per-registration preference fetches.
 *     Ordered by accommodationType, gender, fullName. pendingAmount
 *     (total_amount minus verified-payment sum) is null when status is
 *     'confirmed' (R27.8); total_amount and the verified sum are query-
 *     internal only, never serialized (access-control.spec.md R2.6).
 *
 *   - GET_PREFERENCES — GET /registrations/:id/preferences (R28) returns the
 *     registration's outgoing preferences ordered by preferenceOrder, with
 *     isMutual computed read-time via a correlated EXISTS check. 404 if the
 *     registration doesn't exist. Empty array (not 404) when it exists with
 *     no preferences.
 *
 *   - REPLACE_PREFERENCES — PUT /registrations/:id/preferences (R29) fully
 *     replaces the registration's outgoing preferences. Validates structural
 *     constraints (max 5, unique preferenceOrder) and per-entry constraints
 *     (self-preference, existence, shared accommodation, matching
 *     accommodation type, matching gender) before any write — all-or-nothing.
 *     422 with { error, details: { invalid: [{ preferredRegistrationId,
 *     reason }] } } on any validation failure. 404 if :id doesn't exist.
 *     DELETE + INSERT run via c.env.DB.batch() (implicit transaction).
 *     Audits 'preferences_updated'.
 *
 *   - CLEAR_PREFERENCES — DELETE /registrations/:id/preferences (R30) deletes
 *     all outgoing preferences for :id only (incoming preferences from other
 *     registrations are untouched). 404 if :id doesn't exist. 204 on success.
 *     Audits 'preferences_deleted' with the deleted count.
 *
 *   - GENERATE_PAYMENT_LINK — POST /registrations/:id/payment-link (R42)
 *     returns a single-use, 24h payment link for a listed registration that
 *     is not yet 'confirmed'. 404 if :id doesn't exist. 409 if the
 *     registration is already 'confirmed'. No email is sent — link delivery
 *     is the branch rep's job. Audits 'payment_link_generated'. Response
 *     carries only { link } — no amounts, totals, or payment history
 *     (access-control.spec.md R2.6).
 *
 *   - CONVERT_ACCOMMODATION — PUT /registrations/:id/accommodation (R41)
 *     converts a confirmed-or-pending shared_triple registration to
 *     shared_double — one-way only. Route-owned guards, in order: 422 on a
 *     missing/malformed body (R41.1), 404 on a non-numeric or unknown :id
 *     (R41.2, same convention as every other endpoint in this file), 422 if
 *     current accommodation isn't shared_triple or requested isn't
 *     shared_double (R41.3). Everything past those guards delegates to
 *     c.var.editService.edit(), which owns pricing recompute, the
 *     payment_pending delta row, status re-derivation, audit, and the
 *     fire-and-forget payment email (R41.6) — including its own 409s
 *     (stale updatedAt, R41.4; pending_verification payment, R41.5;
 *     shared-double inventory at capacity, R41.5.1, inherited automatically
 *     via the shared edit path, not bypassed). The route re-implements none
 *     of EditService's guards — any AppError it throws is passed through
 *     verbatim (status + message), per R41.4/R41.5/R41.5.1's specced bodies
 *     now matching EditService's actual text exactly. Preference rows are
 *     untouched (R41.7) — the edit path has no preference-cleanup step and
 *     none is added. Response is exactly { accommodationType, status,
 *     pendingAmount, updatedAt } (R41.8); pendingAmount is null when the
 *     post-conversion status is 'confirmed', else the edit's own delta.
 *
 * EXPECTS:
 *   - c.env.DB is a live D1Database binding.
 *   - c.var.systemAuditRepo is set by the DI middleware in app.ts.
 *   - c.var.authService is set by the DI middleware in app.ts (GENERATE_PAYMENT_LINK).
 *   - c.var.editService is set by the DI middleware in app.ts (CONVERT_ACCOMMODATION).
 *   - Auth context: c.var.auth.role === 'staff' | 'admin', c.var.auth.userId,
 *     c.var.auth.email.
 *
 * FAILURE BEHAVIOR:
 *   - 404 returned when the path registration id doesn't resolve to a row.
 *   - 422 returned for structural/constraint validation failures on PUT.
 *   - Non-AppError exceptions from c.var.editService.edit() propagate through
 *     the global error handler as 500 (EditService's own contract).
 *   - D1 errors propagate through the global error handler.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { authMiddleware, requireRole, requireScope } from '../middleware/auth.middleware.js';
import { setRequestMeta } from '../infra/request-meta.js';

export const allocationRoutes = new Hono<AppEnv>();

allocationRoutes.use('*', authMiddleware, requireRole('staff', 'admin'), requireScope('allocation'));

const SHARED_ACCOMMODATION_TYPES = new Set(['shared_double', 'shared_triple']);

interface EligibleRegistrationRow {
  id: number;
  reg_code: string;
  full_name: string;
  branch: string;
  gender: string | null;
  email: string;
  whatsapp: string;
  photo_thumb_key: string | null;
  accommodation: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  updated_at: number;
  total_amount: number;
  verified_sum: number | null;
  preference_count: number;
  incoming_preference_count: number;
}

interface PreferenceDetailRow {
  preferred_registration_id: number;
  preference_order: number;
  reg_code: string;
  full_name: string;
  branch: string;
  gender: string | null;
  is_mutual: number;
  updated_at: number;
}

interface RegistrationLookupRow {
  id: number;
  accommodation: string;
  gender: string | null;
}

function toPhotoThumbUrl(id: number, photoThumbKey: string | null, publicThumbsUrl: string | undefined): string | null {
  if (!photoThumbKey || !publicThumbsUrl) return null;
  return `${publicThumbsUrl}/${id}.jpg`;
}

async function loadPreferencesWithVersion(db: D1Database, registrationId: number) {
  const result = await db
    .prepare(
      `SELECT rp.preferred_registration_id, rp.preference_order,
              r.reg_code, r.full_name, r.branch, r.gender,
              rp.updated_at,
              CASE WHEN EXISTS (
                SELECT 1 FROM roommate_preferences rp2
                WHERE rp2.registration_id = rp.preferred_registration_id
                  AND rp2.preferred_registration_id = rp.registration_id
              ) THEN 1 ELSE 0 END as is_mutual
       FROM roommate_preferences rp
       JOIN registrations r ON r.id = rp.preferred_registration_id
       WHERE rp.registration_id = ?
       ORDER BY rp.preference_order ASC`,
    )
    .bind(registrationId)
    .all<PreferenceDetailRow>();

  const rows = result.results ?? [];
  const preferences = rows.map((row) => ({
    preferredRegistrationId: row.preferred_registration_id,
    regCode: row.reg_code,
    fullName: row.full_name,
    branch: row.branch,
    gender: row.gender,
    preferenceOrder: row.preference_order,
    isMutual: row.is_mutual === 1,
  }));
  const version = rows.length > 0 ? Math.max(...rows.map((r) => r.updated_at)) : null;

  return { preferences, version };
}

// Per-registration optimistic-concurrency token (spec staff-api.spec.md R28.6):
// MAX(updated_at) across this registration's OUTGOING preference rows only
// (registration_id = :id, never preferred_registration_id). Returns null when
// the registration has no preferences. MAX over zero rows yields a row whose
// version column is NULL, so the `?? null` also covers the no-rows case.
async function getVersion(db: D1Database, registrationId: number): Promise<number | null> {
  const row = await db
    .prepare('SELECT MAX(updated_at) as version FROM roommate_preferences WHERE registration_id = ?')
    .bind(registrationId)
    .first<{ version: number | null }>();
  return row?.version ?? null;
}

// ---------------------------------------------------------------------------
// GET /allocation/registrations (spec staff-api.spec.md R27)
// ---------------------------------------------------------------------------

allocationRoutes.get('/registrations', async (c) => {
  const db = c.env.DB;

  const result = await db
    .prepare(
      `SELECT r.id, r.reg_code, r.full_name, r.branch, r.gender, r.email, r.whatsapp,
              r.photo_thumb_key, r.accommodation, r.check_in, r.check_out,
              r.status, r.updated_at, r.total_amount,
              COALESCE(outgoing.cnt, 0) as preference_count,
              COALESCE(incoming.cnt, 0) as incoming_preference_count,
              verified.verified_sum as verified_sum
       FROM registrations r
       LEFT JOIN (
         SELECT registration_id, COUNT(*) as cnt FROM roommate_preferences GROUP BY registration_id
       ) outgoing ON outgoing.registration_id = r.id
       LEFT JOIN (
         SELECT preferred_registration_id, COUNT(*) as cnt FROM roommate_preferences GROUP BY preferred_registration_id
       ) incoming ON incoming.preferred_registration_id = r.id
       LEFT JOIN (
         SELECT registration_id, SUM(amount) as verified_sum FROM payments WHERE status = 'verified' GROUP BY registration_id
       ) verified ON verified.registration_id = r.id
       WHERE r.accommodation IN ('shared_double', 'shared_triple', 'private')
       ORDER BY r.accommodation ASC, r.gender ASC, r.full_name ASC`,
    )
    .all<EligibleRegistrationRow>();

  const rows = result.results ?? [];
  const publicThumbsUrl = c.env.PUBLIC_THUMBS_URL;

  const prefResult = await db
    .prepare(
      `SELECT rp.registration_id, rp.preferred_registration_id, rp.preference_order,
              r.reg_code, r.full_name, r.branch, r.gender, rp.updated_at
       FROM roommate_preferences rp
       JOIN registrations r ON r.id = rp.preferred_registration_id
       WHERE rp.registration_id IN (
         SELECT id FROM registrations WHERE accommodation IN ('shared_double', 'shared_triple', 'private')
       )
       ORDER BY rp.registration_id, rp.preference_order`,
    )
    .all<{
      registration_id: number;
      preferred_registration_id: number;
      preference_order: number;
      reg_code: string;
      full_name: string;
      branch: string;
      gender: string | null;
      updated_at: number;
    }>();

  const prefRows = prefResult.results ?? [];
  const pairSet = new Set(prefRows.map((r) => `${r.registration_id}:${r.preferred_registration_id}`));

  const prefsByReg = new Map<number, { prefs: typeof prefRows; maxUpdatedAt: number }>();
  for (const row of prefRows) {
    const entry = prefsByReg.get(row.registration_id);
    if (entry) {
      entry.prefs.push(row);
      if (row.updated_at > entry.maxUpdatedAt) entry.maxUpdatedAt = row.updated_at;
    } else {
      prefsByReg.set(row.registration_id, { prefs: [row], maxUpdatedAt: row.updated_at });
    }
  }

  const registrations = rows.map((row) => {
    const prefData = prefsByReg.get(row.id);
    const preferences = prefData
      ? prefData.prefs.map((p) => ({
          preferredRegistrationId: p.preferred_registration_id,
          regCode: p.reg_code,
          fullName: p.full_name,
          branch: p.branch,
          gender: p.gender,
          preferenceOrder: p.preference_order,
          isMutual: pairSet.has(`${p.preferred_registration_id}:${p.registration_id}`),
        }))
      : [];
    return {
      id: row.id,
      regCode: row.reg_code,
      fullName: row.full_name,
      branch: row.branch,
      gender: row.gender,
      email: row.email,
      whatsapp: row.whatsapp,
      photoThumbUrl: toPhotoThumbUrl(row.id, row.photo_thumb_key, publicThumbsUrl),
      accommodationType: row.accommodation,
      checkIn: row.check_in,
      checkOut: row.check_out,
      status: row.status,
      pendingAmount: row.status === 'confirmed' ? null : row.total_amount - (row.verified_sum ?? 0),
      updatedAt: row.updated_at,
      preferenceCount: row.preference_count,
      incomingPreferenceCount: row.incoming_preference_count,
      preferences,
      prefsVersion: prefData?.maxUpdatedAt ?? null,
    };
  });

  return c.json({ registrations, total: registrations.length });
});

// ---------------------------------------------------------------------------
// GET /allocation/registrations/:id/preferences (spec staff-api.spec.md R28)
// ---------------------------------------------------------------------------

allocationRoutes.get('/registrations/:id/preferences', async (c) => {
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const registrationId = Number(idParam);

  const db = c.env.DB;
  const reg = await db
    .prepare('SELECT id, accommodation, gender FROM registrations WHERE id = ?')
    .bind(registrationId)
    .first<RegistrationLookupRow>();

  if (!reg) {
    return c.json({ error: 'Not found' }, 404);
  }

  const { preferences, version } = await loadPreferencesWithVersion(db, registrationId);

  return c.json({ preferences, version });
});

// ---------------------------------------------------------------------------
// PUT /allocation/registrations/:id/preferences (spec staff-api.spec.md R29)
// ---------------------------------------------------------------------------

interface PreferenceInput {
  preferredRegistrationId: number;
  preferenceOrder: number;
}

interface InvalidEntry {
  preferredRegistrationId: number | null;
  reason: string;
}

allocationRoutes.put('/registrations/:id/preferences', async (c) => {
  setRequestMeta(c, { reqType: 'allocation:preferences-replace' });

  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const registrationId = Number(idParam);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // R29.8 — `version` is required. This is a pure body-shape check and, per
  // the R18.2 precedent, runs before any DB lookup (so a missing version
  // surfaces as 422 even when the registration itself doesn't exist). The key
  // must be present; `null` is a legal value meaning "first write".
  if (!('version' in body)) {
    return c.json({ error: 'version is required' }, 422);
  }
  const rawVersion = body['version'];
  if (rawVersion !== null && (typeof rawVersion !== 'number' || !Number.isFinite(rawVersion))) {
    return c.json({ error: 'version must be a number or null' }, 422);
  }
  const providedVersion = rawVersion as number | null;

  const preferencesRaw = body['preferences'];
  if (!Array.isArray(preferencesRaw)) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { preferences: 'Required (array)' } } },
      422,
    );
  }

  const db = c.env.DB;

  const reg = await db
    .prepare('SELECT id, accommodation, gender FROM registrations WHERE id = ?')
    .bind(registrationId)
    .first<RegistrationLookupRow>();

  if (!reg) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (!SHARED_ACCOMMODATION_TYPES.has(reg.accommodation)) {
    return c.json(
      {
        error: 'Preference validation failed',
        details: { invalid: [{ preferredRegistrationId: null, reason: 'Not a shared-accommodation registration' }] },
      },
      422,
    );
  }

  // ── Structural validation ──────────────────────────────────────────────
  const invalid: InvalidEntry[] = [];

  if (preferencesRaw.length > 5) {
    invalid.push({ preferredRegistrationId: null, reason: 'Maximum 5 preferences allowed' });
  }

  const preferences: PreferenceInput[] = [];
  const seenOrders = new Set<number>();
  const seenIds = new Set<number>();

  for (const entry of preferencesRaw) {
    const e = entry as Record<string, unknown>;
    const preferredRegistrationId = Number(e['preferredRegistrationId']);
    const preferenceOrder = Number(e['preferenceOrder']);

    if (!Number.isInteger(preferredRegistrationId)) {
      invalid.push({ preferredRegistrationId: null, reason: 'Registration not found' });
      continue;
    }

    if (
      !Number.isInteger(preferenceOrder) ||
      preferenceOrder < 1 ||
      preferenceOrder > 5
    ) {
      // Not one of the spec's enumerated reason strings — the spec's R29.3
      // "integer 1-5" constraint doesn't map to a listed reason for
      // out-of-range values (as opposed to the listed "Duplicate
      // preferenceOrder" for collisions). Flagging for review.
      invalid.push({ preferredRegistrationId, reason: 'Invalid preferenceOrder' });
      continue;
    }

    if (seenOrders.has(preferenceOrder)) {
      invalid.push({ preferredRegistrationId, reason: 'Duplicate preferenceOrder' });
      continue;
    }
    seenOrders.add(preferenceOrder);

    if (seenIds.has(preferredRegistrationId)) {
      // Duplicate preferredRegistrationId within the request — not one of
      // the spec's enumerated reason strings either (R2.5 implies it via the
      // UNIQUE constraint but staff-api.spec.md R29.4 doesn't list a
      // dedicated reason). Flagging for review.
      invalid.push({ preferredRegistrationId, reason: 'Duplicate preferredRegistrationId' });
      continue;
    }
    seenIds.add(preferredRegistrationId);

    if (preferredRegistrationId === registrationId) {
      invalid.push({ preferredRegistrationId, reason: 'Cannot prefer self' });
      continue;
    }

    preferences.push({ preferredRegistrationId, preferenceOrder });
  }

  // ── Per-entry validation against referenced registrations ───────────────
  if (preferences.length > 0) {
    const ids = preferences.map((p) => p.preferredRegistrationId);
    const placeholders = ids.map(() => '?').join(',');
    const result = await db
      .prepare(`SELECT id, accommodation, gender FROM registrations WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<RegistrationLookupRow>();

    const byId = new Map((result.results ?? []).map((r) => [r.id, r]));

    for (const p of preferences) {
      const preferred = byId.get(p.preferredRegistrationId);
      if (!preferred) {
        invalid.push({ preferredRegistrationId: p.preferredRegistrationId, reason: 'Registration not found' });
        continue;
      }
      if (!SHARED_ACCOMMODATION_TYPES.has(preferred.accommodation)) {
        invalid.push({ preferredRegistrationId: p.preferredRegistrationId, reason: 'Not a shared-accommodation registration' });
        continue;
      }
      if (preferred.accommodation !== reg.accommodation) {
        invalid.push({ preferredRegistrationId: p.preferredRegistrationId, reason: 'Different accommodation type' });
        continue;
      }
      if (preferred.gender !== reg.gender) {
        invalid.push({ preferredRegistrationId: p.preferredRegistrationId, reason: 'Different gender' });
        continue;
      }
    }
  }

  if (invalid.length > 0) {
    return c.json(
      { error: 'Preference validation failed', details: { invalid } },
      422,
    );
  }

  // R29.8 — Optimistic lock. Computed after structural validation but before
  // any write. Proceed only when: (no existing prefs AND version === null) OR
  // (existing prefs AND version === current MAX(updated_at)). Anything else —
  // including an explicit null against existing prefs, or a stale non-null
  // against none — is a conflict.
  const currentVersion = await getVersion(db, registrationId);
  const versionOk =
    currentVersion === null ? providedVersion === null : providedVersion === currentVersion;
  if (!versionOk) {
    return c.json({ error: 'Preferences were modified by another user. Please reload.' }, 409);
  }

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  const staffUserId = auth.role !== 'attendee' ? auth.userId : 0;

  // CF-ms-precision (carry-forward, non-negotiable): set updated_at explicitly
  // from Date.now() (true millisecond precision), NOT the SQL DEFAULT
  // (unixepoch()*1000, second granularity). Second granularity would give two
  // writes in the same second an identical version token and let a stale write
  // slip through undetected — the exact lost-update this mechanism prevents.
  // One shared `now` for the whole batch so the post-write MAX is deterministic.
  const now = Date.now();
  const statements = [
    db.prepare('DELETE FROM roommate_preferences WHERE registration_id = ?').bind(registrationId),
    ...preferences.map((p) =>
      db
        .prepare(
          `INSERT INTO roommate_preferences (registration_id, preferred_registration_id, preference_order, created_by, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(registrationId, p.preferredRegistrationId, p.preferenceOrder, staffUserId, now),
    ),
  ];

  await db.batch(statements);

  await c.var.systemAuditRepo.append({
    action: 'preferences_updated',
    actor: staffEmail,
    targetType: 'registration',
    targetId: registrationId,
    details: JSON.stringify({ registrationId, preferences }),
  });

  const saved = await loadPreferencesWithVersion(db, registrationId);
  return c.json({ preferences: saved.preferences, version: saved.version });
});

// ---------------------------------------------------------------------------
// DELETE /allocation/registrations/:id/preferences (spec staff-api.spec.md R30)
// ---------------------------------------------------------------------------

allocationRoutes.delete('/registrations/:id/preferences', async (c) => {
  setRequestMeta(c, { reqType: 'allocation:preferences-clear' });

  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const registrationId = Number(idParam);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // R30.5 — `version` is required (same contract as R29.8). Pure body-shape
  // check, before any DB lookup per the R18.2 precedent.
  if (!('version' in body)) {
    return c.json({ error: 'version is required' }, 422);
  }
  const rawVersion = body['version'];
  if (rawVersion !== null && (typeof rawVersion !== 'number' || !Number.isFinite(rawVersion))) {
    return c.json({ error: 'version must be a number or null' }, 422);
  }
  const providedVersion = rawVersion as number | null;

  const db = c.env.DB;
  const reg = await db
    .prepare('SELECT id FROM registrations WHERE id = ?')
    .bind(registrationId)
    .first<{ id: number }>();

  if (!reg) {
    return c.json({ error: 'Not found' }, 404);
  }

  // R30.5 — Optimistic lock, identical resolution to R29.8. No existing prefs +
  // version null → no-op 204 (falls through to the delete below, which removes
  // nothing). Existing prefs + matching version → proceed. Otherwise 409 —
  // including a stale non-null version sent when no prefs exist (not a silent
  // no-op).
  const currentVersion = await getVersion(db, registrationId);
  const versionOk =
    currentVersion === null ? providedVersion === null : providedVersion === currentVersion;
  if (!versionOk) {
    return c.json({ error: 'Preferences were modified by another user. Please reload.' }, 409);
  }

  const countRow = await db
    .prepare('SELECT COUNT(*) as cnt FROM roommate_preferences WHERE registration_id = ?')
    .bind(registrationId)
    .first<{ cnt: number }>();
  const deletedCount = countRow?.cnt ?? 0;

  await db.prepare('DELETE FROM roommate_preferences WHERE registration_id = ?').bind(registrationId).run();

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  await c.var.systemAuditRepo.append({
    action: 'preferences_deleted',
    actor: staffEmail,
    targetType: 'registration',
    targetId: registrationId,
    details: JSON.stringify({ registrationId, count: deletedCount }),
  });

  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// POST /allocation/registrations/:id/payment-link (spec staff-api.spec.md R42)
// ---------------------------------------------------------------------------

allocationRoutes.post('/registrations/:id/payment-link', async (c) => {
  setRequestMeta(c, { reqType: 'allocation:payment-link' });

  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const registrationId = Number(idParam);

  const db = c.env.DB;
  const reg = await db
    .prepare('SELECT id, reg_code, status FROM registrations WHERE id = ?')
    .bind(registrationId)
    .first<{ id: number; reg_code: string; status: string }>();

  if (!reg) {
    return c.json({ error: 'Not found' }, 404);
  }

  // R42.2 — covers the race where a payment was verified after the
  // allocation list was fetched.
  if (reg.status === 'confirmed') {
    return c.json({ error: 'Registration is already confirmed' }, 409);
  }

  const link = await c.var.authService.createPaymentLinkUrl(reg.id, reg.reg_code);

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  // Same repo/action as the dashboard endpoint (staff.routes.ts:1092-1119) —
  // R42.3. No email is sent (link delivery is the branch rep's job).
  await c.var.systemAuditRepo.append({
    action: 'payment_link_generated',
    actor: staffEmail,
    targetType: 'registration',
    targetId: reg.id,
    details: JSON.stringify({ generatedBy: staffEmail }),
  });

  // R42.4 — response carries only the link (no amounts, totals, or history).
  return c.json({ link });
});

// ---------------------------------------------------------------------------
// PUT /allocation/registrations/:id/accommodation (spec staff-api.spec.md R41)
// ---------------------------------------------------------------------------

allocationRoutes.put('/registrations/:id/accommodation', async (c) => {
  setRequestMeta(c, { reqType: 'allocation:convert-accommodation' });

  // R41.2 — non-numeric :id can't match any registration; same convention as
  // every other endpoint in this file (preferences GET/PUT/DELETE).
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const registrationId = Number(idParam);

  // R41.1 — both fields required, missing or malformed → 422. This includes
  // an unparseable JSON body itself, per R41.1's explicit status code for
  // this endpoint (overriding this file's default 400-on-parse-failure
  // convention used by the preferences endpoints, which have no such
  // explicit spec text).
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'accommodationType and updatedAt are required' }, 422);
  }

  const accommodationType = body['accommodationType'];
  const updatedAt = body['updatedAt'];
  if (typeof accommodationType !== 'string' || !accommodationType) {
    return c.json({ error: 'accommodationType and updatedAt are required' }, 422);
  }
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
    return c.json({ error: 'accommodationType and updatedAt are required' }, 422);
  }

  const db = c.env.DB;
  const reg = await db
    .prepare('SELECT id, accommodation FROM registrations WHERE id = ?')
    .bind(registrationId)
    .first<{ id: number; accommodation: string }>();

  // R41.2
  if (!reg) {
    return c.json({ error: 'Not found' }, 404);
  }

  // R41.3 — one-way only; also covers the race where another staff member
  // already converted the registration.
  if (reg.accommodation !== 'shared_triple' || accommodationType !== 'shared_double') {
    return c.json({ error: 'Only shared_triple to shared_double conversion is allowed' }, 422);
  }

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  // R41.4/R41.5/R41.5.1 — EditService owns every guard past this point
  // (optimistic lock, pending-verification block, capacity guard inherited
  // via the shared edit path). Not caught here: AppError propagates to the
  // global error handler (error.middleware.ts), which already returns
  // { error: err.message } at err.statusCode verbatim — the same pass-
  // through every other editService.edit() caller in this codebase relies
  // on (e.g. staff.routes.ts's dashboard edit endpoint). Re-catching here
  // would just re-implement what R41.4/R41.5/R41.5.1 already delegate.
  const result = await c.var.editService.edit(
    registrationId,
    { fields: { accommodation: 'shared_double' }, updatedAt },
    staffEmail,
  );

  // R41.8 — exactly these four fields; pendingAmount null when confirmed,
  // matching the R27.8/GET-list convention (accommodation is always
  // cost-affecting, so paymentDelta is always set for this call — the null
  // branch only guards the edge case where the delta nets to zero and the
  // registration becomes confirmed as a result).
  return c.json({
    accommodationType: result.registration.accommodation,
    status: result.registration.status,
    pendingAmount: result.registration.status === 'confirmed' ? null : result.paymentDelta,
    updatedAt: result.registration.updatedAt,
  });
});
