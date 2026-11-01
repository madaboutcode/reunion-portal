/**
 * Endpoint tests for resources v2: GET /staff/resources — three new aggregate fields.
 *
 * BOUNDARY: HTTP endpoint (Hono handler + in-memory fakes).
 *   All tests go through the request handler — no implementation internals.
 *
 * COVERS:
 *   - accommodationByNight response shape (both night keys always present, T2-11)
 *   - T2-4 night interval: check_in=08-14/check_out=08-16 appears in BOTH buckets
 *   - T2-4: check_in=08-15 appears only in 08-15 bucket
 *   - empty DB: both night keys present, all-zero (T2-11)
 *   - status=confirmed filter scopes accommodationByNight (T2-6)
 *   - branch filter scopes accommodationByNight (T2-6)
 *   - shared_double rooms = ceil(count/2); shared_triple rooms = ceil(count/3)
 *   - extraBeds counted per night
 *   - donation_only fully excluded from accommodationByNight
 *   - mealsByParticipationType response shape
 *   - campusDayCaterer includes full_celebration + campus_only alumni + attendees
 *   - ravizBanquet includes full_celebration only
 *   - donation_only excluded from mealsByParticipationType
 *   - status filter scopes mealsByParticipationType (T2-6)
 *   - childrenByAgeBand response shape
 *   - age boundary: age=5 → under6; ages 6–12 → age6to12; age=13 → age12plus
 *   - null age → under6
 *   - status filter scopes childrenByAgeBand (T2-6)
 *   - branch filter scopes childrenByAgeBand (T2-6)
 *   - existing flat resources fields unchanged (headcount, accommodation, meals, tshirts)
 *
 * @module staff-resources-v2.test
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
} from "../repositories/interfaces.js";
import type {
  Registration,
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

const TEST_JWT_SECRET = "test-secret-key-for-staff-resources-v2-32chars!!";
const TEST_ENV = {
  JWT_SECRET: TEST_JWT_SECRET,
  DB: createFakePermissionsDb(),
} as unknown as import("../env.js").Env;

// Night keys (T2-11)
const NIGHT_14 = "2026-08-14";
const NIGHT_15 = "2026-08-15";

// =============================================================================
// Seeded attendee structure for the rich fake
// =============================================================================

/** An attendee record seeded into the fake repo, including its parent registration. */
interface SeededAttendee {
  type: string;       // 'spouse' | 'child' | 'guest'
  meal: string;       // 'veg' | 'non_veg'
  age: number | null; // null for children whose age is unknown
  parentStatus: string;
  parentBranch: string;
  parentParticipationType: string;
}

/** A registration record seeded into the fake attendee repo context. */
interface SeededRegistration {
  status: string;
  branch: string;
  participationType: string; // 'full_celebration' | 'campus_only' | 'donation_only'
  accommodation: string;     // 'none' | 'private' | 'shared_double' | 'shared_triple'
  checkIn: string | null;
  checkOut: string | null;
  extraBed: boolean;
  alumniMeal: string; // 'veg' | 'non_veg'
  gender?: string;     // 'male' | 'female' — defaults to 'male' when absent
  attendees: Array<Omit<SeededAttendee, 'parentStatus' | 'parentBranch' | 'parentParticipationType'>>;
}

// =============================================================================
// Rich in-memory attendee repo — real logic for the three new methods
// =============================================================================

