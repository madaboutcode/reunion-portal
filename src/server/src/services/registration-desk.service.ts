/**
 * CONTRACT: Registration-desk application service (see
 * docs/specs/interfaces/registration-desk-api.ispec.md and
 * tasks/registration-desk.design.md).
 *
 * GUARANTEE: LOOKUP_ELIGIBILITY — lookupByCode and checkIn resolve a
 *   registration only when it exists AND is not donation-only; donation-only
 *   and missing records both surface as NotFoundError (ispec R3.1/R4.2).
 *   Marking present never MUTATES payment state — checkIn only reads the
 *   verified sum to gate the transition (PAYMENT_GATES_CHECK_IN below); it
 *   never writes to a payment row.
 *
 * GUARANTEE: CHECK_IN_IDEMPOTENT — checkIn uses the guarded markPresent
 *   UPDATE (WHERE checked_in_at IS NULL). The audit entry is written exactly
 *   once, only by the request that performed the mutation; a repeat returns
 *   the original timestamp with no second audit row (ispec R4.1).
 *
 * GUARANTEE: PAYMENT_GATES_CHECK_IN — checkIn rejects the checked_in_at
 *   NULL -> present transition with AppError 409 `payment_required` when
 *   outstanding (total_amount - verified sum) is > 0 (reverses the old R4.3
 *   "pending may still be checked in" rule — server-side backstop for the
 *   web's hard gate, closing the stale-tab/direct-API/spot-path bypass). The
 *   gate runs ONLY on that transition — an already-present registration
 *   (checked_in_at already set) always replays the idempotent success, even
 *   if a charge added after check-in created a new outstanding balance
 *   (attendance and payment are independent once present — design "Detail-
 *   footer gate" footer state c: adding a charge while present does not
 *   undo check-in). This preserves CHECK_IN_IDEMPOTENT exactly as before.
 *
 * GUARANTEE: SPOT_IDEMPOTENCY — createSpotRegistration replays the original
 *   desk-safe response for the same (actor, key, body) after a successful
 *   creation, returns 409 for the same (actor, key) with a different body,
 *   and returns 409 for a fresh key that matches an existing WhatsApp/email
 *   (ispec R5.5/R5.6, R6.1/R6.2). The registration, payment, and idempotency
 *   row are written in one atomic batch (desk.repo.ts SPOT_CREATE_ATOMIC), so
 *   a concurrent duplicate key rolls back the whole insert — no orphan
 *   registration and no second registration from one confirmed submission.
 *
 * GUARANTEE: NO_AUTO_CHECK_IN — a spot registration is created with
 *   checked_in_at NULL; marking present is always a separate explicit action
 *   (registration-desk.spec.md R5.6).
 *
 * GUARANTEE: DESK_SETTLE_FULL_ONLY — settleDeskPayment always settles the
 *   entire outstanding balance (total_amount minus verified sum); there is no
 *   partial-amount path. It handles both payment_pending and
 *   pending_verification pending payments (the desk settlement supersedes an
 *   online proof upload — settleAtDesk also clears proof_file_key/gateway_ref/
 *   gateway_response so a desk-settled row never looks like both an in-person
 *   collection and an online bank transfer) and 409s when nothing is owed. On
 *   success it re-derives registration status via deriveRegistrationStatus
 *   and appends a 'desk_payment_collected' audit row — using the SAME
 *   createSnapshot(registration, attendees) shape every other registration-
 *   scoped audit entry uses (audit.ts SNAPSHOT_SHAPE) — to the SAME audit_log
 *   the dashboard payment flows use (auditRepo), distinct from the desk's
 *   system_audit_log (present/absent/spot-create), because this event is
 *   registration-scoped money history, not a desk-operator action log.
 *
 * GUARANTEE: DESK_SETTLE_SENDS_CONFIRMATION — when a settle transitions the
 *   registration to 'confirmed' (which every successful settle does — the
 *   outstanding<=0 guard already excludes the already-confirmed case), it
 *   sends the SAME payment-confirmed email verifyPayment sends on
 *   confirmation (sendPaymentConfirmedEmail mirrors payment.service.ts's
 *   verifyPayment confirmed-email block field-for-field), fire-and-forget —
 *   an email failure is logged and never fails or undoes the settle.
 *
 * GUARANTEE: DESK_CHARGE_REUSES_PIPELINE — addDeskCharge delegates entirely
 *   to TshirtChargeService.addCharge (the SAME pipeline the staff dashboard
 *   uses), so total_amount/pricing_snapshot recompute and the pending balance
 *   reconciliation are byte-identical to the dashboard edit page. addCharge's
 *   422 (bad amount/description) guards pass through unchanged; its 409
 *   (pending_verification) is remapped to code 'payment_under_verification'
 *   so the desk client can distinguish it from other 409s without parsing
 *   the message.
 *
 * GUARANTEE: DESK_CHARGE_SENDS_PAYMENT_EMAIL — addDeskCharge sends the SAME
 *   additional-payment / revised-payment notification the staff edit page's
 *   PUT-save flow sends (edit.service.ts sendPaymentEmail): sendAdditionalPayment
 *   when the charge created a fresh pending payment, sendRevisedPayment when
 *   it grew an existing one — chosen from TshirtChargeService.addCharge's
 *   returned paymentAction, with the same authService.createPaymentLinkUrl →
 *   plain /pay/:regCode fallback. This is a DELIBERATE reversal of the
 *   original plan's "no email on the charge path" decision — the desk
 *   collects in person, but the committee confirmed the attendee should still get a
 *   payment-link record of the charge, matching the edit page. Email failure
 *   is logged and swallowed (try/catch — same posture as
 *   payment.service.ts's createBalancePayment/verifyPayment notifications);
 *   it never fails the charge itself.
 *
 * GUARANTEE: SERVER_OWNED_PRICING — totalAmount, pricing lines, payment
 *   status, and payment records are computed server-side from the allowed
 *   fields (ispec R5.2). The client can never set them — the request schema
 *   rejects those keys as unknown.
 *
 * GUARANTEE: SPOT_CREATE_RETURNS_IMMEDIATELY — createSpotRegistration does no
 *   photo work. It returns as soon as the atomic create (or idempotency
 *   replay) resolves. Relocating the pending photo and generating/publishing
 *   its thumbnail is the caller's job, off the response path — see
 *   registration-desk.routes.ts (c.executionCtx.waitUntil(
 *   registrationService.relocateFiles(id, regCode))), which reuses
 *   RegistrationService's self-registration finalization verbatim.
 *
 * EXPECTS: the caller has already authenticated as staff/admin and holds the
 *   registration_desk scope (route-level requireScope). Inputs arrive already
 *   validated by deskSpotRegistrationSchema (422 at the boundary).
 *
 * FAILURE BEHAVIOR:
 *   - NotFoundError (404) for missing/donation-only registrations.
 *   - AppError 409 for idempotency conflicts and duplicate WhatsApp/email.
 *   - DeskStateError for an unknown payment state — propagates as 500 with a
 *     safe message (hard failure, never a guessed default).
 *   - D1 errors propagate. Expired idempotency rows are pruned before key
 *     lookup; prune failure stops creation rather than applying stale keys.
 *
 * KNOWN LIMITATIONS: none for the documented normal flows.
 */

