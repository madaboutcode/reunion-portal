/**
 * CONTRACT
 *
 * GUARANTEE: DONATION_ONLY_BLOCK (R22) — addTshirt() throws AppError 400 when
 *   the registration's participationType is 'donation_only'. No server-side
 *   check exists on the other mutating methods for this rule — only adding a
 *   shirt to a donation-only registration is meaningful to block.
 *
 * GUARANTEE: PENDING_VERIFICATION_BLOCK (R23) — addTshirt, removeTshirt,
 *   addCharge, and removeCharge all throw AppError 409 when any payment for
 *   the registration is in 'pending_verification' status. This reuses the
 *   same rule as edit.service.ts's EDIT_PENDING_VERIFICATION_BLOCK — no new
 *   business logic, same guarantee. updateTshirt (size/gender only) is
 *   cosmetic per R17/R23 and is never blocked.
 *
 * GUARANTEE: DERIVED_PRICING (R16) — after every cost-affecting mutation, the
 *   registration's total_amount and pricing_snapshot are recomputed from the
 *   live tshirts/additional_charges rows via calculateTotal() — the t-shirt
 *   charge is never incremented/decremented in place, always derived fresh
 *   from `count(is_included = 0) * tshirtExtraRate`.
 *
 * GUARANTEE: MIRROR_SYNC — updateTshirt() on the included (is_included = 1)
 *   row also updates registrations.tshirt_size so the denormalized mirror
 *   stays in sync. The tshirts table remains authoritative for pricing.
 *
 * GUARANTEE: PAYMENT_RECONCILE — when the recomputed total exceeds the sum of
 *   verified payments, a payment_pending record is created (or its amount
 *   updated) for the delta and registration status is re-derived via
 *   deriveRegistrationStatus(). When the recomputed total is at or below the
 *   verified sum, any stale payment_pending record is deleted — an
 *   overpayment from here on is handled by the existing refund path, not by
 *   this service.
 *
 * GUARANTEE: SYNC_SINGLE_SAVE (tshirt-extras-misc-charges single-save rework)
 *   — planTshirtSync()/planChargeSync() are pure, read-only diff planners:
 *   given the incoming full list from the client, an item WITH an id updates
 *   or no-ops the matching row, an item WITHOUT an id creates a new row, and
 *   an existing row absent from the incoming list is deleted. They compute
 *   `costAffecting` (true iff the plan creates or deletes at least one row —
 *   size/gender edits and charge no-ops are cosmetic) without writing
 *   anything, so a route handler can pre-check the R23 pending_verification
 *   guard for the whole PUT /registrations/:id save BEFORE calling
 *   editService.edit(), avoiding a split result where the registration
 *   fields save but the shirt/charge sync then 409s.
 *
 * GUARANTEE: SYNC_EXECUTES_PLAN — syncTshirts()/syncCharges() call the
 *   corresponding plan method, re-assert the same guards it already computed
 *   (DONATION_ONLY_BLOCK for shirt creates, PENDING_VERIFICATION_BLOCK when
 *   costAffecting, the included-shirt delete guard, positive-amount guard for
 *   charge creates), execute the create/update/delete diff, and — only when
 *   the plan was cost-affecting — recalculate pricing via the same
 *   recalcAndPersist() used by the discrete add/remove endpoints. Cosmetic-only
 *   tshirt updates append a `tshirt_updated` audit entry but skip repricing,
 *   matching updateTshirt()'s existing behavior. A no-op plan (nothing
 *   created, updated, or deleted) does nothing and returns recalc: null.
 *
 * GUARANTEE: SYNC_INCLUDED_SHIRT_PROTECTED — syncTshirts() throws AppError 400
 *   if the diff would delete the is_included=1 row, regardless of whether the
 *   rest of the plan is cost-affecting.
 *
 * GUARANTEE: SYNC_CHARGES_IMMUTABLE — syncCharges() never updates an existing
 *   charge row's description/amount, even if the incoming item's id matches
 *   but its fields differ — charges are create-or-delete only, per addCharge/
 *   removeCharge's existing contract.
 *
 * EXPECTS: registrationRepo, attendeeRepo, paymentRepo, auditRepo, tshirtRepo,
 *   chargeRepo are all initialised before any method is called.
 *
 * FAILURE BEHAVIOR: AppError with statusCode propagates to the route handler.
 *   NotFoundError (404) when the registration, shirt, or charge does not
 *   exist. planTshirtSync()/planChargeSync() throw NotFoundError if an
 *   incoming item's id does not match any existing row for the registration.
 */