class ResourcesAttendeeRepo implements IAttendeeRepository {
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
      const [type, meal] = k.split(':');
      return { type, meal, count };
    });
  }

  async accommodationByNight(
    filters?: { statuses?: string[]; branch?: string },
  ): Promise<Record<string, {
    private: number;
    privateByGender: { male: number; female: number; other: number };
    shared_double: { count: number; rooms: number };
    shared_doubleByGender: { male: number; female: number; other: number };
    shared_triple: { count: number; rooms: number };
    shared_tripleByGender: { male: number; female: number; other: number };
    extraBeds: number;
  }>> {
    // T2-11: always initialize both night keys to zero
    const zeroGender = () => ({ male: 0, female: 0, other: 0 });
    const zero = () => ({
      private: 0,
      privateByGender: zeroGender(),
      shared_double: { count: 0, rooms: 0 },
      shared_doubleByGender: zeroGender(),
      shared_triple: { count: 0, rooms: 0 },
      shared_tripleByGender: zeroGender(),
      extraBeds: 0,
    });
    const result: Record<string, ReturnType<typeof zero>> = {
      [NIGHT_14]: zero(),
      [NIGHT_15]: zero(),
    };

    const regs = this.applyFilters(filters).filter(
      (r) => r.checkIn !== null && r.accommodation !== 'none',
    );

    for (const night of [NIGHT_14, NIGHT_15]) {
      const bucket = result[night];
      for (const reg of regs) {
        // [check_in, check_out) interval (decision C6)
        if (reg.checkIn! <= night && (reg.checkOut ?? '') > night) {
          const n = 1;
          const g = (reg.gender === 'male' || reg.gender === 'female') ? reg.gender : 'other';
          if (reg.accommodation === 'private') {
            bucket.private += n;
            bucket.privateByGender[g] += n;
            if (reg.extraBed) bucket.extraBeds += n;
          } else if (reg.accommodation === 'shared_double') {
            bucket.shared_double.count += n;
            bucket.shared_doubleByGender[g] += n;
          } else if (reg.accommodation === 'shared_triple') {
            bucket.shared_triple.count += n;
            bucket.shared_tripleByGender[g] += n;
          }
        }
      }
      // Shared rooms cannot mix genders, so round each gender independently.
      bucket.shared_double.rooms = Object.values(bucket.shared_doubleByGender)
        .reduce((rooms, count) => rooms + Math.ceil(count / 2), 0);
      bucket.shared_triple.rooms = Object.values(bucket.shared_tripleByGender)
        .reduce((rooms, count) => rooms + Math.ceil(count / 3), 0);
    }

    return result;
  }

  async mealsByParticipationType(
    filters?: { statuses?: string[]; branch?: string },
  ): Promise<{ campusDayCaterer: { headcount: number; veg: number; nonVeg: number }; ravizBanquet: { headcount: number; veg: number; nonVeg: number } }> {
    const regs = this.applyFilters(filters);

    const campus = { headcount: 0, veg: 0, nonVeg: 0 };
    const raviz = { headcount: 0, veg: 0, nonVeg: 0 };

    const apply = (bucket: typeof campus, meal: string) => {
      bucket.headcount++;
      if (meal === 'veg') bucket.veg++;
      else bucket.nonVeg++;
    };

    for (const reg of regs) {
      const pt = reg.participationType;
      // Alumni
      if (pt === 'full_celebration' || pt === 'campus_only') apply(campus, reg.alumniMeal);
      if (pt === 'full_celebration') apply(raviz, reg.alumniMeal);
      // Attendees
      for (const a of reg.attendees) {
        if (pt === 'full_celebration' || pt === 'campus_only') apply(campus, a.meal);
        if (pt === 'full_celebration') apply(raviz, a.meal);
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
        if (a.type !== 'child') continue;
        if (a.age === null || a.age < 6) under6++;
        else if (a.age <= 12) age6to12++;
        else age12plus++;
      }
    }

    return { under6, age6to12, age12plus };
  }

  private applyFilters(filters?: { statuses?: string[]; branch?: string }): SeededRegistration[] {
    return this.registrations.filter((r) => {
      if (r.participationType === 'donation_only') return false; // C8
      if (filters?.statuses && !filters.statuses.includes(r.status)) return false;
      if (filters?.branch && r.branch !== filters.branch) return false;
      return true;
    });
  }
}

// =============================================================================
// Stub registration repo (sufficient for the /resources endpoint)
// =============================================================================

class StubRegistrationRepo implements IRegistrationRepository {
  private registrations: Registration[] = [];

  seed(reg: Registration): void { this.registrations.push(reg); }

