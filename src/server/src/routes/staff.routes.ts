/**
 * CONTRACT
 *
 * GUARANTEES:
 *   - AUTH_GUARD — All routes require a valid JWT with role 'staff' or 'admin'.
 *     Missing/invalid token returns 401. Wrong role returns 403.
 *
 *   - DASHBOARD — GET /dashboard returns aggregate stats: total, pending,
 *     pendingVerification, confirmed counts and moneyCollected (sum of verified
 *     payment amounts). All counts via SQL aggregation — 2 repo calls, no loops.
 *
 *   - RESOURCES — GET /resources returns aggregated resource planning data:
 *     headcount (alumni/spouses/children/guests), accommodation (shared/single/none),
 *     meals (veg/nonVeg across all people), t-shirt sizes. Filters by status
 *     (comma-separated) and branch. Always excludes donation-only registrations.
 *     Attendee headcount/meals via single SQL aggregate — no per-registration loops.
 *
 *   - REPORTS — GET /reports returns analytics data: branch breakdown
 *     (registrations/status/revenue per branch), daily registration timeline,
 *     revenue summary (collected vs expected), and budgetProgress (event and
 *     accommodation actual-vs-target). No filters — full picture. Branch
 *     revenue via single SQL aggregate — no per-registration loops.
 *     budgetProgress.*.actual is derived from an exact per-registration split
 *     of pricingSnapshot (splitPricingBreakup); budgetProgress.event.target
 *     is the static EVENT_GOALS.eventBudgetTarget; budgetProgress
 *     .accommodation.target is a top-down room-block estimate from room
 *     inventory (not per-registration bookings).
 *
 *   - REGISTRATION_LIST — GET /registrations supports filtering by type, status,
 *     branch, search (name/email/regCode/whatsapp) with server-side pagination
 *     (page/limit). Ordered by createdAt DESC. Returns PagedResponse<T> shape.
 *     All filtering/sorting/pagination pushed to SQL — 2 parallel repo calls.
 *
 *   - REGISTRATION_DETAIL — GET /registrations/:id returns full detail including
 *     attendees, payments, documents, and audit log. Logs 'registration_viewed'
 *     in system audit.
 *
 *   - VERIFY_PAYMENT — POST /payments/:id/verify requires referenceId (422 if
 *     missing). Accepts optional actualAmount (422 if not a positive number).
 *     Delegates to paymentService.verifyPayment(). Returns refundCreated when
 *     the actual amount exceeds the expected amount (overpayment). 409 if
 *     payment is not pending_verification. 404 if payment not found.
 *
 *   - REJECT_PAYMENT — POST /payments/:id/reject requires comment (422 if
 *     missing). Delegates to paymentService.rejectPayment(). 409 if payment is
 *     not pending_verification. 404 if payment not found.
 *
 *   - BALANCE_PAYMENT — POST /registrations/:id/balance-payment creates a new
 *     payment_pending record to cover a verification shortfall. Requires
 *     amount and sourcePaymentId (422 if missing/invalid). Delegates to
 *     paymentService.createBalancePayment(). 409 if a pending payment already
 *     exists.
 *
 *   - LIST_REFUNDS — GET /refunds returns all refunds, optionally filtered by
 *     ?status=. Refunds are mapped with a live-or-snapshot owner: active
 *     refunds keep live registration/payment links, detached cancellation
 *     refunds read the immutable identity/source snapshot fields. The flat
 *     response fields (registrationId, sourcePaymentId, fullName, regCode)
 *     remain; registrationId/sourcePaymentId are null for detached refunds.
 *     Additive fields: reason, cancellationReason, ownerKind, original ids,
 *     email, sourcePaymentAmount, sourcePaymentReference.
 *
 *   - COMPLETE_REFUND — POST /refunds/:id/complete marks a pending refund as
 *     completed. Requires bankReference (422 if missing). Delegates to
 *     paymentService.completeRefund() (guarded D1 batch + system audit). 409
 *     if refund already completed or zero rows changed. 404 if refund not
 *     found. Works for detached refunds after the registration is deleted.
 *
 *   - CANCEL_REGISTRATION — POST /registrations/:id/cancel cancels a
 *     registration with verified payments. Requires a non-empty reason (422
 *     if missing/blank). Delegates to cancellationService.cancel(). 409 if a
 *     payment is pending_verification or the registration was already
 *     archived/cancelled. 404 if the registration never existed. Returns the
 *     archived identity plus the pending cancellation refunds.
 *
 *   - SEND_PAYMENT_LINK — POST /registrations/:id/send-payment-link generates a
 *     fresh 24-hour payment magic link and sends it to the attendee's email.
 *     409 if payment already confirmed. 404 if registration not found.
 *     Audits as 'payment_link_sent'.
 *
 *   - GENERATE_PAYMENT_LINK — POST /registrations/:id/generate-payment-link
 *     generates a fresh 24-hour payment magic link and returns it (no email).
 *     409 if confirmed. 404 if not found. Audits as 'payment_link_generated'.
 *
 *   - UPLOAD_PROOF_STAFF — POST /registrations/:id/upload-proof processes a
 *     multipart file upload on behalf of an attendee. Audits as
 *     'proof_uploaded_by_staff' with staff email as actor. 409 if no pending
 *     payment. 404 if registration not found.
 *
 *   - MY_REGISTRATION — GET /my-registration returns the staff member's own
 *     registration matched by email from JWT. 404 if not found.
 *
 *   - FILE_PROXY — GET /files/*key proxies R2 file to authenticated staff.
 *     Streams body with Content-Type and Content-Length. 404 if not in R2.
 *     Logs 'file_viewed' in system audit.
 *     The key MUST match the staff file allow-list (spec R6.4): prefixes
 *     payment-proofs/, id-docs/pending/, photos/pending/, or
 *     registrations/<regCode>/ where regCode is SMRT + 12 Crockford-base32
 *     chars (domain/reg-id.ts REG_ID_FORMAT). Any other key — including
 *     path-traversal payloads — returns 404 (not 400) without touching R2,
 *     so the existence of other keys/prefixes is never revealed.
 *
 *   - EXPORT — GET /export returns CSV of all matching registrations (same
 *     filters as /registrations, pagination ignored). Logs 'export_downloaded'.
 *
 * EXPECTS:
 *   - c.var.registrationRepo, paymentRepo, attendeeRepo, auditRepo,
 *     documentRepo, fileStorage are set by the DI middleware in index.ts.
 *   - c.var.paymentService is set by the DI middleware.
 *   - c.var.systemAuditRepo is set by the DI middleware.
 *   - Auth context for staff/admin: c.var.auth.role === 'staff' | 'admin',
 *     c.var.auth.email, c.var.auth.userId.
 *
 * FAILURE BEHAVIOR:
 *   - AppError with statusCode 4xx propagates through the global error handler.
 *   - 422 returned for missing required body fields (referenceId, comment).
 *   - 404 returned when resource not found.
 *   - 409 returned for business rule violations (wrong payment status).
 */

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from '../env.js';
import { authMiddleware, requireRole, requireScope } from '../middleware/auth.middleware.js';
import { AppError } from '../services/errors.js';
import { ALLOWED_ID_FILE_TYPES, MAX_ID_FILE_SIZE, ACCOMMODATION_OPTIONS, ACCOMMODATION_LABELS, PARTICIPATION_LABELS, CONTRIBUTION_CAUSE_VALUES, formatRegCodeForDisplay, REG_CODE_PREFIX, toPagedResponse, PRICING_DEFAULTS, CHECKIN_OPTIONS, EVENT_GOALS, splitPricingBreakup, participationTypeSchema, genderSchema, tshirtSizeSchema } from '@smriti/shared';
import type { AccommodationType, ParticipationType, AttendanceIntent, PricingBreakup } from '@smriti/shared';
import { deriveRegistrationStatus, type RegistrationStatus } from '../domain/status.js';
import { slugifyFileName } from '../utils.js';
import { setRequestMeta } from '../infra/request-meta.js';
import { generateRegCode } from '../domain/reg-id.js';
import type { RegistrationInsertSet } from '../domain/registration-insert-set.js';
import { createSnapshot } from '../domain/audit.js';

export const staffRoutes = new Hono<AppEnv>();

const MAX_PHOTO_FILE_SIZE = 5 * 1024 * 1024;
const MAX_PHOTO_MULTIPART_BODY_SIZE = MAX_PHOTO_FILE_SIZE + 64 * 1024;

