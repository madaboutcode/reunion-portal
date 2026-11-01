/**
 * Endpoint tests for server slice 1: per-participation-type dashboard stats
 * + participationType filtering on list/export.
 *
 * BOUNDARY: HTTP endpoints (Hono handler + in-memory fakes).
 *   All tests go through the request handler — no implementation internals.
 *
 * COVERS:
 *   - byParticipationType counts match fixtures
 *   - byParticipationType is always unfiltered (D6): ignores type=attendee/donor param
 *   - GET /registrations?participationType=campus_only returns only campus rows
 *   - GET /export?participationType=campus_only contains only campus rows (CSV)
 *   - GET /export?type=donor excludes attendees (T2-3 pre-existing bug fix)
 *   - Existing flat stats fields unaffected by the new field
 *
 * @module staff-participation-type.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { handleError } from "../middleware/error.middleware.js";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { createFakePermissionsDb } from "./helpers/fake-permissions-db.js";
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
import { D1RegistrationRepository } from "../repositories/registration.repo.js";
import { D1PaymentRepository } from "../repositories/payment.repo.js";
import { D1AttendeeRepository } from "../repositories/attendee.repo.js";

// =============================================================================
// Constants
// =============================================================================

const TEST_JWT_SECRET = "test-secret-key-for-staff-participation-tests-32!";
const TEST_ENV = {
  JWT_SECRET: TEST_JWT_SECRET,
  DB: createFakePermissionsDb(),
} as unknown as import("../env.js").Env;

// =============================================================================
// In-memory registration repo (same pattern as staff-dashboard-perf.test.ts)
// =============================================================================

class InMemoryRegistrationRepo implements IRegistrationRepository {
  private registrations: Map<number, Registration> = new Map();
  private nextId = 1001;

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
    let regs = [...this.registrations.values()];

    if (filters?.type === 'attendee') {
      regs = regs.filter((r) =>
        r.participationType === 'full_celebration' || r.participationType === 'campus_only');
    } else if (filters?.type === 'donor') {
      regs = regs.filter((r) => r.participationType === 'donation_only');
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

    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? regs.length;
    return regs.slice(offset, offset + limit);
  }

  async count(filters?: RegistrationFilters): Promise<number> {
    let regs = [...this.registrations.values()];

    if (filters?.type === 'attendee') {
      regs = regs.filter((r) =>
        r.participationType === 'full_celebration' || r.participationType === 'campus_only');
    } else if (filters?.type === 'donor') {
      regs = regs.filter((r) => r.participationType === 'donation_only');
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
    let regs = [...this.registrations.values()];
    if (_filters?.type === 'attendee') {
      regs = regs.filter((r) =>
        r.participationType === 'full_celebration' || r.participationType === 'campus_only');
    } else if (_filters?.type === 'donor') {
      regs = regs.filter((r) => r.participationType === 'donation_only');
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
    // Always unfiltered — all registrations regardless of any type/participation filter
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
// Minimal fakes for deps not under test
// =============================================================================

class StubPaymentRepo implements IPaymentRepository {
  async create(_payment: NewPayment): Promise<{ id: number }> { return { id: 1 }; }
  async findById(_id: number): Promise<Payment | null> { return null; }
  async findByRegistration(_registrationId: number): Promise<Payment[]> { return []; }
  async updateStatus(
    _id: number, _status: PaymentStatus, _gatewayData?: GatewayData,
    _proofFileKey?: string, _verification?: { verifiedBy: string; verifiedAt: number },
  ): Promise<void> {}
  async sumVerified(_filters?: { type?: 'attendee' | 'donor' }): Promise<number> { return 0; }
  async sumVerifiedByBranch(_filters?: { type?: 'attendee' | 'donor' }): Promise<Array<{ branch: string; collected: number }>> { return []; }
  async verify(_id: number, _amount: number, _gatewayRef: string, _verifiedBy: string, _verifiedAt: number): Promise<void> {}
  async settleAtDesk(): Promise<void> {}
  async findPendingByRegistration(_registrationId: number): Promise<Payment | null> { return null; }
  async deletePending(_paymentId: number): Promise<void> {}
  async updatePendingAmount(_paymentId: number, _newAmount: number): Promise<void> {}
  async sumVerifiedByRegistration(_registrationId: number): Promise<number> { return 0; }
}

class StubAttendeeRepo implements IAttendeeRepository {
  async findByRegistration(_registrationId: number): Promise<Attendee[]> { return []; }
  async replaceForRegistration(_registrationId: number, _attendees: NewAttendee[]): Promise<void> {}
  async countGrouped(_filters?: { statuses?: string[]; branch?: string }): Promise<Array<{ type: string; meal: string; count: number }>> { return []; }
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

// =============================================================================
// Domain object builder
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

// =============================================================================
// Test app factory
// =============================================================================

interface TestCtx {
  req: (input: string, init?: RequestInit) => Promise<Response>;
  registrationRepo: InMemoryRegistrationRepo;
}

function createTestApp(): TestCtx {
  _scopeCache.clear();
  const registrationRepo = new InMemoryRegistrationRepo();
  const paymentRepo = new StubPaymentRepo();
  const attendeeRepo = new StubAttendeeRepo();
  const auditRepo = new StubAuditRepo();
  const documentRepo = new StubDocumentRepo();
  const fileStorage = new StubFileStorage();
  const systemAuditRepo = new StubSystemAuditRepo();

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
    await next();
  });

  app.route("/staff", staffRoutes);

  const req = (input: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(app.request(input, init, TEST_ENV));

  return { req, registrationRepo };
}

async function staffJwt(): Promise<string> {
  return signToken({ sub: "10", role: "staff", email: "staff@example.test" }, TEST_JWT_SECRET, "7d");
}

// =============================================================================
// Dashboard — byParticipationType shape + correctness
// =============================================================================

describe("dashboard byParticipationType — shape", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("stats.byParticipationType is present and has full_celebration, campus_only, donation_only keys", async () => {
    // Catches: route omitting byParticipationType from the response
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { stats: Record<string, unknown> };
    expect(body.stats).toHaveProperty("byParticipationType");
    const bpt = body.stats["byParticipationType"] as Record<string, unknown>;
    expect(bpt).toHaveProperty("full_celebration");
    expect(bpt).toHaveProperty("campus_only");
    expect(bpt).toHaveProperty("donation_only");
  });

  it("each participation-type bucket has total, confirmed, pending, pendingVerification", async () => {
    // Catches: bucket shape missing a field
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { stats: { byParticipationType: Record<string, Record<string, unknown>> } };
    for (const key of ['full_celebration', 'campus_only', 'donation_only'] as const) {
      const bucket = body.stats.byParticipationType[key];
      expect(bucket).toHaveProperty("total");
      expect(bucket).toHaveProperty("confirmed");
      expect(bucket).toHaveProperty("pending");
      expect(bucket).toHaveProperty("pendingVerification");
    }
  });

  it("all buckets are zero when no registrations exist", async () => {
    // Catches: route returning null/undefined instead of zero-filled buckets
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as {
      stats: {
        byParticipationType: Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }>
      }
    };
    for (const key of ['full_celebration', 'campus_only', 'donation_only'] as const) {
      expect(body.stats.byParticipationType[key].total).toBe(0);
      expect(body.stats.byParticipationType[key].confirmed).toBe(0);
      expect(body.stats.byParticipationType[key].pending).toBe(0);
      expect(body.stats.byParticipationType[key].pendingVerification).toBe(0);
    }
  });
});

describe("dashboard byParticipationType — fixture counts", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();

    // Fixture: 2 full_celebration (1 confirmed, 1 pending), 1 campus_only (pending_verification),
    // 1 donation_only (confirmed)
    ctx.registrationRepo.seed(makeReg({ id: 1001, participationType: "full_celebration", status: "confirmed", attendanceIntent: "attending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, participationType: "full_celebration", status: "pending", attendanceIntent: "attending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1003, participationType: "campus_only", status: "pending_verification", attendanceIntent: "attending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1004, participationType: "donation_only", status: "confirmed", attendanceIntent: "donation_only" }));
  });

  it("full_celebration bucket has correct total/confirmed/pending/pendingVerification", async () => {
    // Catches: misrouting status into wrong bucket
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as {
      stats: { byParticipationType: Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }> }
    };
    const fc = body.stats.byParticipationType["full_celebration"];
    expect(fc.total).toBe(2);
    expect(fc.confirmed).toBe(1);
    expect(fc.pending).toBe(1);
    expect(fc.pendingVerification).toBe(0);
  });

  it("campus_only bucket reflects pending_verification count", async () => {
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as {
      stats: { byParticipationType: Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }> }
    };
    const co = body.stats.byParticipationType["campus_only"];
    expect(co.total).toBe(1);
    expect(co.confirmed).toBe(0);
    expect(co.pending).toBe(0);
    expect(co.pendingVerification).toBe(1);
  });

  it("donation_only bucket is populated correctly", async () => {
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as {
      stats: { byParticipationType: Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }> }
    };
    const don = body.stats.byParticipationType["donation_only"];
    expect(don.total).toBe(1);
    expect(don.confirmed).toBe(1);
    expect(don.pending).toBe(0);
    expect(don.pendingVerification).toBe(0);
  });

  it("existing flat stats fields (total, pending, confirmed, pendingVerification) are still present", async () => {
    // Catches: route accidentally dropping flat stats when adding byParticipationType
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { stats: Record<string, unknown> };
    expect(body.stats).toHaveProperty("total");
    expect(body.stats).toHaveProperty("pending");
    expect(body.stats).toHaveProperty("pendingVerification");
    expect(body.stats).toHaveProperty("confirmed");
    expect(body.stats).toHaveProperty("moneyCollected");
  });
});

// =============================================================================
// D6 — byParticipationType is ALWAYS unfiltered
// =============================================================================

describe("dashboard byParticipationType — D6: unfiltered regardless of type param", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();

    // One attendee (full_celebration), one donor (donation_only)
    ctx.registrationRepo.seed(makeReg({ id: 1001, participationType: "full_celebration", status: "confirmed", attendanceIntent: "attending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, participationType: "donation_only", status: "pending", attendanceIntent: "donation_only" }));
  });

  it("D6: byParticipationType includes donation_only even when type=attendee filters flat stats", async () => {
    // Catches: route naively applying the type filter to countByParticipationAndStatus
    const res = await ctx.req("/api/staff/dashboard?type=attendee", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      stats: {
        total: number;
        byParticipationType: Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }>
      }
    };

    // Flat stats are filtered: only the attendee registration
    expect(body.stats.total).toBe(1);

    // byParticipationType is UNFILTERED: both registrations present
    expect(body.stats.byParticipationType["full_celebration"].total).toBe(1);
    expect(body.stats.byParticipationType["donation_only"].total).toBe(1);
  });

  it("D6: byParticipationType includes attendees even when type=donor filters flat stats", async () => {
    // Catches: route applying type=donor filter to countByParticipationAndStatus
    const res = await ctx.req("/api/staff/dashboard?type=donor", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      stats: {
        byParticipationType: Record<string, { total: number }>
      }
    };

    // byParticipationType is UNFILTERED: both registrations visible
    expect(body.stats.byParticipationType["full_celebration"].total).toBe(1);
    expect(body.stats.byParticipationType["donation_only"].total).toBe(1);
  });
});

// =============================================================================
// Registrations list — participationType filter
// =============================================================================

describe("GET /registrations?participationType — filter", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();

    // One full_celebration, two campus_only, one donation_only
    ctx.registrationRepo.seed(makeReg({ id: 1001, participationType: "full_celebration", email: "fc@example.com", attendanceIntent: "attending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, participationType: "campus_only", email: "co1@example.com", attendanceIntent: "attending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1003, participationType: "campus_only", email: "co2@example.com", attendanceIntent: "attending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1004, participationType: "donation_only", email: "don@example.com", attendanceIntent: "donation_only" }));
  });

  it("participationType=campus_only returns only campus_only rows", async () => {
    // Catches: filter not wired into query-builder or route ignoring param
    const res = await ctx.req("/api/staff/registrations?participationType=campus_only", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ participationType: string }>; totalItems: number };
    expect(body.totalItems).toBe(2);
    expect(body.data).toHaveLength(2);
    for (const item of body.data) {
      expect(item.participationType).toBe("campus_only");
    }
  });

  it("participationType=full_celebration returns only full_celebration rows", async () => {
    const res = await ctx.req("/api/staff/registrations?participationType=full_celebration", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { data: Array<{ participationType: string }>; totalItems: number };
    expect(body.totalItems).toBe(1);
    expect(body.data[0].participationType).toBe("full_celebration");
  });

  it("omitting participationType returns all rows (no filter applied)", async () => {
    // Catches: route treating absent param as campus_only or defaulting unexpectedly
    const res = await ctx.req("/api/staff/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number };
    expect(body.totalItems).toBe(4);
  });

  it("participationType and type filters compose correctly", async () => {
    // type=attendee + participationType=campus_only: only campus attendees (not donors)
    const res = await ctx.req("/api/staff/registrations?type=attendee&participationType=campus_only", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number; data: Array<{ participationType: string }> };
    expect(body.totalItems).toBe(2);
    for (const item of body.data) {
      expect(item.participationType).toBe("campus_only");
    }
  });

  it("totalItems reflects participationType-filtered count, not total count", async () => {
    // Catches: list() filtering but count() not filtering (inconsistent filter passing)
    const res = await ctx.req("/api/staff/registrations?participationType=campus_only&limit=1", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { data: unknown[]; totalItems: number };
    // Only 1 item on page 1
    expect(body.data).toHaveLength(1);
    // But totalItems reflects the full matching set (2 campus_only rows)
    expect(body.totalItems).toBe(2);
  });
});

// =============================================================================
// Export — participationType filter (T2-3 + new requirement)
// =============================================================================

describe("GET /export — participationType filter and type filter fix", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();

    // Two campus_only, one full_celebration, one donation_only
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      participationType: "campus_only",
      attendanceIntent: "attending",
      fullName: "Campus One",
      regCode: "SMRTCAMPUS000001",
      email: "co1@example.com",
      contributionSplits: {},
    }));
    ctx.registrationRepo.seed(makeReg({
      id: 1002,
      participationType: "campus_only",
      attendanceIntent: "attending",
      fullName: "Campus Two",
      regCode: "SMRTCAMPUS000002",
      email: "co2@example.com",
      contributionSplits: {},
    }));
    ctx.registrationRepo.seed(makeReg({
      id: 1003,
      participationType: "full_celebration",
      attendanceIntent: "attending",
      fullName: "Full One",
      regCode: "SMRTFULL0000001",
      email: "fc@example.com",
      contributionSplits: {},
    }));
    ctx.registrationRepo.seed(makeReg({
      id: 1004,
      participationType: "donation_only",
      attendanceIntent: "donation_only",
      fullName: "Donor One",
      regCode: "SMRTDONOR000001",
      email: "donor@example.com",
      contributionSplits: {},
    }));
  });

  it("export?participationType=campus_only CSV contains only campus_only rows", async () => {
    // Catches: export ignoring participationType param
    const res = await ctx.req("/api/staff/export?participationType=campus_only", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    // 1 header + 2 campus_only rows
    expect(lines).toHaveLength(3);
    // Both campus rows present
    expect(csv).toContain("co1@example.com");
    expect(csv).toContain("co2@example.com");
    // Full and donor rows absent
    expect(csv).not.toContain("fc@example.com");
    expect(csv).not.toContain("donor@example.com");
  });

  it("export?participationType=campus_only CSV rows have campus_only participation label in participation column", async () => {
    // Catches: filter working but label column being wrong.
    // The route uses PARTICIPATION_LABELS which maps campus_only → "Campus Celebration".
    const res = await ctx.req("/api/staff/export?participationType=campus_only", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const csv = await res.text();
    const dataLines = csv.trim().split("\n").slice(1); // drop header
    // Every data line should include the label for campus_only
    for (const line of dataLines) {
      expect(line).toContain("Campus Celebration");
    }
  });

  it("T2-3 fix: export?type=donor excludes attendee registrations (pre-existing bug)", async () => {
    // T2-3: export was ignoring the ?type param entirely. Fixed in this brick.
    // Catches: route ignoring type param in registrationRepo.list() call
    const res = await ctx.req("/api/staff/export?type=donor", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    // 1 header + 1 donor row only
    expect(lines).toHaveLength(2);
    expect(csv).toContain("donor@example.com");
    expect(csv).not.toContain("co1@example.com");
    expect(csv).not.toContain("fc@example.com");
  });

  it("T2-3 fix: export?type=attendee excludes donation_only registrations", async () => {
    const res = await ctx.req("/api/staff/export?type=attendee", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    // 1 header + 3 attendee rows (campus x2, full x1)
    expect(lines).toHaveLength(4);
    expect(csv).not.toContain("donor@example.com");
  });

  it("export without participationType returns all rows (no filter applied)", async () => {
    // Catches: export always filtering even when param is absent
    const res = await ctx.req("/api/staff/export", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    // 1 header + 4 rows
    expect(lines).toHaveLength(5);
  });

  it("export response has Content-Type text/csv", async () => {
    // Catches: export returning wrong content type after changes
    const res = await ctx.req("/api/staff/export?participationType=campus_only", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.headers.get("content-type")).toContain("text/csv");
  });
});

// =============================================================================
// Canonical classification — legacy attendance_intent must not affect scope
// =============================================================================

describe("staff attendee/donor scope uses participationType as source of truth", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();

    // Deliberately contradictory legacy values. Classification must follow
    // participationType even if old/imported data has drifted.
    ctx.registrationRepo.seed(makeReg({
      id: 2001,
      fullName: "Canonical Attendee",
      email: "canonical-attendee@example.com",
      participationType: "campus_only",
      attendanceIntent: "donation_only",
      status: "confirmed",
    }));
    ctx.registrationRepo.seed(makeReg({
      id: 2002,
      fullName: "Canonical Donor Only",
      email: "canonical-donor@example.com",
      participationType: "donation_only",
      attendanceIntent: "attending",
      status: "pending",
    }));
    ctx.registrationRepo.seed(makeReg({
      id: 2003,
      fullName: "Invalid Legacy Type",
      email: "invalid-type@example.com",
      participationType: "legacy_unknown" as Registration["participationType"],
      attendanceIntent: "attending",
      status: "confirmed",
    }));
  });

  it("classifies mismatched fixtures correctly in dashboard totals and statuses", async () => {
    const attendeeRes = await ctx.req("/api/staff/dashboard?type=attendee", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const attendee = await attendeeRes.json() as {
      stats: { total: number; confirmed: number; pending: number };
    };
    expect(attendee.stats).toMatchObject({ total: 1, confirmed: 1, pending: 0 });

    const donorRes = await ctx.req("/api/staff/dashboard?type=donor", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const donor = await donorRes.json() as {
      stats: { total: number; confirmed: number; pending: number };
    };
    expect(donor.stats).toMatchObject({ total: 1, confirmed: 0, pending: 1 });
  });

  it("classifies mismatched fixtures correctly in list and CSV export", async () => {
    const listRes = await ctx.req("/api/staff/registrations?type=attendee", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = await listRes.json() as { data: Array<{ email: string }>; totalItems: number };
    expect(list.totalItems).toBe(1);
    expect(list.data.map((row) => row.email)).toEqual(["canonical-attendee@example.com"]);

    const exportRes = await ctx.req("/api/staff/export?type=donor", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const csv = await exportRes.text();
    expect(csv).toContain("canonical-donor@example.com");
    expect(csv).not.toContain("canonical-attendee@example.com");
    expect(csv).not.toContain("invalid-type@example.com");
  });
});

describe("D1 staff scope queries use the canonical participation_type column", () => {
  function captureDb() {
    const sql: string[] = [];
    const db = {
      prepare(statement: string) {
        sql.push(statement);
        const prepared = {
          bind(..._args: unknown[]) { return prepared; },
          async first<T>() { return { count: 0, total: 0 } as T; },
          async all<T>() { return { results: [] as T[] }; },
        };
        return prepared;
      },
    };
    return { db: db as unknown as D1Database, sql };
  }

  it("registration list/count and status filters never scope through attendance_intent", async () => {
    const { db, sql } = captureDb();
    const repo = new D1RegistrationRepository(db);

    await repo.list({ type: "attendee" });
    await repo.list({ type: "donor" });
    await repo.count({ type: "attendee" });
    await repo.count({ type: "donor" });
    await repo.countByStatus({ type: "attendee" });
    await repo.countByStatus({ type: "donor" });
    await repo.geographyAggregates();

    expect(sql).toHaveLength(8);
    expect(sql.every((statement) => statement.includes("participation_type"))).toBe(true);
    expect(sql.every((statement) => !statement.includes("attendance_intent"))).toBe(true);
    expect(sql.filter((statement) =>
      statement.includes("participation_type IN ('full_celebration', 'campus_only')"),
    )).toHaveLength(5);
  });

  it("verified payment totals and branch totals scope through participation_type", async () => {
    const { db, sql } = captureDb();
    const repo = new D1PaymentRepository(db);

    await repo.sumVerified({ type: "attendee" });
    await repo.sumVerified({ type: "donor" });
    await repo.sumVerifiedByBranch({ type: "attendee" });
    await repo.sumVerifiedByBranch({ type: "donor" });

    expect(sql).toHaveLength(4);
    expect(sql.every((statement) => statement.includes("r.participation_type"))).toBe(true);
    expect(sql.every((statement) => !statement.includes("attendance_intent"))).toBe(true);
    expect(sql.filter((statement) =>
      statement.includes("r.participation_type IN ('full_celebration', 'campus_only')"),
    )).toHaveLength(2);
  });

  it("all attendee resource queries use the explicit participation allowlist", async () => {
    const { db, sql } = captureDb();
    const repo = new D1AttendeeRepository(db);

    await repo.countGrouped();
    await repo.accommodationByNight();
    await repo.mealsByParticipationType();
    await repo.childrenByAgeBand();

    expect(sql).toHaveLength(6);
    expect(sql.every((statement) =>
      statement.includes("r.participation_type IN ('full_celebration', 'campus_only')"),
    )).toBe(true);
  });
});

describe("PUT /registrations/:id validates participationType at the HTTP boundary", () => {
  it("returns 422 for an unknown type and leaves the registration unchanged", async () => {
    const ctx = createTestApp();
    const token = await staffJwt();
    const original = makeReg({
      id: 3001,
      participationType: "campus_only",
      attendanceIntent: "attending",
      updatedAt: 123456,
    });
    ctx.registrationRepo.seed(original);

    const res = await ctx.req("/api/staff/registrations/3001", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        updatedAt: original.updatedAt,
        fields: { participationType: "typo" },
      }),
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: "Validation failed",
      details: { fieldErrors: { participationType: "Invalid participation type" } },
    });
    expect(await ctx.registrationRepo.findById(3001)).toMatchObject({
      participationType: "campus_only",
      attendanceIntent: "attending",
      updatedAt: 123456,
    });
  });
});
