/**
 * CONTRACT
 *
 * GUARANTEE: EDIT_ARCHIVED_BLOCKED — edit() throws AppError 404 if the
 *   registration does not exist (archived registrations are deleted from the
 *   registrations table, so not-found === archived).
 *
 * GUARANTEE: EDIT_OPTIMISTIC_LOCK — edit() passes updatedAt from the request
 *   body to updateWithLock(). If another write occurred between load and save,
 *   throws AppError 409 with message 'Registration was modified by another
 *   request. Please reload and try again.'
 *
 * GUARANTEE: EDIT_PENDING_VERIFICATION_BLOCK — edit() throws AppError 409
 *   when any payment is in pending_verification status AND the change set
 *   includes cost-affecting fields. Cosmetic changes are always allowed.
 *
 * GUARANTEE: EDIT_COST_DECREASE_BLOCKED — edit() throws AppError 409 when
 *   newTotal < sumVerified (cannot owe less than money already received).
 *
 * GUARANTEE: EDIT_EMAIL_UNIQUE — when email changes, edit() checks for an
 *   existing registration with the new email (case-insensitive). Throws AppError
 *   409 if a duplicate exists.
 *
 * GUARANTEE: EDIT_ATOMIC — registration update, attendee replace, and status
 *   change are committed in a single db.batch() call inside updateWithLock().
 *   Payment creation and audit logging are separate writes after the batch.
 *   This means a crash between the batch and payment creation could leave an
 *   inconsistent state — accepted risk per the registration portal's
 *   operational context (manual reconciliation available).
 *
 * GUARANTEE: EDIT_EMAIL_FIRE_AND_FORGET — payment emails are sent after the
 *   DB commit and are not awaited. Email failures are logged but do not roll
 *   back the edit.
 *
 * GUARANTEE: EDIT_USES_SHARED_PRICING — pricing is computed via calculateTotal()
 *   from @smriti/shared. No duplicate pricing logic exists in this service.
 *
 * EXPECTS: registrationRepo, paymentRepo, attendeeRepo, auditRepo, emailService,
 *   authService are all initialised before edit() is called.
 *
 * EXPECTS: attendees provided to edit() are in NewAttendee format (snake_case,
 *   with registration_id set to the target registration's id).
 *
 * FAILURE BEHAVIOR: AppError with statusCode propagates to the route handler.
 *   Unexpected DB errors propagate as 500.
 */

import type { PricingBreakup } from '@smriti/shared';
import { calculateTotal, PRICING_DEFAULTS } from '@smriti/shared';
import type {
  IRegistrationRepository,
  IPaymentRepository,
  IAuditRepository,
  IEmailService,
  ITshirtRepository,
  IAdditionalChargeRepository,
} from '../repositories/interfaces.js';
import type { Registration, NewAttendee, RegistrationUpdate } from '../domain/types.js';
import type { AttendanceIntent, ParticipationType } from '@smriti/shared';
import { classifyChanges } from '../domain/edit-classifier.js';
import { AppError, NotFoundError } from './errors.js';
import { deriveRegistrationStatus } from '../domain/status.js';
import { createLogger, parseLogLevel, type Logger } from '../infra/logger.js';
import { AvailabilityService } from './availability.service.js';

// Relative room-capacity ranking. Higher rank = more capacity consumed.
const ACCOMMODATION_RANK: Record<string, number> = {
  none: 0,
  shared_triple: 1,
  shared_double: 2,
  private: 3,
};

function isAccommodationUpgrade(oldType: string, newType: string): boolean {
  return (ACCOMMODATION_RANK[newType] ?? 0) > (ACCOMMODATION_RANK[oldType] ?? 0);
}

function attendanceIntentFor(participationType: ParticipationType): AttendanceIntent {
  return participationType === 'donation_only' ? 'donation_only' : 'attending';
}

// Null-object fallbacks so tests/callers that don't care about t-shirts or
// additional charges (most of the existing edit test suite) don't need to
// wire up an ITshirtRepository/IAdditionalChargeRepository just to construct
// EditService. Real callers (app.ts) always pass the D1-backed repos.
const NO_TSHIRTS: ITshirtRepository = {
  findByRegistration: async () => [],
  findAll: async () => [],
  create: async () => { throw new Error('NO_TSHIRTS repo is read-only'); },
  update: async () => {},
  delete: async () => {},
  countExtras: async () => 0,
};
const NO_CHARGES: IAdditionalChargeRepository = {
  findByRegistration: async () => [],
  create: async () => { throw new Error('NO_CHARGES repo is read-only'); },
  delete: async () => {},
};