import type { PricingBreakup, Tshirt, AdditionalCharge, Gender, TshirtSize } from '@smriti/shared';
import { calculateTotal, PRICING_DEFAULTS } from '@smriti/shared';
import type {
  IRegistrationRepository,
  IAttendeeRepository,
  IPaymentRepository,
  IAuditRepository,
  ITshirtRepository,
  IAdditionalChargeRepository,
} from '../repositories/interfaces.js';
import type { Registration } from '../domain/types.js';
import type { AuditAction } from '../domain/status.js';
import { toSharedRegistration } from '../domain/to-shared-registration.js';
import { AppError, NotFoundError } from './errors.js';
import { deriveRegistrationStatus } from '../domain/status.js';

export interface RecalcResult {
  registration: Registration;
  pricingBreakup: PricingBreakup;
  paymentAction: 'none' | 'created' | 'updated' | 'deleted';
  paymentDelta: number;
}

// ---------------------------------------------------------------------------
// Single-save sync types (tshirt-extras-misc-charges rework)
// ---------------------------------------------------------------------------

export interface TshirtSyncItem {
  id?: number;
  gender: Gender | null;
  size: TshirtSize;
  isIncluded: boolean;
}

export interface ChargeSyncItem {
  id?: number;
  description: string;
  amount: number;
}

export interface TshirtSyncPlan {
  toCreate: TshirtSyncItem[];
  toUpdate: Array<{ existing: Tshirt; gender: Gender | null; size: TshirtSize }>;
  toDelete: Tshirt[];
  /** True iff the plan would create or delete at least one row. */
  costAffecting: boolean;
}

export interface ChargeSyncPlan {
  toCreate: ChargeSyncItem[];
  toDelete: AdditionalCharge[];
  /** True iff the plan would create or delete at least one row. */
  costAffecting: boolean;
}

export interface TshirtSyncResult {
  tshirts: Tshirt[];
  recalc: RecalcResult | null;
}

export interface ChargeSyncResult {
  charges: AdditionalCharge[];
  recalc: RecalcResult | null;
}

export class TshirtChargeService {
  private registrationRepo: IRegistrationRepository;
  private attendeeRepo: IAttendeeRepository;
  private paymentRepo: IPaymentRepository;
  private auditRepo: IAuditRepository;
  private tshirtRepo: ITshirtRepository;
  private chargeRepo: IAdditionalChargeRepository;

  constructor(deps: {
    registrationRepo: IRegistrationRepository;
    attendeeRepo: IAttendeeRepository;
    paymentRepo: IPaymentRepository;
    auditRepo: IAuditRepository;
    tshirtRepo: ITshirtRepository;
    chargeRepo: IAdditionalChargeRepository;
  }) {
    this.registrationRepo = deps.registrationRepo;
    this.attendeeRepo = deps.attendeeRepo;
    this.paymentRepo = deps.paymentRepo;
    this.auditRepo = deps.auditRepo;
    this.tshirtRepo = deps.tshirtRepo;
    this.chargeRepo = deps.chargeRepo;
  }

  // ---------------------------------------------------------------------
  // T-shirts
  // ---------------------------------------------------------------------

  async addTshirt(
    registrationId: number,
    data: { gender: Gender | null; size: TshirtSize },
    actorEmail: string,
  ): Promise<{ tshirt: Tshirt; recalc: RecalcResult }> {
    const reg = await this.requireRegistration(registrationId);
    if (reg.participationType === 'donation_only') {
      throw new AppError('T-shirts are not available for donation-only registrations.', 400);
    }
    await this.assertNotPendingVerification(registrationId);

    const tshirt = await this.tshirtRepo.create({
      registrationId,
      gender: data.gender,
      size: data.size,
      isIncluded: false,
    });

    const recalc = await this.recalcAndPersist(registrationId, actorEmail, 'tshirt_added', {
      tshirtId: tshirt.id,
      size: tshirt.size,
      gender: tshirt.gender,
    });

    return { tshirt, recalc };
  }