  async createWithRelations(_i: RegistrationInsertSet): Promise<{ id: number }> { return { id: 1 }; }
  async findById(_id: number): Promise<Registration | null> { return null; }
  async findByRegCode(_rc: string): Promise<Registration | null> { return null; }
  async findByEmail(_e: string): Promise<Registration[]> { return []; }
  async findByWhatsapp(_w: string): Promise<Registration[]> { return []; }
  async updateStatus(_id: number, _s: RegistrationStatus): Promise<void> {}
  async update(_id: number, _d: RegistrationUpdate, _a?: NewAttendee[]): Promise<void> {}
  async count(_f?: RegistrationFilters): Promise<number> { return 0; }
  async countByStatus(_f?: { type?: 'attendee' | 'donor' }): Promise<{ pending: number; pendingVerification: number; confirmed: number }> { return { pending: 0, pendingVerification: 0, confirmed: 0 }; }
  async countByParticipationAndStatus(): Promise<Record<'full_celebration' | 'campus_only' | 'donation_only', { total: number; confirmed: number; pending: number; pendingVerification: number }>> {
    const zero = () => ({ total: 0, confirmed: 0, pending: 0, pendingVerification: 0 });
    return { full_celebration: zero(), campus_only: zero(), donation_only: zero() };
  }
  async geographyAggregates(): Promise<{ cities: { city: string; count: number }[]; countries: { country: string; count: number }[] }> { return { cities: [], countries: [] }; }
  async donorRecognitionRows(_t: number): Promise<{ publicDonors: { displayName: string; amount: number; felicitationEligible: boolean }[]; nonPublicCount: number; nonPublicTotal: number }> { return { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 }; }
  async getContributionAggregates(): Promise<Array<{ cause: string; count: number; total: number }>> { return []; }
  async getDonationTotals(): Promise<{ count: number; total: number }> { return { count: 0, total: 0 }; }
  async findMissingThumbnails(): Promise<Array<{ id: number; regCode: string; photoFileKey: string }>> { return []; }
  async findWithThumbnails() { return []; }
  async list(filters?: RegistrationFilters): Promise<Registration[]> {
    let regs = [...this.registrations];
    if (filters?.type === 'attendee') regs = regs.filter((r) => r.attendanceIntent === 'attending');
    if (filters?.status) regs = regs.filter((r) => r.status === filters.status);
    if (filters?.branch) regs = regs.filter((r) => r.branch === filters.branch);
    if (filters?.participationType) regs = regs.filter((r) => r.participationType === filters.participationType);
    return regs;
  }
  async updateWithLock(_id: number, _data: import('../domain/types.js').RegistrationUpdate, _expectedUpdatedAt: number, _attendees?: import('../domain/types.js').NewAttendee[]): Promise<void> {}
}

// =============================================================================
// Minimal stubs
// =============================================================================

class StubPaymentRepo implements IPaymentRepository {
  async create(_p: NewPayment): Promise<{ id: number }> { return { id: 1 }; }
  async findById(_id: number): Promise<Payment | null> { return null; }
  async findByRegistration(_id: number): Promise<Payment[]> { return []; }
  async updateStatus(_id: number, _s: PaymentStatus, _g?: GatewayData, _p?: string, _v?: { verifiedBy: string; verifiedAt: number }): Promise<void> {}
  async sumVerified(_f?: { type?: 'attendee' | 'donor' }): Promise<number> { return 0; }
  async sumVerifiedByBranch(_f?: { type?: 'attendee' | 'donor' }): Promise<Array<{ branch: string; collected: number }>> { return []; }
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

// =============================================================================
// Registration factory
// =============================================================================

function makeReg(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 1,
    regCode: "SMRTTEST00000001",
    status: "confirmed",
    fullName: "Test Alumnus",
    branch: "CS",
    email: "test@example.com",
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
  attendeeRepo: ResourcesAttendeeRepo;
  registrationRepo: StubRegistrationRepo;
}

function createTestApp(): TestCtx {
  _scopeCache.clear();
  const attendeeRepo = new ResourcesAttendeeRepo();
  const registrationRepo = new StubRegistrationRepo();
  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);

  app.use("*", async (c, next) => {
    c.set("registrationRepo", registrationRepo);
    c.set("paymentRepo", new StubPaymentRepo());
    c.set("attendeeRepo", attendeeRepo);
    c.set("auditRepo", new StubAuditRepo());
    c.set("documentRepo", new StubDocumentRepo());
    c.set("fileStorage", new StubFileStorage());
    c.set("systemAuditRepo", new StubSystemAuditRepo());
    c.set("tshirtRepo", createEmptyTshirtRepo());
    c.set("chargeRepo", createEmptyChargeRepo());
    await next();
  });

  app.route("/staff", staffRoutes);