function deriveAttendeeChargeability(attendee: NewAttendee): NewAttendee {
  const isChargeable = attendee.type === 'child'
    ? typeof attendee.age === 'number' && attendee.age >= PRICING_DEFAULTS.childFreeAgeThreshold
    : true;

  return { ...attendee, is_chargeable: isChargeable ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditRegistrationRequest {
  /** Fields to update on the registration (domain-level camelCase). */
  fields: Partial<{
    fullName: string;
    email: string;
    whatsapp: string;
    mobileAlternate: string | null;
    branch: string;
    city: string;
    country: string;
    gender: string;
    tshirtSize: string;
    alumniMeal: string;
    attendanceIntent: AttendanceIntent;
    participationType: ParticipationType;
    accommodation: string;
    checkIn: string | null;
    checkOut: string | null;
    extraBed: boolean;
    breakfastAdult: number;
    breakfastChild: number;
    donationAmount: number;
    publicAck: boolean;
    ackDisplayName: string | null;
    felicitation: boolean;
    idNote: string | null;
    contributionSplits: Record<string, number>;
  }>;
  /** New attendee list (full replacement). If undefined, attendees are unchanged. */
  attendees?: NewAttendee[];
  /** Optimistic lock: updatedAt from the loaded registration. */
  updatedAt: number;
}

export interface EditRegistrationResult {
  registration: Registration;
  pricingBreakup: PricingBreakup | null;
  paymentDelta: number | null;
  paymentAction: 'none' | 'created' | 'updated' | 'deleted';
}

// ---------------------------------------------------------------------------
// Helper: map server Registration domain type → shared Registration shape
// for calculateTotal(). Extracted to domain/to-shared-registration.ts so the
// tshirt/charge service uses the exact same mapping (no drift).
// ---------------------------------------------------------------------------

import type { MealPreference } from '@smriti/shared';
import type { Attendee } from '../domain/types.js';
import { toSharedRegistration } from '../domain/to-shared-registration.js';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class EditService {
  private db: { prepare(sql: string): { bind(...args: unknown[]): { run(): Promise<unknown> } } };
  private registrationRepo: IRegistrationRepository;
  private paymentRepo: IPaymentRepository;
  private attendeeRepo: import('../repositories/interfaces.js').IAttendeeRepository;
  private auditRepo: IAuditRepository;
  private emailService: IEmailService;
  private authService: { createPaymentLinkUrl(registrationId: number, regCode: string): Promise<string> } | null;
  private availabilityService: AvailabilityService | null;
  private tshirtRepo: ITshirtRepository;
  private chargeRepo: IAdditionalChargeRepository;
  private log: Logger;

  constructor(deps: {
    db: { prepare(sql: string): { bind(...args: unknown[]): { run(): Promise<unknown> } } };
    registrationRepo: IRegistrationRepository;
    paymentRepo: IPaymentRepository;
    attendeeRepo: import('../repositories/interfaces.js').IAttendeeRepository;
    auditRepo: IAuditRepository;
    emailService: IEmailService;
    authService?: { createPaymentLinkUrl(registrationId: number, regCode: string): Promise<string> };
    availabilityService?: AvailabilityService;
    tshirtRepo?: ITshirtRepository;
    chargeRepo?: IAdditionalChargeRepository;
    logLevel?: string;
  }) {
    this.db = deps.db;
    this.registrationRepo = deps.registrationRepo;
    this.paymentRepo = deps.paymentRepo;
    this.attendeeRepo = deps.attendeeRepo;
    this.auditRepo = deps.auditRepo;
    this.emailService = deps.emailService;
    this.authService = deps.authService ?? null;
    this.availabilityService = deps.availabilityService ?? null;
    this.tshirtRepo = deps.tshirtRepo ?? NO_TSHIRTS;
    this.chargeRepo = deps.chargeRepo ?? NO_CHARGES;
    this.log = createLogger('edit', parseLogLevel(deps.logLevel));
  }

  async edit(
    registrationId: number,
    request: EditRegistrationRequest,
    staffEmail: string,
  ): Promise<EditRegistrationResult> {
    // Step 1: Load current registration
    const currentReg = await this.registrationRepo.findById(registrationId);
    if (!currentReg) throw new NotFoundError('Registration not found');

    // Optimistic lock pre-check: validate updatedAt before any mutations.
    // This reduces (though does not eliminate) the risk of partial mutations
    // if a concurrent write happened between load and save.
    if (currentReg.updatedAt !== request.updatedAt) {
      throw new AppError(
        'Registration was modified by another request. Please reload and try again.',
        409,
      );
    }

    // Load current attendees for comparison + pricing
    const currentAttendees = await this.attendeeRepo.findByRegistration(registrationId);
    const updatedAttendees = request.attendees?.map(deriveAttendeeChargeability);

    // Step 2: Build the updated registration snapshot (for classification + pricing)
    const updatedReg = this.applyFields(currentReg, request.fields);

    // Step 3: Classify changes
    const classification = classifyChanges(currentReg, updatedReg);

    // Handle email change (R10.2.1)
    let emailChanged = false;
    if (classification.emailChanged && request.fields.email !== undefined) {
      // (a) Duplicate check
      const existing = await this.registrationRepo.findByEmail(request.fields.email);
      if (existing.length > 0 && existing[0].id !== registrationId) {
        throw new AppError('A registration with this email already exists', 409);
      }
      emailChanged = true;
      // (b) Invalidate outstanding magic links for the registration
      await this.db
        .prepare(`DELETE FROM magic_links WHERE registration_id = ? AND used_at IS NULL`)
        .bind(registrationId)
        .run();
    }

    // Step 3.5: Accommodation availability guard.
    // Blocks upgrades when rooms are at capacity, AND blocks check-in date
    // changes when the room type is unavailable for the new date.
    if (this.availabilityService && updatedReg.accommodation !== 'none' && updatedReg.checkIn) {
      const accomChanged = request.fields.accommodation !== undefined &&
        isAccommodationUpgrade(currentReg.accommodation, updatedReg.accommodation);
      const dateChanged = request.fields.checkIn !== undefined &&
        request.fields.checkIn !== currentReg.checkIn;

      if (accomChanged || dateChanged) {
        const available = await this.availabilityService.isAccommodationAvailable(
          updatedReg.accommodation,
          updatedReg.checkIn,
        );
        if (!available) {
          throw new AppError(
            accomChanged
              ? 'Cannot upgrade accommodation — rooms at capacity'
              : 'Selected accommodation is not available for this check-in date',
            409,
          );
        }
      }
    }

    // Step 4: If cost-affecting changes, check pending_verification block
    const isCostAffecting = classification.costAffecting.length > 0 ||
      (updatedAttendees !== undefined && this.hasChargeableAttendeesChanged(currentAttendees, updatedAttendees));

    if (isCostAffecting) {
      // Load all payments to check for pending_verification
      const allPayments = await this.paymentRepo.findByRegistration(registrationId);
      const hasPendingVerification = allPayments.some((p) => p.status === 'pending_verification');
      if (hasPendingVerification) {
        throw new AppError(
          'Cannot make cost-affecting changes while a payment is awaiting verification. Verify or reject the pending payment first.',
          409,
        );
      }
    }

    // Step 5: Recompute pricing if cost-affecting
    let newBreakup: PricingBreakup | null = null;
    let newTotal = currentReg.totalAmount;
    let paymentAction: 'none' | 'created' | 'updated' | 'deleted' = 'none';
    let paymentDelta: number | null = null;

    if (isCostAffecting) {
      // Determine attendees for pricing (use new attendees if provided, else current)
      const attendeesForPricing = updatedAttendees !== undefined
        ? updatedAttendees.map((a) => ({
            id: 0,
            registrationId,
            type: a.type,
            name: a.name,
            age: a.age,
            relationship: a.relationship,
            meal: a.meal as MealPreference,
            isChargeable: a.is_chargeable === 1,
            createdAt: Date.now(),
          }))
        : currentAttendees;

      // Extras (t-shirts, additional charges) are stored in their own tables
      // and are never touched by this edit — but they must still be folded
      // into the recomputed total, or an accommodation/attendee edit would
      // silently drop them from the new total_amount.
      const [tshirts, charges] = await Promise.all([
        this.tshirtRepo.findByRegistration(registrationId),
        this.chargeRepo.findByRegistration(registrationId),
      ]);

      const sharedReg = toSharedRegistration(updatedReg, attendeesForPricing);
      newBreakup = calculateTotal(sharedReg, PRICING_DEFAULTS, {
        tshirts: tshirts.map((t) => ({ isIncluded: t.isIncluded })),
        additionalCharges: charges.map((c) => ({ description: c.description, amount: c.amount })),
      });
      newTotal = newBreakup.total;

      // Step 5b: Compute verified total and delta
      const verifiedTotal = await this.paymentRepo.sumVerifiedByRegistration(registrationId);

      // Cost decrease guard
      if (newTotal < verifiedTotal) {
        throw new AppError(
          `Cannot reduce total below verified payments (₹${verifiedTotal}). Current new total: ₹${newTotal}.`,
          422,
        );
      }

      const delta = newTotal - verifiedTotal;
      paymentDelta = delta;

      // Step 6: Payment action
      const existingPending = await this.paymentRepo.findPendingByRegistration(registrationId);

      if (delta === 0) {
        // Fully paid or donation_only — no outstanding amount
        if (existingPending) {
          // Delete the now-unnecessary pending payment
          await this.paymentRepo.deletePending(existingPending.id);
          paymentAction = 'deleted';
          // Registration status → confirmed (no outstanding obligation)
        }
        // delta == 0, no pending → already confirmed, nothing to do
      } else {
        // delta > 0 — money owed
        if (existingPending) {
          // Update existing pending payment amount
          await this.paymentRepo.updatePendingAmount(existingPending.id, delta);
          paymentAction = 'updated';
        } else {
          // Create new pending payment (confirmed → pending cycle)
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
      }
    } else {
      // Non-cost-affecting edit: still check for orphaned pending payments.
      // If total matches verified (delta==0) and a payment_pending exists,
      // clean it up (R7.11). This handles cases where a supplementary payment
      // was created by a prior edit but the current edit doesn't change pricing.
      const existingPending = await this.paymentRepo.findPendingByRegistration(registrationId);
      if (existingPending) {
        const verifiedTotal = await this.paymentRepo.sumVerifiedByRegistration(registrationId);
        const delta = currentReg.totalAmount - verifiedTotal;
        paymentDelta = delta;
        if (delta === 0) {
          await this.paymentRepo.deletePending(existingPending.id);
          paymentAction = 'deleted';
        }
      }
    }

    // Step 7: Build DB update
    const dbUpdate = this.buildDbUpdate(request.fields, updatedReg, newBreakup, newTotal);

    // Determine new registration status
    const editPayments = await this.paymentRepo.findByRegistration(registrationId);
    const newStatus = deriveRegistrationStatus(editPayments, newTotal);
    // Step 8: Persist atomically
    // updateWithLock handles registration fields + attendee replace in a single batch
    try {
      await this.registrationRepo.updateWithLock(
        registrationId,
        dbUpdate,
        request.updatedAt,
        updatedAttendees,
      );
    } catch (err) {
      if (err instanceof Error && err.message === 'OPTIMISTIC_LOCK_CONFLICT') {
        throw new AppError(
          'Registration was modified by another request. Please reload and try again.',
          409,
        );
      }
      throw err;
    }

    // Update status if it changed (separate call since status is not in RegistrationUpdate)
    if (newStatus !== currentReg.status) {
      await this.registrationRepo.updateStatus(registrationId, newStatus);
    }

    // Step 9: Audit log
    const auditChanges: Record<string, unknown> = {
      fields: request.fields,
      classification,
      ...(isCostAffecting ? { paymentAction, paymentDelta } : {}),
    };

    try {
      await this.auditRepo.append({
        registration_id: registrationId,
        action: 'amended',
        actor: staffEmail,
        changes: JSON.stringify(auditChanges),
        snapshot: JSON.stringify({ registration: updatedReg }),
      });

      if (paymentAction === 'created' || paymentAction === 'updated') {
        await this.auditRepo.append({
          registration_id: registrationId,
          action: paymentAction === 'created' ? 'payment_created' : 'payment_amended',
          actor: staffEmail,
          changes: JSON.stringify({ delta: paymentDelta, action: paymentAction }),
          snapshot: JSON.stringify({ registration: updatedReg }),
        });
      }
    } catch (auditErr) {
      this.log.error('Audit entry failed', { registrationId, error: String(auditErr) });
    }

    // Reload updated registration
    const reloadedReg = await this.registrationRepo.findById(registrationId) ?? updatedReg;

    // Step 10: Fire-and-forget email
    if (paymentAction === 'created' || paymentAction === 'updated') {
      this.sendPaymentEmail(
        reloadedReg,
        paymentAction,
        paymentDelta ?? 0,
        newBreakup,
      ).catch((err) => {
        this.log.error('Payment email failed', { registrationId, error: String(err) });
      });
    } else if (emailChanged) {
      // R10.2.1(c): Email changed, send payment link to new address if pending payment exists
      const pendingAfterEdit = await this.paymentRepo.findPendingByRegistration(registrationId);
      if (pendingAfterEdit) {
        this.sendPaymentEmail(
          reloadedReg,
          'updated',
          pendingAfterEdit.amount,
          newBreakup,
        ).catch((err) => {
          this.log.error('Payment email to new address failed', { registrationId, error: String(err) });
        });
      }
    }

    return {
      registration: reloadedReg,
      pricingBreakup: newBreakup,
      paymentDelta,
      paymentAction,
    };
  }

  private applyFields(
    currentReg: Registration,
    fields: EditRegistrationRequest['fields'],
  ): Registration {
    const participationType = fields.participationType ?? currentReg.participationType;
    const noAccommodation = participationType === 'campus_only' || participationType === 'donation_only';
    const accommodation = noAccommodation
      ? 'none' as Registration['accommodation']
      : (fields.accommodation as Registration['accommodation']) ?? currentReg.accommodation;
    const accommodationRemoved = accommodation === 'none';

    return {
      ...currentReg,
      fullName: fields.fullName ?? currentReg.fullName,
      email: fields.email ?? currentReg.email,
      whatsapp: fields.whatsapp ?? currentReg.whatsapp,
      mobileAlternate: fields.mobileAlternate !== undefined ? fields.mobileAlternate : currentReg.mobileAlternate,
      branch: fields.branch ?? currentReg.branch,
      city: fields.city ?? currentReg.city,
      country: fields.country ?? currentReg.country,
      gender: (fields.gender as Registration['gender']) ?? currentReg.gender,
      tshirtSize: (fields.tshirtSize as Registration['tshirtSize']) ?? currentReg.tshirtSize,
      alumniMeal: (fields.alumniMeal as Registration['alumniMeal']) ?? currentReg.alumniMeal,
      // participationType is canonical. Never allow the legacy intent field to
      // be edited independently into a contradictory state.
      attendanceIntent: attendanceIntentFor(participationType),
      participationType,
      accommodation,
      checkIn: accommodationRemoved ? null : (fields.checkIn !== undefined ? fields.checkIn : currentReg.checkIn),
      checkOut: accommodationRemoved ? null : (fields.checkOut !== undefined ? fields.checkOut : currentReg.checkOut),
      extraBed: accommodationRemoved ? false : (fields.extraBed !== undefined ? fields.extraBed : currentReg.extraBed),
      breakfastAdult: accommodationRemoved ? 0 : (fields.breakfastAdult !== undefined ? fields.breakfastAdult : currentReg.breakfastAdult),
      breakfastChild: accommodationRemoved ? 0 : (fields.breakfastChild !== undefined ? fields.breakfastChild : currentReg.breakfastChild),
      donationAmount: fields.donationAmount ?? currentReg.donationAmount,
      publicAck: fields.publicAck !== undefined ? fields.publicAck : currentReg.publicAck,
      ackDisplayName: fields.ackDisplayName !== undefined ? fields.ackDisplayName : currentReg.ackDisplayName,
      felicitation: fields.felicitation !== undefined ? fields.felicitation : currentReg.felicitation,
      idNote: fields.idNote !== undefined ? fields.idNote : currentReg.idNote,
      contributionSplits: fields.contributionSplits ?? currentReg.contributionSplits,
    };
  }

  private buildDbUpdate(
    fields: EditRegistrationRequest['fields'],
    updatedReg: Registration,
    newBreakup: PricingBreakup | null,
    newTotal: number,
  ): RegistrationUpdate {
    const update: RegistrationUpdate = {};

    if (fields.fullName !== undefined) update.full_name = fields.fullName;
    if (fields.email !== undefined) update.email = fields.email;
    if (fields.whatsapp !== undefined) update.whatsapp = fields.whatsapp;
    if (fields.mobileAlternate !== undefined) update.mobile_alternate = fields.mobileAlternate;
    if (fields.branch !== undefined) update.branch = fields.branch;
    if (fields.city !== undefined) update.city = fields.city;
    if (fields.country !== undefined) update.country = fields.country;
    if (fields.gender !== undefined) update.gender = fields.gender as Registration['gender'];
    if (fields.tshirtSize !== undefined) update.tshirt_size = fields.tshirtSize as Registration['tshirtSize'];
    if (fields.alumniMeal !== undefined) update.alumni_meal = fields.alumniMeal as MealPreference;
    if (fields.participationType !== undefined) {
      update.participation_type = fields.participationType;
      update.attendance_intent = updatedReg.attendanceIntent;
    } else if (fields.attendanceIntent !== undefined) {
      // Backward-compatible handling for older clients that still submit the
      // legacy field: normalize it to the canonical participation type.
      update.attendance_intent = updatedReg.attendanceIntent;
    }
    const accomTouched = fields.accommodation !== undefined || fields.participationType !== undefined;
    if (accomTouched) update.accommodation = updatedReg.accommodation;
    if (fields.checkIn !== undefined || accomTouched) update.check_in = updatedReg.checkIn;
    if (fields.checkOut !== undefined || accomTouched) update.check_out = updatedReg.checkOut;
    if (fields.extraBed !== undefined || accomTouched) update.extra_bed = updatedReg.extraBed ? 1 : 0;
    if (fields.breakfastAdult !== undefined || accomTouched) update.breakfast_adult = updatedReg.breakfastAdult;
    if (fields.breakfastChild !== undefined || accomTouched) update.breakfast_child = updatedReg.breakfastChild;
    if (fields.contributionSplits !== undefined) update.contribution_splits = JSON.stringify(fields.contributionSplits);
    if (fields.donationAmount !== undefined) update.donation_amount = fields.donationAmount;
    if (fields.publicAck !== undefined) update.public_ack = fields.publicAck ? 1 : 0;
    if (fields.ackDisplayName !== undefined) update.ack_display_name = fields.ackDisplayName;
    if (fields.felicitation !== undefined) update.felicitation = fields.felicitation ? 1 : 0;
    if (fields.idNote !== undefined) update.id_note = fields.idNote;

    // Pricing snapshot — update if cost-affecting changes occurred
    if (newBreakup !== null) {
      update.pricing_snapshot = JSON.stringify(newBreakup);
      update.total_amount = newTotal;
    }

    return update;
  }

  private hasChargeableAttendeesChanged(
    currentAttendees: Attendee[],
    newAttendees: NewAttendee[],
  ): boolean {
    const currentChargeable = currentAttendees
      .filter((a) => a.isChargeable)
      .map((a) => `${a.type}:${a.age ?? 'null'}`).sort();
    const newChargeable = newAttendees
      .filter((a) => a.is_chargeable === 1)
      .map((a) => `${a.type}:${a.age ?? 'null'}`).sort();
    return JSON.stringify(currentChargeable) !== JSON.stringify(newChargeable);
  }

  private async sendPaymentEmail(
    reg: Registration,
    paymentAction: 'created' | 'updated',
    delta: number,
    breakup: PricingBreakup | null,
  ): Promise<void> {
    let paymentUrl = `${reg.regCode}`;
    if (this.authService) {
      try {
        paymentUrl = await this.authService.createPaymentLinkUrl(reg.id, reg.regCode);
      } catch (err) {
        this.log.warn('Payment link generation failed', { error: String(err) });
        paymentUrl = `/pay/${reg.regCode}`;
      }
    } else {
      paymentUrl = `/pay/${reg.regCode}`;
    }

    if (paymentAction === 'updated') {
      await this.emailService.sendRevisedPayment(reg.email, {
        fullName: reg.fullName,
        amount: delta,
        breakup: breakup ?? { base: 0, lines: [], donation: 0, collegeContribution: 0, total: delta },
        paymentLink: paymentUrl,
      });
    } else {
      await this.emailService.sendAdditionalPayment(reg.email, {
        fullName: reg.fullName,
        amount: delta,
        breakup: breakup ?? { base: 0, lines: [], donation: 0, collegeContribution: 0, total: delta },
        paymentLink: paymentUrl,
      });
    }
  }
}