// ---------------------------------------------------------------------------
// Staff file proxy allow-list (spec R6.4)
//
// Derived from the real R2 key write sites — every prefix below is justified
// by a production key producer (see cycle evidence t2-allowlist-derivation.txt):
//   payment-proofs/<regCode>-<paymentId>-<file>  staff upload-proof (this file)
//   registrations/<regCode>/...                  proof / id-doc / photo /
//                                                photo-thumb (payment.service,
//                                                registration.service)
//   id-docs/pending/... , photos/pending/...     wizard uploads (upload.routes);
//                                                these keys persist in the DB
//                                                when background relocation
//                                                (relocateFiles) fails, and in
//                                                the waitUntil window right
//                                                after submit — staff detail
//                                                pages fetch them verbatim.
// ---------------------------------------------------------------------------
const ALLOWED_FILE_KEY_PREFIXES = [
  'payment-proofs/',
  'id-docs/pending/',
  'photos/pending/',
] as const;

// regCode format per src/server/src/domain/reg-id.ts (REG_ID_FORMAT guarantee):
// "SMRT" + 12 chars of Crockford base32 (0123456789ABCDEFGHJKMNPQRSTVWXYZ —
// excludes I, L, O, U). 16 chars total.
const ALLOWED_REG_FILE_KEY_PATTERN = new RegExp(`^registrations/${REG_CODE_PREFIX}[0-9A-HJKMNP-TV-Z]{12}/`);

export function isAllowedStaffFileKey(key: string): boolean {
  // Defense-in-depth: no traversal sequences, backslashes, NUL bytes, or
  // absolute paths. No legitimate key producer emits any of these
  // (slugifyFileName collapses to [a-z0-9-] + one extension dot).
  if (key.includes('..') || key.includes('\\') || key.includes('\0') || key.startsWith('/')) {
    return false;
  }
  return (
    ALLOWED_FILE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
    ALLOWED_REG_FILE_KEY_PATTERN.test(key)
  );
}

function matchesRegistrationSearch(
  registration: { fullName: string; email: string; regCode: string; whatsapp: string },
  search: string,
) {
  const normalizedSearch = search.replace(/[\s-]/g, '');
  const displayRegCode = formatRegCodeForDisplay(registration.regCode).toLowerCase();

  return (
    registration.fullName.toLowerCase().includes(search) ||
    registration.email.toLowerCase().includes(search) ||
    registration.regCode.toLowerCase().includes(search) ||
    registration.regCode.toLowerCase().replace(/-/g, '').includes(normalizedSearch) ||
    displayRegCode.includes(search) ||
    registration.whatsapp.toLowerCase().includes(search)
  );
}

// Apply auth + role guard to all staff routes
staffRoutes.use('*', authMiddleware, requireRole('staff', 'admin'));

// ---------------------------------------------------------------------------
// GET /staff/dashboard (spec R5)
// ---------------------------------------------------------------------------

staffRoutes.get('/dashboard', requireScope('dashboard'), async (c) => {
  const registrationRepo = c.var.registrationRepo;
  const paymentRepo = c.var.paymentRepo;

  const typeParam = c.req.query('type') as 'attendee' | 'donor' | undefined;
  const typeFilter = typeParam ? { type: typeParam } : undefined;

  // byParticipationType is ALWAYS unfiltered (decision D6): counts all
  // participation types regardless of the ?type= filter on the flat stats.
  const [counts, moneyCollected, byParticipationType] = await Promise.all([
    registrationRepo.countByStatus(typeFilter),
    paymentRepo.sumVerified(typeFilter),
    registrationRepo.countByParticipationAndStatus(),
  ]);

  const total = counts.pending + counts.pendingVerification + counts.confirmed;

  return c.json({
    stats: { total, ...counts, moneyCollected, byParticipationType },
  });
});

// ---------------------------------------------------------------------------
// POST /staff/registrations — quick-add donor registration
// ---------------------------------------------------------------------------

staffRoutes.post('/registrations', requireScope('dashboard'), async (c) => {
  const body = await c.req.json<{
    fullName?: string;
    branch?: string;
    donationAmount?: number;
    email?: string;
    whatsapp?: string;
    gender?: 'male' | 'female';
    city?: string;
    country?: string;
    publicAck?: boolean;
    ackDisplayName?: string;
    felicitation?: boolean;
  }>();

  const { fullName, branch, donationAmount, email, whatsapp, gender, city, country, publicAck, ackDisplayName, felicitation } = body;

  if (!fullName?.trim()) return c.json({ error: 'fullName is required' }, 422);
  if (!branch?.trim()) return c.json({ error: 'branch is required' }, 422);
  if (typeof donationAmount !== 'number' || donationAmount <= 0) {
    return c.json({ error: 'donationAmount must be a positive number' }, 422);
  }

  const regCode = generateRegCode();

  const pricingBreakup: PricingBreakup = {
    base: 0,
    collegeContribution: 0,
    lines: [],
    donation: donationAmount,
    total: donationAmount,
  };

  const insertSet: RegistrationInsertSet = {
    registration: {
      reg_code: regCode,
      full_name: fullName.trim(),
      branch: branch.trim(),
      email: email?.trim() || `donor-${regCode.toLowerCase()}@smriti.internal`,
      whatsapp: whatsapp?.trim() || '',
      mobile_alternate: null,
      city: city?.trim() || '',
      country: country?.trim() || 'India',
      attendance_intent: 'donation_only' as AttendanceIntent,
      participation_type: 'donation_only' as ParticipationType,
      gender: gender ?? null,
      tshirt_size: null,
      alumni_meal: 'none',
      accommodation: 'none' as AccommodationType,
      check_in: null,
      check_out: null,
      extra_bed: 0,
      donation_amount: donationAmount,
      public_ack: publicAck ? 1 : 0,
      ack_display_name: ackDisplayName?.trim() || null,
      felicitation: felicitation ? 1 : 0,
      contribution_splits: '{}',
      pricing_snapshot: JSON.stringify(pricingBreakup),
      total_amount: donationAmount,
      id_note: null,
      photo_file_key: null,
    },
    attendees: [],
    document: null,
    payment: {
      registration_id: 0,
      amount: donationAmount,
      status: 'payment_pending',
      gateway: null,
      gateway_ref: null,
      gateway_response: null,
      proof_file_key: null,
      verified_by: null,
      verified_at: null,
    },
  };

  const { id } = await c.var.registrationRepo.createWithRelations(insertSet);

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  try {
    const created = await c.var.registrationRepo.findById(id);
    if (created) {
      await c.var.auditRepo.append({
        registration_id: id,
        action: 'created' as const,
        actor: staffEmail,
        changes: null,
        snapshot: createSnapshot(created, []),
      });
    }
  } catch {
    // audit failure is non-fatal
  }

  return c.json({ id, regCode }, 201);
});

// ---------------------------------------------------------------------------
// GET /staff/resources — resource planning aggregates
// ---------------------------------------------------------------------------

