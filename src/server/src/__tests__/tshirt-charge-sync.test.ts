/**
 * Tests for TshirtChargeService.syncTshirts()/syncCharges() and their
 * planTshirtSync()/planChargeSync() diff planners — the single-save rework
 * from the tshirt-extras-misc-charges cycle (decision-dedicated-endpoints.md).
 *
 * Reuses the in-memory fake pattern from tshirt-charges-qa.test.ts (own
 * copies here — that file's classes aren't exported).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TshirtChargeService } from '../services/tshirt-charge.service.js';
import { NotFoundError } from '../services/errors.js';
import type {
  IRegistrationRepository,
  IAttendeeRepository,
  IPaymentRepository,
  IAuditRepository,
  ITshirtRepository,
  IAdditionalChargeRepository,
} from '../repositories/interfaces.js';
import type {
  Registration,
  RegistrationUpdate,
  RegistrationFilters,
  NewAttendee,
  Attendee,
  Payment,
  NewPayment,
  GatewayData,
  AuditEntry,
  NewAuditEntry,
} from '../domain/types.js';
import type { RegistrationStatus, PaymentStatus } from '../domain/status.js';
import type { Tshirt, AdditionalCharge } from '@smriti/shared';

class InMemoryRegistrationRepo implements Partial<IRegistrationRepository> {
  registrations = new Map<number, Registration>();

  async findById(id: number): Promise<Registration | null> {
    return this.registrations.get(id) ?? null;
  }
  async update(id: number, data: RegistrationUpdate): Promise<void> {
    const reg = this.registrations.get(id);
    if (!reg) return;
    if (data.tshirt_size !== undefined) reg.tshirtSize = data.tshirt_size;
    if ('pricing_snapshot' in data) {
      const anyData = data as unknown as { pricing_snapshot?: string; total_amount?: number };
      if (anyData.pricing_snapshot !== undefined) reg.pricingSnapshot = JSON.parse(anyData.pricing_snapshot);
      if (anyData.total_amount !== undefined) reg.totalAmount = anyData.total_amount;
    }
    reg.updatedAt = Date.now();
  }
  async updateStatus(id: number, status: RegistrationStatus): Promise<void> {
    const reg = this.registrations.get(id);
    if (reg) reg.status = status;
  }
  async findByRegCode(): Promise<Registration | null> { return null; }
  async findByEmail(): Promise<Registration[]> { return []; }
  async findByWhatsapp(): Promise<Registration[]> { return []; }
  async list(_filters?: RegistrationFilters): Promise<Registration[]> { return [...this.registrations.values()]; }
  async count(): Promise<number> { return this.registrations.size; }
}

class InMemoryAttendeeRepo implements Partial<IAttendeeRepository> {
  async findByRegistration(_registrationId: number): Promise<Attendee[]> { return []; }
  async replaceForRegistration(_registrationId: number, _attendees: NewAttendee[]): Promise<void> {}
}

class InMemoryPaymentRepo implements Partial<IPaymentRepository> {
  payments = new Map<number, Payment>();
  nextId = 1;

  setPaymentsForRegistration(registrationId: number, payments: Payment[]): void {
    for (const p of payments) this.payments.set(p.id, { ...p, registrationId });
  }

  async findByRegistration(registrationId: number): Promise<Payment[]> {
    return [...this.payments.values()].filter((p) => p.registrationId === registrationId);
  }
  async sumVerifiedByRegistration(registrationId: number): Promise<number> {
    return [...this.payments.values()]
      .filter((p) => p.registrationId === registrationId && p.status === 'verified')
      .reduce((sum, p) => sum + p.amount, 0);
  }
  async findPendingByRegistration(_registrationId: number): Promise<Payment | null> { return null; }
  async deletePending(_paymentId: number): Promise<void> {}
  async updatePendingAmount(_paymentId: number, _newAmount: number): Promise<void> {}
  async create(payment: NewPayment): Promise<{ id: number }> {
    const id = this.nextId++;
    this.payments.set(id, {
      id,
      registrationId: payment.registration_id,
      amount: payment.amount,
      status: payment.status,
      gateway: payment.gateway,
      gatewayRef: payment.gateway_ref,
      gatewayResponse: payment.gateway_response,
      proofFileKey: payment.proof_file_key,
      verifiedBy: payment.verified_by,
      verifiedAt: payment.verified_at,
      method: null,
      note: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { id };
  }
  async findById(_id: number): Promise<Payment | null> { return null; }
  async updateStatus(_id: number, _status: PaymentStatus, _g?: GatewayData): Promise<void> {}
}

class InMemoryAuditRepo implements Partial<IAuditRepository> {
  entries: AuditEntry[] = [];
  async append(entry: NewAuditEntry): Promise<void> {
    this.entries.push({
      id: this.entries.length + 1,
      registrationId: entry.registration_id,
      action: entry.action,
      actor: entry.actor,
      changes: entry.changes ? JSON.parse(entry.changes) : null,
      snapshot: JSON.parse(entry.snapshot),
      createdAt: Date.now(),
    });
  }
  async findByRegistration(registrationId: number): Promise<AuditEntry[]> {
    return this.entries.filter((e) => e.registrationId === registrationId);
  }
}

class InMemoryTshirtRepo implements ITshirtRepository {
  rows = new Map<number, Tshirt>();
  nextId = 1;

  async findByRegistration(registrationId: number): Promise<Tshirt[]> {
    return [...this.rows.values()].filter((t) => t.registrationId === registrationId);
  }
  async findAll(): Promise<Tshirt[]> { return [...this.rows.values()]; }
  async create(data: { registrationId: number; gender: Tshirt['gender']; size: Tshirt['size']; isIncluded: boolean }): Promise<Tshirt> {
    const id = this.nextId++;
    const t: Tshirt = { id, registrationId: data.registrationId, gender: data.gender, size: data.size, isIncluded: data.isIncluded, createdAt: Date.now() };
    this.rows.set(id, t);
    return t;
  }
  async update(id: number, data: { gender?: Tshirt['gender']; size?: Tshirt['size'] }): Promise<void> {
    const t = this.rows.get(id);
    if (!t) return;
    if (data.gender !== undefined) t.gender = data.gender;
    if (data.size !== undefined) t.size = data.size;
  }
  async delete(id: number): Promise<void> { this.rows.delete(id); }
  async countExtras(registrationId: number): Promise<number> {
    return [...this.rows.values()].filter((t) => t.registrationId === registrationId && !t.isIncluded).length;
  }
}

class InMemoryChargeRepo implements IAdditionalChargeRepository {
  rows = new Map<number, AdditionalCharge>();
  nextId = 1;

  async findByRegistration(registrationId: number): Promise<AdditionalCharge[]> {
    return [...this.rows.values()].filter((c) => c.registrationId === registrationId);
  }
  async create(data: { registrationId: number; description: string; amount: number; createdBy: number }): Promise<AdditionalCharge> {
    const id = this.nextId++;
    const c: AdditionalCharge = { id, registrationId: data.registrationId, description: data.description, amount: data.amount, createdBy: data.createdBy, createdAt: Date.now() };
    this.rows.set(id, c);
    return c;
  }
  async delete(id: number): Promise<void> { this.rows.delete(id); }
}

function baseRegistration(overrides?: Partial<Registration>): Registration {
  const now = Date.now();
  return {
    id: 1,
    regCode: 'SM-0001',
    status: 'pending',
    fullName: 'Test User',
    branch: 'Computer Science & Engineering',
    email: 'test@example.com',
    whatsapp: '+919876543210',
    mobileAlternate: null,
    city: 'Kochi',
    country: 'India',
    attendanceIntent: 'attending',
    participationType: 'full_celebration',
    gender: 'male',
    tshirtSize: 'L',
    alumniMeal: 'non_veg',
    accommodation: 'none',
    checkIn: null,
    checkOut: null,
    extraBed: false,
    breakfastAdult: 0,
    breakfastChild: 0,
    donationAmount: 0,
    publicAck: false,
    ackDisplayName: null,
    felicitation: false,
    contributionSplits: {},
    pricingSnapshot: { base: 8500, collegeContribution: 0, lines: [], donation: 0, total: 8500 },
    totalAmount: 8500,
    idNote: null,
    photoFileKey: null,
    photoThumbKey: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Registration;
}

interface TestHarness {
  service: TshirtChargeService;
  registrationRepo: InMemoryRegistrationRepo;
  paymentRepo: InMemoryPaymentRepo;
  auditRepo: InMemoryAuditRepo;
  tshirtRepo: InMemoryTshirtRepo;
  chargeRepo: InMemoryChargeRepo;
}

function createHarness(): TestHarness {
  const registrationRepo = new InMemoryRegistrationRepo();
  const attendeeRepo = new InMemoryAttendeeRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const auditRepo = new InMemoryAuditRepo();
  const tshirtRepo = new InMemoryTshirtRepo();
  const chargeRepo = new InMemoryChargeRepo();

  const service = new TshirtChargeService({
    registrationRepo: registrationRepo as unknown as IRegistrationRepository,
    attendeeRepo: attendeeRepo as unknown as IAttendeeRepository,
    paymentRepo: paymentRepo as unknown as IPaymentRepository,
    auditRepo: auditRepo as unknown as IAuditRepository,
    tshirtRepo,
    chargeRepo,
  });

  return { service, registrationRepo, paymentRepo, auditRepo, tshirtRepo, chargeRepo };
}

// =============================================================================
// planTshirtSync()
// =============================================================================

describe('planTshirtSync(): pure diff planner', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = createHarness();
    h.registrationRepo.registrations.set(1, baseRegistration({ id: 1 }));
  });

  it('classifies an id-less item as a create and marks the plan cost-affecting', async () => {
    const plan = await h.service.planTshirtSync(1, [
      { gender: 'male', size: 'L', isIncluded: false },
    ]);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toDelete).toHaveLength(0);
    expect(plan.costAffecting).toBe(true);
  });

  it('classifies an existing row missing from the incoming list as a delete', async () => {
    const existing = await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: false });
    const plan = await h.service.planTshirtSync(1, []);
    expect(plan.toDelete.map((t) => t.id)).toEqual([existing.id]);
    expect(plan.costAffecting).toBe(true);
  });

  it('classifies a matching id with a changed size/gender as a cosmetic update, not cost-affecting', async () => {
    const existing = await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: true });
    const plan = await h.service.planTshirtSync(1, [
      { id: existing.id, gender: 'male', size: 'XL', isIncluded: true },
    ]);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toDelete).toHaveLength(0);
    expect(plan.costAffecting).toBe(false);
  });

  it('an identical row (same id, same size/gender) is not classified as an update', async () => {
    const existing = await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: true });
    const plan = await h.service.planTshirtSync(1, [
      { id: existing.id, gender: 'male', size: 'L', isIncluded: true },
    ]);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.costAffecting).toBe(false);
  });

  it('throws NotFoundError when an incoming id does not match any existing row', async () => {
    await expect(
      h.service.planTshirtSync(1, [{ id: 999, gender: 'male', size: 'L', isIncluded: false }]),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('never writes anything — pure read-only diff', async () => {
    await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: true });
    await h.service.planTshirtSync(1, []); // would delete if executed
    expect(await h.tshirtRepo.findByRegistration(1)).toHaveLength(1);
  });
});

// =============================================================================
// planChargeSync()
// =============================================================================

describe('planChargeSync(): pure diff planner', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = createHarness();
    h.registrationRepo.registrations.set(1, baseRegistration({ id: 1 }));
  });

  it('classifies an id-less item as a create', async () => {
    const plan = await h.service.planChargeSync(1, [{ description: 'Lost badge', amount: 100 }]);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.costAffecting).toBe(true);
  });

  it('classifies an existing charge missing from incoming as a delete', async () => {
    const existing = await h.chargeRepo.create({ registrationId: 1, description: 'x', amount: 100, createdBy: 1 });
    const plan = await h.service.planChargeSync(1, []);
    expect(plan.toDelete.map((c) => c.id)).toEqual([existing.id]);
    expect(plan.costAffecting).toBe(true);
  });

  it('a matching id is a no-op regardless of description/amount drift (charges are immutable)', async () => {
    const existing = await h.chargeRepo.create({ registrationId: 1, description: 'Original', amount: 100, createdBy: 1 });
    const plan = await h.service.planChargeSync(1, [
      { id: existing.id, description: 'Attempted rename', amount: 999 },
    ]);
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toDelete).toHaveLength(0);
    expect(plan.costAffecting).toBe(false);
  });

  it('throws NotFoundError when an incoming id does not match any existing charge', async () => {
    await expect(
      h.service.planChargeSync(1, [{ id: 999, description: 'x', amount: 100 }]),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// =============================================================================
// syncTshirts()
// =============================================================================

describe('syncTshirts(): executes the plan', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = createHarness();
    h.registrationRepo.registrations.set(1, baseRegistration({ id: 1 }));
  });

  it('creates a new extra shirt and recalculates pricing (cost-affecting)', async () => {
    const result = await h.service.syncTshirts(1, [{ gender: 'male', size: 'L', isIncluded: false }], 'staff@example.com');
    expect(result.tshirts).toHaveLength(1);
    expect(result.recalc).not.toBeNull();
    expect(result.recalc?.paymentAction).toBe('created');
    expect(h.registrationRepo.registrations.get(1)?.totalAmount).toBeGreaterThan(8500);
  });

  it('deletes a shirt absent from the incoming list and recalculates pricing', async () => {
    const existing = await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: false });
    // Seed a prior recalc so total_amount reflects the extra shirt before removal.
    h.registrationRepo.registrations.get(1)!.totalAmount = 9000;

    const result = await h.service.syncTshirts(1, [], 'staff@example.com');
    expect(await h.tshirtRepo.findByRegistration(1)).toHaveLength(0);
    expect(result.recalc).not.toBeNull();
    expect(h.registrationRepo.registrations.get(1)?.totalAmount).toBe(8500);
    void existing;
  });

  it('cosmetic-only update (size change) does not recalculate pricing but appends tshirt_updated audit', async () => {
    const existing = await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: true });
    const totalBefore = h.registrationRepo.registrations.get(1)!.totalAmount;

    const result = await h.service.syncTshirts(
      1,
      [{ id: existing.id, gender: 'male', size: 'XL', isIncluded: true }],
      'staff@example.com',
    );
    expect(result.recalc).toBeNull();
    expect(h.registrationRepo.registrations.get(1)?.totalAmount).toBe(totalBefore);
    expect(h.auditRepo.entries.some((e) => e.action === 'tshirt_updated')).toBe(true);
  });

  it('mirror-syncs registrations.tshirt_size when the included shirt size changes', async () => {
    const existing = await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: true });
    await h.service.syncTshirts(1, [{ id: existing.id, gender: 'male', size: '2XL', isIncluded: true }], 'staff@example.com');
    expect(h.registrationRepo.registrations.get(1)?.tshirtSize).toBe('2XL');
  });

  it('a no-op plan (identical single shirt) does nothing and returns recalc: null', async () => {
    const existing = await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: true });
    const auditCountBefore = h.auditRepo.entries.length;
    const result = await h.service.syncTshirts(1, [{ id: existing.id, gender: 'male', size: 'L', isIncluded: true }], 'staff@example.com');
    expect(result.recalc).toBeNull();
    expect(h.auditRepo.entries).toHaveLength(auditCountBefore);
  });

  it('rejects (400) deleting the included shirt, even when other rows are also being deleted', async () => {
    const included = await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: true });
    await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'M', isIncluded: false });
    await expect(h.service.syncTshirts(1, [], 'staff@example.com')).rejects.toMatchObject({ statusCode: 400 });
    // Nothing was deleted — the guard fires before any writes.
    expect(await h.tshirtRepo.findByRegistration(1)).toHaveLength(2);
    void included;
  });

  it('rejects (400) creating a shirt for a donation_only registration', async () => {
    h.registrationRepo.registrations.set(2, baseRegistration({ id: 2, participationType: 'donation_only' }));
    await expect(
      h.service.syncTshirts(2, [{ gender: 'male', size: 'L', isIncluded: false }], 'staff@example.com'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects (409) a create/delete plan while a payment is pending_verification', async () => {
    h.paymentRepo.setPaymentsForRegistration(1, [{
      id: 1, registrationId: 1, amount: 8500, status: 'pending_verification', gateway: null, gatewayRef: null,
      gatewayResponse: null, proofFileKey: null, verifiedBy: null, verifiedAt: null, method: null, note: null, createdAt: Date.now(), updatedAt: Date.now(),
    }]);
    await expect(
      h.service.syncTshirts(1, [{ gender: 'male', size: 'L', isIncluded: false }], 'staff@example.com'),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await h.tshirtRepo.findByRegistration(1)).toHaveLength(0);
  });

  it('a cosmetic-only plan is NOT blocked by pending_verification (R23)', async () => {
    const existing = await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: true });
    h.paymentRepo.setPaymentsForRegistration(1, [{
      id: 1, registrationId: 1, amount: 8500, status: 'pending_verification', gateway: null, gatewayRef: null,
      gatewayResponse: null, proofFileKey: null, verifiedBy: null, verifiedAt: null, method: null, note: null, createdAt: Date.now(), updatedAt: Date.now(),
    }]);
    const result = await h.service.syncTshirts(1, [{ id: existing.id, gender: 'male', size: 'XL', isIncluded: true }], 'staff@example.com');
    expect(result.tshirts[0].size).toBe('XL');
  });
});

// =============================================================================
// syncCharges()
// =============================================================================

describe('syncCharges(): executes the plan', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = createHarness();
    h.registrationRepo.registrations.set(1, baseRegistration({ id: 1 }));
  });

  it('creates a new charge and recalculates pricing', async () => {
    const result = await h.service.syncCharges(1, [{ description: 'Lost badge', amount: 100 }], 7, 'staff@example.com');
    expect(result.charges).toHaveLength(1);
    expect(result.charges[0].createdBy).toBe(7);
    expect(result.recalc).not.toBeNull();
    expect(h.registrationRepo.registrations.get(1)?.totalAmount).toBe(8600);
  });

  it('deletes a charge absent from incoming and recalculates pricing', async () => {
    const existing = await h.chargeRepo.create({ registrationId: 1, description: 'x', amount: 100, createdBy: 1 });
    h.registrationRepo.registrations.get(1)!.totalAmount = 8600;

    const result = await h.service.syncCharges(1, [], 7, 'staff@example.com');
    expect(await h.chargeRepo.findByRegistration(1)).toHaveLength(0);
    expect(result.recalc).not.toBeNull();
    expect(h.registrationRepo.registrations.get(1)?.totalAmount).toBe(8500);
    void existing;
  });

  it('a matching-id no-op plan leaves the charge untouched (immutable) and does not recalculate', async () => {
    const existing = await h.chargeRepo.create({ registrationId: 1, description: 'Original', amount: 100, createdBy: 1 });
    const result = await h.service.syncCharges(
      1,
      [{ id: existing.id, description: 'Attempted rename', amount: 999 }],
      7,
      'staff@example.com',
    );
    expect(result.charges[0].description).toBe('Original');
    expect(result.charges[0].amount).toBe(100);
    expect(result.recalc).toBeNull();
  });

  it('rejects (422) a create with amount <= 0', async () => {
    await expect(
      h.service.syncCharges(1, [{ description: 'Free adjustment', amount: 0 }], 7, 'staff@example.com'),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(await h.chargeRepo.findByRegistration(1)).toHaveLength(0);
  });

  it('rejects (422) a create with a blank description', async () => {
    await expect(
      h.service.syncCharges(1, [{ description: '   ', amount: 50 }], 7, 'staff@example.com'),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects (409) a create/delete plan while a payment is pending_verification', async () => {
    h.paymentRepo.setPaymentsForRegistration(1, [{
      id: 1, registrationId: 1, amount: 8500, status: 'pending_verification', gateway: null, gatewayRef: null,
      gatewayResponse: null, proofFileKey: null, verifiedBy: null, verifiedAt: null, method: null, note: null, createdAt: Date.now(), updatedAt: Date.now(),
    }]);
    await expect(
      h.service.syncCharges(1, [{ description: 'Lost badge', amount: 100 }], 7, 'staff@example.com'),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await h.chargeRepo.findByRegistration(1)).toHaveLength(0);
  });

  it('throws NotFoundError for an unknown registration id', async () => {
    await expect(
      h.service.syncCharges(999, [{ description: 'x', amount: 100 }], 7, 'staff@example.com'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