  async updateTshirt(
    registrationId: number,
    tshirtId: number,
    data: { gender?: Gender | null; size?: TshirtSize },
    actorEmail: string,
  ): Promise<Tshirt> {
    await this.requireRegistration(registrationId);

    const existing = await this.findTshirtOrThrow(registrationId, tshirtId);

    await this.tshirtRepo.update(tshirtId, data);

    // Mirror sync (R-mirror): the included shirt's size is denormalized onto
    // registrations.tshirt_size for backward compatibility. The tshirts table
    // stays authoritative for pricing/reporting.
    if (existing.isIncluded && data.size !== undefined) {
      await this.registrationRepo.update(registrationId, { tshirt_size: data.size });
    }

    const updated = await this.findTshirtOrThrow(registrationId, tshirtId);

    await this.auditRepo.append({
      registration_id: registrationId,
      action: 'tshirt_updated',
      actor: actorEmail,
      changes: JSON.stringify({
        tshirtId,
        before: { gender: existing.gender, size: existing.size },
        after: { gender: updated.gender, size: updated.size },
      }),
      snapshot: JSON.stringify({ registration: await this.registrationRepo.findById(registrationId) }),
    });

    return updated;
  }

  async removeTshirt(registrationId: number, tshirtId: number, actorEmail: string): Promise<RecalcResult> {
    await this.requireRegistration(registrationId);
    await this.assertNotPendingVerification(registrationId);

    const existing = await this.findTshirtOrThrow(registrationId, tshirtId);
    if (existing.isIncluded) {
      throw new AppError('Cannot delete the included shirt', 400);
    }
    await this.tshirtRepo.delete(tshirtId);

    return this.recalcAndPersist(registrationId, actorEmail, 'tshirt_removed', {
      tshirtId,
      size: existing.size,
      gender: existing.gender,
    });
  }

  // ---------------------------------------------------------------------
  // Additional charges
  // ---------------------------------------------------------------------

  async addCharge(
    registrationId: number,
    data: { description: string; amount: number },
    createdBy: number,
    actorEmail: string,
  ): Promise<{ charge: AdditionalCharge; recalc: RecalcResult }> {
    await this.requireRegistration(registrationId);
    if (!Number.isFinite(data.amount) || data.amount <= 0) {
      throw new AppError('Amount must be a positive number', 422);
    }
    if (!data.description.trim()) {
      throw new AppError('Description is required', 422);
    }
    await this.assertNotPendingVerification(registrationId);

    const charge = await this.chargeRepo.create({
      registrationId,
      description: data.description.trim(),
      amount: data.amount,
      createdBy,
    });

    const recalc = await this.recalcAndPersist(registrationId, actorEmail, 'charge_added', {
      chargeId: charge.id,
      description: charge.description,
      amount: charge.amount,
    });

    return { charge, recalc };
  }

  async removeCharge(registrationId: number, chargeId: number, actorEmail: string): Promise<RecalcResult> {
    await this.requireRegistration(registrationId);
    await this.assertNotPendingVerification(registrationId);

    const existing = (await this.chargeRepo.findByRegistration(registrationId))
      .find((c) => c.id === chargeId);
    if (!existing) throw new NotFoundError('Charge not found');

    await this.chargeRepo.delete(chargeId);

    return this.recalcAndPersist(registrationId, actorEmail, 'charge_removed', {
      chargeId,
      description: existing.description,
      amount: existing.amount,
    });
  }

  // ---------------------------------------------------------------------
  // Single-save sync (tshirt-extras-misc-charges rework)
  // ---------------------------------------------------------------------

  /**
   * Pure, read-only diff of `incoming` against the registration's current
   * tshirt rows. Never writes. Used both by syncTshirts() and by route-level
   * pre-checks that need to know whether a save is cost-affecting before
   * committing anything (see PENDING_VERIFICATION_BLOCK at the route layer).
   */
  async planTshirtSync(registrationId: number, incoming: TshirtSyncItem[]): Promise<TshirtSyncPlan> {
    const existing = await this.tshirtRepo.findByRegistration(registrationId);
    const existingById = new Map(existing.map((t) => [t.id, t]));

    const toCreate: TshirtSyncItem[] = [];
    const toUpdate: TshirtSyncPlan['toUpdate'] = [];
    const seenIds = new Set<number>();

    for (const item of incoming) {
      if (item.id === undefined) {
        toCreate.push(item);
        continue;
      }
      const match = existingById.get(item.id);
      if (!match) throw new NotFoundError('T-shirt not found');
      seenIds.add(item.id);
      if (match.gender !== item.gender || match.size !== item.size) {
        toUpdate.push({ existing: match, gender: item.gender, size: item.size });
      }
    }

    const toDelete = existing.filter((t) => !seenIds.has(t.id));

    return { toCreate, toUpdate, toDelete, costAffecting: toCreate.length > 0 || toDelete.length > 0 };
  }