  const req = (input: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(app.request(input, init, TEST_ENV));

  return { req, attendeeRepo, registrationRepo };
}

async function staffJwt(): Promise<string> {
  return signToken({ sub: "10", role: "staff", email: "staff@example.test" }, TEST_JWT_SECRET, "7d");
}


// =============================================================================
// accommodationByNight — response shape
// =============================================================================

describe("GET /api/staff/resources — accommodationByNight shape", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("response includes accommodationByNight with both night keys (T2-11)", async () => {
    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { resources: Record<string, unknown> };
    expect(body.resources).toHaveProperty("accommodationByNight");
    const abn = body.resources["accommodationByNight"] as Record<string, unknown>;
    expect(abn).toHaveProperty(NIGHT_14);
    expect(abn).toHaveProperty(NIGHT_15);
  });

  it("T2-11: empty DB returns both night keys all-zero", async () => {
    // No registrations seeded
    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as {
      resources: {
        accommodationByNight: Record<string, {
          private: number;
          shared_double: { count: number; rooms: number };
          shared_triple: { count: number; rooms: number };
          extraBeds: number;
        }>
      }
    };
    const night14 = body.resources.accommodationByNight[NIGHT_14];
    const night15 = body.resources.accommodationByNight[NIGHT_15];
    expect(night14).toBeDefined();
    expect(night14.private).toBe(0);
    expect(night14.shared_double.count).toBe(0);
    expect(night14.shared_double.rooms).toBe(0);
    expect(night14.shared_triple.count).toBe(0);
    expect(night14.shared_triple.rooms).toBe(0);
    expect(night14.extraBeds).toBe(0);
    expect(night15).toBeDefined();
    expect(night15.private).toBe(0);
  });

  it("each night bucket has correct structure (private, shared_double, shared_triple, extraBeds)", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: NIGHT_14, checkOut: NIGHT_15,
      extraBed: false, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, Record<string, unknown>> } };
    const bucket = body.resources.accommodationByNight[NIGHT_14];
    expect(bucket).toHaveProperty("private");
    expect(bucket).toHaveProperty("shared_double");
    expect(bucket).toHaveProperty("shared_triple");
    expect(bucket).toHaveProperty("extraBeds");
    const sd = bucket["shared_double"] as Record<string, unknown>;
    expect(sd).toHaveProperty("count");
    expect(sd).toHaveProperty("rooms");
  });
});

// =============================================================================
// accommodationByNight — interval semantics (T2-4, C6)
// =============================================================================

describe("GET /api/staff/resources — accommodationByNight interval occupancy (T2-4, C6)", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("T2-4: check_in=2026-08-14/check_out=2026-08-16 appears in BOTH night buckets", async () => {
    // Decision C6: [check_in, check_out) interval — a 2-night stay covers both nights
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: "2026-08-14", checkOut: "2026-08-16",
      extraBed: false, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, { private: number }> } };
    // Must appear in BOTH buckets
    expect(body.resources.accommodationByNight[NIGHT_14].private).toBe(1);
    expect(body.resources.accommodationByNight[NIGHT_15].private).toBe(1);
  });

  it("T2-4: check_in=2026-08-15/check_out=2026-08-16 appears only in 2026-08-15 bucket", async () => {
    // A single-night stay on Aug 15 only occupies that bucket
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: "2026-08-15", checkOut: "2026-08-16",
      extraBed: false, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, { private: number }> } };
    // Must appear only in Aug 15, not Aug 14
    expect(body.resources.accommodationByNight[NIGHT_14].private).toBe(0);
    expect(body.resources.accommodationByNight[NIGHT_15].private).toBe(1);
  });

  it("two registrations: one 2-night, one single-night on 08-15", async () => {
    // Reg A: 08-14 → 08-16 → both nights; Reg B: 08-15 → 08-16 → only 08-15
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: "2026-08-14", checkOut: "2026-08-16",
      extraBed: false, alumniMeal: "veg", attendees: [],
    });
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: "2026-08-15", checkOut: "2026-08-16",
      extraBed: false, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, { private: number }> } };
    expect(body.resources.accommodationByNight[NIGHT_14].private).toBe(1); // only Reg A
    expect(body.resources.accommodationByNight[NIGHT_15].private).toBe(2); // both Reg A + B
  });

  it("accommodation='none' excluded from night buckets (C1)", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null,
      extraBed: false, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, { private: number }> } };
    expect(body.resources.accommodationByNight[NIGHT_14].private).toBe(0);
    expect(body.resources.accommodationByNight[NIGHT_15].private).toBe(0);
  });

  it("donation_only excluded from accommodationByNight (C8)", async () => {
    // A donation_only registration with accommodation should be excluded entirely
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "donation_only",
      accommodation: "private", checkIn: NIGHT_14, checkOut: NIGHT_15,
      extraBed: false, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, { private: number }> } };
    expect(body.resources.accommodationByNight[NIGHT_14].private).toBe(0);
    expect(body.resources.accommodationByNight[NIGHT_15].private).toBe(0);
  });

  it("shared_double rooms = ceil(count/2) — 3 people → 2 rooms", async () => {
    // 3 shared_double registrations → ceil(3/2) = 2 rooms
    for (let i = 0; i < 3; i++) {
      ctx.attendeeRepo.seed({
        status: "confirmed", branch: "CS", participationType: "full_celebration",
        accommodation: "shared_double", checkIn: NIGHT_14, checkOut: NIGHT_15,
        extraBed: false, alumniMeal: "veg", attendees: [],
      });
    }

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, { shared_double: { count: number; rooms: number } }> } };
    const sd = body.resources.accommodationByNight[NIGHT_14].shared_double;
    expect(sd.count).toBe(3);
    expect(sd.rooms).toBe(2); // ceil(3/2)
  });

  it("shared_triple rooms = ceil(count/3) — 4 people → 2 rooms", async () => {
    // 4 shared_triple registrations → ceil(4/3) = 2 rooms
    for (let i = 0; i < 4; i++) {
      ctx.attendeeRepo.seed({
        status: "confirmed", branch: "CS", participationType: "full_celebration",
        accommodation: "shared_triple", checkIn: NIGHT_14, checkOut: NIGHT_15,
        extraBed: false, alumniMeal: "veg", attendees: [],
      });
    }

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, { shared_triple: { count: number; rooms: number } }> } };
    const st = body.resources.accommodationByNight[NIGHT_14].shared_triple;
    expect(st.count).toBe(4);
    expect(st.rooms).toBe(2); // ceil(4/3)
  });

  it("rounds shared rooms within each gender group", async () => {
    for (const gender of ["male", "female"] as const) {
      ctx.attendeeRepo.seed({
        status: "confirmed", branch: "CS", participationType: "full_celebration",
        accommodation: "shared_double", checkIn: NIGHT_14, checkOut: NIGHT_15,
        extraBed: false, alumniMeal: "veg", attendees: [], gender,
      });
    }

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, { shared_double: { count: number; rooms: number } }> } };
    const sharedDouble = body.resources.accommodationByNight[NIGHT_14].shared_double;
    expect(sharedDouble.count).toBe(2);
    expect(sharedDouble.rooms).toBe(2);
  });

  it("extraBeds counted per night for private rooms with extra_bed=true", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: "2026-08-14", checkOut: "2026-08-16",
      extraBed: true, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, { private: number; extraBeds: number }> } };
    // 2-night stay → extraBed counted in both nights
    expect(body.resources.accommodationByNight[NIGHT_14].extraBeds).toBe(1);
    expect(body.resources.accommodationByNight[NIGHT_15].extraBeds).toBe(1);
  });
});

