/**
 * QA adversarial tests — staff-dashboard-gaps sprint
 *
 * BOUNDARY: HTTP endpoints (Hono handler + in-memory fakes).
 *   Every test goes through the request handler.
 *   No implementation internals are imported or inspected.
 *
 * SEAMS TARGETED (not covered by existing tests):
 *   /dashboard — byParticipationType internal consistency invariant
 *   /dashboard — over-cap data returned truthfully (no server clamping, R4/D1)
 *   /registrations+export — participationType composes with status+branch simultaneously
 *   /export — CSV row count = filtered /registrations totalItems for same params
 *   /reports — geography city counts sum = attending registration count
 *   /reports — timeline fullCelebration+campusOnly = count on EVERY entry (multi-day)
 *   /reports — felicitation boundary: amount=50000 exactly eligible; 49999 not eligible
 *   /resources — night-15 occupancy ≥ night-14 when all stays are 2-night (08-14→08-16)
 *   /resources — per-night count never exceeds total accommodation count
 *   /resources — age bands sum = total children count
 *
 * @module qa-staff-dashboard-gaps.test
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

const TEST_JWT_SECRET = "test-secret-key-for-qa-staff-dashboard-gaps-32!!";
const TEST_ENV = {
  JWT_SECRET: TEST_JWT_SECRET,
  DB: createFakePermissionsDb(),
} as unknown as import("../env.js").Env;

const NIGHT_14 = "2026-08-14";
const NIGHT_15 = "2026-08-15";

// =============================================================================
// In-memory registration repo — covers dashboard + registrations + reports + export
// =============================================================================

class QARegistrationRepo implements IRegistrationRepository {
  protected registrations: Map<number, Registration> = new Map();
  private nextId = 2001;

  seed(reg: Registration): void {
    this.registrations.set(reg.id, reg);
  }

  async create(_r: NewRegistration, _a: NewAttendee[]): Promise<{ id: number }> {
    return { id: this.nextId++ };
  }
  async createWithRelations(_i: RegistrationInsertSet): Promise<{ id: number }> {
    return { id: this.nextId++ };
  }
  async findById(id: number): Promise<Registration | null> {
    return this.registrations.get(id) ?? null;
  }
  async findByRegCode(regCode: string): Promise<Registration | null> {
    for (const r of this.registrations.values()) {
      if (r.regCode === regCode) return r;
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
    const r = this.registrations.get(id);
    if (r) r.status = status;
  }
  async update(id: number, data: RegistrationUpdate, _a?: NewAttendee[]): Promise<void> {
    const r = this.registrations.get(id);
    if (r && data.full_name !== undefined) r.fullName = data.full_name;
  }

  async list(filters?: RegistrationFilters): Promise<Registration[]> {
    let regs = [...this.registrations.values()];
    if (filters?.type === "attendee") {
      regs = regs.filter((r) => r.attendanceIntent === "attending");
    } else if (filters?.type === "donor") {
      regs = regs.filter((r) => r.attendanceIntent === "donation_only");
    }
    if (filters?.status) regs = regs.filter((r) => r.status === filters.status);
    if (filters?.branch) regs = regs.filter((r) => r.branch === filters.branch);
    if (filters?.participationType) {
      regs = regs.filter((r) => r.participationType === filters.participationType);
    }
    if (filters?.search) {
      const s = filters.search.toLowerCase();
      regs = regs.filter(
        (r) =>
          r.fullName.toLowerCase().includes(s) ||
          r.email.toLowerCase().includes(s) ||
          r.regCode.toLowerCase().includes(s),
      );
    }
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? regs.length;
    return regs.slice(offset, offset + limit);
  }

  async count(filters?: RegistrationFilters): Promise<number> {
    // Count without pagination (ignore offset/limit for totalItems)
    const { offset: _o, limit: _l, ...countFilters } = filters ?? {};
    return (await this.list({ ...countFilters, offset: 0, limit: 999999 })).length;
  }

  async countByStatus(filters?: { type?: "attendee" | "donor" }): Promise<{ pending: number; pendingVerification: number; confirmed: number }> {
    let regs = [...this.registrations.values()];
    if (filters?.type === "attendee") regs = regs.filter((r) => r.attendanceIntent === "attending");
    else if (filters?.type === "donor") regs = regs.filter((r) => r.attendanceIntent === "donation_only");
    return {
      pending: regs.filter((r) => r.status === "pending").length,
      pendingVerification: regs.filter((r) => r.status === "pending_verification").length,
      confirmed: regs.filter((r) => r.status === "confirmed").length,
    };
  }

  async countByParticipationAndStatus(): Promise<Record<
    "full_celebration" | "campus_only" | "donation_only",
    { total: number; confirmed: number; pending: number; pendingVerification: number }
  >> {
    const zero = () => ({ total: 0, confirmed: 0, pending: 0, pendingVerification: 0 });
    const out: Record<string, ReturnType<typeof zero>> = {
      full_celebration: zero(),
      campus_only: zero(),
      donation_only: zero(),
    };
    for (const reg of this.registrations.values()) {
      const pt = reg.participationType as string;
      if (!(pt in out)) continue;
      const b = out[pt];
      b.total++;
      if (reg.status === "confirmed") b.confirmed++;
      else if (reg.status === "pending") b.pending++;
      else if (reg.status === "pending_verification") b.pendingVerification++;
    }
    return out as Record<
      "full_celebration" | "campus_only" | "donation_only",
      { total: number; confirmed: number; pending: number; pendingVerification: number }
    >;
  }

  async geographyAggregates(): Promise<{
    cities: { city: string; count: number }[];
    countries: { country: string; count: number }[];
  }> {
    const attendees = [...this.registrations.values()].filter(
      (r) => r.participationType !== "donation_only",
    );
    const cityMap = new Map<string, number>();
    const countryMap = new Map<string, number>();
    for (const r of attendees) {
      const city = r.city && r.city.trim() ? r.city : "Unknown";
      const country = r.country && r.country.trim() ? r.country : "Unknown";
      cityMap.set(city, (cityMap.get(city) ?? 0) + 1);
      countryMap.set(country, (countryMap.get(country) ?? 0) + 1);
    }
    return {
      cities: [...cityMap.entries()].map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count),
      countries: [...countryMap.entries()].map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count),
    };
  }

  async donorRecognitionRows(felicitationThreshold: number): Promise<{
    publicDonors: { displayName: string; amount: number; felicitationEligible: boolean }[];
    nonPublicCount: number;
    nonPublicTotal: number;
  }> {
    const donors = [...this.registrations.values()].filter((r) => r.donationAmount > 0);
    const publicDonors = donors
      .filter((r) => r.publicAck === true)
      .sort((a, b) => b.donationAmount - a.donationAmount)
      .map((r) => ({
        displayName: r.ackDisplayName && r.ackDisplayName.trim() ? r.ackDisplayName : r.fullName,
        amount: r.donationAmount,
        felicitationEligible: r.felicitation === true && r.donationAmount >= felicitationThreshold,
      }));
    const nonPublicDonors = donors.filter((r) => r.publicAck !== true);
    return {
      publicDonors,
      nonPublicCount: nonPublicDonors.length,
      nonPublicTotal: nonPublicDonors.reduce((sum, r) => sum + r.donationAmount, 0),
    };
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
// In-memory attendee repo — covers resources invariants
// =============================================================================

interface SeededRegistration {
  status: string;
  branch: string;
  participationType: string;
  accommodation: string;
  checkIn: string | null;
  checkOut: string | null;
  extraBed: boolean;
  alumniMeal: string;
  attendees: Array<{ type: string; meal: string; age: number | null }>;
}

class QAAttendeeRepo implements IAttendeeRepository {
  private registrations: SeededRegistration[] = [];

  seed(reg: SeededRegistration): void {
    this.registrations.push(reg);
  }

  async findByRegistration(_id: number): Promise<Attendee[]> { return []; }
  async replaceForRegistration(_id: number, _a: NewAttendee[]): Promise<void> {}

  async countGrouped(filters?: { statuses?: string[]; branch?: string }): Promise<Array<{ type: string; meal: string; count: number }>> {
    const regs = this.applyFilters(filters);
    const map = new Map<string, number>();
    for (const reg of regs) {
      for (const a of reg.attendees) {
        const key = `${a.type}:${a.meal}`;
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return [...map.entries()].map(([k, count]) => {
      const [type, meal] = k.split(":");
      return { type, meal, count };
    });
  }

  async accommodationByNight(
    filters?: { statuses?: string[]; branch?: string },
  ): Promise<Record<string, { private: number; privateByGender: { male: number; female: number; other: number }; shared_double: { count: number; rooms: number }; shared_doubleByGender: { male: number; female: number; other: number }; shared_triple: { count: number; rooms: number }; shared_tripleByGender: { male: number; female: number; other: number }; extraBeds: number }>> {
    const zero = () => ({
      private: 0,
      privateByGender: { male: 0, female: 0, other: 0 },
      shared_double: { count: 0, rooms: 0 },
      shared_doubleByGender: { male: 0, female: 0, other: 0 },
      shared_triple: { count: 0, rooms: 0 },
      shared_tripleByGender: { male: 0, female: 0, other: 0 },
      extraBeds: 0,
    });
    const result: Record<string, ReturnType<typeof zero>> = {
      [NIGHT_14]: zero(),
      [NIGHT_15]: zero(),
    };
    const regs = this.applyFilters(filters).filter(
      (r) => r.checkIn !== null && r.accommodation !== "none",
    );
    for (const night of [NIGHT_14, NIGHT_15]) {
      const bucket = result[night];
      for (const reg of regs) {
        if (reg.checkIn! <= night && (reg.checkOut ?? "") > night) {
          if (reg.accommodation === "private") {
            bucket.private += 1;
            if (reg.extraBed) bucket.extraBeds += 1;
          } else if (reg.accommodation === "shared_double") {
            bucket.shared_double.count += 1;
          } else if (reg.accommodation === "shared_triple") {
            bucket.shared_triple.count += 1;
          }
        }
      }
      bucket.shared_double.rooms = Math.ceil(bucket.shared_double.count / 2);
      bucket.shared_triple.rooms = Math.ceil(bucket.shared_triple.count / 3);
    }
    return result;
  }

  async mealsByParticipationType(
    filters?: { statuses?: string[]; branch?: string },
  ): Promise<{ campusDayCaterer: { headcount: number; veg: number; nonVeg: number }; ravizBanquet: { headcount: number; veg: number; nonVeg: number } }> {
    const regs = this.applyFilters(filters);
    const campus = { headcount: 0, veg: 0, nonVeg: 0 };
    const raviz = { headcount: 0, veg: 0, nonVeg: 0 };
    const apply = (b: typeof campus, meal: string) => {
      b.headcount++;
      if (meal === "veg") b.veg++;
      else b.nonVeg++;
    };
    for (const reg of regs) {
      const pt = reg.participationType;
      if (pt === "full_celebration" || pt === "campus_only") apply(campus, reg.alumniMeal);
      if (pt === "full_celebration") apply(raviz, reg.alumniMeal);
      for (const a of reg.attendees) {
        if (pt === "full_celebration" || pt === "campus_only") apply(campus, a.meal);
        if (pt === "full_celebration") apply(raviz, a.meal);
      }
    }
    return { campusDayCaterer: campus, ravizBanquet: raviz };
  }

  async childrenByAgeBand(
    filters?: { statuses?: string[]; branch?: string },
  ): Promise<{ under6: number; age6to12: number; age12plus: number }> {
    const regs = this.applyFilters(filters);
    let under6 = 0, age6to12 = 0, age12plus = 0;
    for (const reg of regs) {
      for (const a of reg.attendees) {
        if (a.type !== "child") continue;
        if (a.age === null || a.age < 6) under6++;
        else if (a.age < 12) age6to12++;
        else age12plus++;
      }
    }
    return { under6, age6to12, age12plus };
  }

  private applyFilters(filters?: { statuses?: string[]; branch?: string }): SeededRegistration[] {
    return this.registrations.filter((r) => {
      if (r.participationType === "donation_only") return false;
      if (filters?.statuses && !filters.statuses.includes(r.status)) return false;
      if (filters?.branch && r.branch !== filters.branch) return false;
      return true;
    });
  }
}

// =============================================================================
// Minimal stubs
// =============================================================================

class StubPaymentRepo implements IPaymentRepository {
  async create(_p: NewPayment): Promise<{ id: number }> { return { id: 1 }; }
  async findById(_id: number): Promise<Payment | null> { return null; }
  async findByRegistration(_id: number): Promise<Payment[]> { return []; }
  async updateStatus(_id: number, _s: PaymentStatus, _g?: GatewayData, _p?: string, _v?: { verifiedBy: string; verifiedAt: number }): Promise<void> {}
  async sumVerified(_f?: { type?: "attendee" | "donor" }): Promise<number> { return 0; }
  async sumVerifiedByBranch(_f?: { type?: "attendee" | "donor" }): Promise<Array<{ branch: string; collected: number }>> { return []; }
  async verify(_id: number, _amount: number, _gatewayRef: string, _verifiedBy: string, _verifiedAt: number): Promise<void> {}
  async settleAtDesk(): Promise<void> {}
  async findPendingByRegistration(_registrationId: number): Promise<Payment | null> { return null; }
  async deletePending(_paymentId: number): Promise<void> {}
  async updatePendingAmount(_paymentId: number, _newAmount: number): Promise<void> {}
  async sumVerifiedByRegistration(_registrationId: number): Promise<number> { return 0; }
}

class StubAuditRepo implements IAuditRepository {
  async append(_e: NewAuditEntry): Promise<void> {}
  async findByRegistration(_id: number): Promise<AuditEntry[]> { return []; }
}

class StubDocumentRepo implements IDocumentRepository {
  async create(_d: NewIdDocument): Promise<{ id: number }> { return { id: 1 }; }
  async findByRegistration(_id: number): Promise<IdDocument[]> { return []; }
  async updateR2Key(_id: number, _k: string): Promise<void> {}
}

class StubFileStorage implements IFileStorage {
  async upload(_k: string, _d: ArrayBuffer, _m: FileMetadata): Promise<void> {}
  async getSignedUrl(_k: string, _e: number): Promise<string> { throw new Error("not implemented"); }
  async get(_k: string): Promise<{ body: ReadableStream; contentType: string; size: number } | null> { return null; }
  async delete(_k: string): Promise<void> {}
  async copy(_f: string, _t: string): Promise<boolean> { return true; }
  async move(_f: string, _t: string): Promise<void> {}
}

class StubSystemAuditRepo implements ISystemAuditRepository {
  async append(_e: { action: SystemAuditAction; actor: string; targetType?: string; targetId?: number; details?: string }): Promise<void> {}
}

class StubInventoryRepo implements IInventoryRepository {
  async get(): Promise<Record<string, number>> { return {}; }
  async set(_inventory: Record<string, number>): Promise<void> {}
}

// =============================================================================
// Domain object builder
// =============================================================================

const BASE_NOW = 1_700_000_000_000;

function makeReg(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 2001,
    regCode: "SMRT-QA-DEFAULT-001",
    status: "confirmed",
    fullName: "QA Alumnus",
    branch: "Computer Science",
    email: "qa@example.com",
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
    createdAt: BASE_NOW,
    updatedAt: BASE_NOW,
    ...overrides,
  };
}

// =============================================================================
// Test app factories — one for dashboard/registrations/reports, one for resources
// =============================================================================

interface RegistrationCtx {
  req: (input: string, init?: RequestInit) => Promise<Response>;
  repo: QARegistrationRepo;
}

function createRegistrationApp(): RegistrationCtx {
  _scopeCache.clear();
  const repo = new QARegistrationRepo();
  const attendeeRepo = new QAAttendeeRepo();
  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);
  app.use("*", async (c, next) => {
    c.set("registrationRepo", repo);
    c.set("paymentRepo", new StubPaymentRepo());
    c.set("attendeeRepo", attendeeRepo);
    c.set("auditRepo", new StubAuditRepo());
    c.set("documentRepo", new StubDocumentRepo());
    c.set("fileStorage", new StubFileStorage());
    c.set("systemAuditRepo", new StubSystemAuditRepo());
    c.set("inventoryRepo", new StubInventoryRepo());
    c.set("tshirtRepo", createEmptyTshirtRepo());
    c.set("chargeRepo", createEmptyChargeRepo());
    await next();
  });
  app.route("/staff", staffRoutes);
  const req = (input: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(app.request(input, init, TEST_ENV));
  return { req, repo };
}

interface ResourceCtx {
  req: (input: string, init?: RequestInit) => Promise<Response>;
  attendeeRepo: QAAttendeeRepo;
}

function createResourceApp(): ResourceCtx {
  _scopeCache.clear();
  const attendeeRepo = new QAAttendeeRepo();
  const regRepo = new QARegistrationRepo();
  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);
  app.use("*", async (c, next) => {
    c.set("registrationRepo", regRepo);
    c.set("paymentRepo", new StubPaymentRepo());
    c.set("attendeeRepo", attendeeRepo);
    c.set("auditRepo", new StubAuditRepo());
    c.set("documentRepo", new StubDocumentRepo());
    c.set("fileStorage", new StubFileStorage());
    c.set("systemAuditRepo", new StubSystemAuditRepo());
    c.set("inventoryRepo", new StubInventoryRepo());
    c.set("tshirtRepo", createEmptyTshirtRepo());
    c.set("chargeRepo", createEmptyChargeRepo());
    await next();
  });
  app.route("/staff", staffRoutes);
  const req = (input: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(app.request(input, init, TEST_ENV));
  return { req, attendeeRepo };
}

async function staffJwt(): Promise<string> {
  return signToken({ sub: "99", role: "staff", email: "qa@example.test" }, TEST_JWT_SECRET, "7d");
}

// =============================================================================
// /dashboard — byParticipationType internal consistency invariants (D2, A4)
// =============================================================================

describe("GET /api/staff/dashboard — byParticipationType internal consistency", () => {
  let ctx: RegistrationCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createRegistrationApp();
    token = await staffJwt();
  });

  it("bucket.total = confirmed + pending + pendingVerification for full_celebration (R2, D2)", async () => {
    // Catches: total computed independently and diverging from the status sub-counts
    ctx.repo.seed(makeReg({ id: 2001, participationType: "full_celebration", status: "confirmed" }));
    ctx.repo.seed(makeReg({ id: 2002, participationType: "full_celebration", status: "pending" }));
    ctx.repo.seed(makeReg({ id: 2003, participationType: "full_celebration", status: "pending_verification" }));
    ctx.repo.seed(makeReg({ id: 2004, participationType: "full_celebration", status: "confirmed" }));

    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      stats: {
        byParticipationType: Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }>
      }
    };
    const fc = body.stats.byParticipationType["full_celebration"];
    expect(fc).toBeDefined();
    // Invariant: total must equal the sum of the three status fields
    expect(fc.total).toBe(fc.confirmed + fc.pending + fc.pendingVerification);
    // Concrete values
    expect(fc.confirmed).toBe(2);
    expect(fc.pending).toBe(1);
    expect(fc.pendingVerification).toBe(1);
    expect(fc.total).toBe(4);
  });

  it("bucket.total = confirmed + pending + pendingVerification for campus_only (R2, D2)", async () => {
    // Catches: campus_only total off by one or missing pending_verification
    ctx.repo.seed(makeReg({ id: 2010, participationType: "campus_only", status: "pending" }));
    ctx.repo.seed(makeReg({ id: 2011, participationType: "campus_only", status: "pending_verification" }));

    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as {
      stats: {
        byParticipationType: Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }>
      }
    };
    const co = body.stats.byParticipationType["campus_only"];
    expect(co.total).toBe(co.confirmed + co.pending + co.pendingVerification);
    expect(co.pending).toBe(1);
    expect(co.pendingVerification).toBe(1);
    expect(co.total).toBe(2);
  });

  it("all three participation types present in byParticipationType even with zero rows (A4)", async () => {
    // Catches: missing keys when a participation type has no registrations
    // No registrations seeded
    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as {
      stats: { byParticipationType: Record<string, unknown> }
    };
    expect(body.stats.byParticipationType).toHaveProperty("full_celebration");
    expect(body.stats.byParticipationType).toHaveProperty("campus_only");
    expect(body.stats.byParticipationType).toHaveProperty("donation_only");
  });

  it("byParticipationType is unfiltered: participationType query param has no effect (D6)", async () => {
    // Catches: byParticipationType being filtered when participationType=campus_only is passed
    // The participation filter is only for list/export (D6).
    ctx.repo.seed(makeReg({ id: 2020, participationType: "full_celebration", status: "confirmed" }));
    ctx.repo.seed(makeReg({ id: 2021, participationType: "campus_only", status: "confirmed" }));

    // Even if the dashboard accepted this param (it should not), byParticipationType must be unfiltered
    const res = await ctx.req("/api/staff/dashboard?participationType=campus_only", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as {
      stats: {
        byParticipationType: Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }>
      }
    };
    // full_celebration must still appear with its count (not filtered away)
    expect(body.stats.byParticipationType["full_celebration"].total).toBe(1);
    expect(body.stats.byParticipationType["campus_only"].total).toBe(1);
  });
});

// =============================================================================
// /dashboard — over-cap data returned truthfully (R4, D1)
// =============================================================================

describe("GET /api/staff/dashboard — over-cap data not clamped server-side (R4, D1)", () => {
  let ctx: RegistrationCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createRegistrationApp();
    token = await staffJwt();
  });

  it("campus_only count of 51 is returned truthfully — no server-side clamping to 50 (R4, D1)", async () => {
    // Catches: server clamping campus_only.total to the cap value (50)
    // Spec R4: no sold-out state, no API rejection — visibility only
    for (let i = 0; i < 51; i++) {
      ctx.repo.seed(makeReg({
        id: 3000 + i,
        participationType: "campus_only",
        status: "confirmed",
        regCode: `SMRT-QA-CAP-${String(i).padStart(3, "0")}`,
        email: `cap${i}@example.com`,
      }));
    }

    const res = await ctx.req("/api/staff/dashboard", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      stats: {
        byParticipationType: Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }>
      }
    };
    const co = body.stats.byParticipationType["campus_only"];
    // Must reflect the actual 51, not clamped to 50
    expect(co.total).toBe(51);
    expect(co.confirmed).toBe(51);
  });
});

// =============================================================================
// /registrations — participationType composes with status + branch simultaneously
// =============================================================================

describe("GET /api/staff/registrations — participationType filter composes with status+branch (A3, A14)", () => {
  let ctx: RegistrationCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createRegistrationApp();
    token = await staffJwt();
  });

  it("participationType=campus_only AND status=confirmed returns only campus confirmed rows", async () => {
    // Catches: one filter being applied but the other ignored
    ctx.repo.seed(makeReg({ id: 4001, participationType: "campus_only", status: "confirmed", attendanceIntent: "attending" }));
    ctx.repo.seed(makeReg({ id: 4002, participationType: "campus_only", status: "pending", attendanceIntent: "attending", regCode: "SMRT-QA-4002", email: "p2@example.com" }));
    ctx.repo.seed(makeReg({ id: 4003, participationType: "full_celebration", status: "confirmed", attendanceIntent: "attending", regCode: "SMRT-QA-4003", email: "p3@example.com" }));

    const res = await ctx.req("/api/staff/registrations?type=attendee&participationType=campus_only&status=confirmed", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { totalItems: number; data: Array<{ participationType: string; status: string }> };
    // Only campus_only + confirmed should appear
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    for (const item of body.data) {
      expect(item.participationType).toBe("campus_only");
      expect(item.status).toBe("confirmed");
    }
  });

  it("participationType=campus_only AND branch=EC returns only campus EC rows (not other branches)", async () => {
    // Catches: branch filter not composing with participationType
    ctx.repo.seed(makeReg({ id: 4010, participationType: "campus_only", branch: "EC", status: "confirmed", attendanceIntent: "attending", regCode: "SMRT-QA-4010", email: "ec1@example.com" }));
    ctx.repo.seed(makeReg({ id: 4011, participationType: "campus_only", branch: "CS", status: "confirmed", attendanceIntent: "attending", regCode: "SMRT-QA-4011", email: "cs1@example.com" }));
    ctx.repo.seed(makeReg({ id: 4012, participationType: "full_celebration", branch: "EC", status: "confirmed", attendanceIntent: "attending", regCode: "SMRT-QA-4012", email: "fc1@example.com" }));

    const res = await ctx.req("/api/staff/registrations?type=attendee&participationType=campus_only&branch=EC", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number; data: Array<{ participationType: string; branch: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].participationType).toBe("campus_only");
    expect(body.data[0].branch).toBe("EC");
  });

  it("participationType=full_celebration AND status=pending AND branch=CS returns only that intersection", async () => {
    // Catches: any of the three filters being silently ignored
    ctx.repo.seed(makeReg({ id: 4020, participationType: "full_celebration", branch: "CS", status: "pending", attendanceIntent: "attending", regCode: "SMRT-QA-4020", email: "m1@example.com" }));
    ctx.repo.seed(makeReg({ id: 4021, participationType: "full_celebration", branch: "EC", status: "pending", attendanceIntent: "attending", regCode: "SMRT-QA-4021", email: "m2@example.com" }));
    ctx.repo.seed(makeReg({ id: 4022, participationType: "campus_only", branch: "CS", status: "pending", attendanceIntent: "attending", regCode: "SMRT-QA-4022", email: "m3@example.com" }));
    ctx.repo.seed(makeReg({ id: 4023, participationType: "full_celebration", branch: "CS", status: "confirmed", attendanceIntent: "attending", regCode: "SMRT-QA-4023", email: "m4@example.com" }));

    const res = await ctx.req("/api/staff/registrations?type=attendee&participationType=full_celebration&branch=CS&status=pending", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { totalItems: number; data: Array<{ participationType: string; branch: string; status: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].participationType).toBe("full_celebration");
    expect(body.data[0].branch).toBe("CS");
    expect(body.data[0].status).toBe("pending");
  });
});

// =============================================================================
// /export — CSV row count = totalItems from /registrations for same params (A3)
// =============================================================================

describe("GET /api/staff/export — CSV row count matches /registrations totalItems (A3, T2-3)", () => {
  let ctx: RegistrationCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createRegistrationApp();
    token = await staffJwt();
  });

  it("export with participationType=campus_only yields same count as filtered list (A3)", async () => {
    // Catches: export ignoring participationType while list honours it (or vice versa)
    ctx.repo.seed(makeReg({ id: 5001, participationType: "campus_only", status: "confirmed", attendanceIntent: "attending" }));
    ctx.repo.seed(makeReg({ id: 5002, participationType: "campus_only", status: "pending", attendanceIntent: "attending", regCode: "SMRT-QA-5002", email: "e2@example.com" }));
    ctx.repo.seed(makeReg({ id: 5003, participationType: "full_celebration", status: "confirmed", attendanceIntent: "attending", regCode: "SMRT-QA-5003", email: "e3@example.com" }));

    const params = "type=attendee&participationType=campus_only";

    // Get totalItems from list
    const listRes = await ctx.req(`/api/staff/registrations?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = await listRes.json() as { totalItems: number };
    const totalItems = listBody.totalItems;

    // Get CSV row count (subtract 1 for header)
    const exportRes = await ctx.req(`/api/staff/export?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(exportRes.status).toBe(200);
    const csv = await exportRes.text();
    const rows = csv.trim().split("\n");
    const dataRows = rows.length - 1; // minus header

    expect(dataRows).toBe(totalItems);
    // Also verify the counts are non-zero (fixture has 2 campus rows)
    expect(totalItems).toBe(2);
  });

  it("export with participationType=campus_only + status=confirmed yields correct filtered count", async () => {
    // Catches: export not composing participationType+status like list does
    ctx.repo.seed(makeReg({ id: 5010, participationType: "campus_only", status: "confirmed", attendanceIntent: "attending", regCode: "SMRT-QA-5010", email: "f1@example.com" }));
    ctx.repo.seed(makeReg({ id: 5011, participationType: "campus_only", status: "pending", attendanceIntent: "attending", regCode: "SMRT-QA-5011", email: "f2@example.com" }));
    ctx.repo.seed(makeReg({ id: 5012, participationType: "full_celebration", status: "confirmed", attendanceIntent: "attending", regCode: "SMRT-QA-5012", email: "f3@example.com" }));

    const params = "type=attendee&participationType=campus_only&status=confirmed";

    const listRes = await ctx.req(`/api/staff/registrations?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = await listRes.json() as { totalItems: number };

    const exportRes = await ctx.req(`/api/staff/export?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const csv = await exportRes.text();
    const dataRows = csv.trim().split("\n").length - 1;

    expect(dataRows).toBe(listBody.totalItems);
    expect(listBody.totalItems).toBe(1);
  });
});

// =============================================================================
// /reports — geography: city counts sum = attending registration count (B1, B10)
// =============================================================================

describe("GET /api/staff/reports — geography city counts sum equals attending registration count", () => {
  let ctx: RegistrationCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createRegistrationApp();
    token = await staffJwt();
  });

  it("sum of all city counts equals total attending (non-donation-only) registrations (B1, B10)", async () => {
    // Catches: geography double-counting or undercounting due to exclusion logic
    ctx.repo.seed(makeReg({ id: 6001, city: "Kochi", participationType: "full_celebration", attendanceIntent: "attending" }));
    ctx.repo.seed(makeReg({ id: 6002, city: "Kochi", participationType: "full_celebration", attendanceIntent: "attending", regCode: "SMRT-QA-6002", email: "g2@example.com" }));
    ctx.repo.seed(makeReg({ id: 6003, city: "Thrissur", participationType: "campus_only", attendanceIntent: "attending", regCode: "SMRT-QA-6003", email: "g3@example.com" }));
    ctx.repo.seed(makeReg({ id: 6004, city: "Mumbai", participationType: "donation_only", attendanceIntent: "donation_only", regCode: "SMRT-QA-6004", email: "g4@example.com" }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as {
      geography: { cities: Array<{ city: string; count: number }> }
    };

    const citySumTotal = body.geography.cities.reduce((sum, c) => sum + c.count, 0);
    // 3 attending registrations (donation_only excluded)
    expect(citySumTotal).toBe(3);
    // Mumbai (donation_only) must NOT appear
    expect(body.geography.cities.find((c) => c.city === "Mumbai")).toBeUndefined();
  });

  it("sum of all country counts equals total attending registrations (B1, B10)", async () => {
    // Catches: country aggregation diverging from city aggregation scope
    ctx.repo.seed(makeReg({ id: 6010, country: "India", participationType: "full_celebration", attendanceIntent: "attending", regCode: "SMRT-QA-6010", email: "h1@example.com" }));
    ctx.repo.seed(makeReg({ id: 6011, country: "India", participationType: "campus_only", attendanceIntent: "attending", regCode: "SMRT-QA-6011", email: "h2@example.com" }));
    ctx.repo.seed(makeReg({ id: 6012, country: "UAE", participationType: "full_celebration", attendanceIntent: "attending", regCode: "SMRT-QA-6012", email: "h3@example.com" }));
    ctx.repo.seed(makeReg({ id: 6013, country: "India", participationType: "donation_only", attendanceIntent: "donation_only", regCode: "SMRT-QA-6013", email: "h4@example.com" }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as {
      geography: { countries: Array<{ country: string; count: number }> }
    };

    const countryTotal = body.geography.countries.reduce((sum, c) => sum + c.count, 0);
    // 3 attending registrations
    expect(countryTotal).toBe(3);
  });
});

// =============================================================================
// /reports — timeline: fullCelebration + campusOnly = count on EVERY entry (B3)
// =============================================================================

describe("GET /api/staff/reports — timeline fullCelebration+campusOnly = count on every entry (B3)", () => {
  let ctx: RegistrationCtx;
  let token: string;

  const DAY1 = new Date("2026-06-01T10:00:00Z").getTime();
  const DAY2 = new Date("2026-06-02T10:00:00Z").getTime();
  const DAY3 = new Date("2026-06-03T10:00:00Z").getTime();

  beforeEach(async () => {
    ctx = createRegistrationApp();
    token = await staffJwt();
  });

  it("fullCelebration + campusOnly = count on ALL entries in a 3-day timeline (B3)", async () => {
    // Catches: the invariant holding on day 1 but not day 2/3, or a day with only one type
    // Day 1: 2 full, 1 campus. Day 2: 1 campus only. Day 3: 1 full only.
    ctx.repo.seed(makeReg({ id: 7001, participationType: "full_celebration", attendanceIntent: "attending", createdAt: DAY1 }));
    ctx.repo.seed(makeReg({ id: 7002, participationType: "full_celebration", attendanceIntent: "attending", createdAt: DAY1, regCode: "SMRT-QA-7002", email: "t2@example.com" }));
    ctx.repo.seed(makeReg({ id: 7003, participationType: "campus_only", attendanceIntent: "attending", createdAt: DAY1, regCode: "SMRT-QA-7003", email: "t3@example.com" }));
    ctx.repo.seed(makeReg({ id: 7004, participationType: "campus_only", attendanceIntent: "attending", createdAt: DAY2, regCode: "SMRT-QA-7004", email: "t4@example.com" }));
    ctx.repo.seed(makeReg({ id: 7005, participationType: "full_celebration", attendanceIntent: "attending", createdAt: DAY3, regCode: "SMRT-QA-7005", email: "t5@example.com" }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { timeline: Array<{ date: string; count: number; fullCelebration: number; campusOnly: number }> };

    expect(body.timeline).toHaveLength(3);
    // Invariant must hold on EVERY entry
    for (const entry of body.timeline) {
      const sum = entry.fullCelebration + entry.campusOnly;
      expect({ date: entry.date, count: entry.count, sum }).toEqual({
        date: entry.date,
        count: entry.count,
        sum: entry.count,
      });
    }

    // Concrete per-day values
    const day1 = body.timeline.find((e) => e.date === "2026-06-01");
    expect(day1?.count).toBe(3);
    expect(day1?.fullCelebration).toBe(2);
    expect(day1?.campusOnly).toBe(1);

    const day2 = body.timeline.find((e) => e.date === "2026-06-02");
    expect(day2?.count).toBe(1);
    expect(day2?.fullCelebration).toBe(0);
    expect(day2?.campusOnly).toBe(1);

    const day3 = body.timeline.find((e) => e.date === "2026-06-03");
    expect(day3?.count).toBe(1);
    expect(day3?.fullCelebration).toBe(1);
    expect(day3?.campusOnly).toBe(0);
  });
});

// =============================================================================
// /reports — felicitation threshold boundary (R16, C6, T2-10)
// =============================================================================

describe("GET /api/staff/reports — felicitation threshold boundary (R16, C6)", () => {
  let ctx: RegistrationCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createRegistrationApp();
    token = await staffJwt();
  });

  it("amount = 50000 exactly with felicitation=true → felicitationEligible=true (exact threshold)", async () => {
    // Catches: off-by-one: threshold is ≥ 50000 so 50000 must be eligible
    // R16: "≥ ₹50,000 with felicitation consent"
    ctx.repo.seed(makeReg({
      id: 8001,
      donationAmount: 50000,
      publicAck: true,
      ackDisplayName: "Exact Threshold Donor",
      felicitation: true,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: Array<{ amount: number; felicitationEligible: boolean }> } };
    expect(body.donorRecognition.publicDonors).toHaveLength(1);
    expect(body.donorRecognition.publicDonors[0].amount).toBe(50000);
    expect(body.donorRecognition.publicDonors[0].felicitationEligible).toBe(true);
  });

  it("amount = 49999 with felicitation=true → felicitationEligible=false (just below threshold)", async () => {
    // Catches: implementation using > instead of >= for threshold check
    ctx.repo.seed(makeReg({
      id: 8002,
      donationAmount: 49999,
      publicAck: true,
      ackDisplayName: "Near Threshold Donor",
      felicitation: true,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: Array<{ amount: number; felicitationEligible: boolean }> } };
    expect(body.donorRecognition.publicDonors).toHaveLength(1);
    expect(body.donorRecognition.publicDonors[0].amount).toBe(49999);
    expect(body.donorRecognition.publicDonors[0].felicitationEligible).toBe(false);
  });

  it("amount = 50000 with felicitation=false → felicitationEligible=false (consent required)", async () => {
    // Catches: threshold check only, ignoring consent flag
    ctx.repo.seed(makeReg({
      id: 8003,
      donationAmount: 50000,
      publicAck: true,
      ackDisplayName: "No Consent At Threshold",
      felicitation: false,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: Array<{ felicitationEligible: boolean }> } };
    expect(body.donorRecognition.publicDonors[0].felicitationEligible).toBe(false);
  });

  it("two donors at boundary: 50000 eligible, 49999 not — both in same response", async () => {
    // Catches: batch processing conflating the two donors
    ctx.repo.seed(makeReg({
      id: 8010,
      donationAmount: 50000,
      publicAck: true,
      ackDisplayName: "At Threshold",
      felicitation: true,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
      regCode: "SMRT-QA-8010",
      email: "atthresh@example.com",
    }));
    ctx.repo.seed(makeReg({
      id: 8011,
      donationAmount: 49999,
      publicAck: true,
      ackDisplayName: "Below Threshold",
      felicitation: true,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
      regCode: "SMRT-QA-8011",
      email: "below@example.com",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: Array<{ displayName: string; amount: number; felicitationEligible: boolean }> } };
    expect(body.donorRecognition.publicDonors).toHaveLength(2);

    const atThreshold = body.donorRecognition.publicDonors.find((d) => d.amount === 50000);
    const belowThreshold = body.donorRecognition.publicDonors.find((d) => d.amount === 49999);
    expect(atThreshold?.felicitationEligible).toBe(true);
    expect(belowThreshold?.felicitationEligible).toBe(false);
  });
});

// =============================================================================
// /resources — night-15 occupancy ≥ night-14 when all stays are 2-night (C6)
// =============================================================================

describe("GET /api/staff/resources — night occupancy interval invariant (C6)", () => {
  let ctx: ResourceCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createResourceApp();
    token = await staffJwt();
  });

  it("night-15 private occupancy ≥ night-14 when ALL stays check out 2026-08-16 (2-night spans cover both) (C6)", async () => {
    // Catches: night-15 being lower than night-14 because single-night stays on 08-14
    // are added but some are missed for 08-15.
    // All 3 registrations check_in=08-14, check_out=08-16 → both nights occupied
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: NIGHT_14, checkOut: "2026-08-16",
      extraBed: false, alumniMeal: "veg", attendees: [],
    });
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: NIGHT_14, checkOut: "2026-08-16",
      extraBed: false, alumniMeal: "veg", attendees: [],
    });
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: NIGHT_14, checkOut: "2026-08-16",
      extraBed: false, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, { private: number }> } };
    const night14 = body.resources.accommodationByNight[NIGHT_14].private;
    const night15 = body.resources.accommodationByNight[NIGHT_15].private;

    // Both nights must have the same occupancy (all are 2-night stays)
    expect(night14).toBe(3);
    expect(night15).toBe(3);
    // Invariant: night-15 ≥ night-14 when all stays include both nights
    expect(night15).toBeGreaterThanOrEqual(night14);
  });

  it("per-night private count never exceeds total registration count (C6)", async () => {
    // Catches: double-counting the same registration in one night bucket
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: NIGHT_14, checkOut: "2026-08-16",
      extraBed: false, alumniMeal: "veg", attendees: [],
    });
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: NIGHT_15, checkOut: "2026-08-16",
      extraBed: false, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, { private: number }> } };
    const totalRegistrations = 2; // only 2 registrations seeded

    // No single night can have more occupants than total registrations
    expect(body.resources.accommodationByNight[NIGHT_14].private).toBeLessThanOrEqual(totalRegistrations);
    expect(body.resources.accommodationByNight[NIGHT_15].private).toBeLessThanOrEqual(totalRegistrations);
    // Concrete values
    expect(body.resources.accommodationByNight[NIGHT_14].private).toBe(1); // only reg 1
    expect(body.resources.accommodationByNight[NIGHT_15].private).toBe(2); // both regs
  });
});

// =============================================================================
// /resources — age bands sum = total children count (C4, R14)
// =============================================================================

describe("GET /api/staff/resources — childrenByAgeBand sum invariant (C4, R14)", () => {
  let ctx: ResourceCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createResourceApp();
    token = await staffJwt();
  });

  it("under6 + age6to12 + age12plus = total child attendees count (R14)", async () => {
    // Catches: a child being miscategorised and counted in no band or two bands
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [
        { type: "child", meal: "veg", age: 3 },    // under6
        { type: "child", meal: "veg", age: 5 },    // under6
        { type: "child", meal: "veg", age: 6 },    // age6to12
        { type: "child", meal: "veg", age: 11 },   // age6to12
        { type: "child", meal: "veg", age: 12 },   // age12plus
        { type: "child", meal: "veg", age: 15 },   // age12plus
        { type: "child", meal: "veg", age: null },  // under6 (null → under6)
        { type: "spouse", meal: "veg", age: null }, // NOT a child — excluded
      ],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { childrenByAgeBand: { under6: number; age6to12: number; age12plus: number } } };
    const { under6, age6to12, age12plus } = body.resources.childrenByAgeBand;

    const totalChildrenInFixture = 7; // 7 children (not spouse)
    expect(under6 + age6to12 + age12plus).toBe(totalChildrenInFixture);
    expect(under6).toBe(3);   // age 3, 5, null
    expect(age6to12).toBe(2); // age 6, 11
    expect(age12plus).toBe(2); // age 12, 15
  });

  it("age bands sum = 0 when no children exist (only spouses) (R14)", async () => {
    // Catches: non-child attendees leaking into age bands
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [
        { type: "spouse", meal: "veg", age: null },
        { type: "guest", meal: "non_veg", age: 35 },
      ],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { childrenByAgeBand: { under6: number; age6to12: number; age12plus: number } } };
    const { under6, age6to12, age12plus } = body.resources.childrenByAgeBand;
    expect(under6 + age6to12 + age12plus).toBe(0);
  });
});
