/**
 * HTTP-boundary tests for the partial verification & refunds feature.
 *
 * Scope: this exercises the ACTUAL consumer boundary — the staff dashboard
 * client calls these HTTP endpoints, not PaymentService methods directly.
 * `e2e.test.ts`'s "PaymentService — partial verification & refunds" describe
 * block calls `paymentService.verifyPayment()` etc. directly, which never
 * exercises:
 *   - the route-level validation in staff.routes.ts (numeric coercion for
 *     actualAmount/amount/sourcePaymentId, trimming, 404 id-param guards)
 *   - the `c.var.refundRepo` wiring used directly by GET /staff/refunds
 *   - AppError -> HTTP status code mapping via handleError middleware
 *
 * These are new/changed routes for this feature:
 *   - POST /staff/payments/:id/verify        (actualAmount is new)
 *   - POST /staff/registrations/:id/balance-payment  (new)
 *   - GET  /staff/refunds                     (new)
 *   - POST /staff/refunds/:id/complete        (new)
 *
 * Requirements covered: R1, R2, R2.1, R3, R7, R8, R9, R13.2, R13.5.
 * Design validation scenarios covered: V1, V3, V4, V6, V7, V8, V9, V10.
 *
 * @module payment-partial-refund-routes.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { handleError } from "../middleware/error.middleware.js";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { createFakePermissionsDb } from "./helpers/fake-permissions-db.js";
import { staffRoutes } from "../routes/staff.routes.js";
import { PaymentService } from "../services/payment.service.js";
import { signToken } from "../infra/jwt.js";
import { RefundCompletionFakeD1 } from "./helpers/refund-completion-d1.js";
import type {
  IRegistrationRepository,
  IAttendeeRepository,
  IPaymentRepository,
  IAuditRepository,
  IEmailService,
  IRefundRepository,
  IFileStorage,
} from "../repositories/interfaces.js";
import type {
  Registration,
  NewRegistration,
  RegistrationUpdate,
  RegistrationFilters,
  Attendee,
  NewAttendee,
  Payment,
  NewPayment,
  GatewayData,
  AuditEntry,
  NewAuditEntry,
  Refund,
  NewRefund,
} from "../domain/types.js";
import type { RegistrationStatus, PaymentStatus } from "../domain/status.js";
import type { RegistrationInsertSet } from "../domain/registration-insert-set.js";
import type { PricingBreakup } from "@smriti/shared";

const TEST_JWT_SECRET = "test-secret-key-for-payment-route-tests-32chars!";
const TEST_ENV = {
  JWT_SECRET: TEST_JWT_SECRET,
  DB: createFakePermissionsDb(),
} as unknown as import("../env.js").Env;

async function staffToken(email = "staff@example.test"): Promise<string> {
  return signToken({ sub: "10", role: "staff", email }, TEST_JWT_SECRET, "7d");
}

// ---------------------------------------------------------------------------
// In-memory fakes — real behavior, observable side effects (not silent stubs)
// ---------------------------------------------------------------------------

class InMemoryRegistrationRepo implements IRegistrationRepository {
  private registrations: Map<number, Registration> = new Map();
  private nextId = 1001;

  async create(registration: NewRegistration, _attendees: NewAttendee[]): Promise<{ id: number }> {
    const id = this.nextId++;
    const now = Date.now();
    const reg: Registration = {
      id,
      regCode: registration.reg_code,
      status: "pending",
      fullName: registration.full_name,
      branch: registration.branch,
      email: registration.email,
      whatsapp: registration.whatsapp,
      mobileAlternate: registration.mobile_alternate,
      city: registration.city,
      country: registration.country,
      attendanceIntent: registration.attendance_intent,
      participationType: registration.participation_type,
      gender: registration.gender,
      tshirtSize: registration.tshirt_size,
      alumniMeal: registration.alumni_meal,
      accommodation: registration.accommodation,
      checkIn: registration.check_in,
      checkOut: registration.check_out,
      extraBed: registration.extra_bed !== 0,
      breakfastAdult: 0,
      breakfastChild: 0,
      donationAmount: registration.donation_amount,
      publicAck: registration.public_ack !== 0,
      ackDisplayName: registration.ack_display_name,
      felicitation: registration.felicitation !== 0,
      contributionSplits: {},
      pricingSnapshot: JSON.parse(registration.pricing_snapshot) as PricingBreakup,
      totalAmount: registration.total_amount,
      idNote: registration.id_note,
      photoFileKey: registration.photo_file_key,
      photoThumbKey: null,
      createdAt: now,
      updatedAt: now,
    };
    this.registrations.set(id, reg);
    return { id };
  }

  async createWithRelations(insertSet: RegistrationInsertSet): Promise<{ id: number }> {
    return this.create(insertSet.registration, insertSet.attendees);
  }

  async findById(id: number): Promise<Registration | null> {
    return this.registrations.get(id) ?? null;
  }

  async findByRegCode(regCode: string): Promise<Registration | null> {
    for (const reg of this.registrations.values()) if (reg.regCode === regCode) return reg;
    return null;
  }

  async findByEmail(email: string): Promise<Registration[]> {
    return [...this.registrations.values()].filter((r) => r.email === email);
  }

  async findByWhatsapp(whatsapp: string): Promise<Registration[]> {
    return [...this.registrations.values()].filter((r) => r.whatsapp === whatsapp);
  }

  async updateStatus(id: number, status: RegistrationStatus): Promise<void> {
    const reg = this.registrations.get(id);
    if (reg) {
      reg.status = status;
      reg.updatedAt = Date.now();
    }
  }

  async update(_id: number, _data: RegistrationUpdate, _attendees?: NewAttendee[]): Promise<void> {}
  async list(_filters?: RegistrationFilters): Promise<Registration[]> { return []; }
  async count(_filters?: RegistrationFilters): Promise<number> { return this.registrations.size; }
  async countByStatus(): Promise<{ pending: number; pendingVerification: number; confirmed: number }> {
    return { pending: 0, pendingVerification: 0, confirmed: 0 };
  }
  async geographyAggregates() { return { cities: [], countries: [] }; }
  async donorRecognitionRows() { return { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 }; }
  async getContributionAggregates() { return []; }
  async countByParticipationAndStatus() {
    const zero = () => ({ total: 0, confirmed: 0, pending: 0, pendingVerification: 0 });
    return { full_celebration: zero(), campus_only: zero(), donation_only: zero() } as Record<
      'full_celebration' | 'campus_only' | 'donation_only',
      { total: number; confirmed: number; pending: number; pendingVerification: number }
    >;
  }
  async getDonationTotals() { return { count: 0, total: 0 }; }
  async findMissingThumbnails() { return []; }
  async findWithThumbnails() { return []; }
  async updateWithLock(): Promise<void> {}
}

class InMemoryAttendeeRepo implements IAttendeeRepository {
  async findByRegistration(_registrationId: number): Promise<Attendee[]> { return []; }
  async replaceForRegistration(_registrationId: number, _newAttendees: NewAttendee[]): Promise<void> {}
  async countGrouped() { return []; }
  async accommodationByNight() {
    return {
      '2026-08-14': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 },
      '2026-08-15': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 },
    };
  }
  async mealsByParticipationType() {
    return { campusDayCaterer: { headcount: 0, veg: 0, nonVeg: 0 }, ravizBanquet: { headcount: 0, veg: 0, nonVeg: 0 } };
  }
  async childrenByAgeBand() { return { under6: 0, age6to12: 0, age12plus: 0 }; }
}

/** Mirrors the real D1PaymentRepository's verify() semantics: WHERE-guarded,
 * silently no-ops if the payment isn't pending_verification. This is what
 * makes the HTTP-level tests trustworthy — deleting the service's
 * `paymentRepo.verify()` call would leave the payment status untouched and
 * these tests would catch it. */
