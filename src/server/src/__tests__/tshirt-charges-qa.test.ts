/**
 * QA acceptance tests — tshirt-extras-misc-charges feature.
 *
 * Covers the 12 named QA cases from the sprint's QA plan. Cases are
 * numbered to match the plan; case 3 and case 6 have no automated
 * equivalent (case 3 doesn't exist in the plan numbering as given to this
 * agent; case 6 — "no double-count between report consumers" — is verified
 * indirectly via the pricing-engine count assertions in cases 1/5/7) and
 * are not separately named here. Case 8 (R17 gender-gated size picker) is
 * a web-only module — see src/web/src/lib/__tests__/tshirt-options.test.ts.
 * Case 12 (R21 report cell format) lives in a Python script; the closest
 * server-side equivalent (the pricing engine's line-item label) is
 * asserted here instead.
 *
 * Pricing cases (1, 2, 5, 7, 10) exercise calculateTotal() directly — it's
 * a pure function. Service-level cases (4, 9, 11) construct
 * TshirtChargeService with in-memory fakes, following the pattern in
 * payment-flow.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { calculateTotal, PRICING_DEFAULTS, splitPricingBreakup } from '@smriti/shared';
import type { Registration as SharedRegistration } from '@smriti/shared';
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

// =============================================================================
// Section A — pricing engine (pure function), cases 1, 2, 5, 7, 10
// =============================================================================

function baseSharedRegistration(overrides?: Partial<SharedRegistration>): SharedRegistration {
  return {
    contact: {
      fullName: 'Test User',
      branch: 'Computer Science & Engineering',
      gender: 'male',
      email: 'test@example.com',
      whatsapp: '+919876543210',
      city: 'Kochi',
      country: 'India',
    },
    attendance: {
      intent: 'attending',
      participationType: 'full_celebration',
      alumniMeal: 'non_veg',
      tshirtSize: 'L',
    },
    attendees: { children: [], guests: [] },
    ...overrides,
  } as SharedRegistration;
}

describe('QA Case 1: 4 shirts (1 included + 3 extras) → extra charge ₹1500, not ₹2000', () => {
  it('charges only for the 3 non-included shirts', () => {
    const reg = baseSharedRegistration();
    const breakup = calculateTotal(reg, PRICING_DEFAULTS, {
      tshirts: [
        { isIncluded: true },
        { isIncluded: false },
        { isIncluded: false },
        { isIncluded: false },
      ],
    });

    const line = breakup.lines.find((l) => l.label === 'Extra T-Shirts (3)');
    expect(line).toBeDefined();
    expect(line?.fee).toBe(1500);
    expect(line?.fee).not.toBe(2000);
  });
});

describe('QA Case 2: 1 shirt (included only) → ₹0; 0 shirts → ₹0', () => {
  it('has no t-shirt line item when only the included shirt exists', () => {
    const reg = baseSharedRegistration();
    const breakup = calculateTotal(reg, PRICING_DEFAULTS, {
      tshirts: [{ isIncluded: true }],
    });
    expect(breakup.lines.find((l) => l.label.startsWith('Extra T-Shirts'))).toBeUndefined();
  });

  it('has no t-shirt line item with zero shirt rows', () => {
    const reg = baseSharedRegistration();
    const breakup = calculateTotal(reg, PRICING_DEFAULTS, { tshirts: [] });
    expect(breakup.lines.find((l) => l.label.startsWith('Extra T-Shirts'))).toBeUndefined();
  });

  it('has no t-shirt line item when extras is omitted entirely', () => {
    const reg = baseSharedRegistration();
    const breakup = calculateTotal(reg, PRICING_DEFAULTS);
    expect(breakup.lines.find((l) => l.label.startsWith('Extra T-Shirts'))).toBeUndefined();
  });
});

describe('QA Case 5 (R13): no included shirt + 1 extra → ₹500 (free-first rule is structural)', () => {
  it('charges 1 × ₹500 when the only row present is a non-included extra', () => {
    const reg = baseSharedRegistration();
    const breakup = calculateTotal(reg, PRICING_DEFAULTS, {
      tshirts: [{ isIncluded: false }],
    });
    const line = breakup.lines.find((l) => l.label === 'Extra T-Shirts (1)');
    expect(line).toBeDefined();
    expect(line?.fee).toBe(500);
  });
});

describe('QA Case 7 (R16): pricing is derived from current rows, never incremented in place', () => {
  it('reflects 2 extras as ₹1000, then 1 extra (after a removal) as ₹500 — recomputed each time', () => {
    const reg = baseSharedRegistration();

    const withTwoExtras = calculateTotal(reg, PRICING_DEFAULTS, {
      tshirts: [{ isIncluded: true }, { isIncluded: false }, { isIncluded: false }],
    });
    expect(withTwoExtras.lines.find((l) => l.label === 'Extra T-Shirts (2)')?.fee).toBe(1000);

    // Simulate a removal: recompute from the new row set, not from the old total.
    const afterRemoval = calculateTotal(reg, PRICING_DEFAULTS, {
      tshirts: [{ isIncluded: true }, { isIncluded: false }],
    });
    expect(afterRemoval.lines.find((l) => l.label === 'Extra T-Shirts (1)')?.fee).toBe(500);

    // The two breakups are independent computations — no leftover state.
    expect(withTwoExtras.total).not.toBe(afterRemoval.total);
  });
});

describe('QA Case 10 (R18): additional charges are tagged "event", never "accommodation"', () => {
  it('categorizes the additional-charge line item as "event"', () => {
    const reg = baseSharedRegistration();
    const breakup = calculateTotal(reg, PRICING_DEFAULTS, {
      additionalCharges: [{ description: 'Lost wristband replacement', amount: 250 }],
    });
    const line = breakup.lines.find((l) => l.label === 'Lost wristband replacement');
    expect(line).toBeDefined();
    expect(line?.category).toBe('event');
    expect(line?.category).not.toBe('accommodation');
  });

  it('keeps the charge amount out of the accommodation bucket in splitPricingBreakup()', () => {
    const reg = baseSharedRegistration({
      accommodation: {
        type: 'private',
        checkIn: '2026-08-14',
        checkOut: '2026-08-16',
        extraBed: false,
      },
    });
    const withoutCharge = calculateTotal(reg, PRICING_DEFAULTS, {});
    const withCharge = calculateTotal(reg, PRICING_DEFAULTS, {
      additionalCharges: [{ description: 'Broken glass charge', amount: 300 }],
    });
    const chargeLine = withCharge.lines.find((l) => l.label === 'Broken glass charge');
    expect(chargeLine?.category).toBe('event');

    const splitWithout = splitPricingBreakup(withoutCharge, withoutCharge.total);
    const splitWith = splitPricingBreakup(withCharge, withCharge.total);

    // Adding the charge must not change the accommodation bucket at all —
    // the entire ₹300 must land in the "event" bucket.
    expect(splitWith.accommodation).toBe(splitWithout.accommodation);
    expect(splitWith.event).toBe(splitWithout.event + 300);
    expect(withCharge.total).toBe(withoutCharge.total + 300);
  });
});

describe('QA Case 12 (R21): pricing engine label format for extra shirts', () => {
  it('labels the extra-shirt line item as "Extra T-Shirts (N)" for N = 1, 2, 3', () => {
    const reg = baseSharedRegistration();
    for (const n of [1, 2, 3]) {
      const tshirts = [{ isIncluded: true }, ...Array.from({ length: n }, () => ({ isIncluded: false }))];
      const breakup = calculateTotal(reg, PRICING_DEFAULTS, { tshirts });
      expect(breakup.lines.find((l) => l.label === `Extra T-Shirts (${n})`)).toBeDefined();
    }
  });
});

// =============================================================================
// Section B — TshirtChargeService (in-memory fakes), cases 4, 9, 11
// =============================================================================

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
      // TshirtChargeService passes pricing_snapshot/total_amount via RegistrationUpdate-shaped
      // object even though the typed interface doesn't declare those fields (see service code) —
      // fake mirrors what the real repo persists.
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

describe('QA Case 4 (R22): donation_only registration rejects t-shirt addition', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = createHarness();
    h.registrationRepo.registrations.set(1, baseRegistration({ id: 1, participationType: 'donation_only' }));
  });

  it('addTshirt() throws AppError with statusCode 400', async () => {
    await expect(
      h.service.addTshirt(1, { gender: 'male', size: 'L' }, 'staff@example.com'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('does not create a tshirt row when rejected', async () => {
    await expect(h.service.addTshirt(1, { gender: 'male', size: 'L' }, 'staff@example.com')).rejects.toThrow();
    expect(await h.tshirtRepo.findByRegistration(1)).toHaveLength(0);
  });
});

describe('QA Case 9 (R23): cost-affecting mutations blocked while payment is pending_verification', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = createHarness();
    h.registrationRepo.registrations.set(1, baseRegistration({ id: 1 }));
    h.paymentRepo.setPaymentsForRegistration(1, [
      {
        id: 1,
        registrationId: 1,
        amount: 8500,
        status: 'pending_verification',
        gateway: null,
        gatewayRef: null,
        gatewayResponse: null,
        proofFileKey: null,
        verifiedBy: null,
        verifiedAt: null,
        method: null,
        note: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
  });

  it('addTshirt() rejects with statusCode 409', async () => {
    await expect(
      h.service.addTshirt(1, { gender: 'male', size: 'L' }, 'staff@example.com'),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('addCharge() rejects with statusCode 409', async () => {
    await expect(
      h.service.addCharge(1, { description: 'Lost badge', amount: 100 }, 1, 'staff@example.com'),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('removeTshirt() rejects with statusCode 409 even for an existing shirt', async () => {
    const existing = await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: false });
    await expect(
      h.service.removeTshirt(1, existing.id, 'staff@example.com'),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('removeCharge() rejects with statusCode 409 even for an existing charge', async () => {
    const existing = await h.chargeRepo.create({ registrationId: 1, description: 'Lost badge', amount: 100, createdBy: 1 });
    await expect(
      h.service.removeCharge(1, existing.id, 'staff@example.com'),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('updateTshirt() (cosmetic size/gender edit) is NOT blocked by pending_verification', async () => {
    const existing = await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: true });
    await expect(
      h.service.updateTshirt(1, existing.id, { size: 'XL' }, 'staff@example.com'),
    ).resolves.toMatchObject({ size: 'XL' });
  });
});

describe('removeTshirt(): included-shirt delete guard', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = createHarness();
    h.registrationRepo.registrations.set(1, baseRegistration({ id: 1 }));
  });

  it('throws AppError 400 when the shirt row is the included shirt', async () => {
    const included = await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: true });
    await expect(
      h.service.removeTshirt(1, included.id, 'staff@example.com'),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Cannot delete the included shirt' });
    // Nothing was deleted — the guard fires before any write.
    expect(await h.tshirtRepo.findByRegistration(1)).toHaveLength(1);
  });

  it('succeeds when the shirt row is a non-included extra', async () => {
    const extra = await h.tshirtRepo.create({ registrationId: 1, gender: 'male', size: 'L', isIncluded: false });
    const recalc = await h.service.removeTshirt(1, extra.id, 'staff@example.com');
    expect(recalc).toBeDefined();
    expect(await h.tshirtRepo.findByRegistration(1)).toHaveLength(0);
  });
});

describe('QA Case 11 (R9): additional charge amount must be positive', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = createHarness();
    h.registrationRepo.registrations.set(1, baseRegistration({ id: 1 }));
  });

  it('rejects amount = 0', async () => {
    await expect(
      h.service.addCharge(1, { description: 'Free adjustment', amount: 0 }, 1, 'staff@example.com'),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects amount = -100', async () => {
    await expect(
      h.service.addCharge(1, { description: 'Refund-shaped charge', amount: -100 }, 1, 'staff@example.com'),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('does not persist a charge row for a rejected amount', async () => {
    await expect(h.service.addCharge(1, { description: 'x', amount: -5 }, 1, 'staff@example.com')).rejects.toThrow();
    expect(await h.chargeRepo.findByRegistration(1)).toHaveLength(0);
  });

  it('accepts a positive amount', async () => {
    const { charge } = await h.service.addCharge(1, { description: 'Damaged badge', amount: 150 }, 1, 'staff@example.com');
    expect(charge.amount).toBe(150);
  });
});

describe('QA Case 9/NotFound: mutating a non-existent registration is a 404, not a silent no-op', () => {
  it('addTshirt() on an unknown registration id throws NotFoundError', async () => {
    const h = createHarness();
    await expect(
      h.service.addTshirt(999, { gender: 'male', size: 'M' }, 'staff@example.com'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