staffRoutes.get('/resources', requireScope('resources'), async (c) => {
  const registrationRepo = c.var.registrationRepo;
  const attendeeRepo = c.var.attendeeRepo;

  const statusParam = c.req.query('status'); // comma-separated: "confirmed,pending"
  const branch = c.req.query('branch');

  const statusList = statusParam
    ? statusParam.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const statusSet = statusList ? new Set(statusList) : null;

  const attendeeFilters = { statuses: statusList ?? undefined, branch: branch ?? undefined };

  const [allRegistrations, attendeeCounts, accommodationByNight, mealsByParticipationType, childrenByAgeBand, allTshirts] = await Promise.all([
    registrationRepo.list({
      branch: branch ?? undefined,
      type: 'attendee', // always excludes donation-only
    }),
    attendeeRepo.countGrouped(attendeeFilters),
    attendeeRepo.accommodationByNight(attendeeFilters),
    attendeeRepo.mealsByParticipationType(attendeeFilters),
    attendeeRepo.childrenByAgeBand(attendeeFilters),
    c.var.tshirtRepo.findAll(),
  ]);

  // Group all shirt rows (included + extras) by registration, for the merge
  // below — one query instead of an N+1 per registration.
  const tshirtsByRegistration = new Map<number, typeof allTshirts>();
  for (const t of allTshirts) {
    const bucket = tshirtsByRegistration.get(t.registrationId);
    if (bucket) bucket.push(t);
    else tshirtsByRegistration.set(t.registrationId, [t]);
  }

  // Apply status filter to the already-loaded registrations (no N+1 — reads columns)
  const filtered = statusSet
    ? allRegistrations.filter((r) => statusSet.has(r.status))
    : allRegistrations;

  const headcount = { alumni: 0, spouses: 0, children: 0, guests: 0, total: 0 };
  const accommodation: Record<string, { total: number; male: number; female: number; other: number }> = Object.fromEntries(
    ACCOMMODATION_OPTIONS.map((o) => [o.value, { total: 0, male: 0, female: 0, other: 0 }]),
  );
  const meals = { veg: 0, nonVeg: 0 };
  const tshirts: Record<string, Record<string, number>> = {
    male: {},
    female: {},
    unspecified: {},
  };

  // Registration-level aggregates (alumni fields — no sub-queries, just reading loaded rows)
  for (const reg of filtered) {
    headcount.alumni++;
    headcount.total++;

    // Alumni meal
    if (reg.alumniMeal === 'veg') meals.veg++;
    else meals.nonVeg++;

    // Accommodation
    const accom = reg.accommodation ?? 'none';
    const bucket = accommodation[accom];
    bucket.total++;
    const accomGender = reg.gender === 'male' ? 'male'
      : reg.gender === 'female' ? 'female'
      : 'other';
    bucket[accomGender]++;

    // T-shirt segmented by gender — merged from the tshirts table (item source
    // of truth: included + extras) with a fallback to the legacy tshirt_size
    // mirror for any registration that predates the tshirts table backfill.
    const regTshirts = tshirtsByRegistration.get(reg.id);
    if (regTshirts && regTshirts.length > 0) {
      for (const t of regTshirts) {
        const genderKey = t.gender === 'male' ? 'male'
          : t.gender === 'female' ? 'female'
          : 'unspecified';
        tshirts[genderKey][t.size] = (tshirts[genderKey][t.size] ?? 0) + 1;
      }
    } else if (reg.tshirtSize) {
      const genderKey = reg.gender === 'male' ? 'male'
        : reg.gender === 'female' ? 'female'
        : 'unspecified';
      tshirts[genderKey][reg.tshirtSize] = (tshirts[genderKey][reg.tshirtSize] ?? 0) + 1;
    }
  }

  // Attendee headcount + meals from single SQL aggregate (replaces per-registration N+1)
  for (const row of attendeeCounts) {
    if (row.type === 'spouse') headcount.spouses += row.count;
    else if (row.type === 'child') headcount.children += row.count;
    else if (row.type === 'guest') headcount.guests += row.count;
    headcount.total += row.count;

    if (row.meal === 'veg') meals.veg += row.count;
    else meals.nonVeg += row.count;
  }

  return c.json({
    resources: {
      headcount,
      accommodation,
      accommodationByNight,
      meals,
      mealsByParticipationType,
      tshirts,
      childrenByAgeBand,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /staff/reports — analytics for the organizing committee
// ---------------------------------------------------------------------------

staffRoutes.get('/reports', requireScope('reports'), async (c) => {
  const registrationRepo = c.var.registrationRepo;
  const paymentRepo = c.var.paymentRepo;

  const [attendeeRegs, branchRevenueRows, contributions, donations, geography, donorRecognition, rooms] = await Promise.all([
    registrationRepo.list({ type: 'attendee' }),
    paymentRepo.sumVerifiedByBranch({ type: 'attendee' }),
    registrationRepo.getContributionAggregates(),
    registrationRepo.getDonationTotals(),
    registrationRepo.geographyAggregates(),
    registrationRepo.donorRecognitionRows(PRICING_DEFAULTS.donationFelicitationThreshold),
    c.var.inventoryRepo.get(),
  ]);

  // ── Branch breakdown ────────────────────────────────────────────────────
  const branchMap = new Map<string, {
    total: number;
    confirmed: number;
    pendingVerification: number;
    pending: number;
    expectedRevenue: number;
  }>();

  // ── Budget progress actuals (event vs. accommodation split) ────────────
  let eventActual = 0;
  let accommodationActual = 0;

  for (const reg of attendeeRegs) {
    const entry = branchMap.get(reg.branch) ?? {
      total: 0, confirmed: 0, pendingVerification: 0, pending: 0, expectedRevenue: 0,
    };
    entry.total++;
    if (reg.status === 'confirmed') entry.confirmed++;
    else if (reg.status === 'pending_verification') entry.pendingVerification++;
    else entry.pending++;
    entry.expectedRevenue += reg.totalAmount;
    branchMap.set(reg.branch, entry);

    const split = splitPricingBreakup(reg.pricingSnapshot, reg.totalAmount);
    eventActual += split.event;
    accommodationActual += split.accommodation;
  }

  // Branch revenue: single SQL aggregate instead of per-registration N+1
  const branchRevenue = new Map(branchRevenueRows.map((r) => [r.branch, r.collected]));

  const branchBreakdown = Array.from(branchMap.entries())
    .map(([branch, data]) => ({
      branch,
      ...data,
      collectedRevenue: branchRevenue.get(branch) ?? 0,
    }))
    .sort((a, b) => b.total - a.total);

  // ── Daily timeline with participation-type split (B3) ───────────────────
  // count = total attendees (back-compat); fullCelebration + campusOnly are
  // additive fields for the goal overlay chart. donation_only is already
  // excluded by the type:'attendee' filter on attendeeRegs (B10).
  const dayMap = new Map<string, { count: number; fullCelebration: number; campusOnly: number }>();
  for (const reg of attendeeRegs) {
    const day = new Date(reg.createdAt).toISOString().slice(0, 10);
    const entry = dayMap.get(day) ?? { count: 0, fullCelebration: 0, campusOnly: 0 };
    entry.count++;
    if (reg.participationType === 'full_celebration') entry.fullCelebration++;
    else if (reg.participationType === 'campus_only') entry.campusOnly++;
    dayMap.set(day, entry);
  }

  const timeline = Array.from(dayMap.entries())
    .map(([date, entry]) => ({ date, ...entry }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── Revenue summary ─────────────────────────────────────────────────────
  let expected = 0;
  for (const reg of attendeeRegs) {
    expected += reg.totalAmount;
  }
  let collected = 0;
  for (const amt of branchRevenue.values()) {
    collected += amt;
  }

  // ── Budget progress targets ─────────────────────────────────────────────
  // Accommodation target is a top-down "what we'd owe the hotel for our full
  // room block" estimate: total room-nights (summed across both check-in
  // dates) × private room nightly rate + GST. It intentionally ignores
  // shared_double/shared_triple bookings and per-registration nuance — the
  // venue bills by room block, not by who's sharing what.
  const totalRoomNights = CHECKIN_OPTIONS.reduce((sum, night) => sum + (rooms[night] ?? 0), 0);
  const nightlyRate = PRICING_DEFAULTS.accommodationPrivateFee ?? 0;
  const taxPercent = PRICING_DEFAULTS.accommodationTaxPercent ?? 18;
  const accommodationTarget = Math.round(totalRoomNights * nightlyRate * (1 + taxPercent / 100));

  return c.json({
    branchBreakdown,
    timeline,
    revenue: { collected, expected, pending: expected - collected },
    contributions,
    donations,
    geography,
    donorRecognition,
    budgetProgress: {
      event: { actual: eventActual, target: EVENT_GOALS.eventBudgetTarget },
      accommodation: { actual: accommodationActual, target: accommodationTarget },
    },
  });
});

// ---------------------------------------------------------------------------
// GET /staff/registrations (spec R6)
// ---------------------------------------------------------------------------

staffRoutes.get('/registrations', requireScope('dashboard'), async (c) => {
  const registrationRepo = c.var.registrationRepo;

  const typeParam = c.req.query('type') as 'attendee' | 'donor' | undefined;
  const statusParam = c.req.query('status') as RegistrationStatus | undefined;
  const branch = c.req.query('branch');
  const search = c.req.query('search');
  const participationTypeParam = c.req.query('participationType');
  const page = Math.max(1, Number(c.req.query('page') ?? '1'));
  const rawLimit = Number(c.req.query('limit') ?? '50');
  const limit = Math.min(100, Math.max(1, rawLimit));
  const offset = (page - 1) * limit;

  const filters = {
    type: typeParam,
    status: statusParam,
    branch: branch ?? undefined,
    search: search ?? undefined,
    participationType: participationTypeParam ?? undefined,
    orderBy: 'created_at' as const,
    orderDir: 'DESC' as const,
    limit,
    offset,
  };

  const [pageItems, totalItems] = await Promise.all([
    registrationRepo.list(filters),
    registrationRepo.count(filters),
  ]);

  const data = pageItems.map((reg) => ({
    id: reg.id,
    regCode: reg.regCode,
    fullName: reg.fullName,
    email: reg.email,
    whatsapp: reg.whatsapp,
    branch: reg.branch,
    status: reg.status,
    attendanceIntent: reg.attendanceIntent,
    participationType: reg.participationType,
    totalAmount: reg.totalAmount,
    photoThumbKey: reg.photoThumbKey,
    createdAt: reg.createdAt,
  }));

  return c.json(toPagedResponse(data, page, limit, totalItems));
});

// ---------------------------------------------------------------------------
// GET /staff/registrations/:id (spec R7)
// ---------------------------------------------------------------------------

staffRoutes.get('/registrations/:id', requireScope('dashboard'), async (c) => {
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const regId = Number(idParam);

  const registrationRepo = c.var.registrationRepo;
  const attendeeRepo = c.var.attendeeRepo;
  const paymentRepo = c.var.paymentRepo;
  const documentRepo = c.var.documentRepo;
  const auditRepo = c.var.auditRepo;
  const systemAuditRepo = c.var.systemAuditRepo;

  const reg = await registrationRepo.findById(regId);
  if (!reg) return c.json({ error: 'Not found' }, 404);

  const [attendees, payments, documents, auditEntries, tshirts, additionalCharges] = await Promise.all([
    attendeeRepo.findByRegistration(regId),
    paymentRepo.findByRegistration(regId),
    documentRepo.findByRegistration(regId),
    auditRepo.findByRegistration(regId),
    c.var.tshirtRepo.findByRegistration(regId),
    c.var.chargeRepo.findByRegistration(regId),
  ]);

  // Audit: log registration_viewed (spec R7.4)
  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  await systemAuditRepo.append({
    action: 'registration_viewed',
    actor: staffEmail,
    targetType: 'registration',
    targetId: regId,
    details: JSON.stringify({ regCode: reg.regCode }),
  });

  return c.json({
    registration: {
      id: reg.id,
      regCode: reg.regCode,
      status: reg.status,
      fullName: reg.fullName,
      email: reg.email,
      whatsapp: reg.whatsapp,
      branch: reg.branch,
      city: reg.city,
      country: reg.country,
      gender: reg.gender ?? null,
      mobileAlternate: reg.mobileAlternate ?? null,
      attendance: {
        intent: reg.attendanceIntent,
        participationType: reg.participationType,
        mealPreference: reg.alumniMeal === 'none' ? null : reg.alumniMeal,
        tshirtSize: reg.tshirtSize,
      },
      accommodation:
        reg.accommodation !== 'none'
          ? {
              type: reg.accommodation,
              checkIn: reg.checkIn,
              checkOut: reg.checkOut,
              extraBed: reg.extraBed,
              breakfastAdult: reg.breakfastAdult,
              breakfastChild: reg.breakfastChild,
            }
          : null,
      donation: reg.donationAmount,
      publicAck: reg.publicAck,
      ackDisplayName: reg.ackDisplayName ?? null,
      felicitation: reg.felicitation,
      contributionSplits: reg.contributionSplits,
      pricingBreakup: reg.pricingSnapshot,
      totalAmount: reg.totalAmount,
      idNote: reg.idNote ?? null,
      photoFileKey: reg.photoFileKey ?? null,
      photoThumbKey: reg.photoThumbKey ?? null,
      createdAt: reg.createdAt,
      updatedAt: reg.updatedAt,
    },
    attendees: attendees.map((a) => ({
      id: a.id,
      type: a.type,
      name: a.name,
      age: a.age,
      relationship: a.relationship,
      mealPreference: a.meal,
      tshirtSize: null, // attendees don't have tshirtSize in schema
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      status: p.status,
      proofFileKey: p.proofFileKey,
      gatewayRef: p.gatewayRef,
      verifiedBy: p.verifiedBy,
      verifiedAt: p.verifiedAt,
      createdAt: p.createdAt,
    })),
    documents: documents.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      r2Key: d.r2Key,
    })),
    audit: auditEntries.map((e) => ({
      action: e.action,
      actor: e.actor,
      changes: e.changes,
      createdAt: e.createdAt,
    })),
    tshirts,
    additionalCharges,
  });
});

// ---------------------------------------------------------------------------
// T-shirts & additional charges — extra shirts and staff-added line items
// ---------------------------------------------------------------------------

staffRoutes.get('/registrations/:id/tshirts', requireScope('dashboard'), async (c) => {
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const registrationId = Number(idParam);

  const reg = await c.var.registrationRepo.findById(registrationId);
  if (!reg) return c.json({ error: 'Not found' }, 404);

  const tshirts = await c.var.tshirtRepo.findByRegistration(registrationId);
  return c.json({ tshirts });
});

staffRoutes.post('/registrations/:id/tshirts', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:tshirt-add' });
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const registrationId = Number(idParam);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { size: 'Required' } } },
      422,
    );
  }

  const sizeResult = tshirtSizeSchema.safeParse(body['size']);
  if (!sizeResult.success) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { size: 'Invalid t-shirt size' } } },
      422,
    );
  }

  const genderRaw = body['gender'];
  let gender: import('@smriti/shared').Gender | null = null;
  if (genderRaw !== undefined && genderRaw !== null) {
    const genderResult = genderSchema.safeParse(genderRaw);
    if (!genderResult.success) {
      return c.json(
        { error: 'Validation failed', details: { fieldErrors: { gender: 'Invalid gender' } } },
        422,
      );
    }
    gender = genderResult.data;
  }

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  const { tshirt, recalc } = await c.var.tshirtChargeService.addTshirt(
    registrationId,
    { gender, size: sizeResult.data },
    staffEmail,
  );

  return c.json({
    tshirt,
    pricingBreakup: recalc.pricingBreakup,
    totalAmount: recalc.registration.totalAmount,
    paymentAction: recalc.paymentAction,
    paymentDelta: recalc.paymentDelta,
  });
});