class InMemoryPaymentRepo implements IPaymentRepository {
  private payments: Map<number, Payment> = new Map();
  private nextId = 1;

  async create(payment: NewPayment): Promise<{ id: number }> {
    const id = this.nextId++;
    const now = Date.now();
    const p: Payment = {
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
      createdAt: now,
      updatedAt: now,
    };
    this.payments.set(id, p);
    return { id };
  }

  async findById(id: number): Promise<Payment | null> {
    const p = this.payments.get(id);
    return p ? { ...p } : null;
  }

  async findByRegistration(registrationId: number): Promise<Payment[]> {
    return [...this.payments.values()]
      .filter((p) => p.registrationId === registrationId)
      .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  }

  async updateStatus(
    id: number,
    status: PaymentStatus,
    gatewayData?: GatewayData,
    proofFileKey?: string,
    verification?: { verifiedBy: string; verifiedAt: number },
  ): Promise<void> {
    const p = this.payments.get(id);
    if (!p) return;
    p.status = status;
    p.updatedAt = Date.now();
    if (gatewayData?.gatewayRef !== undefined) p.gatewayRef = gatewayData.gatewayRef;
    if (gatewayData?.gateway !== undefined) p.gateway = gatewayData.gateway;
    if (proofFileKey !== undefined) p.proofFileKey = proofFileKey;
    if (verification !== undefined) {
      p.verifiedBy = verification.verifiedBy;
      p.verifiedAt = verification.verifiedAt;
    }
  }

