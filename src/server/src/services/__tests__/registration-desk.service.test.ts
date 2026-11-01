import { describe, expect, it, vi } from 'vitest';
import { PricingService } from '../pricing.service.js';
import { RegistrationDeskService } from '../registration-desk.service.js';
import type { TshirtChargeService } from '../tshirt-charge.service.js';
import type {
  IAttendeeRepository,
  IAuditRepository,
  IDeskRepository,
  IEmailService,
  IPaymentRepository,
  IRefundRepository,
  IRegistrationRepository,
  IRoomRepository,
} from '../../repositories/interfaces.js';
import type {
  DeskIdempotencyRow,
  DeskOverviewRow,
  DeskSpotRegistrationInput,
} from '../../domain/desk-types.js';
import type { RegistrationInsertSet } from '../../domain/registration-insert-set.js';

const input: DeskSpotRegistrationInput = {
  fullName: 'Ravi Kumar',
  whatsapp: '+919876543210',
  branch: 'CS',
  participationType: 'campus_only',
  alumniMeal: 'veg',
  photoFileKey: 'photos/pending/ravi.jpg',
  email: 'ravi@example.com',
  children: [],
  guests: [],
};

function makeService(
  deskRepo: IDeskRepository,
  overrides: {
    registrationRepo?: IRegistrationRepository;
    attendeeRepo?: IAttendeeRepository;
    paymentRepo?: IPaymentRepository;
    roomRepo?: IRoomRepository;
    auditRepo?: IAuditRepository;
    tshirtChargeService?: TshirtChargeService;
    emailService?: IEmailService;
    refundRepo?: IRefundRepository;
  } = {},
) {
  const registrationRepo = overrides.registrationRepo ?? ({
    findByWhatsapp: async () => [],
    findByEmail: async () => [],
  } as unknown as IRegistrationRepository);
  const attendeeRepo = overrides.attendeeRepo ?? ({
    findByRegistration: async () => [],
  } as unknown as IAttendeeRepository);
  const paymentRepo = overrides.paymentRepo ?? ({
    sumVerifiedByRegistration: async () => 0,
  } as unknown as IPaymentRepository);
  const roomRepo = overrides.roomRepo ?? ({
    listAssignmentsByRegistration: async () => [],
  } as unknown as IRoomRepository);
  const auditRepo = overrides.auditRepo ?? ({
    append: async () => {},
    findByRegistration: async () => [],
  } as unknown as IAuditRepository);
  // Not exercised by the spot-registration/check-in tests below — settle and
  // add-charge get their own dedicated fakes per test.
  const tshirtChargeService = overrides.tshirtChargeService ?? ({} as unknown as TshirtChargeService);
  const emailService = overrides.emailService ?? ({
    sendAdditionalPayment: async () => {},
    sendRevisedPayment: async () => {},
    sendPaymentConfirmed: async () => {},
  } as unknown as IEmailService);
  const refundRepo = overrides.refundRepo ?? ({
    findByRegistration: async () => [],
  } as unknown as IRefundRepository);
  return new RegistrationDeskService({
    deskRepo,
    registrationRepo,
    attendeeRepo,
    paymentRepo,
    roomRepo,
    auditRepo,
    tshirtChargeService,
    refundRepo,
    appBaseUrl: 'https://app.example.test',
    emailService,
    pricingService: new PricingService(),
    now: () => 1_800_000_000_000,
  });
}

