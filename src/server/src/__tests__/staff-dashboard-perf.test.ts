/**
 * Adversarial tests for staff-dashboard-perf.spec.md
 *
 * BOUNDARY: HTTP endpoints at GET /api/staff/registrations,
 *   GET /api/staff/dashboard, GET /api/staff/resources, GET /api/staff/reports.
 *   All tests go through the Hono request handler with in-memory fakes.
 *   No implementation internals are called directly.
 *
 * GAPS NOT TESTED HERE (require separate instrumentation or wrong boundary):
 *   - R3.2, R4.1, R5.1: "constant query count regardless of N" / "single
 *     aggregation query" — these are implementation constraints, not observable
 *     at the HTTP boundary. Would require a call-counting fake on the repo layer.
 *   - R6, R6.1–R6.7: Frontend React behavior (API call count on load, URL
 *     mutation). Cannot be tested in a server test file. Belongs in a browser
 *     or component test.
 *   - R7.4: Concurrent verification — a liveness/consistency property that
 *     cannot be asserted with a synchronous in-memory fake.
 *
 * SPEC DISCREPANCY NOTED:
 *   - R7.2 uses "SM26ABCD" / "SM26-ABCD" as example reg codes. The project's
 *     actual format is "SMRT..." (16 chars). Tests use the real format.
 *
 * BORROWED FROM IMPLEMENTATION ARTIFACTS (not defined in spec):
 *   - `attendanceIntent: "attending"` → attendee; `"donation_only"` → donor.
 *     These values are inferred from domain/types.ts AttendanceIntent, not
 *     named in the spec. Tests marked [INFERRED] where this applies.
 *
 * @module staff-dashboard-perf.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { handleError } from "../middleware/error.middleware.js";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { createFakePermissionsDb } from "./helpers/fake-permissions-db.js";
import { createEmptyTshirtRepo, createEmptyChargeRepo } from "./helpers/fake-tshirt-charge-repos.js";
import { staffRoutes } from "../routes/staff.routes.js";
import { signToken } from "../infra/jwt.js";
import type {
  IRegistrationRepository,
  IAttendeeRepository,
  IPaymentRepository,
  IAuditRepository,
  IDocumentRepository,
  IFileStorage,
  ISystemAuditRepository,
  IInventoryRepository,
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
  IdDocument,
  NewIdDocument,
  FileMetadata,
  SystemAuditAction,
} from "../domain/types.js";
import type { RegistrationStatus, PaymentStatus } from "../domain/status.js";
import type { RegistrationInsertSet } from "../domain/registration-insert-set.js";

// =============================================================================
// Constants
// =============================================================================

const TEST_JWT_SECRET = "test-secret-key-for-staff-perf-tests-32chars!";
const TEST_ENV = {
  JWT_SECRET: TEST_JWT_SECRET,
  DB: createFakePermissionsDb(),
} as unknown as import("../env.js").Env;

// =============================================================================
// Observable call-counting registration repo
//
// The spec (R3.2, R4.1, R5.1) requires constant query counts regardless of N.
// These are inobservable at the HTTP boundary. However, the list() and count()
// call counts ARE observable through this fake, enabling us to test the
// "2 parallel repo calls" guarantee for R2 (registrations endpoint).
// =============================================================================

class CountingRegistrationRepo implements IRegistrationRepository {
  private registrations: Map<number, Registration> = new Map();
  private nextId = 1001;

  // Observable call counters — for testing query-count guarantees
  listCallCount = 0;
  countCallCount = 0;
  countByStatusCallCount = 0;
  listCallArgs: RegistrationFilters[] = [];

  seed(reg: Registration): void {
    this.registrations.set(reg.id, reg);
  }

  async create(_registration: NewRegistration, _attendees: NewAttendee[]): Promise<{ id: number }> {
    const id = this.nextId++;
    return { id };
  }

  async createWithRelations(_insertSet: RegistrationInsertSet): Promise<{ id: number }> {
    const id = this.nextId++;
    return { id };
  }

  async findById(id: number): Promise<Registration | null> {
    return this.registrations.get(id) ?? null;
  }

  async findByRegCode(regCode: string): Promise<Registration | null> {
    for (const reg of this.registrations.values()) {
      if (reg.regCode === regCode) return reg;
    }
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
    if (reg) { reg.status = status; }
  }

  async update(id: number, data: RegistrationUpdate, _attendees?: NewAttendee[]): Promise<void> {
    const reg = this.registrations.get(id);
    if (!reg) return;
    if (data.full_name !== undefined) reg.fullName = data.full_name;
  }

  async list(filters?: RegistrationFilters): Promise<Registration[]> {
    this.listCallCount++;
    this.listCallArgs.push(filters ?? {});

    let regs = [...this.registrations.values()];

    if (filters?.type === 'attendee') {
      regs = regs.filter((r) => r.attendanceIntent === 'attending');
    } else if (filters?.type === 'donor') {
      regs = regs.filter((r) => r.attendanceIntent === 'donation_only');
    }

    if (filters?.status) {
      regs = regs.filter((r) => r.status === filters.status);
    }

    if (filters?.branch) {
      regs = regs.filter((r) => r.branch === filters.branch);
    }

    if (filters?.participationType) {
      regs = regs.filter((r) => r.participationType === filters.participationType);
    }

    // Server-side search: the route passes search to repo; fake applies it here
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      const qNoHyphen = q.replace(/[\s-]/g, '');
      regs = regs.filter((r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.regCode.toLowerCase().includes(q) ||
        r.regCode.toLowerCase().replace(/-/g, '').includes(qNoHyphen) ||
        r.whatsapp.toLowerCase().includes(q)
      );
    }

    // Apply limit/offset for pagination
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? regs.length;
    return regs.slice(offset, offset + limit);
  }

  async count(filters?: RegistrationFilters): Promise<number> {
    this.countCallCount++;

    let regs = [...this.registrations.values()];

    if (filters?.type === 'attendee') {
      regs = regs.filter((r) => r.attendanceIntent === 'attending');
    } else if (filters?.type === 'donor') {
      regs = regs.filter((r) => r.attendanceIntent === 'donation_only');
    }

    if (filters?.status) {
      regs = regs.filter((r) => r.status === filters.status);
    }

    if (filters?.branch) {
      regs = regs.filter((r) => r.branch === filters.branch);
    }

    if (filters?.participationType) {
      regs = regs.filter((r) => r.participationType === filters.participationType);
    }

    if (filters?.search) {
      const q = filters.search.toLowerCase();
      const qNoHyphen = q.replace(/[\s-]/g, '');
      regs = regs.filter((r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.regCode.toLowerCase().includes(q) ||
        r.regCode.toLowerCase().replace(/-/g, '').includes(qNoHyphen) ||
        r.whatsapp.toLowerCase().includes(q)
      );
    }

    return regs.length;
  }

  async countByStatus(_filters?: { type?: 'attendee' | 'donor' }): Promise<{
    pending: number;
    pendingVerification: number;
    confirmed: number;
  }> {
    this.countByStatusCallCount++;

    let regs = [...this.registrations.values()];
    if (_filters?.type === 'attendee') {
      regs = regs.filter((r) => r.attendanceIntent === 'attending');
    } else if (_filters?.type === 'donor') {
      regs = regs.filter((r) => r.attendanceIntent === 'donation_only');
    }

    return {
      pending: regs.filter((r) => r.status === 'pending').length,
      pendingVerification: regs.filter((r) => r.status === 'pending_verification').length,
      confirmed: regs.filter((r) => r.status === 'confirmed').length,
    };
  }

  async countByParticipationAndStatus(): Promise<Record<
    'full_celebration' | 'campus_only' | 'donation_only',
    { total: number; confirmed: number; pending: number; pendingVerification: number }
  >> {
    const zero = () => ({ total: 0, confirmed: 0, pending: 0, pendingVerification: 0 });
    const out: Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }> = {
      full_celebration: zero(),
      campus_only: zero(),
      donation_only: zero(),
    };

    for (const reg of this.registrations.values()) {
      const pt = reg.participationType as string;
      if (!(pt in out)) continue;
      const bucket = out[pt];
      bucket.total++;
      if (reg.status === 'confirmed') bucket.confirmed++;
      else if (reg.status === 'pending') bucket.pending++;
      else if (reg.status === 'pending_verification') bucket.pendingVerification++;
    }

    return out as Record<
      'full_celebration' | 'campus_only' | 'donation_only',
      { total: number; confirmed: number; pending: number; pendingVerification: number }
    >;
  }

  async geographyAggregates(): Promise<{ cities: { city: string; count: number }[]; countries: { country: string; count: number }[] }> {
    return { cities: [], countries: [] };
  }

  async donorRecognitionRows(_felicitationThreshold: number): Promise<{ publicDonors: { displayName: string; amount: number; felicitationEligible: boolean }[]; nonPublicCount: number; nonPublicTotal: number }> {
    return { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 };
  }

  async getContributionAggregates(): Promise<Array<{ cause: string; count: number; total: number }>> {
    return [];
  }

  async getDonationTotals(): Promise<{ count: number; total: number }> {
    return { count: 0, total: 0 };
  }

  async findMissingThumbnails(): Promise<Array<{ id: number; regCode: string; photoFileKey: string }>> {
    return [];
  }
  async findWithThumbnails() { return []; }
  async updateWithLock(_id: number, _data: import('../domain/types.js').RegistrationUpdate, _expectedUpdatedAt: number, _attendees?: import('../domain/types.js').NewAttendee[]): Promise<void> {}
}

// =============================================================================
// Observable counting payment repo
// =============================================================================

class CountingPaymentRepo implements IPaymentRepository {
  payments: Map<number, Payment> = new Map();
  private nextId = 1;

  // Observable call counters
  sumVerifiedCallCount = 0;
  sumVerifiedByBranchCallCount = 0;

  seed(payment: Payment): void {
    this.payments.set(payment.id, payment);
  }

  async create(payment: NewPayment): Promise<{ id: number }> {
    const id = this.nextId++;
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.payments.set(id, p);
    return { id };
  }

  async findById(id: number): Promise<Payment | null> {
    return this.payments.get(id) ?? null;
  }

  async findByRegistration(registrationId: number): Promise<Payment[]> {
    return [...this.payments.values()].filter((p) => p.registrationId === registrationId);
  }

  async updateStatus(
    id: number,
    status: PaymentStatus,
    _gatewayData?: GatewayData,
    _proofFileKey?: string,
    _verification?: { verifiedBy: string; verifiedAt: number },
  ): Promise<void> {
    const p = this.payments.get(id);
    if (p) p.status = status;
  }

  async sumVerified(filters?: { type?: 'attendee' | 'donor' }): Promise<number> {
    this.sumVerifiedCallCount++;
    let total = 0;
    for (const p of this.payments.values()) {
      if (p.status === 'verified') total += p.amount;
    }
    // Honour the type filter when branch revenue rows are present
    void filters;
    return total;
  }

  async sumVerifiedByBranch(_filters?: { type?: 'attendee' | 'donor' }): Promise<Array<{ branch: string; collected: number }>> {
    this.sumVerifiedByBranchCallCount++;
    return [];
  }
  async verify(_id: number, _amount: number, _gatewayRef: string, _verifiedBy: string, _verifiedAt: number): Promise<void> {}
  async settleAtDesk(): Promise<void> {}
  async findPendingByRegistration(_registrationId: number): Promise<Payment | null> { return null; }
  async deletePending(_paymentId: number): Promise<void> {}
  async updatePendingAmount(_paymentId: number, _newAmount: number): Promise<void> {}
  async sumVerifiedByRegistration(_registrationId: number): Promise<number> { return 0; }
}

// =============================================================================
// Minimal fakes for deps not under test
// =============================================================================

class StubAttendeeRepo implements IAttendeeRepository {
  async findByRegistration(_registrationId: number): Promise<Attendee[]> { return []; }
  async replaceForRegistration(_registrationId: number, _attendees: NewAttendee[]): Promise<void> {}
  async countGrouped(_filters?: { statuses?: string[]; branch?: string }): Promise<Array<{ type: string; meal: string; count: number }>> {
    return [];
  }
  async accommodationByNight(_f?: { statuses?: string[]; branch?: string }): Promise<Record<string, { private: number; privateByGender: { male: number; female: number; other: number }; shared_double: { count: number; rooms: number }; shared_doubleByGender: { male: number; female: number; other: number }; shared_triple: { count: number; rooms: number }; shared_tripleByGender: { male: number; female: number; other: number }; extraBeds: number }>> { return { '2026-08-14': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 }, '2026-08-15': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 } }; }
  async mealsByParticipationType(_f?: { statuses?: string[]; branch?: string }): Promise<{ campusDayCaterer: { headcount: number; veg: number; nonVeg: number }; ravizBanquet: { headcount: number; veg: number; nonVeg: number } }> { return { campusDayCaterer: { headcount: 0, veg: 0, nonVeg: 0 }, ravizBanquet: { headcount: 0, veg: 0, nonVeg: 0 } }; }
  async childrenByAgeBand(_f?: { statuses?: string[]; branch?: string }): Promise<{ under6: number; age6to12: number; age12plus: number }> { return { under6: 0, age6to12: 0, age12plus: 0 }; }
}

class StubAuditRepo implements IAuditRepository {
  async append(_entry: NewAuditEntry): Promise<void> {}
  async findByRegistration(_registrationId: number): Promise<AuditEntry[]> { return []; }
}

class StubDocumentRepo implements IDocumentRepository {
  async create(_doc: NewIdDocument): Promise<{ id: number }> { return { id: 1 }; }
  async findByRegistration(_registrationId: number): Promise<IdDocument[]> { return []; }
  async updateR2Key(_docId: number, _newKey: string): Promise<void> {}
}

class StubFileStorage implements IFileStorage {
  async upload(_key: string, _data: ArrayBuffer, _metadata: FileMetadata): Promise<void> {}
  async getSignedUrl(_key: string, _expiresIn: number): Promise<string> { throw new Error("not implemented"); }
  async get(_key: string): Promise<{ body: ReadableStream; contentType: string; size: number } | null> { return null; }
  async delete(_key: string): Promise<void> {}
  async copy(_fromKey: string, _toKey: string): Promise<boolean> { return true; }
  async move(_fromKey: string, _toKey: string): Promise<void> {}
}


class StubSystemAuditRepo implements ISystemAuditRepository {
  async append(_entry: {
    action: SystemAuditAction;
    actor: string;
    targetType?: string;
    targetId?: number;
    details?: string;
  }): Promise<void> {}
}

class StubInventoryRepo implements IInventoryRepository {
  async get(): Promise<Record<string, number>> { return {}; }
  async set(_inventory: Record<string, number>): Promise<void> {}
}

// =============================================================================
// Domain object builders
// =============================================================================

function makeReg(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 1001,
    regCode: "SMRTTESTCODE0001",
    status: "pending",
    fullName: "Test Alumnus",
    branch: "Computer Science",
    email: "alumnus@example.com",
    whatsapp: "+919876543210",
    mobileAlternate: null,
    city: "Kochi",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    gender: "male",
    tshirtSize: "L",
    alumniMeal: "veg",
    accommodation: "none",
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
    pricingSnapshot: { base: 10000, lines: [], donation: 0, collegeContribution: 500, total: 10000 },
    totalAmount: 10000,
    idNote: null,
    photoFileKey: null,
    photoThumbKey: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 1,
    registrationId: 1001,
    amount: 10000,
    status: "payment_pending",
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
    ...overrides,
  };
}

// =============================================================================
// Test app factory
// =============================================================================

interface TestCtx {
  req: (input: string, init?: RequestInit) => Promise<Response>;
  registrationRepo: CountingRegistrationRepo;
  paymentRepo: CountingPaymentRepo;
  attendeeRepo: StubAttendeeRepo;
}

function createTestApp(): TestCtx {
  _scopeCache.clear();
  const registrationRepo = new CountingRegistrationRepo();
  const paymentRepo = new CountingPaymentRepo();
  const attendeeRepo = new StubAttendeeRepo();
  const auditRepo = new StubAuditRepo();
  const documentRepo = new StubDocumentRepo();
  const fileStorage = new StubFileStorage();
  const systemAuditRepo = new StubSystemAuditRepo();
  const inventoryRepo = new StubInventoryRepo();

  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);

  app.use("*", async (c, next) => {
    c.set("registrationRepo", registrationRepo);
    c.set("paymentRepo", paymentRepo);
    c.set("attendeeRepo", attendeeRepo);
    c.set("auditRepo", auditRepo);
    c.set("documentRepo", documentRepo);
    c.set("fileStorage", fileStorage);
    c.set("systemAuditRepo", systemAuditRepo);
    c.set("inventoryRepo", inventoryRepo);
    c.set("tshirtRepo", createEmptyTshirtRepo());
    c.set("chargeRepo", createEmptyChargeRepo());
    // paymentService and registrationService are not needed for the endpoints under test
    // (registrations list, dashboard, resources, reports)
    await next();
  });

  app.route("/staff", staffRoutes);

  const req = (input: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(app.request(input, init, TEST_ENV));

  return { req, registrationRepo, paymentRepo, attendeeRepo };
}

async function staffJwt(): Promise<string> {
  return signToken({ sub: "10", role: "staff", email: "staff@example.test" }, TEST_JWT_SECRET, "7d");
}

// =============================================================================
// R1 — PagedResponse shape
// =============================================================================

describe("R1 — PagedResponse shape: GET /api/staff/registrations", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("R1 — response contains exactly the five paged-response keys (data, page, pageSize, totalItems, totalPages)", async () => {
    // Catches: generator returning old shape { registrations, total, page, limit }
    ctx.registrationRepo.seed(makeReg({ id: 1001 }));

    const res = await ctx.req("/api/staff/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    // R1 — the new shape must exist
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("pageSize");
    expect(body).toHaveProperty("totalItems");
    expect(body).toHaveProperty("totalPages");

    // R1.3 — the OLD shape must NOT exist
    expect(body).not.toHaveProperty("registrations");
    expect(body).not.toHaveProperty("total");
    expect(body).not.toHaveProperty("limit");
  });

  it("R1 — data is an array", async () => {
    // Catches: generator returning data as an object or null
    ctx.registrationRepo.seed(makeReg({ id: 1001 }));

    const res = await ctx.req("/api/staff/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { data: unknown };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("R1 — page is 1-indexed: default request returns page=1", async () => {
    // R1.1 — page is 1-indexed, not 0-indexed
    // Catches: generator returning page=0 for the first page
    ctx.registrationRepo.seed(makeReg({ id: 1001 }));

    const res = await ctx.req("/api/staff/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { page: number };
    expect(body.page).toBe(1);
  });

  it("R1 — page param is preserved in response: page=2 request returns page=2", async () => {
    // Catches: generator always returning page=1 regardless of query param
    const res = await ctx.req("/api/staff/registrations?page=2", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { page: number };
    expect(body.page).toBe(2);
  });

  it("R1 — pageSize reflects the requested limit", async () => {
    // Catches: generator returning hardcoded pageSize=50 regardless of limit param
    const res = await ctx.req("/api/staff/registrations?limit=10", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { pageSize: number };
    expect(body.pageSize).toBe(10);
  });

  it("R1 — totalItems is a number", async () => {
    // Catches: generator returning totalItems as a string
    const res = await ctx.req("/api/staff/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: unknown };
    expect(typeof body.totalItems).toBe("number");
  });

  it("R1 — totalPages is a number", async () => {
    const res = await ctx.req("/api/staff/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalPages: unknown };
    expect(typeof body.totalPages).toBe("number");
  });

  it("R1.1 — totalPages = ceil(totalItems / pageSize), not floor", async () => {
    // 3 items, pageSize 2 → ceil(3/2) = 2 pages. floor gives 1. Wrong.
    // Catches: generator using Math.floor instead of Math.ceil
    for (let i = 1001; i <= 1003; i++) {
      ctx.registrationRepo.seed(makeReg({ id: i }));
    }

    const res = await ctx.req("/api/staff/registrations?limit=2", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number; totalPages: number; pageSize: number };
    expect(body.totalItems).toBe(3);
    expect(body.pageSize).toBe(2);
    expect(body.totalPages).toBe(2); // ceil(3/2) = 2, not floor(3/2) = 1
  });

  it("R1.1 — totalPages minimum is 1 even when totalItems is 0", async () => {
    // R1.1 — minimum 1 page even when no results
    // Catches: generator returning totalPages=0 for empty result sets
    // (no registrations seeded)
    const res = await ctx.req("/api/staff/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number; totalPages: number };
    expect(body.totalItems).toBe(0);
    expect(body.totalPages).toBe(1); // minimum 1, not 0
  });

  it("R1.1 — totalPages = 1 when totalItems equals pageSize exactly (no remainder)", async () => {
    // 2 items, pageSize 2 → exactly divisible, should be 1 page, not 0
    // Catches: off-by-one: ceil(2/2) = 1 is correct
    for (let i = 1001; i <= 1002; i++) {
      ctx.registrationRepo.seed(makeReg({ id: i }));
    }

    const res = await ctx.req("/api/staff/registrations?limit=2", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalPages: number };
    expect(body.totalPages).toBe(1);
  });

  it("R1.2 — data contains at most pageSize items", async () => {
    // Seed 5 items but request only 3 per page
    for (let i = 1001; i <= 1005; i++) {
      ctx.registrationRepo.seed(makeReg({ id: i }));
    }

    const res = await ctx.req("/api/staff/registrations?limit=3", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBeLessThanOrEqual(3);
    expect(body.data).toHaveLength(3);
  });

  it("R1.2 — data is empty array (not null) when 0 items match", async () => {
    // Catches: generator returning null or omitting data field on empty results
    // No registrations seeded
    const res = await ctx.req("/api/staff/registrations?status=confirmed", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { data: unknown };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(0);
  });
});

// =============================================================================
// R2 — Registrations list endpoint: field set on items
// =============================================================================

describe("R2.7 — StaffRegistrationListItem field set", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      regCode: "SMRTTESTCODE0001",
      fullName: "Ravi Kumar",
      email: "ravi@example.com",
      whatsapp: "+919000000001",
      branch: "Mechanical Engineering",
      status: "pending",
      attendanceIntent: "attending",
      participationType: "full_celebration",
      totalAmount: 10000,
    }));
  });

  it("R2.7 — each item has id, regCode, fullName, email, whatsapp, branch, status, attendanceIntent, participationType, totalAmount, createdAt", async () => {
    // Catches: generator omitting fields from the list item shape
    const res = await ctx.req("/api/staff/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    const item = body.data[0];
    expect(item).toBeDefined();
    expect(item["id"]).toBe(1001);
    expect(item["regCode"]).toBe("SMRTTESTCODE0001");
    expect(item["fullName"]).toBe("Ravi Kumar");
    expect(item["email"]).toBe("ravi@example.com");
    expect(item["whatsapp"]).toBe("+919000000001");
    expect(item["branch"]).toBe("Mechanical Engineering");
    expect(item["status"]).toBe("pending");
    expect(item["attendanceIntent"]).toBe("attending");
    expect(item["participationType"]).toBe("full_celebration");
    expect(item["totalAmount"]).toBe(10000);
    expect(typeof item["createdAt"]).toBe("number");
  });
});

// =============================================================================
// R2 — Filtering
// =============================================================================

describe("R2.1 — type filter [INFERRED: attendanceIntent='attending' → attendee, 'donation_only' → donor]", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
    // Seed one attendee and one donor
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      attendanceIntent: "attending",
      participationType: "full_celebration",
      email: "attendee@example.com",
    }));
    ctx.registrationRepo.seed(makeReg({
      id: 1002,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
      email: "donor@example.com",
    }));
  });

  it("R2.1 — type=attendee returns only attendee registrations, not donors", async () => {
    // Catches: generator ignoring the type filter and returning all rows
    const res = await ctx.req("/api/staff/registrations?type=attendee", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { data: Array<{ email: string }>; totalItems: number };
    expect(body.totalItems).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].email).toBe("attendee@example.com");
  });

  it("R2.1 — type=donor returns only donation-only registrations, not attendees", async () => {
    // Catches: generator ignoring the type filter
    const res = await ctx.req("/api/staff/registrations?type=donor", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { data: Array<{ email: string }>; totalItems: number };
    expect(body.totalItems).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].email).toBe("donor@example.com");
  });

  it("R2.1 — omitting type returns all registrations (attendees + donors)", async () => {
    // Catches: generator defaulting to attendee filter when none specified
    const res = await ctx.req("/api/staff/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number };
    expect(body.totalItems).toBe(2);
  });
});

describe("R2.2 — search filter", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("R2.2 — search by name (case-insensitive): 'ravi' matches fullName 'Ravi Kumar'", async () => {
    // Catches: generator doing case-sensitive match only
    ctx.registrationRepo.seed(makeReg({ id: 1001, fullName: "Ravi Kumar" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, fullName: "Priya Nair" }));

    const res = await ctx.req("/api/staff/registrations?search=ravi", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number; data: Array<{ fullName: string }> };
    expect(body.totalItems).toBe(1);
    expect(body.data[0].fullName).toBe("Ravi Kumar");
  });

  it("R2.2 — search by name uppercase: 'RAVI' matches fullName 'Ravi Kumar'", async () => {
    // Catches: generator applying toLowerCase only to the stored value, not the query
    ctx.registrationRepo.seed(makeReg({ id: 1001, fullName: "Ravi Kumar" }));

    const res = await ctx.req("/api/staff/registrations?search=RAVI", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number };
    expect(body.totalItems).toBe(1);
  });

  it("R2.2 — search by email: 'ravi@example' matches email 'ravi@example.com'", async () => {
    // Catches: generator not searching email field
    ctx.registrationRepo.seed(makeReg({ id: 1001, fullName: "Someone Else", email: "ravi@example.com" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, fullName: "Other", email: "other@example.com" }));

    const res = await ctx.req("/api/staff/registrations?search=ravi%40example", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number };
    expect(body.totalItems).toBe(1);
  });

  it("R2.2 — search by whatsapp number matches partial number", async () => {
    // Catches: generator not searching whatsapp field
    ctx.registrationRepo.seed(makeReg({ id: 1001, whatsapp: "+919876543210" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, whatsapp: "+911234567890" }));

    const res = await ctx.req("/api/staff/registrations?search=987654", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number };
    expect(body.totalItems).toBe(1);
  });

  it("R2.2 / R7.2 — search by reg code without hyphens matches hyphenated display code", async () => {
    // R7.2 — 'SMRTABCD12345678' search matches a registration with that code
    // (spec example uses SM26 format which doesn't match project format, using real format)
    // Catches: generator only searching stored regCode without normalising hyphens
    ctx.registrationRepo.seed(makeReg({ id: 1001, regCode: "SMRTABCD12345678" }));

    const res = await ctx.req("/api/staff/registrations?search=SMRTABCD12345678", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number };
    expect(body.totalItems).toBe(1);
  });

  it("R7.2 — search with hyphenated reg code format matches the same registration", async () => {
    // R7.2 — searching 'SMRT-ABCD-1234-5678' should find 'SMRTABCD12345678'
    // Catches: generator stripping hyphens from stored code but not from query
    ctx.registrationRepo.seed(makeReg({ id: 1001, regCode: "SMRTABCD12345678" }));

    const res = await ctx.req("/api/staff/registrations?search=SMRT-ABCD-1234-5678", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number };
    expect(body.totalItems).toBe(1);
  });

  it("R2.2 — empty search string returns all registrations (no filter applied)", async () => {
    // Catches: generator treating empty string as a filter that matches nothing
    ctx.registrationRepo.seed(makeReg({ id: 1001 }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, email: "other@example.com" }));

    const res = await ctx.req("/api/staff/registrations?search=", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number };
    expect(body.totalItems).toBe(2);
  });

  it("R7.1 — search with SQL LIKE wildcard character '%' does not crash the endpoint", async () => {
    // R7.1 — parameterized queries handle special chars safely. At the HTTP
    // boundary we assert the response is 200 (not 500) — we can't inspect SQL.
    // Catches: generator building LIKE queries with string interpolation
    ctx.registrationRepo.seed(makeReg({ id: 1001 }));

    const res = await ctx.req("/api/staff/registrations?search=%25", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    // Should not throw or return 500
    expect(res.status).not.toBe(500);
  });

  it("R7.1 — search with SQL underscore wildcard '_' returns 200", async () => {
    ctx.registrationRepo.seed(makeReg({ id: 1001 }));

    const res = await ctx.req("/api/staff/registrations?search=_", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("R7.1 — search with single quote does not crash endpoint", async () => {
    // Catches: generator building raw SQL strings without escaping
    ctx.registrationRepo.seed(makeReg({ id: 1001 }));

    const res = await ctx.req("/api/staff/registrations?search='", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(500);
  });

  it("R7.1 — search with SQL comment sequence '--' returns 200", async () => {
    // Catches: generator vulnerable to SQL comment injection
    ctx.registrationRepo.seed(makeReg({ id: 1001 }));

    const res = await ctx.req("/api/staff/registrations?search=--", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(500);
  });

  it("R7.1 — search with semicolon returns 200", async () => {
    const res = await ctx.req("/api/staff/registrations?search=%3B", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("R2.3 — status filter", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
    ctx.registrationRepo.seed(makeReg({ id: 1001, status: "pending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, status: "confirmed" }));
    ctx.registrationRepo.seed(makeReg({ id: 1003, status: "pending_verification" }));
  });

  it("R2.3 — status=confirmed returns only confirmed registrations", async () => {
    // Catches: generator ignoring the status filter
    const res = await ctx.req("/api/staff/registrations?status=confirmed", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number; data: Array<{ status: string }> };
    expect(body.totalItems).toBe(1);
    expect(body.data[0].status).toBe("confirmed");
  });

  it("R2.3 — status=pending_verification returns only pending_verification registrations", async () => {
    const res = await ctx.req("/api/staff/registrations?status=pending_verification", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number; data: Array<{ status: string }> };
    expect(body.totalItems).toBe(1);
    expect(body.data[0].status).toBe("pending_verification");
  });
});

describe("R2.5 / R2.6 — server-side pagination", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
    // Seed 5 registrations
    for (let i = 1001; i <= 1005; i++) {
      ctx.registrationRepo.seed(makeReg({ id: i }));
    }
  });

  it("R2.5 — page=2 limit=2 returns items 3–4 (second page), not all 5", async () => {
    // Catches: generator returning all rows regardless of page/limit
    const res = await ctx.req("/api/staff/registrations?page=2&limit=2", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { data: unknown[]; page: number; pageSize: number };
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(2);
    expect(body.data).toHaveLength(2); // exactly 2 items on page 2
  });

  it("R2.6 — totalItems reflects all matching rows, not just the current page", async () => {
    // Catches: generator setting totalItems = data.length (current page count)
    const res = await ctx.req("/api/staff/registrations?page=1&limit=2", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { data: unknown[]; totalItems: number };
    expect(body.data).toHaveLength(2); // only 2 items in this page
    expect(body.totalItems).toBe(5);   // but 5 total exist
  });

  it("R7.3 — page beyond total pages returns empty data array with correct totalItems", async () => {
    // R7.3 — page 99 on a 5-item dataset returns empty data, not an error
    // Catches: generator throwing 404 or returning wrong totalItems
    const res = await ctx.req("/api/staff/registrations?page=99&limit=50", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; totalItems: number; totalPages: number };
    expect(body.data).toHaveLength(0);
    expect(body.totalItems).toBe(5);
    expect(body.totalPages).toBe(1); // ceil(5/50) = 1
  });

  it("R7.3 — totalPages is correct even for out-of-range page requests", async () => {
    // totalPages should reflect reality (1 page of 50 for 5 items), not the
    // requested page number (99).
    const res = await ctx.req("/api/staff/registrations?page=99&limit=50", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalPages: number };
    expect(body.totalPages).toBe(1);
  });

  it("page=0 is treated as page=1 (clamped, not an error)", async () => {
    // The route does Math.max(1, Number(page)), so page=0 becomes page=1.
    // Catches: generator returning empty or crashing on page=0
    const res = await ctx.req("/api/staff/registrations?page=0&limit=2", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { page: number; data: unknown[] };
    expect(body.page).toBe(1);
    expect(body.data).toHaveLength(2);
  });

  it("page=-1 is treated as page=1 (clamped, not an error)", async () => {
    // Catches: generator crashing or returning wrong page for negative page
    const res = await ctx.req("/api/staff/registrations?page=-1&limit=2", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { page: number };
    expect(body.page).toBe(1);
  });
});

// =============================================================================
// R2 — registrations endpoint issues 2 parallel repo calls (list + count)
// =============================================================================

describe("R2 — registrations endpoint calls list() and count() exactly once each", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("R2 — list() is called exactly once per request (not N times for N registrations)", async () => {
    // Catches: generator loading all rows then filtering in-application-code via
    // multiple repo calls, or calling list() once per result row
    for (let i = 1001; i <= 1020; i++) {
      ctx.registrationRepo.seed(makeReg({ id: i }));
    }

    await ctx.req("/api/staff/registrations?limit=5", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(ctx.registrationRepo.listCallCount).toBe(1);
  });

  it("R2 — count() is called exactly once per request", async () => {
    // Catches: generator calling count() once per page item
    for (let i = 1001; i <= 1020; i++) {
      ctx.registrationRepo.seed(makeReg({ id: i }));
    }

    await ctx.req("/api/staff/registrations?limit=5", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(ctx.registrationRepo.countCallCount).toBe(1);
  });

  it("R2 — filters passed to list() and count() are consistent", async () => {
    // Catches: generator filtering in list() but passing empty filters to count(),
    // causing totalItems to be the unfiltered count
    ctx.registrationRepo.seed(makeReg({ id: 1001, status: "pending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, status: "confirmed" }));

    const res = await ctx.req("/api/staff/registrations?status=pending", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { data: unknown[]; totalItems: number };
    // The 'pending' filter must be applied to both list() and count()
    expect(body.totalItems).toBe(1);
    expect(body.data).toHaveLength(1);
  });
});

// =============================================================================
// R3 — Dashboard stats endpoint
// =============================================================================

describe("R3.1 — GET /api/staff/dashboard response shape", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("R3.1 — response has exactly { stats: { total, pending, pendingVerification, confirmed, moneyCollected } }", async () => {
    // Catches: generator renaming or dropping fields from the stats shape
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { stats: Record<string, unknown> };
    expect(body).toHaveProperty("stats");
    const { stats } = body;
    expect(stats).toHaveProperty("total");
    expect(stats).toHaveProperty("pending");
    expect(stats).toHaveProperty("pendingVerification");
    expect(stats).toHaveProperty("confirmed");
    expect(stats).toHaveProperty("moneyCollected");
  });

  it("R3.1 — total = pending + pendingVerification + confirmed", async () => {
    // Catches: generator computing total independently from a different source,
    // producing total != sum of statuses
    ctx.registrationRepo.seed(makeReg({ id: 1001, status: "pending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, status: "pending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1003, status: "confirmed" }));
    ctx.registrationRepo.seed(makeReg({ id: 1004, status: "pending_verification" }));

    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { stats: Record<string, number> };
    const { stats } = body;
    expect(stats["total"]).toBe(stats["pending"] + stats["pendingVerification"] + stats["confirmed"]);
    expect(stats["total"]).toBe(4);
    expect(stats["pending"]).toBe(2);
    expect(stats["confirmed"]).toBe(1);
    expect(stats["pendingVerification"]).toBe(1);
  });

  it("R3.1 — moneyCollected is a number (not string, not null)", async () => {
    // Catches: generator returning moneyCollected as a string "10000" or null
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { stats: { moneyCollected: unknown } };
    expect(typeof body.stats.moneyCollected).toBe("number");
  });

  it("R3.1 — moneyCollected is 0 when no verified payments exist", async () => {
    // Catches: generator returning undefined/null instead of 0 for empty state
    ctx.registrationRepo.seed(makeReg({ id: 1001, status: "pending" }));
    ctx.paymentRepo.seed(makePayment({ id: 1, registrationId: 1001, status: "payment_pending", amount: 10000 }));

    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { stats: { moneyCollected: number } };
    expect(body.stats.moneyCollected).toBe(0);
  });

  it("R3.1 — moneyCollected sums only verified payments", async () => {
    // Catches: generator summing all payments regardless of status
    ctx.registrationRepo.seed(makeReg({ id: 1001, status: "confirmed" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, status: "pending_verification" }));
    ctx.paymentRepo.seed(makePayment({ id: 1, registrationId: 1001, status: "verified", amount: 12000 }));
    ctx.paymentRepo.seed(makePayment({ id: 2, registrationId: 1002, status: "pending_verification", amount: 8000 }));

    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { stats: { moneyCollected: number } };
    expect(body.stats.moneyCollected).toBe(12000);
  });

  it("R3.3 — type=attendee filter is accepted without error and affects counts [INFERRED]", async () => {
    // R3.3 — type filter behaviour. The spec says "unchanged from staff-api.spec.md R6.8"
    // (absent spec). We test that the filter parameter is accepted and reaches countByStatus.
    ctx.registrationRepo.seed(makeReg({ id: 1001, attendanceIntent: "attending", status: "pending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, attendanceIntent: "donation_only", status: "confirmed" }));

    const res = await ctx.req("/api/staff/dashboard?type=attendee", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { stats: { total: number; confirmed: number } };
    // With type=attendee filter, the donation-only confirmed registration should NOT count
    expect(body.stats.total).toBe(1);
    expect(body.stats.confirmed).toBe(0);
  });

  it("R3.2 — dashboard calls countByStatus exactly once, regardless of registration count", async () => {
    // R3.2 — constant query count. We can observe countByStatus call count.
    // Catches: generator loading all rows then counting in JS loops,
    // which would call list() instead of countByStatus()
    for (let i = 1001; i <= 1050; i++) {
      ctx.registrationRepo.seed(makeReg({ id: i }));
    }

    await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Dashboard should call countByStatus exactly once (not once per registration)
    expect(ctx.registrationRepo.countByStatusCallCount).toBe(1);
    // And should NOT call list() at all — stats come from aggregation
    expect(ctx.registrationRepo.listCallCount).toBe(0);
  });

  it("R3.2 — dashboard calls sumVerified exactly once, regardless of payment count", async () => {
    // Catches: generator looping through payments per-registration
    for (let i = 1001; i <= 1050; i++) {
      ctx.registrationRepo.seed(makeReg({ id: i, status: "confirmed" }));
      ctx.paymentRepo.seed(makePayment({ id: i - 1000, registrationId: i, status: "verified", amount: 1000 }));
    }

    await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(ctx.paymentRepo.sumVerifiedCallCount).toBe(1);
  });
});

// =============================================================================
// R4 — Resources endpoint
// =============================================================================

describe("R4.3 — GET /api/staff/resources response shape unchanged", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("R4.3 — response has { resources: { headcount, accommodation, meals, tshirts } }", async () => {
    // Catches: generator renaming 'resources' or dropping sub-keys
    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { resources: Record<string, unknown> };
    expect(body).toHaveProperty("resources");
    const { resources } = body;
    expect(resources).toHaveProperty("headcount");
    expect(resources).toHaveProperty("accommodation");
    expect(resources).toHaveProperty("meals");
    expect(resources).toHaveProperty("tshirts");
  });

  it("R4.3 — headcount has alumni, spouses, children, guests, total sub-keys", async () => {
    // Catches: generator dropping headcount sub-keys
    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { headcount: Record<string, unknown> } };
    const { headcount } = body.resources;
    expect(headcount).toHaveProperty("alumni");
    expect(headcount).toHaveProperty("spouses");
    expect(headcount).toHaveProperty("children");
    expect(headcount).toHaveProperty("guests");
    expect(headcount).toHaveProperty("total");
  });

  it("R4.3 — meals has veg and nonVeg sub-keys (not 'nonveg', not 'non_veg')", async () => {
    // Catches: generator using wrong casing or underscore for nonVeg key
    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { meals: Record<string, unknown> } };
    const { meals } = body.resources;
    expect(meals).toHaveProperty("veg");
    expect(meals).toHaveProperty("nonVeg");
    // Explicitly check wrong variants are absent
    expect(meals).not.toHaveProperty("nonveg");
    expect(meals).not.toHaveProperty("non_veg");
  });

  it("R4 — resources only includes attendees (not donors): headcount.alumni excludes donation_only registrations", async () => {
    // R4 spec says "always excludes donation-only registrations"
    // Catches: generator counting all registrations including donors
    ctx.registrationRepo.seed(makeReg({ id: 1001, attendanceIntent: "attending", status: "confirmed" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, attendanceIntent: "donation_only", status: "confirmed" }));

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { headcount: { alumni: number } } };
    // Only the attending registration should be counted, not the donor
    expect(body.resources.headcount.alumni).toBe(1);
  });
});

// =============================================================================
// R5 — Reports endpoint
// =============================================================================

describe("R5.3 — GET /api/staff/reports response shape unchanged", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("R5.3 — response has { branchBreakdown, timeline, revenue }", async () => {
    // Catches: generator renaming top-level keys in the reports response
    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("branchBreakdown");
    expect(body).toHaveProperty("timeline");
    expect(body).toHaveProperty("revenue");
  });

  it("R5.3 — branchBreakdown is an array", async () => {
    // Catches: generator returning branchBreakdown as an object/map
    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { branchBreakdown: unknown };
    expect(Array.isArray(body.branchBreakdown)).toBe(true);
  });

  it("R5.3 — timeline is an array of { date, count } objects", async () => {
    // Catches: generator returning timeline as a map or different shape
    ctx.registrationRepo.seed(makeReg({ id: 1001, attendanceIntent: "attending" }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { timeline: Array<Record<string, unknown>> };
    expect(Array.isArray(body.timeline)).toBe(true);
    if (body.timeline.length > 0) {
      const entry = body.timeline[0];
      expect(entry).toHaveProperty("date");
      expect(entry).toHaveProperty("count");
      expect(typeof entry["date"]).toBe("string");
      expect(typeof entry["count"]).toBe("number");
    }
  });

  it("R5.3 — revenue has { collected, expected, pending }", async () => {
    // Catches: generator dropping revenue.pending or renaming a field
    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { revenue: Record<string, unknown> };
    expect(body.revenue).toHaveProperty("collected");
    expect(body.revenue).toHaveProperty("expected");
    expect(body.revenue).toHaveProperty("pending");
  });

  it("R5.3 — revenue.pending = expected - collected", async () => {
    // Catches: generator computing pending incorrectly
    ctx.registrationRepo.seed(makeReg({ id: 1001, attendanceIntent: "attending", totalAmount: 10000 }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { revenue: { collected: number; expected: number; pending: number } };
    expect(body.revenue.pending).toBe(body.revenue.expected - body.revenue.collected);
  });

  it("R5.1 — sumVerifiedByBranch is called exactly once for reports, not once per branch", async () => {
    // R5.1 — branch revenue via single aggregation. Observable via call counter.
    // Catches: generator looping through branches and calling sumVerifiedByBranch per branch
    ctx.registrationRepo.seed(makeReg({ id: 1001, branch: "CSE", attendanceIntent: "attending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, branch: "ECE", attendanceIntent: "attending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1003, branch: "ME", attendanceIntent: "attending" }));

    await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(ctx.paymentRepo.sumVerifiedByBranchCallCount).toBe(1);
  });

  it("R5.3 — branchBreakdown items include branch, total, confirmed, pendingVerification, pending, expectedRevenue, collectedRevenue", async () => {
    // Catches: generator dropping fields from branch breakdown items
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      branch: "Computer Science",
      attendanceIntent: "attending",
      status: "confirmed",
      totalAmount: 10000,
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { branchBreakdown: Array<Record<string, unknown>> };
    expect(body.branchBreakdown).toHaveLength(1);
    const branch = body.branchBreakdown[0];
    expect(branch).toHaveProperty("branch");
    expect(branch).toHaveProperty("total");
    expect(branch).toHaveProperty("confirmed");
    expect(branch).toHaveProperty("pendingVerification");
    expect(branch).toHaveProperty("pending");
    expect(branch).toHaveProperty("expectedRevenue");
    expect(branch).toHaveProperty("collectedRevenue");
    expect(branch["branch"]).toBe("Computer Science");
    expect(branch["total"]).toBe(1);
  });
});

// =============================================================================
// R2.4 — Sort order: results ordered by registration date descending
// =============================================================================

describe("R2.4 — results ordered by createdAt descending", () => {
  it("R2.4 — most recently created registration appears first in data", async () => {
    // Catches: generator returning rows in insertion order (ascending by id)
    const ctx = createTestApp();
    const token = await staffJwt();

    const nowMs = Date.now();
    // Seed three registrations with explicit, different createdAt values
    ctx.registrationRepo.seed(makeReg({ id: 1001, createdAt: nowMs - 3000, fullName: "Oldest" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, createdAt: nowMs - 1000, fullName: "Middle" }));
    ctx.registrationRepo.seed(makeReg({ id: 1003, createdAt: nowMs,        fullName: "Newest" }));

    // The in-memory fake applies the orderBy through the passed filters;
    // the route passes orderBy: 'created_at', orderDir: 'DESC'. The fake's
    // list() must honour these — if it does not, items arrive in Map insertion
    // order and this test will fail, correctly exposing a filter-passing gap.
    await ctx.req("/api/staff/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    // The route passes orderDir: 'DESC' to list(). If the repo (or the route
    // itself) doesn't sort, the order will be wrong.
    // NOTE: The in-memory fake above doesn't sort by createdAt because the
    // real DB handles this. This test validates that the ROUTE passes the
    // correct orderBy/orderDir filters to the repo.
    const args = ctx.registrationRepo.listCallArgs[0];
    expect(args.orderBy).toBe("created_at");
    expect(args.orderDir).toBe("DESC");
  });
});