  async sumVerified(): Promise<number> { return 0; }
  async sumVerifiedByBranch(): Promise<Array<{ branch: string; collected: number }>> { return []; }

  async verify(id: number, amount: number, gatewayRef: string, verifiedBy: string, verifiedAt: number): Promise<void> {
    const p = this.payments.get(id);
    if (!p || p.status !== 'pending_verification') return;
    p.status = 'verified';
    p.amount = amount;
    p.gatewayRef = gatewayRef;
    p.verifiedBy = verifiedBy;
    p.verifiedAt = verifiedAt;
    p.updatedAt = Date.now();
  }

  async settleAtDesk(): Promise<void> {}

  async findPendingByRegistration(registrationId: number): Promise<Payment | null> {
    const pending = [...this.payments.values()].filter(
      (p) => p.registrationId === registrationId && p.status === 'payment_pending',
    );
    return pending[0] ?? null;
  }

  async deletePending(): Promise<void> {}
  async updatePendingAmount(): Promise<void> {}

  async sumVerifiedByRegistration(registrationId: number): Promise<number> {
    return [...this.payments.values()]
      .filter((p) => p.registrationId === registrationId && p.status === 'verified')
      .reduce((sum, p) => sum + p.amount, 0);
  }
}

class InMemoryRefundRepo implements IRefundRepository {
  refunds: Map<number, Refund> = new Map();
  private nextId = 1;

  async create(refund: NewRefund): Promise<{ id: number }> {
    const id = this.nextId++;
    this.refunds.set(id, {
      id,
      registrationId: refund.registration_id,
      sourcePaymentId: refund.source_payment_id,
      amount: refund.amount,
      reason: 'overpayment',
      cancellationReason: null,
      status: refund.status,
      bankReference: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: Date.now(),
      originalRegistrationId: refund.registration_id,
      originalPaymentId: refund.source_payment_id,
      regCode: '—',
      fullName: '—',
      email: '',
      sourcePaymentAmount: refund.amount,
      sourcePaymentReference: null,
      ownerKind: 'active',
    });
    return { id };
  }

  async findById(id: number): Promise<Refund | null> {
    return this.refunds.get(id) ?? null;
  }