describe('RegistrationDeskService', () => {
  it("stores the request's email and replays the actor-scoped response", async () => {
    const rows = new Map<string, DeskIdempotencyRow>();
    const inserts: RegistrationInsertSet[] = [];
    let nextId = 1001;
    const deskRepo = {
      pruneIdempotency: async () => undefined,
      findIdempotency: async (actorId: number, key: string) => rows.get(`${actorId}:${key}`) ?? null,
      createSpotRegistration: async (
        data: RegistrationInsertSet,
        idem: {
          actorId: number;
          key: string;
          fingerprint: string;
          regCode: string;
          participationType: 'full_celebration' | 'campus_only';
          amountDue: number;
          actorEmail: string;
        },
      ) => {
        const id = nextId++;
        inserts.push(data);
        auditEntries.push({ action: 'spot_registration_created', actor: idem.actorEmail, targetId: id });
        rows.set(`${idem.actorId}:${idem.key}`, {
          id,
          actor_id: idem.actorId,
          idem_key: idem.key,
          fingerprint: idem.fingerprint,
          response: JSON.stringify({
            registration: {
              id,
              regCode: idem.regCode,
              participationType: idem.participationType,
              payment: { state: 'payment_pending', amountDue: idem.amountDue },
              checkIn: { present: false, checkedInAt: null },
              passUrl: `/pass#${idem.regCode}`,
            },
          }),
          created_at: 1_800_000_000_000,
        });
        return { id };
      },
    } as unknown as IDeskRepository;
    const auditEntries: unknown[] = [];
    const service = makeService(deskRepo);
    const actor = { userId: 7, email: 'desk@example.com' };

    const created = await service.createSpotRegistration(input, actor, 'desk-123');
    const replayed = await service.createSpotRegistration(input, actor, 'desk-123');

    expect(inserts).toHaveLength(1);
    expect(inserts[0].registration.email).toBe(input.email);
    expect(replayed).toEqual({ replay: true, body: created.body });
    expect(Object.keys(created.body.registration).sort()).toEqual([
      'checkIn',
      'id',
      'participationType',
      'passUrl',
      'payment',
      'regCode',
    ]);
    expect(auditEntries).toHaveLength(1);
  });

  it('keeps the first check-in timestamp and writes one audit entry', async () => {
    // status: 'confirmed' / fully paid — the payment gate (correction:
    // PAYMENT_GATES_CHECK_IN) blocks check-in on an outstanding balance, so
    // this fixture must model an already-settled registration to exercise
    // check-in's own idempotency behavior in isolation.
    const row: DeskOverviewRow = {
      id: 1001,
      reg_code: 'SMRT000000001001',
      full_name: 'Ravi Kumar',
      branch: 'CS',
      participation_type: 'campus_only',
      alumni_meal: 'veg',
      accommodation: 'none',
      check_in: null,
      check_out: null,
      photo_thumb_key: null,
      checked_in_at: null,
      checked_in_by: null,
      status: 'confirmed',
      total_amount: 5500,
      whatsapp: '+919876543210',
    };
    const deskRepo = {
      findOverviewRow: async () => row,
      markPresent: async (_id: number, checkedInAt: number, checkedInBy: number, actorEmail: string) => {
        if (row.checked_in_at !== null) return { wrote: false };
        row.checked_in_at = checkedInAt;
        row.checked_in_by = checkedInBy;
        auditEntries.push({ action: 'attendee_checked_in', actor: actorEmail, targetId: row.id });
        return { wrote: true };
      },
    } as unknown as IDeskRepository;
    const auditEntries: unknown[] = [];
    const paymentRepo = { sumVerifiedByRegistration: async () => row.total_amount } as unknown as IPaymentRepository;
    const service = makeService(deskRepo, { paymentRepo });
    const actor = { userId: 7, email: 'desk@example.com' };

    const first = await service.checkIn(1001, actor);
    const repeated = await service.checkIn(1001, actor);

    expect(first.checkIn.checkedInAt).toBe(1_800_000_000_000);
    expect(repeated).toEqual(first);
    expect(auditEntries).toHaveLength(1);
  });

  it('unmarkPresent clears a check-in and is idempotent in both directions', async () => {
    // status: 'confirmed' / fully paid — checkIn() is called first to set up
    // the "present" state this test exercises, so it must pass the payment
    // gate (correction: PAYMENT_GATES_CHECK_IN).
    const row: DeskOverviewRow = {
      id: 2001,
      reg_code: 'SMRT79WW4A25NWG1',
      full_name: 'Anu Pillai',
      branch: 'CSE',
      participation_type: 'campus_only',
      alumni_meal: 'veg',
      accommodation: 'none',
      check_in: null,
      check_out: null,
      photo_thumb_key: null,
      checked_in_at: null,
      checked_in_by: null,
      status: 'confirmed',
      total_amount: 5500,
      whatsapp: '+919876543210',
    };
    const auditEntries: Array<{ action: string; actor: string; targetId: number }> = [];
    const deskRepo = {
      findOverviewRow: async () => row,
      markPresent: async (_id: number, checkedInAt: number, checkedInBy: number, actorEmail: string) => {
        if (row.checked_in_at !== null) return { wrote: false };
        row.checked_in_at = checkedInAt;
        row.checked_in_by = checkedInBy;
        auditEntries.push({ action: 'attendee_checked_in', actor: actorEmail, targetId: row.id });
        return { wrote: true };
      },
      markAbsent: async (_id: number, actorEmail: string) => {
        if (row.checked_in_at === null) return { wrote: false };
        row.checked_in_at = null;
        row.checked_in_by = null;
        auditEntries.push({ action: 'attendee_check_in_undone', actor: actorEmail, targetId: row.id });
        return { wrote: true };
      },
    } as unknown as IDeskRepository;
    const paymentRepo = { sumVerifiedByRegistration: async () => row.total_amount } as unknown as IPaymentRepository;
    const service = makeService(deskRepo, { paymentRepo });
    const actor = { userId: 7, email: 'desk@example.com' };

    await service.checkIn(2001, actor);
    const undone = await service.unmarkPresent(2001, actor);
    expect(undone.checkIn).toEqual({ present: false, checkedInAt: null });

    // A repeat undo on an already-cleared row is a no-op, no second audit row.
    const repeat = await service.unmarkPresent(2001, actor);
    expect(repeat.checkIn).toEqual({ present: false, checkedInAt: null });
    const undoCount = auditEntries.filter((a) => a.action === 'attendee_check_in_undone').length;
    expect(undoCount).toBe(1);
    const checkInCount = auditEntries.filter((a) => a.action === 'attendee_checked_in').length;
    expect(checkInCount).toBe(1);
  });

  it('unmarkPresent 404s for donation-only registrations (same guard as checkIn)', async () => {
    const row: DeskOverviewRow = {
      id: 2002,
      reg_code: 'SMRT79WW4A25NWG2',
      full_name: 'Donor Only',
      branch: 'CSE',
      participation_type: 'donation_only',
      alumni_meal: 'veg',
      accommodation: 'none',
      check_in: null,
      check_out: null,
      photo_thumb_key: null,
      checked_in_at: 1_700_000_000_000,
      checked_in_by: 7,
      status: 'pending',
      total_amount: 0,
      whatsapp: '+919876543210',
    };
    const markAbsent = vi.fn();
    const deskRepo = {
      findOverviewRow: async () => row,
      markAbsent,
    } as unknown as IDeskRepository;
    const service = makeService(deskRepo);
    await expect(service.unmarkPresent(2002, { userId: 7, email: 'desk@example.com' })).rejects.toThrow(
      /Attendee not found/i,
    );
    expect(markAbsent).not.toHaveBeenCalled();
  });
});

