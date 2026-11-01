/**
 * Route-level tests for PUT /api/staff/registrations/:id — the single-save
 * sync path added by the tshirt-extras-misc-charges rework. Covers:
 *
 * 1. Sending `tshirts`/`additionalCharges` in the PUT body applies the sync
 *    and the response reflects the updated tshirts/charges.
 * 2. The pending_verification pre-check rejects the WHOLE request (including
 *    unrelated field changes) when the tshirt/charge portion of the save is
 *    cost-affecting.
 *
 * Follows the routeHarness pattern in photo-replacement.test.ts: a real
 * Hono app with the real auth middleware / requireScope chain (JWT +
 * fake-permissions-db), a fake editService that just records calls, and a
 * real TshirtChargeService wired to in-memory repo fakes so the sync path
 * actually executes.
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import type {
  Registration,
  RegistrationUpdate,
  RegistrationFilters,
  Attendee,
  Payment,
  NewPayment,
  GatewayData,
  AuditEntry,
  NewAuditEntry,
} from '../domain/types.js';
import type { RegistrationStatus, PaymentStatus } from '../domain/status.js';
import type { Tshirt, AdditionalCharge } from '@smriti/shared';
import type {
  IRegistrationRepository,
  IAttendeeRepository,
  IPaymentRepository,
  IAuditRepository,
  ITshirtRepository,
  IAdditionalChargeRepository,
} from '../repositories/interfaces.js';
import { handleError } from '../middleware/error.middleware.js';
import { _scopeCache } from '../middleware/auth.middleware.js';
import { createFakePermissionsDb } from './helpers/fake-permissions-db.js';
import { signToken } from '../infra/jwt.js';
import { staffRoutes } from '../routes/staff.routes.js';
import { TshirtChargeService } from '../services/tshirt-charge.service.js';

const JWT_SECRET = 'staff-put-tshirt-sync-test-secret-at-least-32-bytes';

function registration(overrides: Partial<Registration> = {}): Registration {
  const now = Date.now();
  return {
    id: 42,
    regCode: 'SMRT0042',
    status: 'pending',
    fullName: 'Omar M',
    branch: 'CSE',
    email: 'omar@example.com',
    whatsapp: '9999999999',
    mobileAlternate: null,
    city: 'Kochi',
    country: 'India',
    attendanceIntent: 'attending',
    participationType: 'full_celebration',
    gender: 'female',
    tshirtSize: 'M',
    alumniMeal: 'veg',
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
    pricingSnapshot: { base: 8500, collegeContribution: 0, lines: [], donation: 0, total: 8500 } as Registration['pricingSnapshot'],
    totalAmount: 8500,
    idNote: null,
    photoFileKey: null,
    photoThumbKey: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

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

async function token(role: 'staff' | 'admin'): Promise<string> {
  return signToken({ sub: '7', role, email: `${role}@example.com` }, JWT_SECRET, '1h');
}

function routeHarness() {
  _scopeCache.clear();

  const registrationRepo = new InMemoryRegistrationRepo();
  const attendeeRepo = new InMemoryAttendeeRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const auditRepo = new InMemoryAuditRepo();
  const tshirtRepo = new InMemoryTshirtRepo();
  const chargeRepo = new InMemoryChargeRepo();

  const tshirtChargeService = new TshirtChargeService({
    registrationRepo: registrationRepo as unknown as IRegistrationRepository,
    attendeeRepo: attendeeRepo as unknown as IAttendeeRepository,
    paymentRepo: paymentRepo as unknown as IPaymentRepository,
    auditRepo: auditRepo as unknown as IAuditRepository,
    tshirtRepo,
    chargeRepo,
  });

  const editCalls: Array<{ id: number; request: Record<string, unknown>; actor: string }> = [];
  const editService = {
    async edit(id: number, request: Record<string, unknown>, actor: string) {
      editCalls.push({ id, request, actor });
      const reg = registrationRepo.registrations.get(id);
      if (!reg) throw new Error('test setup: registration missing');
      return {
        registration: reg,
        pricingBreakup: reg.pricingSnapshot,
        paymentDelta: 0,
        paymentAction: 'none' as const,
      };
    },
  };

  const app = new Hono<AppEnv>().basePath('/api');
  app.onError(handleError);
  app.use('*', async (c, next) => {
    c.set('editService', editService as never);
    c.set('registrationRepo', registrationRepo as unknown as IRegistrationRepository);
    c.set('paymentRepo', paymentRepo as unknown as IPaymentRepository);
    c.set('tshirtChargeService', tshirtChargeService);
    c.set('tshirtRepo', tshirtRepo);
    c.set('chargeRepo', chargeRepo);
    await next();
  });
  app.route('/staff', staffRoutes);

  const request = (path: string, init: RequestInit = {}) => app.request(path, init, {
    JWT_SECRET,
    DB: createFakePermissionsDb(),
  } as AppEnv['Bindings']);

  return { request, editCalls, registrationRepo, paymentRepo, tshirtRepo, chargeRepo };
}

describe('PUT /api/staff/registrations/:id — tshirt/charge single-save sync', () => {
  it('applies tshirts/additionalCharges from the body and returns the updated rows', async () => {
    const h = routeHarness();
    const reg = registration({ id: 42 });
    h.registrationRepo.registrations.set(42, reg);
    await h.tshirtRepo.create({ registrationId: 42, gender: 'female', size: 'M', isIncluded: true });

    const response = await h.request('/api/staff/registrations/42', {
      method: 'PUT',
      body: JSON.stringify({
        updatedAt: reg.updatedAt,
        fields: {},
        tshirts: [
          { id: (await h.tshirtRepo.findByRegistration(42))[0].id, gender: 'female', size: 'M', isIncluded: true },
          { gender: 'male', size: 'L', isIncluded: false },
        ],
        additionalCharges: [{ description: 'Lost wristband', amount: 250 }],
      }),
      headers: {
        Authorization: `Bearer ${await token('staff')}`,
        'Content-Type': 'application/json',
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      tshirts: Array<{ size: string; isIncluded: boolean }>;
      additionalCharges: Array<{ description: string; amount: number }>;
    };
    expect(body.tshirts).toHaveLength(2);
    expect(body.tshirts.some((t) => t.size === 'L' && !t.isIncluded)).toBe(true);
    expect(body.additionalCharges).toHaveLength(1);
    expect(body.additionalCharges[0]).toEqual(expect.objectContaining({ description: 'Lost wristband', amount: 250 }));

    // Persisted, not just echoed — confirmed via the repo fakes directly.
    expect(await h.tshirtRepo.findByRegistration(42)).toHaveLength(2);
    expect(await h.chargeRepo.findByRegistration(42)).toHaveLength(1);
  });

  it('rejects the whole request — including unrelated field changes — when a payment is pending_verification and the tshirt add is cost-affecting', async () => {
    const h = routeHarness();
    const reg = registration({ id: 42, fullName: 'Original Name' });
    h.registrationRepo.registrations.set(42, reg);
    h.paymentRepo.setPaymentsForRegistration(42, [{
      id: 1,
      registrationId: 42,
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
    }]);

    const response = await h.request('/api/staff/registrations/42', {
      method: 'PUT',
      body: JSON.stringify({
        updatedAt: reg.updatedAt,
        fields: { fullName: 'Updated Name' },
        tshirts: [{ gender: 'male', size: 'L', isIncluded: false }],
      }),
      headers: {
        Authorization: `Bearer ${await token('staff')}`,
        'Content-Type': 'application/json',
      },
    });

    expect(response.status).toBe(409);
    // editService.edit() was never invoked — the whole request was rejected
    // before any part of the save (including the field change) committed.
    expect(h.editCalls).toEqual([]);
    expect(h.registrationRepo.registrations.get(42)?.fullName).toBe('Original Name');
    expect(await h.tshirtRepo.findByRegistration(42)).toHaveLength(0);
  });

  it('a cosmetic-only tshirt edit (no create/delete) is NOT blocked by pending_verification', async () => {
    const h = routeHarness();
    const reg = registration({ id: 42 });
    h.registrationRepo.registrations.set(42, reg);
    const included = await h.tshirtRepo.create({ registrationId: 42, gender: 'female', size: 'M', isIncluded: true });
    h.paymentRepo.setPaymentsForRegistration(42, [{
      id: 1,
      registrationId: 42,
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
    }]);

    const response = await h.request('/api/staff/registrations/42', {
      method: 'PUT',
      body: JSON.stringify({
        updatedAt: reg.updatedAt,
        fields: {},
        tshirts: [{ id: included.id, gender: 'female', size: 'L', isIncluded: true }],
      }),
      headers: {
        Authorization: `Bearer ${await token('staff')}`,
        'Content-Type': 'application/json',
      },
    });

    expect(response.status).toBe(200);
    expect(h.editCalls).toHaveLength(1);
    expect((await h.tshirtRepo.findByRegistration(42))[0].size).toBe('L');
  });
});