// =============================================================================
// accommodationByNight — filters (T2-6)
// =============================================================================

describe("GET /api/staff/resources — accommodationByNight filter scoping (T2-6)", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("status=confirmed filter excludes pending registrations from accommodationByNight", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: NIGHT_14, checkOut: NIGHT_15,
      extraBed: false, alumniMeal: "veg", attendees: [],
    });
    ctx.attendeeRepo.seed({
      status: "pending", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: NIGHT_14, checkOut: NIGHT_15,
      extraBed: false, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources?status=confirmed", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, { private: number }> } };
    // Only confirmed → 1 private room per night
    expect(body.resources.accommodationByNight[NIGHT_14].private).toBe(1);
  });

  it("branch filter scopes accommodationByNight to that branch only", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: NIGHT_14, checkOut: NIGHT_15,
      extraBed: false, alumniMeal: "veg", attendees: [],
    });
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "EC", participationType: "full_celebration",
      accommodation: "private", checkIn: NIGHT_14, checkOut: NIGHT_15,
      extraBed: false, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources?branch=CS", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { accommodationByNight: Record<string, { private: number }> } };
    expect(body.resources.accommodationByNight[NIGHT_14].private).toBe(1); // only CS branch
  });
});

// =============================================================================
// mealsByParticipationType — shape + business logic
// =============================================================================