// =============================================================================
// settleDeskPayment — desk-payment-collection plan req #1.
//
// The full HTTP-level flow (existing pending row, pending_verification
// override, already-settled 409, donation-only 404, scope guards, allowlist)
// is proven end-to-end against real D1 in registration-desk-api.test.ts. The
// two tests below exercise a branch that setup is expensive to reach — a
// registration with NO payment_pending/pending_verification row at all
// (outstanding > 0 but nothing pending, e.g. stale/legacy data) — and pin
// down settleAtDesk's exact call arguments, which is cheap to assert against
// fakes but noisy to assert against raw DB rows.
// =============================================================================

describe('RegistrationDeskService — settleDeskPayment', () => {
  function makeOverviewRow(overrides: Partial<DeskOverviewRow> = {}): DeskOverviewRow {
    return {
      id: 5001,
      reg_code: 'SMRT79WW4A25NWG5',
      full_name: 'Meera Pillai',
      branch: 'ME',
      participation_type: 'full_celebration',
      alumni_meal: 'veg',
      accommodation: 'none',
      check_in: null,
      check_out: null,
      photo_thumb_key: null,
      checked_in_at: null,
      checked_in_by: null,
      status: 'pending',
      total_amount: 5500,
      whatsapp: '+919876543211',
      ...overrides,
    };
  }

  it('creates a payment_pending row when none exists, then settles it for the full outstanding balance', async () => {
    const row = makeOverviewRow();
    const deskRepo = {
      findOverviewRow: async () => row,
      findTshirts: async () => [],
    } as unknown as IDeskRepository;

    const payments: Array<{ id: number; registrationId: number; status: string; amount: number }> = [];
    let nextPaymentId = 1;
    const settleCalls: Array<{ id: number; args: unknown }> = [];
    const paymentRepo = {
      sumVerifiedByRegistration: async () =>
        payments.filter((p) => p.status === 'verified').reduce((sum, p) => sum + p.amount, 0),
      findByRegistration: async () => payments.map((p) => ({ ...p })),
      create: async (np: { registration_id: number; amount: number; status: string }) => {
        const id = nextPaymentId++;
        payments.push({ id, registrationId: np.registration_id, status: np.status, amount: np.amount });
        return { id };
      },
      settleAtDesk: async (id: number, args: unknown) => {
        settleCalls.push({ id, args });
        const p = payments.find((p) => p.id === id);
        if (p) {
          p.status = 'verified';
          p.amount = (args as { amount: number }).amount;
        }
      },
    } as unknown as IPaymentRepository;

    let updatedStatus: string | undefined;
    const registrationRepo = {
      updateStatus: async (_id: number, status: string) => {
        updatedStatus = status;
        row.status = status as DeskOverviewRow['status'];
      },
      findById: async () => ({ id: 5001, regCode: row.reg_code, fullName: row.full_name, email: 'meera@example.com' }),
    } as unknown as IRegistrationRepository;

    const auditEntries: Array<{ action: string; actor: string; changes: string }> = [];
    const auditRepo = {
      append: async (entry: { action: string; actor: string; changes: string }) => {
        auditEntries.push(entry);
      },
      findByRegistration: async () => [],
    } as unknown as IAuditRepository;

    const service = makeService(deskRepo, { paymentRepo, registrationRepo, auditRepo });
    const overview = await service.settleDeskPayment(5001, 'cash', undefined, {
      userId: 7,
      email: 'desk@example.com',
    });

    // Would fail if settleDeskPayment's "no pending row -> create one" branch
    // were removed: without it, settleAtDesk would be called against a
    // nonexistent payment id (0 rows affected) and nothing would settle.
    expect(payments).toHaveLength(1);
    expect(settleCalls).toHaveLength(1);
    expect(settleCalls[0].args).toMatchObject({
      amount: 5500,
      method: 'cash',
      note: null,
      verifiedBy: 'desk@example.com',
    });
    expect(updatedStatus).toBe('confirmed');
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].action).toBe('desk_payment_collected');
    expect(JSON.parse(auditEntries[0].changes)).toEqual({ amount: 5500, method: 'cash' });
    expect(overview.attendee.payment).toEqual({ state: 'confirmed' });
  });

  it('409s when the outstanding balance is already zero — nothing to collect', async () => {
    const row = makeOverviewRow({ status: 'confirmed', total_amount: 5500 });
    const deskRepo = { findOverviewRow: async () => row } as unknown as IDeskRepository;
    const paymentRepo = { sumVerifiedByRegistration: async () => 5500 } as unknown as IPaymentRepository;

    const service = makeService(deskRepo, { paymentRepo });
    await expect(
      service.settleDeskPayment(5001, 'cash', undefined, { userId: 7, email: 'desk@example.com' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

// =============================================================================
// Spot registration — photo work moved off the response path (bug fix,
// follow-up)
//
// createSpotRegistration used to generate the thumbnail INLINE (blocking the
// response) and never relocated the pending photo. Both are now the route's
// job (registration-desk.routes.ts), fired via c.executionCtx.waitUntil(
// registrationService.relocateFiles(id, regCode)) — the exact method
// self-registration uses. See registration-desk-api.test.ts "desk API — spot
// registration photo finalization" for the end-to-end proof (photo relocated,
// thumbnail generated+published, and a missing photo/binding never fails the
// registration). This service no longer depends on fileStorage, an Images
// binding, or a public thumbs bucket at all — the constructor doesn't accept
// them, so createSpotRegistration cannot touch photo state by construction.
// This test is the runtime companion proof: even with a photo on the input,
// no registration-repo update happens inside createSpotRegistration itself.
// =============================================================================

describe('RegistrationDeskService — spot registration does no photo work', () => {
  it('does not call registrationRepo.update for a spot registration with a photo', async () => {
    let nextId = 3001;
    const deskRepo = {
      pruneIdempotency: async () => undefined,
      findIdempotency: async () => null,
      createSpotRegistration: async () => ({ id: nextId++ }),
    } as unknown as IDeskRepository;

    const registrationRepo = {
      findByWhatsapp: async () => [],
      findByEmail: async () => [],
      update: async () => {
        throw new Error('createSpotRegistration must not touch registration state after the atomic create');
      },
    } as unknown as IRegistrationRepository;
    const attendeeRepo = { findByRegistration: async () => [] } as unknown as IAttendeeRepository;
    const paymentRepo = { sumVerifiedByRegistration: async () => 0 } as unknown as IPaymentRepository;
    const roomRepo = { listAssignmentsByRegistration: async () => [] } as unknown as IRoomRepository;
    const auditRepo = { append: async () => {}, findByRegistration: async () => [] } as unknown as IAuditRepository;
    const tshirtChargeService = {} as unknown as TshirtChargeService;
    const emailService = {
      sendAdditionalPayment: async () => {},
      sendRevisedPayment: async () => {},
      sendPaymentConfirmed: async () => {},
    } as unknown as IEmailService;
    const refundRepo = { findByRegistration: async () => [] } as unknown as IRefundRepository;

    const service = new RegistrationDeskService({
      deskRepo,
      registrationRepo,
      attendeeRepo,
      paymentRepo,
      roomRepo,
      refundRepo,
      appBaseUrl: 'https://app.example.test',
      auditRepo,
      tshirtChargeService,
      emailService,
      pricingService: new PricingService(),
      now: () => 1_800_000_000_000,
    });

    // input.photoFileKey is set (see the shared `input` fixture above) — if
    // createSpotRegistration still tried to finalize the photo itself, the
    // registrationRepo.update() stub above would throw and fail this test.
    const result = await service.createSpotRegistration(input, { userId: 9, email: 'desk@example.com' }, 'no-photo-work-key');

    expect(result.replay).toBe(false);
    expect(result.body.registration.regCode).toMatch(/^SMRT/);
  });
});