  /**
   * Pure, read-only diff of `incoming` against the registration's current
   * charge rows. Charges are immutable once created (SYNC_CHARGES_IMMUTABLE)
   * — an incoming item with a matching id is always a no-op.
   */
  async planChargeSync(registrationId: number, incoming: ChargeSyncItem[]): Promise<ChargeSyncPlan> {
    const existing = await this.chargeRepo.findByRegistration(registrationId);
    const existingIds = new Set(existing.map((c) => c.id));

    const toCreate: ChargeSyncItem[] = [];
    const seenIds = new Set<number>();

    for (const item of incoming) {
      if (item.id === undefined) {
        toCreate.push(item);
        continue;
      }
      if (!existingIds.has(item.id)) throw new NotFoundError('Charge not found');
      seenIds.add(item.id);
    }

    const toDelete = existing.filter((c) => !seenIds.has(c.id));

    return { toCreate, toDelete, costAffecting: toCreate.length > 0 || toDelete.length > 0 };
  }

  /**
   * Applies a single-save diff of the registration's t-shirt rows. Cosmetic
   * updates (size/gender on existing rows) are never blocked by
   * pending_verification (R23); creates/deletes are. Callers that need to
   * block an entire multi-part save atomically (see staff.routes.ts PUT
   * handler) should call planTshirtSync() first and pre-check before doing
   * any writes — by the time this method's own guard runs, no writes have
   * happened yet, so it is always safe to call directly too.
   */
  async syncTshirts(
    registrationId: number,
    incoming: TshirtSyncItem[],
    actorEmail: string,
  ): Promise<TshirtSyncResult> {
    const reg = await this.requireRegistration(registrationId);
    const plan = await this.planTshirtSync(registrationId, incoming);

    if (plan.toCreate.length > 0 && reg.participationType === 'donation_only') {
      throw new AppError('T-shirts are not available for donation-only registrations.', 400);
    }
    if (plan.toDelete.some((t) => t.isIncluded)) {
      throw new AppError('Cannot remove the included shirt.', 400);
    }
    if (plan.costAffecting) {
      await this.assertNotPendingVerification(registrationId);
    }

    for (const { existing, gender, size } of plan.toUpdate) {
      await this.tshirtRepo.update(existing.id, { gender, size });
      if (existing.isIncluded) {
        await this.registrationRepo.update(registrationId, { tshirt_size: size });
      }
    }
    for (const item of plan.toCreate) {
      await this.tshirtRepo.create({
        registrationId,
        gender: item.gender,
        size: item.size,
        isIncluded: item.isIncluded,
      });
    }
    for (const existing of plan.toDelete) {
      await this.tshirtRepo.delete(existing.id);
    }

    let recalc: RecalcResult | null = null;
    if (plan.costAffecting) {
      recalc = await this.recalcAndPersist(registrationId, actorEmail, 'tshirt_synced', {
        created: plan.toCreate.length,
        updated: plan.toUpdate.length,
        deleted: plan.toDelete.length,
      });
    } else if (plan.toUpdate.length > 0) {
      await this.auditRepo.append({
        registration_id: registrationId,
        action: 'tshirt_updated',
        actor: actorEmail,
        changes: JSON.stringify({ updated: plan.toUpdate.length }),
        snapshot: JSON.stringify({ registration: await this.registrationRepo.findById(registrationId) }),
      });
    }

    const tshirts = await this.tshirtRepo.findByRegistration(registrationId);
    return { tshirts, recalc };
  }