staffRoutes.put('/registrations/:id/tshirts/:tid', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:tshirt-update' });
  const idParam = c.req.param('id');
  const tidParam = c.req.param('tid');
  if (!idParam || !/^\d+$/.test(idParam) || !tidParam || !/^\d+$/.test(tidParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const registrationId = Number(idParam);
  const tshirtId = Number(tidParam);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const data: { gender?: import('@smriti/shared').Gender | null; size?: import('@smriti/shared').TshirtSize } = {};

  if (body['size'] !== undefined) {
    const sizeResult = tshirtSizeSchema.safeParse(body['size']);
    if (!sizeResult.success) {
      return c.json(
        { error: 'Validation failed', details: { fieldErrors: { size: 'Invalid t-shirt size' } } },
        422,
      );
    }
    data.size = sizeResult.data;
  }

  if (body['gender'] !== undefined) {
    if (body['gender'] === null) {
      data.gender = null;
    } else {
      const genderResult = genderSchema.safeParse(body['gender']);
      if (!genderResult.success) {
        return c.json(
          { error: 'Validation failed', details: { fieldErrors: { gender: 'Invalid gender' } } },
          422,
        );
      }
      data.gender = genderResult.data;
    }
  }

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  const tshirt = await c.var.tshirtChargeService.updateTshirt(registrationId, tshirtId, data, staffEmail);

  return c.json({ tshirt });
});

staffRoutes.delete('/registrations/:id/tshirts/:tid', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:tshirt-remove' });
  const idParam = c.req.param('id');
  const tidParam = c.req.param('tid');
  if (!idParam || !/^\d+$/.test(idParam) || !tidParam || !/^\d+$/.test(tidParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const registrationId = Number(idParam);
  const tshirtId = Number(tidParam);

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  const recalc = await c.var.tshirtChargeService.removeTshirt(registrationId, tshirtId, staffEmail);

  return c.json({
    pricingBreakup: recalc.pricingBreakup,
    totalAmount: recalc.registration.totalAmount,
    paymentAction: recalc.paymentAction,
    paymentDelta: recalc.paymentDelta,
  });
});

staffRoutes.get('/registrations/:id/charges', requireScope('dashboard'), async (c) => {
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const registrationId = Number(idParam);

  const reg = await c.var.registrationRepo.findById(registrationId);
  if (!reg) return c.json({ error: 'Not found' }, 404);

  const charges = await c.var.chargeRepo.findByRegistration(registrationId);
  return c.json({ charges });
});

staffRoutes.post('/registrations/:id/charges', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:charge-add' });
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const registrationId = Number(idParam);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { description: 'Required', amount: 'Required' } } },
      422,
    );
  }

  const description = body['description'];
  if (typeof description !== 'string' || !description.trim()) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { description: 'Required' } } },
      422,
    );
  }

  const amount = Number(body['amount']);
  if (!Number.isFinite(amount) || amount <= 0) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { amount: 'Must be a positive number' } } },
      422,
    );
  }

  const auth = c.var.auth as { role: 'staff' | 'admin'; userId: number; email: string } | { role: 'attendee'; registrationId: number };
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  const staffUserId = auth.role !== 'attendee' ? auth.userId : 0;

  const { charge, recalc } = await c.var.tshirtChargeService.addCharge(
    registrationId,
    { description, amount },
    staffUserId,
    staffEmail,
  );

  return c.json({
    charge,
    pricingBreakup: recalc.pricingBreakup,
    totalAmount: recalc.registration.totalAmount,
    paymentAction: recalc.paymentAction,
    paymentDelta: recalc.paymentDelta,
  });
});