  async list(filters?: { status?: string }): Promise<Refund[]> {
    let results = [...this.refunds.values()];
    if (filters?.status) results = results.filter((r) => r.status === filters.status);
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  async listWithRegistration(filters?: { status?: string }): Promise<Refund[]> {
    return this.list(filters);
  }

  async findByRegistration(registrationId: number): Promise<Refund[]> {
    return [...this.refunds.values()]
      .filter((r) => r.registrationId === registrationId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async findByOriginalRegistration(originalRegistrationId: number): Promise<Refund[]> {
    return [...this.refunds.values()]
      .filter((r) => r.originalRegistrationId === originalRegistrationId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async complete(id: number, resolvedBy: string, bankReference: string): Promise<void> {
    const r = this.refunds.get(id);
    if (!r || r.status !== 'pending') return;
    r.status = 'completed';
    r.resolvedBy = resolvedBy;
    r.resolvedAt = Date.now();
    r.bankReference = bankReference;
  }
}

// ---------------------------------------------------------------------------
// RefundCompletionFakeD1 — emulates PaymentService's completeRefund() guarded
// batch against the in-memory refund repo. Imported from
// helpers/refund-completion-d1.ts; a losing statement writes zero rows exactly
// like the real guarded SQL, so a repeat completion is reported as 409 with no
// system-audit row. (verifyPayment's overpayment branch runs plain repository
// calls and needs no D1 emulation.)
// ---------------------------------------------------------------------------

class InMemoryAuditRepo implements IAuditRepository {
  entries: AuditEntry[] = [];
  private nextId = 1;

  async append(entry: NewAuditEntry): Promise<void> {
    this.entries.push({
      id: this.nextId++,
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

const stubFileStorage: IFileStorage = {
  async upload(): Promise<void> {},
  async getSignedUrl(): Promise<string> { return ""; },
  async get() { return null; },
  async delete(): Promise<void> {},
  async copy(): Promise<boolean> { return true; },
  async move(): Promise<void> {},
};

class ObservableEmailService implements IEmailService {
  sentPaymentConfirmed: Array<{ to: string; data: unknown }> = [];
  sentAdditionalPayment: Array<{ to: string; data: unknown }> = [];

  async sendConfirmation(): Promise<void> {}
  async sendMagicLink(): Promise<void> {}
  async sendPaymentConfirmed(to: string, data: unknown): Promise<void> {
    this.sentPaymentConfirmed.push({ to, data });
  }
  async sendPaymentRejected(): Promise<void> {}
  async sendStaffWelcome(): Promise<void> {}
  async sendPaymentLink(): Promise<void> {}
  async sendRevisedPayment(): Promise<void> {}
  async sendAdditionalPayment(to: string, data: unknown): Promise<void> {
    this.sentAdditionalPayment.push({ to, data });
  }
  async sendStoryHidden(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Test app factory — mirrors app.ts wiring for the routes under test
// ---------------------------------------------------------------------------

interface TestContext {
  req: (input: string, init?: RequestInit) => Response | Promise<Response>;
  regRepo: InMemoryRegistrationRepo;
  paymentRepo: InMemoryPaymentRepo;
  refundRepo: InMemoryRefundRepo;
  auditRepo: InMemoryAuditRepo;
  emailService: ObservableEmailService;
  completionDb: RefundCompletionFakeD1;
}

function createTestApp(): TestContext {
  _scopeCache.clear();
  const regRepo = new InMemoryRegistrationRepo();
  const attendeeRepo = new InMemoryAttendeeRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const refundRepo = new InMemoryRefundRepo();
  const auditRepo = new InMemoryAuditRepo();
  const emailService = new ObservableEmailService();
  const completionDb = new RefundCompletionFakeD1({ refundRepo });

  const paymentService = new PaymentService({
    db: completionDb as unknown as import('@cloudflare/workers-types').D1Database,
    registrationRepo: regRepo,
    paymentRepo,
    attendeeRepo,
    auditRepo,
    refundRepo,
    fileStorage: stubFileStorage,
    emailService,
    appBaseUrl: "http://localhost:5173",
  });

  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);
  app.use("*", async (c, next) => {
    c.set("paymentService", paymentService);
    c.set("refundRepo", refundRepo);
    await next();
  });
  app.route("/staff", staffRoutes);

  const req = (input: string, init?: RequestInit) => app.request(input, init, TEST_ENV);

  return { req, regRepo, paymentRepo, refundRepo, auditRepo, emailService, completionDb };
}

let regCounter = 0;

function buildRegistration(totalAmount: number): NewRegistration {
  regCounter += 1;
  const n = regCounter;
  return {
    reg_code: `SMRTROUTETEST${String(n).padStart(5, "0")}`,
    full_name: "Test Alumni",
    branch: "2005",
    email: `route-alumni${n}@example.com`,
    whatsapp: "+919999999999",
    mobile_alternate: null,
    city: "Kochi",
    country: "India",
    attendance_intent: "attending",
    participation_type: "full_celebration",
    gender: null,
    tshirt_size: "M",
    alumni_meal: "veg",
    accommodation: "none",
    check_in: null,
    check_out: null,
    extra_bed: 0,
    donation_amount: 0,
    public_ack: 0,
    ack_display_name: null,
    felicitation: 0,
    contribution_splits: "{}",
    pricing_snapshot: JSON.stringify({ base: totalAmount, lines: [], donation: 0, collegeContribution: 0, total: totalAmount }),
    total_amount: totalAmount,
    id_note: null,
    photo_file_key: null,
  };
}

async function seedPendingVerification(
  ctx: TestContext,
  opts?: { totalAmount?: number; paymentAmount?: number },
): Promise<{ regId: number; paymentId: number }> {
  const totalAmount = opts?.totalAmount ?? 13810;
  const paymentAmount = opts?.paymentAmount ?? totalAmount;
  const { id: regId } = await ctx.regRepo.create(buildRegistration(totalAmount), []);
  const { id: paymentId } = await ctx.paymentRepo.create({
    registration_id: regId,
    amount: paymentAmount,
    status: "pending_verification",
    gateway: null,
    gateway_ref: null,
    gateway_response: null,
    proof_file_key: "proof-key.jpg",
    verified_by: null,
    verified_at: null,
  });
  return { regId, paymentId };
}

// ---------------------------------------------------------------------------
// POST /api/staff/payments/:id/verify
// ---------------------------------------------------------------------------

describe("POST /api/staff/payments/:id/verify — actualAmount (R1, R2, R7-R9)", () => {
  let ctx: TestContext;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffToken();
  });

  it("V1: full verify over HTTP actually persists verified status+amount (not a route stub)", async () => {
    const { regId, paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });

    const res = await ctx.req(`/api/staff/payments/${paymentId}/verify`, {
      method: "POST",
      body: JSON.stringify({ referenceId: "UTR123", actualAmount: 13810 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { paymentStatus: string; registrationStatus: string };
    expect(body.paymentStatus).toBe("verified");
    expect(body.registrationStatus).toBe("confirmed");

    // Prove the HTTP call actually mutated repo state, not just returned a
    // canned response — this is what an "Invisible Side Effect" test misses.
    const payment = await ctx.paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("verified");
    expect(payment?.amount).toBe(13810);
    const reg = await ctx.regRepo.findById(regId);
    expect(reg?.status).toBe("confirmed");
  });

  it("V4: passes actualAmount through to the service for a partial verify", async () => {
    const { regId, paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });
    await ctx.paymentRepo.create({
      registration_id: regId,
      amount: 2620,
      status: "payment_pending",
      gateway: null,
      gateway_ref: null,
      gateway_response: null,
      proof_file_key: null,
      verified_by: null,
      verified_at: null,
    });

    const res = await ctx.req(`/api/staff/payments/${paymentId}/verify`, {
      method: "POST",
      body: JSON.stringify({ referenceId: "UTR123", actualAmount: 11190 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { paymentStatus: string; registrationStatus: string };
    expect(body.registrationStatus).not.toBe("confirmed");

    const payment = await ctx.paymentRepo.findById(paymentId);
    expect(payment?.amount).toBe(11190);
    expect(payment?.status).toBe("verified");
  });

  it("V3: 409 propagates over HTTP when actualAmount creates an uncovered shortfall", async () => {
    const { paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });

    const res = await ctx.req(`/api/staff/payments/${paymentId}/verify`, {
      method: "POST",
      body: JSON.stringify({ referenceId: "UTR123", actualAmount: 11190 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/uncovered shortfall/i);

    // Verify never partially applies on rejection.
    const payment = await ctx.paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("pending_verification");
  });

  it("V7: 422 when actualAmount is zero (route-level validation)", async () => {
    const { paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });

    const res = await ctx.req(`/api/staff/payments/${paymentId}/verify`, {
      method: "POST",
      body: JSON.stringify({ referenceId: "UTR123", actualAmount: 0 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(422);
    const body = await res.json() as { details: { fieldErrors: Record<string, string> } };
    expect(body.details.fieldErrors.actualAmount).toBeDefined();
  });

  it("422 when actualAmount is negative (route-level validation)", async () => {
    const { paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });

    const res = await ctx.req(`/api/staff/payments/${paymentId}/verify`, {
      method: "POST",
      body: JSON.stringify({ referenceId: "UTR123", actualAmount: -500 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(422);
  });

  it("422 when actualAmount is missing (now mandatory)", async () => {
    const { paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });

    const res = await ctx.req(`/api/staff/payments/${paymentId}/verify`, {
      method: "POST",
      body: JSON.stringify({ referenceId: "UTR123" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(422);
    const body = await res.json() as { details: { fieldErrors: Record<string, string> } };
    expect(body.details.fieldErrors.actualAmount).toBe("Required");
  });

  it("422 when actualAmount is not a number (route-level validation)", async () => {
    const { paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });

    const res = await ctx.req(`/api/staff/payments/${paymentId}/verify`, {
      method: "POST",
      body: JSON.stringify({ referenceId: "UTR123", actualAmount: "not-a-number" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(422);
    // Must not have been forwarded to the service and silently coerced to
    // NaN, which would make `actual <= 0` false and slip past validation.
    const payment = await ctx.paymentRepo.findById(paymentId);
    expect(payment?.status).toBe("pending_verification");
  });

  it("V6: overpayment over HTTP returns refundCreated and persists the refund", async () => {
    const { paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });

    const res = await ctx.req(`/api/staff/payments/${paymentId}/verify`, {
      method: "POST",
      body: JSON.stringify({ referenceId: "UTR123", actualAmount: 25000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { refundCreated?: { id: number; amount: number } };
    expect(body.refundCreated).toBeDefined();
    expect(body.refundCreated?.amount).toBe(11190);

    const refunds = await ctx.refundRepo.list({ status: "pending" });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(11190);

    const payment = await ctx.paymentRepo.findById(paymentId);
    expect(payment?.amount).toBe(13810);
  });

  it("response omits refundCreated entirely for a non-overpayment verify", async () => {
    const { paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });

    const res = await ctx.req(`/api/staff/payments/${paymentId}/verify`, {
      method: "POST",
      body: JSON.stringify({ referenceId: "UTR123", actualAmount: 13810 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    const body = await res.json() as Record<string, unknown>;
    expect("refundCreated" in body).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/staff/registrations/:id/balance-payment
// ---------------------------------------------------------------------------

describe("POST /api/staff/registrations/:id/balance-payment (R3, R4)", () => {
  let ctx: TestContext;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffToken();
  });

  it("V4: creates a payment_pending record and sends the payment-link notification", async () => {
    const { regId, paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });

    const res = await ctx.req(`/api/staff/registrations/${regId}/balance-payment`, {
      method: "POST",
      body: JSON.stringify({ amount: 2620, sourcePaymentId: paymentId }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { paymentId: number; amount: number; status: string };
    expect(body.amount).toBe(2620);
    expect(body.status).toBe("payment_pending");

    const pending = await ctx.paymentRepo.findPendingByRegistration(regId);
    expect(pending?.amount).toBe(2620);
    expect(ctx.emailService.sentAdditionalPayment).toHaveLength(1);

    const created = ctx.auditRepo.entries.filter((e) => e.action === "payment_created");
    expect(created).toHaveLength(1);
  });

  it("422 when amount is missing", async () => {
    const { regId, paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });

    const res = await ctx.req(`/api/staff/registrations/${regId}/balance-payment`, {
      method: "POST",
      body: JSON.stringify({ sourcePaymentId: paymentId }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(422);
  });

  it("422 when amount is zero or negative", async () => {
    const { regId, paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });

    const res = await ctx.req(`/api/staff/registrations/${regId}/balance-payment`, {
      method: "POST",
      body: JSON.stringify({ amount: -1, sourcePaymentId: paymentId }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(422);
  });

  it("422 when sourcePaymentId is missing", async () => {
    const { regId } = await seedPendingVerification(ctx, { totalAmount: 13810 });

    const res = await ctx.req(`/api/staff/registrations/${regId}/balance-payment`, {
      method: "POST",
      body: JSON.stringify({ amount: 2620 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(422);
  });

  it("V8: 409 when a pending payment already exists for the registration", async () => {
    const { regId, paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });
    await ctx.paymentRepo.create({
      registration_id: regId,
      amount: 1000,
      status: "payment_pending",
      gateway: null,
      gateway_ref: null,
      gateway_response: null,
      proof_file_key: null,
      verified_by: null,
      verified_at: null,
    });

    const res = await ctx.req(`/api/staff/registrations/${regId}/balance-payment`, {
      method: "POST",
      body: JSON.stringify({ amount: 1000, sourcePaymentId: paymentId }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(409);
  });

  it("404 when the registration does not exist", async () => {
    const res = await ctx.req(`/api/staff/registrations/999999/balance-payment`, {
      method: "POST",
      body: JSON.stringify({ amount: 1000, sourcePaymentId: 1 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/staff/refunds
// ---------------------------------------------------------------------------

describe("GET /api/staff/refunds (R9, R15)", () => {
  let ctx: TestContext;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffToken();
  });

  it("lists refunds created via overpayment, with registration info attached", async () => {
    const { paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });
    await ctx.req(`/api/staff/payments/${paymentId}/verify`, {
      method: "POST",
      body: JSON.stringify({ referenceId: "UTR123", actualAmount: 25000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    const res = await ctx.req(`/api/staff/refunds`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { refunds: Array<{ amount: number; status: string; regCode: string; fullName: string }> };
    expect(body.refunds).toHaveLength(1);
    expect(body.refunds[0].amount).toBe(11190);
    expect(body.refunds[0].status).toBe("pending");
    expect(typeof body.refunds[0].regCode).toBe("string");
  });

  it("filters by ?status= query param", async () => {
    const { paymentId: p1 } = await seedPendingVerification(ctx, { totalAmount: 13810 });
    const { paymentId: p2 } = await seedPendingVerification(ctx, { totalAmount: 13810 });

    const v1 = await ctx.req(`/api/staff/payments/${p1}/verify`, {
      method: "POST",
      body: JSON.stringify({ referenceId: "UTR1", actualAmount: 25000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    const v1Body = await v1.json() as { refundCreated: { id: number } };

    await ctx.req(`/api/staff/payments/${p2}/verify`, {
      method: "POST",
      body: JSON.stringify({ referenceId: "UTR2", actualAmount: 20000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    await ctx.req(`/api/staff/refunds/${v1Body.refundCreated.id}/complete`, {
      method: "POST",
      body: JSON.stringify({ bankReference: "IMPS/999" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    const res = await ctx.req(`/api/staff/refunds?status=pending`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.json() as { refunds: Array<{ status: string }> };
    expect(body.refunds).toHaveLength(1);
    expect(body.refunds[0].status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// POST /api/staff/refunds/:id/complete
// ---------------------------------------------------------------------------

describe("POST /api/staff/refunds/:id/complete (R10, R10.1)", () => {
  let ctx: TestContext;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffToken();
  });

  async function seedRefund(): Promise<number> {
    const { paymentId } = await seedPendingVerification(ctx, { totalAmount: 13810 });
    const res = await ctx.req(`/api/staff/payments/${paymentId}/verify`, {
      method: "POST",
      body: JSON.stringify({ referenceId: "UTR123", actualAmount: 25000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { refundCreated: { id: number } };
    return body.refundCreated.id;
  }

  it("V9: marks a pending refund completed and records the bank reference", async () => {
    const refundId = await seedRefund();

    const res = await ctx.req(`/api/staff/refunds/${refundId}/complete`, {
      method: "POST",
      body: JSON.stringify({ bankReference: "IMPS/999" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("completed");

    const refund = await ctx.refundRepo.findById(refundId);
    expect(refund?.status).toBe("completed");
    expect(refund?.bankReference).toBe("IMPS/999");

    // Refund completion audits via system_audit_log (PaymentService batch),
    // not the registration-scoped audit repo — exactly one row for the winner.
    const audited = ctx.completionDb.systemAuditRows.filter((e) => e.action === "refund_completed");
    expect(audited).toHaveLength(1);
  });

  it("422 when bankReference is missing", async () => {
    const refundId = await seedRefund();

    const res = await ctx.req(`/api/staff/refunds/${refundId}/complete`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(422);
  });

  it("V10: 409 when the refund is already completed", async () => {
    const refundId = await seedRefund();
    await ctx.req(`/api/staff/refunds/${refundId}/complete`, {
      method: "POST",
      body: JSON.stringify({ bankReference: "IMPS/999" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    const res = await ctx.req(`/api/staff/refunds/${refundId}/complete`, {
      method: "POST",
      body: JSON.stringify({ bankReference: "IMPS/000" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(409);
  });

  it("404 when the refund does not exist", async () => {
    const res = await ctx.req(`/api/staff/refunds/999999/complete`, {
      method: "POST",
      body: JSON.stringify({ bankReference: "IMPS/999" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });
});