import type {
  IAttendeeRepository,
  IAuditRepository,
  IDeskRepository,
  IEmailService,
  IPaymentRepository,
  IRefundRepository,
  IRegistrationRepository,
  IRoomRepository,
} from '../repositories/interfaces.js';
import { generateRegCode } from '../domain/reg-id.js';
import type { Attendee, NewAttendee, Payment, Refund, Registration } from '../domain/types.js';
import { createSnapshot } from '../domain/audit.js';
import type { RegistrationInsertSet } from '../domain/registration-insert-set.js';
import { deriveRegistrationStatus } from '../domain/status.js';
import type { DeskPaymentMethod, PricingBreakup } from '@smriti/shared';
import { createLogger, parseLogLevel, type Logger } from '../infra/logger.js';
import {
  mapDeskPaymentState,
  rankDeskSearch,
  toDeskOverviewTshirt,
  toDeskPhotosVersion,
  toDeskRoomNumbers,
  toDeskSearchCandidate,
  type DeskOverviewGroup,
  type DeskSpotRegistrationInput,
} from '../domain/desk-types.js';
import { DESK_IDEMPOTENCY_RETENTION_MS } from '../domain/desk-types.js';
import {
  toDeskCheckInResponse,
  toDeskOverviewResponse,
  toDeskSearchResponse,
  toDeskSpotRegistrationResponse,
  toDeskStatsResponse,
  type DeskOverviewResponse,
  type DeskStatsResponse,
} from '../domain/desk-mapper.js';
import { PricingService } from './pricing.service.js';
import type { RecalcResult, TshirtChargeService } from './tshirt-charge.service.js';
import { NotFoundError, AppError } from './errors.js';