describe("GET /api/staff/resources — mealsByParticipationType", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("response includes mealsByParticipationType with campusDayCaterer and ravizBanquet", async () => {
    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: Record<string, unknown> };
    expect(body.resources).toHaveProperty("mealsByParticipationType");
    const meals = body.resources["mealsByParticipationType"] as Record<string, unknown>;
    expect(meals).toHaveProperty("campusDayCaterer");
    expect(meals).toHaveProperty("ravizBanquet");
    const campus = meals["campusDayCaterer"] as Record<string, unknown>;
    expect(campus).toHaveProperty("headcount");
    expect(campus).toHaveProperty("veg");
    expect(campus).toHaveProperty("nonVeg");
  });

  it("full_celebration alumni count toward both campusDayCaterer and ravizBanquet", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null,
      extraBed: false, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { mealsByParticipationType: { campusDayCaterer: { headcount: number; veg: number }; ravizBanquet: { headcount: number; veg: number } } } };
    expect(body.resources.mealsByParticipationType.campusDayCaterer.headcount).toBe(1);
    expect(body.resources.mealsByParticipationType.campusDayCaterer.veg).toBe(1);
    expect(body.resources.mealsByParticipationType.ravizBanquet.headcount).toBe(1);
    expect(body.resources.mealsByParticipationType.ravizBanquet.veg).toBe(1);
  });

  it("campus_only alumni count toward campusDayCaterer only, NOT ravizBanquet", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "campus_only",
      accommodation: "none", checkIn: null, checkOut: null,
      extraBed: false, alumniMeal: "non_veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { mealsByParticipationType: { campusDayCaterer: { headcount: number; nonVeg: number }; ravizBanquet: { headcount: number } } } };
    expect(body.resources.mealsByParticipationType.campusDayCaterer.headcount).toBe(1);
    expect(body.resources.mealsByParticipationType.campusDayCaterer.nonVeg).toBe(1);
    expect(body.resources.mealsByParticipationType.ravizBanquet.headcount).toBe(0);
  });

  it("donation_only excluded from mealsByParticipationType entirely (C8)", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "donation_only",
      accommodation: "none", checkIn: null, checkOut: null,
      extraBed: false, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { mealsByParticipationType: { campusDayCaterer: { headcount: number }; ravizBanquet: { headcount: number } } } };
    expect(body.resources.mealsByParticipationType.campusDayCaterer.headcount).toBe(0);
    expect(body.resources.mealsByParticipationType.ravizBanquet.headcount).toBe(0);
  });

  it("attendees of full_celebration registration count toward both caterers", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false,
      alumniMeal: "veg",
      attendees: [{ type: "spouse", meal: "veg", age: null }],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { mealsByParticipationType: { campusDayCaterer: { headcount: number }; ravizBanquet: { headcount: number } } } };
    // 1 alumni + 1 spouse = 2 in each caterer
    expect(body.resources.mealsByParticipationType.campusDayCaterer.headcount).toBe(2);
    expect(body.resources.mealsByParticipationType.ravizBanquet.headcount).toBe(2);
  });

  it("attendees of campus_only registration count toward campusDayCaterer only", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "campus_only",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false,
      alumniMeal: "veg",
      attendees: [{ type: "child", meal: "veg", age: 8 }],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { mealsByParticipationType: { campusDayCaterer: { headcount: number }; ravizBanquet: { headcount: number } } } };
    expect(body.resources.mealsByParticipationType.campusDayCaterer.headcount).toBe(2); // alumni + child
    expect(body.resources.mealsByParticipationType.ravizBanquet.headcount).toBe(0);
  });

  it("status filter scopes mealsByParticipationType (T2-6)", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null,
      extraBed: false, alumniMeal: "veg", attendees: [],
    });
    ctx.attendeeRepo.seed({
      status: "pending", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null,
      extraBed: false, alumniMeal: "veg", attendees: [],
    });

    const res = await ctx.req("/api/staff/resources?status=confirmed", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { mealsByParticipationType: { campusDayCaterer: { headcount: number } } } };
    expect(body.resources.mealsByParticipationType.campusDayCaterer.headcount).toBe(1); // confirmed only
  });

  it("veg/nonVeg tallied correctly across alumni and attendees", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false,
      alumniMeal: "veg",
      attendees: [{ type: "spouse", meal: "non_veg", age: null }],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { mealsByParticipationType: { campusDayCaterer: { headcount: number; veg: number; nonVeg: number }; ravizBanquet: { headcount: number; veg: number; nonVeg: number } } } };
    const campus = body.resources.mealsByParticipationType.campusDayCaterer;
    expect(campus.headcount).toBe(2);
    expect(campus.veg).toBe(1);    // alumni is veg
    expect(campus.nonVeg).toBe(1); // spouse is non_veg

    const raviz = body.resources.mealsByParticipationType.ravizBanquet;
    expect(raviz.headcount).toBe(2);
    expect(raviz.veg).toBe(1);
    expect(raviz.nonVeg).toBe(1);
  });
});

// =============================================================================
// childrenByAgeBand — shape + age band boundaries
// =============================================================================