staffRoutes.delete('/registrations/:id/charges/:cid', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:charge-remove' });
  const idParam = c.req.param('id');
  const cidParam = c.req.param('cid');
  if (!idParam || !/^\d+$/.test(idParam) || !cidParam || !/^\d+$/.test(cidParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const registrationId = Number(idParam);
  const chargeId = Number(cidParam);

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  const recalc = await c.var.tshirtChargeService.removeCharge(registrationId, chargeId, staffEmail);

  return c.json({
    pricingBreakup: recalc.pricingBreakup,
    totalAmount: recalc.registration.totalAmount,
    paymentAction: recalc.paymentAction,
    paymentDelta: recalc.paymentDelta,
  });
});

// ---------------------------------------------------------------------------
// POST /staff/payments/:id/verify (spec R8)
// ---------------------------------------------------------------------------

staffRoutes.post('/payments/:id/verify', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:payment-verify' });
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const paymentId = Number(idParam);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { referenceId: 'Required' } } },
      422,
    );
  }

  const referenceId = body['referenceId'];
  if (typeof referenceId !== 'string' || !referenceId.trim()) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { referenceId: 'Required' } } },
      422,
    );
  }

  const actualAmountRaw = body['actualAmount'];
  if (actualAmountRaw === undefined || actualAmountRaw === null) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { actualAmount: 'Required' } } },
      422,
    );
  }
  const actualAmount = Number(actualAmountRaw);
  if (!Number.isFinite(actualAmount) || actualAmount <= 0) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { actualAmount: 'Must be a positive number' } } },
      422,
    );
  }

  const withShortfallPayment = body['withShortfallPayment'] === true;

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  const result = await c.var.paymentService.verifyPayment(paymentId, referenceId.trim(), staffEmail, actualAmount, withShortfallPayment);

  return c.json({
    paymentStatus: result.paymentStatus,
    registrationStatus: result.registrationStatus,
    ...(result.refundCreated && { refundCreated: result.refundCreated }),
    ...(result.shortfallCreated && { shortfallCreated: result.shortfallCreated }),
  });
});

// ---------------------------------------------------------------------------
// POST /staff/payments/:id/reject (spec R9)
// ---------------------------------------------------------------------------

staffRoutes.post('/payments/:id/reject', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:payment-reject' });
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const paymentId = Number(idParam);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { comment: 'Required' } } },
      422,
    );
  }

  const comment = body['comment'];
  if (typeof comment !== 'string' || !comment.trim()) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { comment: 'Required' } } },
      422,
    );
  }

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  const result = await c.var.paymentService.rejectPayment(paymentId, comment.trim(), staffEmail);

  return c.json({
    paymentStatus: result.paymentStatus,
    registrationStatus: result.registrationStatus,
  });
});

// ---------------------------------------------------------------------------
// POST /staff/registrations/:id/balance-payment
// ---------------------------------------------------------------------------

staffRoutes.post('/registrations/:id/balance-payment', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:balance-payment' });
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const registrationId = Number(idParam);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { amount: 'Required', sourcePaymentId: 'Required' } } },
      422,
    );
  }

  const amount = Number(body['amount']);
  if (!Number.isFinite(amount) || amount <= 0) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { amount: 'Must be a positive number' } } },
      422,
    );
  }

  const sourcePaymentId = Number(body['sourcePaymentId']);
  if (!Number.isFinite(sourcePaymentId) || sourcePaymentId <= 0) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { sourcePaymentId: 'Required' } } },
      422,
    );
  }

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  const result = await c.var.paymentService.createBalancePayment(registrationId, amount, staffEmail, sourcePaymentId);

  return c.json({
    paymentId: result.paymentId,
    amount: result.amount,
    status: 'payment_pending',
  });
});

// ---------------------------------------------------------------------------
// GET /staff/refunds
// ---------------------------------------------------------------------------

staffRoutes.get('/refunds', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:list-refunds' });
  const status = c.req.query('status');
  const filters = status ? { status } : undefined;
  const refunds = await c.var.refundRepo.listWithRegistration(filters);
  return c.json({ refunds });
});

// ---------------------------------------------------------------------------
// POST /staff/refunds/:id/complete
// ---------------------------------------------------------------------------

staffRoutes.post('/refunds/:id/complete', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:complete-refund' });
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const refundId = Number(idParam);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { bankReference: 'Required' } } },
      422,
    );
  }

  const bankReference = body['bankReference'];
  if (typeof bankReference !== 'string' || !bankReference.trim()) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { bankReference: 'Required' } } },
      422,
    );
  }

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  const result = await c.var.paymentService.completeRefund(refundId, bankReference.trim(), staffEmail);

  return c.json({ status: result.status });
});

// ---------------------------------------------------------------------------
// POST /staff/registrations/:id/send-payment-link
// ---------------------------------------------------------------------------

staffRoutes.post('/registrations/:id/send-payment-link', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:send-payment-link' });
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }

  const reg = await c.var.registrationRepo.findById(Number(idParam));
  if (!reg) return c.json({ error: 'Not found' }, 404);

  if (reg.status === 'confirmed') {
    return c.json({ error: 'Payment already confirmed' }, 409);
  }

  const paymentLink = await c.var.authService.createPaymentLinkUrl(reg.id, reg.regCode);
  await c.var.emailService.sendPaymentLink(reg.email, { link: paymentLink, expiresInHours: 24 });

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  await c.var.systemAuditRepo.append({
    action: 'payment_link_sent',
    actor: staffEmail,
    targetType: 'registration',
    targetId: reg.id,
    details: JSON.stringify({ sentTo: reg.email }),
  });

  return c.json({ ok: true, sentTo: reg.email });
});

// ---------------------------------------------------------------------------
// POST /staff/registrations/:id/generate-payment-link
// ---------------------------------------------------------------------------

staffRoutes.post('/registrations/:id/generate-payment-link', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:generate-payment-link' });
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }

  const reg = await c.var.registrationRepo.findById(Number(idParam));
  if (!reg) return c.json({ error: 'Not found' }, 404);

  if (reg.status === 'confirmed') {
    return c.json({ error: 'Payment already confirmed' }, 409);
  }

  const link = await c.var.authService.createPaymentLinkUrl(reg.id, reg.regCode);

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  await c.var.systemAuditRepo.append({
    action: 'payment_link_generated',
    actor: staffEmail,
    targetType: 'registration',
    targetId: reg.id,
    details: JSON.stringify({ generatedBy: staffEmail }),
  });

  return c.json({ link });
});

// ---------------------------------------------------------------------------
// POST /staff/registrations/:id/photo
// ---------------------------------------------------------------------------

staffRoutes.post(
  '/registrations/:id/photo',
  requireScope('dashboard'),
  bodyLimit({
    maxSize: MAX_PHOTO_MULTIPART_BODY_SIZE,
    onError: (c) => c.json({ error: 'File too large', details: { maxSizeMB: 5 } }, 400),
  }),
  async (c) => {
    setRequestMeta(c, { reqType: 'staff:photo-replacement' });
    const idParam = c.req.param('id');
    if (!idParam || !/^\d+$/.test(idParam)) {
      return c.json({ error: 'Not found' }, 404);
    }

    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      return c.json({
        error: 'Validation failed',
        details: { fieldErrors: { file: 'Required' } },
      }, 422);
    }

    const allowedTypes = ['image/jpeg', 'image/png'] as const;
    if (!(allowedTypes as readonly string[]).includes(file.type)) {
      return c.json({
        error: 'Invalid file type',
        details: { allowedTypes },
      }, 400);
    }
    if (file.size === 0) {
      return c.json({ error: 'File is empty' }, 400);
    }
    if (file.size > MAX_PHOTO_FILE_SIZE) {
      return c.json({ error: 'File too large', details: { maxSizeMB: 5 } }, 400);
    }

    const auth = c.var.auth;
    const actorEmail = auth.role !== 'attendee' ? auth.email : '';
    await c.var.registrationService.replacePhoto(Number(idParam), actorEmail, {
      bytes: await file.arrayBuffer(),
      mimeType: file.type,
      sizeBytes: file.size,
    });

    return c.json({ status: 'ok', message: 'Photo updated.' });
  },
);

// ---------------------------------------------------------------------------
// POST /staff/registrations/:id/upload-proof (spec R10)
// ---------------------------------------------------------------------------