export class RegistrationDeskService {
  private deskRepo: IDeskRepository;
  private registrationRepo: IRegistrationRepository;
  private attendeeRepo: IAttendeeRepository;
  private paymentRepo: IPaymentRepository;
  private roomRepo: IRoomRepository;
  private pricingService: PricingService;
  private auditRepo: IAuditRepository;
  private tshirtChargeService: TshirtChargeService;
  private emailService: IEmailService;
  private refundRepo: IRefundRepository;
  private appBaseUrl: string;
  private authService: { createPaymentLinkUrl(registrationId: number, regCode: string): Promise<string> } | null;
  private log: Logger;
  private now: () => number;

  constructor(deps: {
    deskRepo: IDeskRepository;
    registrationRepo: IRegistrationRepository;
    attendeeRepo: IAttendeeRepository;
    paymentRepo: IPaymentRepository;
    roomRepo: IRoomRepository;
    pricingService: PricingService;
    auditRepo: IAuditRepository;
    tshirtChargeService: TshirtChargeService;
    emailService: IEmailService;
    refundRepo: IRefundRepository;
    /** Base URL for the passUrl link in the settle-confirmation email
     *  (mirrors payment.service.ts's appBaseUrl — same field, same use). */
    appBaseUrl: string;
    /** Optional — when absent, the charge-notification payment link falls
     *  back to a plain /pay/:regCode URL (same fallback edit.service.ts and
     *  payment.service.ts use). */
    authService?: { createPaymentLinkUrl(registrationId: number, regCode: string): Promise<string> };
    logLevel?: string;
    /** Clock injection for deterministic tests. Defaults to Date.now. */
    now?: () => number;
  }) {
    this.deskRepo = deps.deskRepo;
    this.registrationRepo = deps.registrationRepo;
    this.attendeeRepo = deps.attendeeRepo;
    this.paymentRepo = deps.paymentRepo;
    this.roomRepo = deps.roomRepo;
    this.pricingService = deps.pricingService;
    this.auditRepo = deps.auditRepo;
    this.tshirtChargeService = deps.tshirtChargeService;
    this.emailService = deps.emailService;
    this.refundRepo = deps.refundRepo;
    this.appBaseUrl = deps.appBaseUrl;
    this.authService = deps.authService ?? null;
    this.log = createLogger('registration-desk', parseLogLevel(deps.logLevel));
    this.now = deps.now ?? (() => Date.now());
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  async search(query: string, thumbsBaseUrl: string) {
    const candidates = await this.deskRepo.searchCandidates(query);
    const ranked = rankDeskSearch(candidates.map(toDeskSearchCandidate), query);
    const photosVersion = toDeskPhotosVersion(ranked);
    return toDeskSearchResponse(ranked, thumbsBaseUrl, photosVersion);
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  /**
   * Live desk counts for the roster footer: overall total + present, broken
   * down by participation type. Pure count aggregation — it reads no
   * registration data (names, contact, payment) and returns none, so it stays
   * within the desk allowlist. Donation-only is excluded (repo-level).
   */
  async getStats(): Promise<DeskStatsResponse> {
    const rows = await this.deskRepo.countStats();
    return toDeskStatsResponse(rows);
  }

  // -------------------------------------------------------------------------
  // Lookup
  // -------------------------------------------------------------------------

  async lookupByCode(code: string) {
    const row = await this.deskRepo.findOverviewByCode(code);
    if (!row || row.participation_type === 'donation_only') {
      throw new NotFoundError('Attendee not found');
    }
    return this.buildOverview(row.id, row);
  }

  private async buildOverview(registrationId: number, knownRow?: import('../domain/desk-types.js').DeskOverviewRow) {
    const row = knownRow ?? await this.deskRepo.findOverviewRow(registrationId);
    if (!row) throw new NotFoundError('Attendee not found');

    const attendees = await this.attendeeRepo.findByRegistration(registrationId);
    const group: DeskOverviewGroup = {
      spouse: attendees
        .filter((a) => a.type === 'spouse')
        .map((a) => ({ name: a.name, mealPreference: a.meal })),
      children: attendees
        .filter((a) => a.type === 'child')
        .map((a) => ({ name: a.name, age: a.age, mealPreference: a.meal })),
      guests: attendees
        .filter((a) => a.type === 'guest')
        .map((a) => ({ name: a.name, mealPreference: a.meal })),
    };

    const state = mapDeskPaymentState(row.status);
    const verifiedSum = await this.paymentRepo.sumVerifiedByRegistration(registrationId);
    const amountDue = state === 'payment_pending' ? row.total_amount - verifiedSum : null;

    const tshirtRows = await this.deskRepo.findTshirts(registrationId);
    const tshirts = tshirtRows.map(toDeskOverviewTshirt);

    const assignments = await this.roomRepo.listAssignmentsByRegistration(registrationId);
    const rooms = toDeskRoomNumbers(assignments);

    return toDeskOverviewResponse(row, group, amountDue, tshirts, rooms);
  }

  // -------------------------------------------------------------------------
  // Check-in
  // -------------------------------------------------------------------------

  async checkIn(
    registrationId: number,
    actor: { userId: number; email: string },
  ) {
    const reg = await this.deskRepo.findOverviewRow(registrationId);
    if (!reg || reg.participation_type === 'donation_only') {
      throw new NotFoundError('Attendee not found');
    }

    // Gate only the absent -> present transition — an idempotent repeat on
    // an already-present registration must keep replaying success even if a
    // later charge left a new balance outstanding (see PAYMENT_GATES_CHECK_IN).
    if (reg.checked_in_at === null) {
      const verifiedSum = await this.paymentRepo.sumVerifiedByRegistration(registrationId);
      const outstanding = reg.total_amount - verifiedSum;
      if (outstanding > 0) {
        throw new AppError('Settle payment before check-in', 409, 'payment_required');
      }
    }

    const checkedInAt = this.now();
    await this.deskRepo.markPresent(registrationId, checkedInAt, actor.userId, actor.email);

    const current = await this.deskRepo.findOverviewRow(registrationId);
    if (!current || current.checked_in_at === null) {
      throw new Error(`Registration ${registrationId} has no check-in timestamp after markPresent`);
    }
    return toDeskCheckInResponse(current.checked_in_at);
  }

  /**
   * Reverses a check-in (desk operator hit the wrong row / an attendee
   * turned out to not be who they claimed). Same idempotency posture as
   * checkIn: a repeat undo or an undo on a never-checked-in registration is
   * a no-op (writes 0 rows, no second audit entry) and returns the cleared
   * state. Returns the canonical absent response — UI updates identically.
   */
  async unmarkPresent(
    registrationId: number,
    actor: { userId: number; email: string },
  ) {
    const reg = await this.deskRepo.findOverviewRow(registrationId);
    if (!reg || reg.participation_type === 'donation_only') {
      throw new NotFoundError('Attendee not found');
    }

    await this.deskRepo.markAbsent(registrationId, actor.email);
    return toDeskCheckInResponse(null);
  }

  // -------------------------------------------------------------------------
  // Payment collection
  // -------------------------------------------------------------------------

  /**
   * Settles the FULL outstanding balance in person (cash / UPI / bank
   * transfer). There is no partial-amount parameter by design — the desk
   * collects everything owed in one action (plan Pre-Decisions: settlement
   * granularity). Handles both payment_pending (the normal case) and
   * pending_verification (an online proof upload the desk pre-empts) — the
   * desk settle simply supersedes it, same as the design's pending_verification
   * decision. AppError 409 when nothing is owed (already settled).
   */
  async settleDeskPayment(
    registrationId: number,
    method: DeskPaymentMethod,
    note: string | undefined,
    actor: { userId: number; email: string },
  ): Promise<DeskOverviewResponse> {
    const row = await this.deskRepo.findOverviewRow(registrationId);
    if (!row || row.participation_type === 'donation_only') {
      throw new NotFoundError('Attendee not found');
    }

    const verifiedSum = await this.paymentRepo.sumVerifiedByRegistration(registrationId);
    const outstanding = row.total_amount - verifiedSum;
    if (outstanding <= 0) {
      throw new AppError('Payment is already settled', 409);
    }

    const payments = await this.paymentRepo.findByRegistration(registrationId);
    const pending = payments.find(
      (p) => p.status === 'payment_pending' || p.status === 'pending_verification',
    );
    const paymentId = pending
      ? pending.id
      : (
          await this.paymentRepo.create({
            registration_id: registrationId,
            amount: outstanding,
            status: 'payment_pending',
            gateway: null,
            gateway_ref: null,
            gateway_response: null,
            proof_file_key: null,
            verified_by: null,
            verified_at: null,
          })
        ).id;

    const verifiedAt = this.now();
    await this.paymentRepo.settleAtDesk(paymentId, {
      amount: outstanding,
      method,
      note: note ?? null,
      verifiedBy: actor.email,
      verifiedAt,
    });

    const freshPayments = await this.paymentRepo.findByRegistration(registrationId);
    const derivedStatus = deriveRegistrationStatus(freshPayments, row.total_amount);
    if (derivedStatus !== row.status) {
      await this.registrationRepo.updateStatus(registrationId, derivedStatus);
    }

    const reg = await this.registrationRepo.findById(registrationId);
    if (!reg) throw new NotFoundError('Registration not found');
    const attendees = await this.attendeeRepo.findByRegistration(registrationId);

    await this.auditRepo.append({
      registration_id: registrationId,
      action: 'desk_payment_collected',
      actor: actor.email,
      changes: JSON.stringify({ amount: outstanding, method, ...(note ? { note } : {}) }),
      snapshot: createSnapshot(reg, attendees),
    });

    // Reaching this branch means the settle actually transitioned the
    // registration to confirmed, never an already-confirmed no-op: the
    // outstanding<=0 guard above already rejects a settle on a registration
    // that's already fully paid, and settling exactly the outstanding
    // balance always brings sumVerified to total_amount, so derivedStatus is
    // always 'confirmed' by the time we get here. The explicit check mirrors
    // verifyPayment's own guard exactly rather than relying on that math.
    if (derivedStatus === 'confirmed') {
      // freshPayments (post-settleAtDesk), NOT the stale payments read at the
      // top of this method — that pre-settle array is missing the payment
      // entirely in the no-pending-row branch (the row didn't exist yet when
      // `payments` was fetched), which silently dropped it from the
      // confirmation email. Same reasoning as verifyPayment: build the
      // confirmation email from post-settlement state.
      await this.sendPaymentConfirmedEmail(reg, attendees, freshPayments, paymentId, outstanding, method);
    }

    return this.buildOverview(registrationId);
  }

  /**
   * Mirrors payment.service.ts's verifyPayment confirmed-email block
   * EXACTLY: same method (emailService.sendPaymentConfirmed), same data
   * shape, same refund lookup + pending-refunds surfacing, same
   * fire-and-forget try/catch (a notification failure must never undo an
   * already-committed settle — same posture as verifyPayment/
   * createBalancePayment). The only adaptation: verifyPayment shows the
   * gateway reference a staff member typed for the just-verified payment; a
   * desk settlement has no gateway, so the collection method
   * ('cash'/'upi'/'bank_transfer') fills that slot instead.
   */
  private async sendPaymentConfirmedEmail(
    reg: Registration,
    attendees: Attendee[],
    allPayments: Payment[],
    settledPaymentId: number,
    settledAmount: number,
    method: DeskPaymentMethod,
  ): Promise<void> {
    try {
      const spouse = attendees.find((a) => a.type === 'spouse');
      const childCount = attendees.filter((a) => a.type === 'child').length;
      const guestCount = attendees.filter((a) => a.type === 'guest').length;

      let pricingBreakup: PricingBreakup;
      try {
        pricingBreakup = reg.pricingSnapshot;
      } catch {
        pricingBreakup = { base: 0, lines: [], donation: 0, collegeContribution: 0, total: settledAmount };
      }

      // Query refunds so the email can show actual amounts paid and any
      // pending refunds — same reasoning as verifyPayment.
      let allRefunds: Refund[] = [];
      try {
        allRefunds = await this.refundRepo.findByRegistration(reg.id);
      } catch {
        // refund query failure shouldn't block the email
      }

      const refundByPayment = new Map<number, number>();
      for (const r of allRefunds) {
        if (r.sourcePaymentId === null) continue;
        refundByPayment.set(r.sourcePaymentId, (refundByPayment.get(r.sourcePaymentId) ?? 0) + r.amount);
      }

      const verifiedPayments = allPayments
        .filter((p) => p.id === settledPaymentId || p.status === 'verified')
        .map((p) => {
          if (p.id === settledPaymentId) {
            return { amount: settledAmount, referenceId: method, date: p.createdAt };
          }
          const refundAmount = refundByPayment.get(p.id) ?? 0;
          return { amount: p.amount + refundAmount, referenceId: p.gatewayRef ?? '—', date: p.createdAt };
        });

      const pendingRefunds = allRefunds
        .filter((r) => r.status === 'pending')
        .map((r) => ({ amount: r.amount }));

      await this.emailService.sendPaymentConfirmed(reg.email, {
        fullName: reg.fullName,
        regCode: reg.regCode,
        payments: verifiedPayments,
        branch: reg.branch,
        attendanceIntent: reg.attendanceIntent,
        participationType: reg.participationType,
        alumniMeal: reg.alumniMeal,
        tshirtSize: reg.tshirtSize,
        spouseName: spouse?.name ?? null,
        childCount,
        guestCount,
        accommodation: reg.accommodation,
        checkIn: reg.checkIn,
        checkOut: reg.checkOut,
        extraBed: reg.extraBed,
        pricingBreakup,
        passUrl: `${this.appBaseUrl}/pass#${reg.regCode}`,
        refunds: pendingRefunds.length > 0 ? pendingRefunds : undefined,
      });
      this.log.info('Payment confirmed email sent', { to: reg.email, regCode: reg.regCode });
    } catch (err) {
      this.log.error('Payment confirmed email failed', { to: reg.email, error: String(err) });
    }
  }

  // -------------------------------------------------------------------------
  // Additional charges
  // -------------------------------------------------------------------------

  /**
   * Adds an ad-hoc charge (reason + amount), reusing the SAME charge pipeline
   * the staff dashboard uses (TshirtChargeService.addCharge ->
   * recalcAndPersist): recomputes total_amount and creates/updates the single
   * payment_pending row for the full delta. Sends the SAME additional-payment
   * notification the staff edit page sends for a cost-affecting save — see
   * sendChargeEmail below. Inherits addCharge's 422 (bad amount/description)
   * and 409 (pending_verification) guards; the 409 is remapped to a stable
   * `payment_under_verification` code so the client can detect it without
   * parsing the message.
   */
  async addDeskCharge(
    registrationId: number,
    description: string,
    amount: number,
    actor: { userId: number; email: string },
  ): Promise<DeskOverviewResponse> {
    const row = await this.deskRepo.findOverviewRow(registrationId);
    if (!row || row.participation_type === 'donation_only') {
      throw new NotFoundError('Attendee not found');
    }

    let recalc: RecalcResult;
    try {
      ({ recalc } = await this.tshirtChargeService.addCharge(
        registrationId,
        { description, amount },
        actor.userId,
        actor.email,
      ));
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 409) {
        throw new AppError('Payment is under verification', 409, 'payment_under_verification');
      }
      throw err;
    }

    // A positive-amount charge always raises the total, so paymentAction is
    // always 'created' or 'updated' here — never 'none'/'deleted' (those only
    // happen when a recalc lowers or zeroes the pending balance).
    if (recalc.paymentAction === 'created' || recalc.paymentAction === 'updated') {
      await this.sendChargeEmail(recalc.registration, recalc.paymentAction, recalc.paymentDelta, recalc.pricingBreakup);
    }

    return this.buildOverview(registrationId);
  }

  /**
   * Mirrors edit.service.ts's private sendPaymentEmail: sendAdditionalPayment
   * for a freshly created pending payment, sendRevisedPayment for a grown
   * one, with the same createPaymentLinkUrl → /pay/:regCode fallback.
   * Failure is logged and swallowed — same posture as payment.service.ts's
   * notification sends (createBalancePayment, verifyPayment): a notification
   * failure must never fail the charge that already committed.
   */
  private async sendChargeEmail(
    reg: Registration,
    paymentAction: 'created' | 'updated',
    delta: number,
    breakup: PricingBreakup,
  ): Promise<void> {
    try {
      let paymentUrl = `/pay/${reg.regCode}`;
      if (this.authService) {
        try {
          paymentUrl = await this.authService.createPaymentLinkUrl(reg.id, reg.regCode);
        } catch (linkErr) {
          this.log.warn('Payment link generation failed, falling back', { error: String(linkErr) });
        }
      }

      if (paymentAction === 'updated') {
        await this.emailService.sendRevisedPayment(reg.email, {
          fullName: reg.fullName,
          amount: delta,
          breakup,
          paymentLink: paymentUrl,
        });
      } else {
        await this.emailService.sendAdditionalPayment(reg.email, {
          fullName: reg.fullName,
          amount: delta,
          breakup,
          paymentLink: paymentUrl,
        });
      }
      this.log.info('Desk charge notification sent', { to: reg.email, regCode: reg.regCode });
    } catch (err) {
      this.log.error('Desk charge notification failed', { to: reg.email, error: String(err) });
    }
  }

  // -------------------------------------------------------------------------
  // Spot registration
  // -------------------------------------------------------------------------

  async createSpotRegistration(
    input: DeskSpotRegistrationInput,
    actor: { userId: number; email: string },
    idempotencyKey: string,
  ) {
    await this.deskRepo.pruneIdempotency(this.now() - DESK_IDEMPOTENCY_RETENTION_MS);
    const fingerprint = await fingerprintBody(input);

    // 1. Actor-scoped idempotency replay / conflict (ispec R5.5/R5.6).
    const existing = await this.deskRepo.findIdempotency(actor.userId, idempotencyKey);
    if (existing) {
      if (existing.fingerprint === fingerprint) {
        return { replay: true as const, body: JSON.parse(existing.response) };
      }
      throw new AppError('Idempotency key already used', 409);
    }

    // 2. Duplicate identity guard — a fresh key matching an existing
    //    WhatsApp/email returns a safe 409 (ispec R6.1/R6.2), never the
    //    existing registration's data.
    const byWhatsapp = await this.registrationRepo.findByWhatsapp(input.whatsapp);
    if (byWhatsapp.length > 0) {
      throw new AppError('A registration with this WhatsApp number already exists', 409);
    }
    const byEmail = await this.registrationRepo.findByEmail(input.email);
    if (byEmail.length > 0) {
      throw new AppError('A registration with this email already exists', 409);
    }

    // 3. Server-owned pricing and registration code.
    const pricing = this.pricingService.computeDeskPricing(toPricingRegistration(input));
    const regCode = generateRegCode();
    const insertSet = buildDeskInsertSet(input, regCode, input.email, pricing, (age) =>
      this.pricingService.isChildChargeable(age),
    );

    // 4. Atomic create: registration + attendees + payment + durable response
    //    + audit row. The repository derives the generated id inside the batch.
    let id: number;
    try {
      ({ id } = await this.deskRepo.createSpotRegistration(insertSet, {
        actorId: actor.userId,
        key: idempotencyKey,
        fingerprint,
        regCode,
        participationType: input.participationType,
        amountDue: pricing.total,
        actorEmail: actor.email,
      }));
    } catch (error) {
      const duplicateActorKey =
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed: desk_idempotency.actor_id, desk_idempotency.idem_key');
      if (!duplicateActorKey) throw error;

      const winner = await this.deskRepo.findIdempotency(actor.userId, idempotencyKey);
      if (winner?.fingerprint === fingerprint) {
        return { replay: true as const, body: JSON.parse(winner.response) };
      }
      throw new AppError('Idempotency key already used', 409);
    }

    // Photo relocation + thumbnail generation happen OFF this method, in the
    // route (registration-desk.routes.ts) via c.executionCtx.waitUntil(
    // registrationService.relocateFiles(id, regCode)) — the same finalization
    // self-registration uses. createSpotRegistration returns immediately
    // after the atomic create; no photo work runs on the response path.

    const responseBody = toDeskSpotRegistrationResponse({
      id,
      regCode,
      participationType: input.participationType,
      amountDue: pricing.total,
    });
    return { replay: false as const, body: responseBody };
  }
}

/** SHA-256 hex of the canonical (parsed, schema-shaped) request body. */
async function fingerprintBody(input: DeskSpotRegistrationInput): Promise<string> {
  const canonical = JSON.stringify(input);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Pricing projection from the desk's allowed fields. calculateTotal reads
 * only attendance/attendees/donation/contributionSplits/accommodation, never
 * contact. The DB insert separately stores NULL/empty values for fields the
 * desk contract does not collect.
 */
function toPricingRegistration(input: DeskSpotRegistrationInput): import('@smriti/shared').PricingRegistration {
  return {
    attendance: {
      intent: 'attending',
      participationType: input.participationType,
      alumniMeal: input.alumniMeal,
    },
    attendees: {
      spouse: input.spouse
        ? { name: input.spouse.name, meal: input.spouse.mealPreference }
        : undefined,
      children: input.children.map((c) => ({
        name: c.name,
        age: c.age,
        meal: c.mealPreference,
      })),
      guests: input.guests.map((g) => ({
        name: g.name,
        meal: g.mealPreference,
      })),
    },
    contributionSplits: {},
    ...(input.donationAmount !== undefined && input.donationAmount > 0
      ? { donation: { amount: input.donationAmount } }
      : {}),
  };
}

/**
 * Desk insert set: the exact allowed fields mapped to the canonical
 * registration insert shape. Email is already resolved to either the supplied
 * value or the reg-code donor convention before this function runs.
 */
function buildDeskInsertSet(
  input: DeskSpotRegistrationInput,
  regCode: string,
  email: string,
  pricing: import('@smriti/shared').PricingBreakup,
  isChildChargeable: (age: number) => boolean,
): RegistrationInsertSet {
  const attendees: NewAttendee[] = [];

  if (input.spouse) {
    attendees.push({
      registration_id: 0,
      type: 'spouse',
      name: input.spouse.name,
      age: null,
      relationship: null,
      meal: input.spouse.mealPreference,
      is_chargeable: 1,
    });
  }

  for (const child of input.children) {
    attendees.push({
      registration_id: 0,
      type: 'child',
      name: child.name,
      age: child.age,
      relationship: null,
      meal: child.mealPreference,
      is_chargeable: isChildChargeable(child.age) ? 1 : 0,
    });
  }

  for (const guest of input.guests) {
    attendees.push({
      registration_id: 0,
      type: 'guest',
      name: guest.name,
      age: null,
      relationship: null,
      meal: guest.mealPreference,
      is_chargeable: 1,
    });
  }

  return {
    registration: {
      reg_code: regCode,
      full_name: input.fullName,
      branch: input.branch,
      email,
      whatsapp: input.whatsapp,
      mobile_alternate: null,
      city: '', // DB "Unknown" convention; desk contract does not collect it
      country: 'India',
      attendance_intent: 'attending',
      participation_type: input.participationType,
      gender: null,
      tshirt_size: null,
      alumni_meal: input.alumniMeal,
      accommodation: 'none',
      check_in: null,
      check_out: null,
      extra_bed: 0,
      donation_amount: input.donationAmount ?? 0,
      public_ack: 0,
      ack_display_name: null,
      felicitation: 0,
      contribution_splits: JSON.stringify({}),
      pricing_snapshot: JSON.stringify(pricing),
      total_amount: pricing.total,
      id_note: null,
      photo_file_key: input.photoFileKey,
    },
    attendees,
    document: null,
    payment: {
      registration_id: 0,
      amount: pricing.total,
      status: 'payment_pending',
      gateway: null,
      gateway_ref: null,
      gateway_response: null,
      proof_file_key: null,
      verified_by: null,
      verified_at: null,
    },
  };
}