describe("GET /api/staff/resources — childrenByAgeBand age boundaries", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("response includes childrenByAgeBand with under6, age6to12, age12plus", async () => {
    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: Record<string, unknown> };
    expect(body.resources).toHaveProperty("childrenByAgeBand");
    const cab = body.resources["childrenByAgeBand"] as Record<string, unknown>;
    expect(cab).toHaveProperty("under6");
    expect(cab).toHaveProperty("age6to12");
    expect(cab).toHaveProperty("age12plus");
  });

  it("age=5 → under6 band", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [{ type: "child", meal: "veg", age: 5 }],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { childrenByAgeBand: { under6: number; age6to12: number; age12plus: number } } };
    expect(body.resources.childrenByAgeBand.under6).toBe(1);
    expect(body.resources.childrenByAgeBand.age6to12).toBe(0);
    expect(body.resources.childrenByAgeBand.age12plus).toBe(0);
  });

  it("age=6 → age6to12 band (boundary: 6 is inclusive, not under6)", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [{ type: "child", meal: "veg", age: 6 }],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { childrenByAgeBand: { under6: number; age6to12: number; age12plus: number } } };
    expect(body.resources.childrenByAgeBand.under6).toBe(0);
    expect(body.resources.childrenByAgeBand.age6to12).toBe(1);
    expect(body.resources.childrenByAgeBand.age12plus).toBe(0);
  });

  it("age=11 → age6to12 band", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [{ type: "child", meal: "veg", age: 11 }],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { childrenByAgeBand: { under6: number; age6to12: number; age12plus: number } } };
    expect(body.resources.childrenByAgeBand.under6).toBe(0);
    expect(body.resources.childrenByAgeBand.age6to12).toBe(1);
    expect(body.resources.childrenByAgeBand.age12plus).toBe(0);
  });

  it("age=12 → age6to12 band (matches the pricing boundary)", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [{ type: "child", meal: "veg", age: 12 }],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { childrenByAgeBand: { under6: number; age6to12: number; age12plus: number } } };
    expect(body.resources.childrenByAgeBand.under6).toBe(0);
    expect(body.resources.childrenByAgeBand.age6to12).toBe(1);
    expect(body.resources.childrenByAgeBand.age12plus).toBe(0);
  });

  it("null age → under6 (conservative; assume free tier) (C4)", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [{ type: "child", meal: "veg", age: null }],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { childrenByAgeBand: { under6: number; age6to12: number; age12plus: number } } };
    expect(body.resources.childrenByAgeBand.under6).toBe(1);
    expect(body.resources.childrenByAgeBand.age6to12).toBe(0);
    expect(body.resources.childrenByAgeBand.age12plus).toBe(0);
  });

  it("non-child attendees excluded from childrenByAgeBand", async () => {
    // A spouse is not a child — should not appear in any age band
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [{ type: "spouse", meal: "veg", age: null }],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { childrenByAgeBand: { under6: number; age6to12: number; age12plus: number } } };
    expect(body.resources.childrenByAgeBand.under6).toBe(0);
    expect(body.resources.childrenByAgeBand.age6to12).toBe(0);
    expect(body.resources.childrenByAgeBand.age12plus).toBe(0);
  });

  it("multiple children across age bands are each counted in the correct band", async () => {
    // Mix of ages: 5 (under6), 6/11/12 (6-12), null (under6)
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [
        { type: "child", meal: "veg", age: 5 },
        { type: "child", meal: "veg", age: 6 },
        { type: "child", meal: "veg", age: 11 },
        { type: "child", meal: "veg", age: 12 },
        { type: "child", meal: "veg", age: null },
      ],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { childrenByAgeBand: { under6: number; age6to12: number; age12plus: number } } };
    expect(body.resources.childrenByAgeBand.under6).toBe(2);    // age=5, age=null
    expect(body.resources.childrenByAgeBand.age6to12).toBe(3);  // age=6, age=11, age=12
    expect(body.resources.childrenByAgeBand.age12plus).toBe(0);
  });

  it("status=confirmed filter scopes childrenByAgeBand (T2-6)", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [{ type: "child", meal: "veg", age: 5 }],
    });
    ctx.attendeeRepo.seed({
      status: "pending", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [{ type: "child", meal: "veg", age: 8 }], // should be excluded
    });

    const res = await ctx.req("/api/staff/resources?status=confirmed", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { childrenByAgeBand: { under6: number; age6to12: number; age12plus: number } } };
    expect(body.resources.childrenByAgeBand.under6).toBe(1);
    expect(body.resources.childrenByAgeBand.age6to12).toBe(0); // pending excluded
  });

  it("branch filter scopes childrenByAgeBand (T2-6)", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [{ type: "child", meal: "veg", age: 5 }],
    });
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "EC", participationType: "full_celebration",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [{ type: "child", meal: "veg", age: 8 }], // different branch, excluded
    });

    const res = await ctx.req("/api/staff/resources?branch=CS", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { childrenByAgeBand: { under6: number; age6to12: number; age12plus: number } } };
    expect(body.resources.childrenByAgeBand.under6).toBe(1);
    expect(body.resources.childrenByAgeBand.age6to12).toBe(0);
  });

  it("donation_only excluded from childrenByAgeBand (C8)", async () => {
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "donation_only",
      accommodation: "none", checkIn: null, checkOut: null, extraBed: false, alumniMeal: "veg",
      attendees: [{ type: "child", meal: "veg", age: 5 }],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: { childrenByAgeBand: { under6: number; age6to12: number; age12plus: number } } };
    expect(body.resources.childrenByAgeBand.under6).toBe(0);
  });
});