staffRoutes.post('/registrations/:id/upload-proof', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:upload-proof' });
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const regId = Number(idParam);

  const registrationRepo = c.var.registrationRepo;
  const paymentRepo = c.var.paymentRepo;
  const auditRepo = c.var.auditRepo;
  const fileStorage = c.var.fileStorage;

  const reg = await registrationRepo.findById(regId);
  if (!reg) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.parseBody();
  const file = body['file'] as File | undefined;
  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  if (!(ALLOWED_ID_FILE_TYPES as readonly string[]).includes(file.type)) {
    return c.json(
      { error: 'Invalid file type', details: { allowedTypes: ALLOWED_ID_FILE_TYPES } },
      400,
    );
  }

  if (file.size > MAX_ID_FILE_SIZE) {
    return c.json({ error: 'File too large', details: { maxSizeMB: 5 } }, 400);
  }

  const payments = await paymentRepo.findByRegistration(regId);
  const pendingPayment = payments[0];
  if (!pendingPayment || pendingPayment.status !== 'payment_pending') {
    throw new AppError('No pending payment to attach proof to', 409);
  }

  const fileData = await file.arrayBuffer();
  const metadata = {
    mimeType: file.type,
    fileName: file.name,
    sizeBytes: file.size,
  };

  const r2Key = `payment-proofs/${reg.regCode}-${pendingPayment.id}-${slugifyFileName(metadata.fileName)}`;
  await fileStorage.upload(r2Key, fileData, metadata);

  await paymentRepo.updateStatus(pendingPayment.id, 'pending_verification', undefined, r2Key);
  await registrationRepo.updateStatus(regId, 'pending_verification');

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  const snapshot = JSON.stringify({ registration: reg, attendees: [] });
  await auditRepo.append({
    registration_id: regId,
    action: 'proof_uploaded_by_staff',
    actor: staffEmail,
    changes: JSON.stringify({ paymentId: pendingPayment.id, proofFileKey: r2Key }),
    snapshot,
  });

  return c.json({ status: 'pending_verification', message: 'Proof submitted.' });
});

// ---------------------------------------------------------------------------
// GET /staff/my-registration (spec R11)
// ---------------------------------------------------------------------------