  /**
   * Applies a single-save diff of the registration's additional-charge rows.
   * Charges are create-or-delete only (SYNC_CHARGES_IMMUTABLE).
   */
  async syncCharges(
    registrationId: number,
    incoming: ChargeSyncItem[],
    staffUserId: number,
    actorEmail: string,
  ): Promise<ChargeSyncResult> {
    await this.requireRegistration(registrationId);
    const plan = await this.planChargeSync(registrationId, incoming);

    for (const item of plan.toCreate) {
      if (!Number.isFinite(item.amount) || item.amount <= 0) {
        throw new AppError('Amount must be a positive number', 422);
      }
      if (!item.description.trim()) {
        throw new AppError('Description is required', 422);
      }
    }
    if (plan.costAffecting) {
      await this.assertNotPendingVerification(registrationId);
    }

    for (const item of plan.toCreate) {
      await this.chargeRepo.create({
        registrationId,
        description: item.description.trim(),
        amount: item.amount,
        createdBy: staffUserId,
      });
    }
    for (const existing of plan.toDelete) {
      await this.chargeRepo.delete(existing.id);
    }

    let recalc: RecalcResult | null = null;
    if (plan.costAffecting) {
      recalc = await this.recalcAndPersist(registrationId, actorEmail, 'charge_synced', {
        created: plan.toCreate.length,
        deleted: plan.toDelete.length,
      });
    }

    const charges = await this.chargeRepo.findByRegistration(registrationId);
    return { charges, recalc };
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async requireRegistration(registrationId: number): Promise<Registration> {
    const reg = await this.registrationRepo.findById(registrationId);
    if (!reg) throw new NotFoundError('Registration not found');
    return reg;
  }

  private async findTshirtOrThrow(registrationId: number, tshirtId: number): Promise<Tshirt> {
    const existing = (await this.tshirtRepo.findByRegistration(registrationId))
      .find((t) => t.id === tshirtId);
    if (!existing) throw new NotFoundError('T-shirt not found');
    return existing;
  }

  private async assertNotPendingVerification(registrationId: number): Promise<void> {
    const payments = await this.paymentRepo.findByRegistration(registrationId);
    if (payments.some((p) => p.status === 'pending_verification')) {
      throw new AppError(
        'Cost-affecting changes blocked while payment verification is pending.',
        409,
      );
    }
  }

  private async recalcAndPersist(
    registrationId: number,
    actorEmail: string,
    auditAction: Extract<
      AuditAction,
      'tshirt_added' | 'tshirt_removed' | 'charge_added' | 'charge_removed' | 'tshirt_synced' | 'charge_synced'
    >,
    auditDetails: Record<string, unknown>,
  ): Promise<RecalcResult> {
    const [reg, attendees, tshirts, charges] = await Promise.all([
      this.registrationRepo.findById(registrationId),
      this.attendeeRepo.findByRegistration(registrationId),
      this.tshirtRepo.findByRegistration(registrationId),
      this.chargeRepo.findByRegistration(registrationId),
    ]);
    if (!reg) throw new NotFoundError('Registration not found');

    const sharedReg = toSharedRegistration(reg, attendees);
    const breakup = calculateTotal(sharedReg, PRICING_DEFAULTS, {
      tshirts: tshirts.map((t) => ({ isIncluded: t.isIncluded })),
      additionalCharges: charges.map((c) => ({ description: c.description, amount: c.amount })),
    });
    const newTotal = breakup.total;

    await this.registrationRepo.update(registrationId, {
      pricing_snapshot: JSON.stringify(breakup),
      total_amount: newTotal,
    });

    const verifiedTotal = await this.paymentRepo.sumVerifiedByRegistration(registrationId);
    const delta = newTotal - verifiedTotal;
    const existingPending = await this.paymentRepo.findPendingByRegistration(registrationId);

    let paymentAction: RecalcResult['paymentAction'] = 'none';
    if (delta > 0) {
      if (existingPending) {
        await this.paymentRepo.updatePendingAmount(existingPending.id, delta);
        paymentAction = 'updated';
      } else {
        await this.paymentRepo.create({
          registration_id: registrationId,
          amount: delta,
          status: 'payment_pending',
          gateway: null,
          gateway_ref: null,
          gateway_response: null,
          proof_file_key: null,
          verified_by: null,
          verified_at: null,
        });
        paymentAction = 'created';
      }
    } else if (existingPending) {
      // Total is now at or below verified payments — an overpayment here is
      // handled by the existing refund path; a stale payment_pending is no
      // longer owed and would otherwise double-count the delta.
      await this.paymentRepo.deletePending(existingPending.id);
      paymentAction = 'deleted';
    }

    const payments = await this.paymentRepo.findByRegistration(registrationId);
    const newStatus = deriveRegistrationStatus(payments, newTotal);
    if (newStatus !== reg.status) {
      await this.registrationRepo.updateStatus(registrationId, newStatus);
    }

    const reloaded = await this.registrationRepo.findById(registrationId) ?? reg;

    await this.auditRepo.append({
      registration_id: registrationId,
      action: auditAction,
      actor: actorEmail,
      changes: JSON.stringify({ ...auditDetails, newTotal, paymentAction, paymentDelta: delta }),
      snapshot: JSON.stringify({ registration: reloaded }),
    });

    return {
      registration: reloaded,
      pricingBreakup: breakup,
      paymentAction,
      paymentDelta: delta,
    };
  }
}