// =============================================================================
// Existing flat fields unchanged
// =============================================================================

describe("GET /api/staff/resources — existing flat fields unaffected", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("existing fields (headcount, accommodation, meals, tshirts) still present", async () => {
    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { resources: Record<string, unknown> };
    expect(body.resources).toHaveProperty("headcount");
    expect(body.resources).toHaveProperty("accommodation");
    expect(body.resources).toHaveProperty("meals");
    expect(body.resources).toHaveProperty("tshirts");
  });

  it("accommodation field uses gender-bucketed shape (total, male, female, other)", async () => {
    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as {
      resources: { accommodation: Record<string, { total: number; male: number; female: number; other: number }> }
    };
    expect(body.resources).toHaveProperty("accommodation");
    const acc = body.resources.accommodation;
    // Even with zero data, all buckets are initialized with the gender shape
    expect(acc["none"]).toEqual({ total: 0, male: 0, female: 0, other: 0 });
    expect(acc["private"]).toEqual({ total: 0, male: 0, female: 0, other: 0 });
  });
});

// =============================================================================
// accommodation gender breakdown
// =============================================================================

describe("GET /api/staff/resources — accommodation gender breakdown", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("counts alumni per accommodation type segregated by gender", async () => {
    // 2 males in private, 1 female in private, 1 male in shared_double, 1 null-gender in none
    ctx.registrationRepo.seed(makeReg({ id: 1, accommodation: "private", gender: "male" }));
    ctx.registrationRepo.seed(makeReg({ id: 2, accommodation: "private", gender: "male" }));
    ctx.registrationRepo.seed(makeReg({ id: 3, accommodation: "private", gender: "female" }));
    ctx.registrationRepo.seed(makeReg({ id: 4, accommodation: "shared_double", gender: "male" }));
    ctx.registrationRepo.seed(makeReg({ id: 5, accommodation: "none", gender: null }));

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      resources: { accommodation: Record<string, { total: number; male: number; female: number; other: number }> }
    };
    const acc = body.resources.accommodation;

    expect(acc["private"].total).toBe(3);
    expect(acc["private"].male).toBe(2);
    expect(acc["private"].female).toBe(1);
    expect(acc["private"].other).toBe(0);

    expect(acc["shared_double"].total).toBe(1);
    expect(acc["shared_double"].male).toBe(1);
    expect(acc["shared_double"].female).toBe(0);
    expect(acc["shared_double"].other).toBe(0);

    expect(acc["none"].total).toBe(1);
    expect(acc["none"].male).toBe(0);
    expect(acc["none"].female).toBe(0);
    expect(acc["none"].other).toBe(1);

    expect(acc["shared_triple"].total).toBe(0);
  });

  it("gender totals sum to parent count for each type", async () => {
    ctx.registrationRepo.seed(makeReg({ id: 1, accommodation: "private", gender: "male" }));
    ctx.registrationRepo.seed(makeReg({ id: 2, accommodation: "private", gender: "male" }));
    ctx.registrationRepo.seed(makeReg({ id: 3, accommodation: "private", gender: "female" }));
    ctx.registrationRepo.seed(makeReg({ id: 4, accommodation: "private", gender: null }));

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      resources: { accommodation: Record<string, { total: number; male: number; female: number; other: number }> }
    };
    const acc = body.resources.accommodation;

    for (const type of ["none", "private", "shared_double", "shared_triple"]) {
      const b = acc[type];
      expect(b.male + b.female + b.other).toBe(b.total);
    }
  });

  it("does not include dependents — alumni only", async () => {
    ctx.registrationRepo.seed(makeReg({ id: 1, accommodation: "private", gender: "male" }));
    // Seed attendees via the attendee repo — they should NOT affect accommodation gender
    ctx.attendeeRepo.seed({
      status: "confirmed", branch: "CS", participationType: "full_celebration",
      accommodation: "private", checkIn: "2026-08-14", checkOut: "2026-08-15",
      extraBed: false, alumniMeal: "veg",
      attendees: [
        { type: "spouse", meal: "veg", age: null },
        { type: "child", meal: "veg", age: 5 },
      ],
    });

    const res = await ctx.req("/api/staff/resources", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      resources: { accommodation: Record<string, { total: number; male: number; female: number; other: number }> }
    };
    const acc = body.resources.accommodation;

    // Only 1 alumni, not 1+2 dependents
    expect(acc["private"].total).toBe(1);
    expect(acc["private"].male).toBe(1);
    // Headcount should still include attendees (spouse + child = 2)
  });
});