staffRoutes.get('/my-registration', async (c) => {
  const auth = c.var.auth;
  if (auth.role === 'attendee') {
    return c.json({ error: 'No registration found for your email' }, 404);
  }

  const registrationRepo = c.var.registrationRepo;
  const matches = await registrationRepo.findByEmail(auth.email);
  const reg = matches[0];
  if (!reg) {
    return c.json({ error: 'No registration found for your email' }, 404);
  }

  // Reuse registrationService.getByToken for the full response shape
  const result = await c.var.registrationService.getByToken(reg.id);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// GET /staff/me/permissions — staff member's own scopes (no scope check)
// ---------------------------------------------------------------------------

staffRoutes.get('/me/permissions', async (c) => {
  const auth = c.var.auth as { role: 'staff' | 'admin'; userId: number; email: string };
  if (auth.role === 'admin') {
    return c.json({ permissions: null, role: 'admin' });
  }
  const user = await c.var.userRepo.findById(auth.userId);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  return c.json({ permissions: user.permissions, role: user.role });
});

// ---------------------------------------------------------------------------
// GET /staff/files/*key (spec R12)
// ---------------------------------------------------------------------------

staffRoutes.get('/files/*', requireScope('dashboard'), async (c) => {
  // Extract everything after /files/
  const url = new URL(c.req.url);
  const prefix = url.pathname.replace(/.*\/files\//, '');
  const key = decodeURIComponent(prefix);

  if (!key) {
    return c.json({ error: 'Not found' }, 404);
  }

  // R6.4: only keys on the staff allow-list may be fetched. 404 (not 400) so
  // the existence of other prefixes is not leaked. Checked before touching R2.
  if (!isAllowedStaffFileKey(key)) {
    return c.json({ error: 'Not found' }, 404);
  }

  const fileStorage = c.var.fileStorage;
  const file = await fileStorage.get(key);
  if (!file) {
    return c.json({ error: 'Not found' }, 404);
  }

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  await c.var.systemAuditRepo.append({
    action: 'file_viewed',
    actor: staffEmail,
    targetType: 'file',
    details: JSON.stringify({ key }),
  });

  return new Response(file.body, {
    status: 200,
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.size),
    },
  });
});

// ---------------------------------------------------------------------------
// GET /staff/export (spec R13)
// ---------------------------------------------------------------------------

staffRoutes.get('/export', requireScope('dashboard'), async (c) => {
  const registrationRepo = c.var.registrationRepo;
  const systemAuditRepo = c.var.systemAuditRepo;

  const typeParam = c.req.query('type') as 'attendee' | 'donor' | undefined;
  const statusParam = c.req.query('status') as 'pending' | 'pending_verification' | 'confirmed' | undefined;
  const branch = c.req.query('branch');
  const search = c.req.query('search')?.toLowerCase();
  const participationTypeParam = c.req.query('participationType');

  const allRegistrations = await registrationRepo.list({
    type: typeParam,
    status: statusParam,
    branch: branch ?? undefined,
    participationType: participationTypeParam ?? undefined,
  });

  const filtered = search
    ? allRegistrations.filter(
        (r) => matchesRegistrationSearch(r, search),
      )
    : allRegistrations;

  filtered.sort((a, b) => b.createdAt - a.createdAt);

  // Audit export_downloaded (spec R13.5)
  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  await systemAuditRepo.append({
    action: 'export_downloaded',
    actor: staffEmail,
    details: JSON.stringify({
      filters: { status: statusParam, branch, search },
      count: filtered.length,
    }),
  });

  // Build CSV
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const causeColumns = CONTRIBUTION_CAUSE_VALUES.map((cause) => `contribution_${cause}`);
  const headers = ['regCode', 'fullName', 'branch', 'email', 'whatsapp', 'participationType', 'status', 'totalAmount', 'donationAmount', 'accommodation', 'createdAt', ...causeColumns];

  const escape = (val: string | number): string => {
    const s = String(val);
    // Wrap in quotes if contains comma, quote, or newline
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const rows = [
    headers.join(','),
    ...filtered.map((r) => {
      const createdAtIso = new Date(r.createdAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      const splits: Record<string, number> = r.contributionSplits;
      return [
        r.regCode,
        r.fullName,
        r.branch,
        r.email,
        r.whatsapp,
        PARTICIPATION_LABELS[r.participationType as ParticipationType] ?? r.participationType,
        r.status,
        r.totalAmount,
        r.donationAmount,
        ACCOMMODATION_LABELS[r.accommodation as AccommodationType] ?? r.accommodation,
        createdAtIso,
        ...CONTRIBUTION_CAUSE_VALUES.map((cause) => splits[cause] ?? 0),
      ]
        .map(escape)
        .join(',');
    }),
  ];

  const csv = rows.join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="registrations-${dateStr}.csv"`,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /staff/registrations/:id/archive (spec R8.3)
// ---------------------------------------------------------------------------

staffRoutes.post('/registrations/:id/archive', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:archive-registration' });
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const regId = Number(idParam);

  // Parse force flag from request body (optional, defaults to false)
  let force = false;
  try {
    const body = await c.req.json() as Record<string, unknown>;
    force = body['force'] === true;
  } catch {
    // FALLBACK-OK: docs/specs/staff-api.spec.md R19.1 — the archive request
    // body is OPTIONAL (`{ "force": true }`); "when omitted or false" the
    // guard applies, so a missing or malformed body must archive with
    // force=false. This is the only state c.req.json() can reach (no body or
    // malformed JSON), and it has a defined outcome — no fallback past it.
    // No body or invalid JSON — force stays false
  }

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  const { archivedId } = await c.var.archiveService.archive(regId, staffEmail, { force });

  await c.var.systemAuditRepo.append({
    action: 'registration_archived',
    actor: staffEmail,
    targetType: 'registration',
    targetId: regId,
    details: JSON.stringify({ archivedId, force: force || undefined }),
  });

  return c.json({ ok: true, archivedId });
});

// ---------------------------------------------------------------------------
// POST /staff/registrations/:id/cancel (plan tasks/2026-08-03-cancellation-refunds)
// ---------------------------------------------------------------------------
// Cancels a registration with verified payments: archives a full snapshot,
// creates one pending cancellation refund per verified payment (full verified
// amount), deletes payment_pending stubs / payments / the registration, and
// writes registration_cancelled + cancellation_refund_created system-audit
// events — all in one db.batch(). The reason is required (trimmed non-empty,
// 422 otherwise). 404 when the registration never existed; 409 when a payment
// is pending_verification or the registration was already archived/cancelled.

staffRoutes.post('/registrations/:id/cancel', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:cancel-registration' });
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const regId = Number(idParam);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    // FALLBACK-OK: tasks/2026-08-03-cancellation-refunds.plan.md §3
    // "Cancellation request" (request-body contract `{ reason: string }`,
    // reason required non-empty) + src/server/src/__tests__/cancellation.test.ts
    // "400 (not 422) for a malformed JSON body" (verified observation) —
    // c.req.json() rejects ONLY when the body is missing or malformed JSON,
    // and that state is contractually reported as 400 "Invalid JSON body",
    // never as a misleading 422 "reason Required" (reserved for a
    // well-formed body whose reason is missing/blank below). No fallback past
    // this state.
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const reason = body['reason'];
  if (typeof reason !== 'string' || !reason.trim()) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { reason: 'Required' } } },
      422,
    );
  }

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  const result = await c.var.cancellationService.cancel(regId, reason.trim(), staffEmail);

  return c.json(result);
});

// ---------------------------------------------------------------------------
// GET /staff/archived — paginated list of archived registrations
// ---------------------------------------------------------------------------

staffRoutes.get('/archived', requireScope('dashboard'), async (c) => {
  const search = c.req.query('search');
  const page = Math.max(1, Number(c.req.query('page') ?? '1'));
  const rawLimit = Number(c.req.query('limit') ?? '50');
  const limit = Math.min(100, Math.max(1, rawLimit));

  const { items, total } = await c.var.archivedRepo.list({
    search: search ?? undefined,
    page,
    limit,
  });

  return c.json(toPagedResponse(items, page, limit, total));
});

// ---------------------------------------------------------------------------
// GET /staff/archived/:id — single archived registration with parsed snapshot
// ---------------------------------------------------------------------------

staffRoutes.get('/archived/:id', requireScope('dashboard'), async (c) => {
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }

  const archived = await c.var.archivedRepo.findById(Number(idParam));
  if (!archived) {
    return c.json({ error: 'Not found' }, 404);
  }

  return c.json(archived);
});

// ---------------------------------------------------------------------------
// POST /staff/regenerate-thumbnails
// ---------------------------------------------------------------------------

staffRoutes.post('/regenerate-thumbnails', requireScope('admin-tools'), async (c) => {
  const result = await c.var.registrationService.regenerateMissingThumbnails();
  return c.json(result);
});

// ---------------------------------------------------------------------------
// POST /staff/sync-public-thumbnails — copy existing thumbs to CDN bucket
// ---------------------------------------------------------------------------

staffRoutes.post('/sync-public-thumbnails', requireScope('admin-tools'), async (c) => {
  const result = await c.var.registrationService.syncThumbsToPublicBucket();
  return c.json(result);
});

// ---------------------------------------------------------------------------
// POST /staff/reconcile-statuses — fix stale registration statuses
// ---------------------------------------------------------------------------

staffRoutes.post('/reconcile-statuses', requireScope('admin-tools'), async (c) => {
  let dryRun = false;
  try {
    const body = await c.req.json() as Record<string, unknown>;
    dryRun = body.dryRun === true;
  } catch {
    // No body or invalid JSON — default to dry run for safety
    dryRun = true;
  }

  const registrationRepo = c.var.registrationRepo;
  const paymentRepo = c.var.paymentRepo;

  const allRegistrations = await registrationRepo.list();
  const fixes: Array<{ id: number; regCode: string; from: RegistrationStatus; to: RegistrationStatus }> = [];

  for (const reg of allRegistrations) {
    const payments = await paymentRepo.findByRegistration(reg.id);
    const derived = deriveRegistrationStatus(payments, reg.totalAmount);
    if (derived !== reg.status) {
      if (!dryRun) {
        await registrationRepo.updateStatus(reg.id, derived);
      }
      fixes.push({ id: reg.id, regCode: reg.regCode, from: reg.status, to: derived });
    }
  }

  // Audit statuses_reconciled (spec R6.6) — fires on both dry-run and live.
  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  await c.var.systemAuditRepo.append({
    action: 'statuses_reconciled',
    actor: staffEmail,
    targetType: 'registration',
    details: JSON.stringify({
      totalChecked: allRegistrations.length,
      fixesCount: fixes.length,
      fixes,
      dryRun,
    }),
  });

  return c.json({ total: allRegistrations.length, fixed: fixes.length, fixes, dryRun });
});

// ---------------------------------------------------------------------------
// PUT /staff/registrations/:id — Edit registration (spec R10)
// ---------------------------------------------------------------------------

staffRoutes.put('/registrations/:id', requireScope('dashboard'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:registration-edit' });

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

  // updatedAt is required for optimistic locking
  const updatedAt = body['updatedAt'];
  if (typeof updatedAt !== 'number') {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { updatedAt: 'Required (number)' } } },
      422,
    );
  }

  const auth = c.var.auth as
    | { role: 'staff' | 'admin'; userId: number; email: string }
    | { role: 'attendee'; registrationId: number };
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  const staffUserId = auth.role !== 'attendee' ? auth.userId : 0;

  // Extract the fields object from the body
  const fields = (body['fields'] ?? {}) as Record<string, unknown>;
  const participationTypeResult = fields['participationType'] === undefined
    ? null
    : participationTypeSchema.safeParse(fields['participationType']);

  if (participationTypeResult !== null && !participationTypeResult.success) {
    return c.json(
      {
        error: 'Validation failed',
        details: { fieldErrors: { participationType: 'Invalid participation type' } },
      },
      422,
    );
  }

  // Extract attendees (optional — if not provided, attendees are unchanged)
  const attendeesRaw = body['attendees'];

  // Build NewAttendee list if attendees were provided
  let attendees: import('../domain/types.js').NewAttendee[] | undefined;
  if (Array.isArray(attendeesRaw)) {
    attendees = attendeesRaw.map((a: Record<string, unknown>) => ({
      registration_id: registrationId,
      type: a['type'] as 'spouse' | 'child' | 'guest',
      name: (a['name'] as string | null) ?? null,
      age: (a['age'] as number | null) ?? null,
      relationship: (a['relationship'] as string | null) ?? null,
      meal: ((a['meal'] as string) ?? 'non_veg') as import('../domain/types.js').NewAttendee['meal'],
      is_chargeable: (a['isChargeable'] as boolean) ? 1 : 0,
    }));
  }

  // Extract tshirts/additionalCharges (optional — single-save sync, per the
  // tshirt-extras-misc-charges rework: one PUT now covers registration
  // fields, attendees, t-shirts, and additional charges).
  const tshirtsRaw = body['tshirts'];
  const chargesRaw = body['additionalCharges'];

  let tshirtItems: import('../services/tshirt-charge.service.js').TshirtSyncItem[] | undefined;
  if (Array.isArray(tshirtsRaw)) {
    tshirtItems = [];
    for (const raw of tshirtsRaw as Record<string, unknown>[]) {
      const sizeResult = tshirtSizeSchema.safeParse(raw['size']);
      if (!sizeResult.success) {
        return c.json(
          { error: 'Validation failed', details: { fieldErrors: { tshirts: 'Invalid t-shirt size' } } },
          422,
        );
      }
      let gender: import('@smriti/shared').Gender | null = null;
      const genderRaw = raw['gender'];
      if (genderRaw !== undefined && genderRaw !== null) {
        const genderResult = genderSchema.safeParse(genderRaw);
        if (!genderResult.success) {
          return c.json(
            { error: 'Validation failed', details: { fieldErrors: { tshirts: 'Invalid gender' } } },
            422,
          );
        }
        gender = genderResult.data;
      }
      const idRaw = raw['id'];
      tshirtItems.push({
        id: typeof idRaw === 'number' ? idRaw : undefined,
        gender,
        size: sizeResult.data,
        isIncluded: raw['isIncluded'] === true,
      });
    }
  }

  let chargeItems: import('../services/tshirt-charge.service.js').ChargeSyncItem[] | undefined;
  if (Array.isArray(chargesRaw)) {
    chargeItems = [];
    for (const raw of chargesRaw as Record<string, unknown>[]) {
      const idRaw = raw['id'];
      chargeItems.push({
        id: typeof idRaw === 'number' ? idRaw : undefined,
        description: typeof raw['description'] === 'string' ? raw['description'] : '',
        amount: Number(raw['amount']),
      });
    }
  }

  // Pre-check (R23 parity, single-save): if a payment is pending_verification
  // and the shirt/charge portion of this save is cost-affecting (an add or
  // remove — size/gender edits and charge no-ops are cosmetic), reject the
  // WHOLE request before calling editService.edit() or writing anything.
  // Without this, edit() could commit the registration-field portion of the
  // save while the shirt/charge sync below then 409s on its own — a split
  // result the single-save UI has no way to represent. editService.edit()
  // still separately guards registration-field/attendee cost changes; this
  // pre-check only covers the part edit() doesn't know about.
  if (tshirtItems || chargeItems) {
    const existingPayments = await c.var.paymentRepo.findByRegistration(registrationId);
    const hasPendingVerification = existingPayments.some((p) => p.status === 'pending_verification');
    if (hasPendingVerification) {
      const [tshirtPlan, chargePlan] = await Promise.all([
        tshirtItems ? c.var.tshirtChargeService.planTshirtSync(registrationId, tshirtItems) : null,
        chargeItems ? c.var.tshirtChargeService.planChargeSync(registrationId, chargeItems) : null,
      ]);
      if (tshirtPlan?.costAffecting || chargePlan?.costAffecting) {
        throw new AppError(
          'Cannot make cost-affecting changes while a payment is awaiting verification. Verify or reject the pending payment first.',
          409,
        );
      }
    }
  }

  const result = await c.var.editService.edit(
    registrationId,
    {
      fields: {
        fullName: typeof fields['fullName'] === 'string' ? fields['fullName'] : undefined,
        email: typeof fields['email'] === 'string' ? fields['email'] : undefined,
        whatsapp: typeof fields['whatsapp'] === 'string' ? fields['whatsapp'] : undefined,
        mobileAlternate: fields['mobileAlternate'] !== undefined
          ? (fields['mobileAlternate'] as string | null)
          : undefined,
        branch: typeof fields['branch'] === 'string' ? fields['branch'] : undefined,
        city: typeof fields['city'] === 'string' ? fields['city'] : undefined,
        country: typeof fields['country'] === 'string' ? fields['country'] : undefined,
        gender: typeof fields['gender'] === 'string' ? fields['gender'] : undefined,
        tshirtSize: typeof fields['tshirtSize'] === 'string' ? fields['tshirtSize'] : undefined,
        alumniMeal: typeof fields['alumniMeal'] === 'string' ? fields['alumniMeal'] : undefined,
        attendanceIntent: typeof fields['attendanceIntent'] === 'string'
          ? fields['attendanceIntent'] as import('@smriti/shared').AttendanceIntent
          : undefined,
        participationType: participationTypeResult?.data,
        accommodation: typeof fields['accommodation'] === 'string' ? fields['accommodation'] : undefined,
        checkIn: fields['checkIn'] !== undefined ? (fields['checkIn'] as string | null) : undefined,
        checkOut: fields['checkOut'] !== undefined ? (fields['checkOut'] as string | null) : undefined,
        extraBed: typeof fields['extraBed'] === 'boolean' ? fields['extraBed'] : undefined,
        breakfastAdult: typeof fields['breakfastAdult'] === 'number' ? fields['breakfastAdult'] : undefined,
        breakfastChild: typeof fields['breakfastChild'] === 'number' ? fields['breakfastChild'] : undefined,
        donationAmount: typeof fields['donationAmount'] === 'number' ? fields['donationAmount'] : undefined,
        publicAck: typeof fields['publicAck'] === 'boolean' ? fields['publicAck'] : undefined,
        ackDisplayName: fields['ackDisplayName'] !== undefined
          ? (fields['ackDisplayName'] as string | null)
          : undefined,
        felicitation: typeof fields['felicitation'] === 'boolean' ? fields['felicitation'] : undefined,
        idNote: fields['idNote'] !== undefined ? (fields['idNote'] as string | null) : undefined,
        contributionSplits: typeof fields['contributionSplits'] === 'object' && fields['contributionSplits'] !== null
          ? (fields['contributionSplits'] as Record<string, number>)
          : undefined,
      },
      attendees,
      updatedAt,
    },
    staffEmail,
  );

  // Single-save sync: apply the t-shirt/charge diffs after the registration
  // fields + attendees commit successfully. Each sync recalculates pricing
  // from the live tshirts/additional_charges tables when it's cost-affecting
  // (create/delete) — recalcAndPersist() is idempotent, so running it twice
  // (once per sync call) converges on the same final total either way. The
  // last recalc to run reflects the true final state and wins.
  let pricingBreakup = result.pricingBreakup;
  let paymentDelta = result.paymentDelta;
  let paymentAction = result.paymentAction;

  if (tshirtItems) {
    const tshirtSync = await c.var.tshirtChargeService.syncTshirts(registrationId, tshirtItems, staffEmail);
    if (tshirtSync.recalc) {
      pricingBreakup = tshirtSync.recalc.pricingBreakup;
      paymentDelta = tshirtSync.recalc.paymentDelta;
      paymentAction = tshirtSync.recalc.paymentAction;
    }
  }
  if (chargeItems) {
    const chargeSync = await c.var.tshirtChargeService.syncCharges(registrationId, chargeItems, staffUserId, staffEmail);
    if (chargeSync.recalc) {
      pricingBreakup = chargeSync.recalc.pricingBreakup;
      paymentDelta = chargeSync.recalc.paymentDelta;
      paymentAction = chargeSync.recalc.paymentAction;
    }
  }

  // Sync calls above may have updated the registration row again (repricing
  // touches updated_at) — reload so the optimistic-lock token in the response
  // reflects the true final state, not the pre-sync snapshot from edit().
  const [finalRegistration, finalTshirts, finalCharges] = await Promise.all([
    (tshirtItems || chargeItems)
      ? c.var.registrationRepo.findById(registrationId)
      : Promise.resolve(result.registration),
    c.var.tshirtRepo.findByRegistration(registrationId),
    c.var.chargeRepo.findByRegistration(registrationId),
  ]);
  const reg = finalRegistration ?? result.registration;

  return c.json({
    registration: {
      id: reg.id,
      regCode: reg.regCode,
      status: reg.status,
      fullName: reg.fullName,
      email: reg.email,
      updatedAt: reg.updatedAt,
    },
    pricingBreakup,
    paymentDelta,
    paymentAction,
    tshirts: finalTshirts,
    additionalCharges: finalCharges,
  });
});

// ---------------------------------------------------------------------------
// GET /staff/room-inventory — room quotas + occupancy per night
// ---------------------------------------------------------------------------

function roomsConsumedFor(occ: {
  private: number;
  shared_double: { count: number; rooms: number };
  shared_triple: { count: number; rooms: number };
} | undefined): number {
  if (!occ) return 0;
  return occ.private + occ.shared_double.rooms + occ.shared_triple.rooms;
}

staffRoutes.get('/room-inventory', requireScope('resources'), async (c) => {
  const [totals, occupancyByNight] = await Promise.all([
    c.var.inventoryRepo.get(),
    c.var.attendeeRepo.accommodationByNight(),
  ]);

  const inventory: Record<string, { totalRooms: number; roomsConsumed: number }> = {};
  const overCommitted: Record<string, boolean> = {};

  for (const night of CHECKIN_OPTIONS) {
    const totalRooms = totals[night] ?? 0;
    const roomsConsumed = roomsConsumedFor(occupancyByNight[night]);
    inventory[night] = { totalRooms, roomsConsumed };
    overCommitted[night] = roomsConsumed > totalRooms;
  }

  return c.json({ inventory, overCommitted });
});

// ---------------------------------------------------------------------------
// PUT /staff/room-inventory — set room quotas per night
// ---------------------------------------------------------------------------

staffRoutes.put('/room-inventory', requireScope('resources'), async (c) => {
  setRequestMeta(c, { reqType: 'staff:room-inventory-update' });

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const fieldErrors: Record<string, string> = {};
  const newInventory: Record<string, number> = {};

  for (const [night, value] of Object.entries(body)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      fieldErrors[night] = 'Must be a non-negative integer';
      continue;
    }
    newInventory[night] = value;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return c.json({ error: 'Validation failed', details: { fieldErrors } }, 422);
  }

  await c.var.inventoryRepo.set(newInventory);

  const occupancyByNight = await c.var.attendeeRepo.accommodationByNight();
  const overCommitted: Record<string, boolean> = {};
  for (const [night, totalRooms] of Object.entries(newInventory)) {
    overCommitted[night] = roomsConsumedFor(occupancyByNight[night]) > totalRooms;
  }

  // Audit room_inventory_updated (spec R6.6).
  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  await c.var.systemAuditRepo.append({
    action: 'room_inventory_updated',
    actor: staffEmail,
    targetType: 'inventory',
    details: JSON.stringify({ newInventory, overCommitted }),
  });

  return c.json({ ok: true, overCommitted });
});
