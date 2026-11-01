/**
 * Endpoint tests for server slice 2: GET /staff/reports extensions.
 *
 * BOUNDARY: HTTP endpoint (Hono handler + in-memory fakes).
 *   All tests go through the request handler — no implementation internals.
 *
 * COVERS:
 *   - geography response shape + city/country correctness
 *   - blank city/country bucketed as "Unknown" (B4)
 *   - donation_only excluded from geography (B10)
 *   - donorRecognition response shape
 *   - felicitationEligible: (felicitation=1, amount<50000)→false (T2-10)
 *   - felicitationEligible: (felicitation=0, amount≥50000)→false (T2-10)
 *   - felicitationEligible: (felicitation=1, amount≥50000)→true
 *   - displayName fallback: public_ack=1, blank ack_display_name → full_name (B5)
 *   - nonPublicCount + nonPublicTotal aggregate
 *   - timeline entries gain fullCelebration + campusOnly (B3)
 *   - timeline count = fullCelebration + campusOnly (when only those two types present)
 *   - donation_only excluded from timeline (B10)
 *   - existing flat fields (branchBreakdown, timeline.count, revenue) unchanged
 *
 * @module staff-reports-extension.test
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

const TEST_JWT_SECRET = "test-secret-key-for-staff-reports-tests-32chars!";
const TEST_ENV = {
  JWT_SECRET: TEST_JWT_SECRET,
  DB: createFakePermissionsDb(),
} as unknown as import("../env.js").Env;

// =============================================================================
// Rich in-memory registration repo with real geographyAggregates + donor logic
// =============================================================================

class ReportsRegistrationRepo implements IRegistrationRepository {
  protected registrations: Map<number, Registration> = new Map();
  private nextId = 1001;

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
    if (filters?.type === 'attendee') {
      regs = regs.filter((r) => r.attendanceIntent === 'attending');
    } else if (filters?.type === 'donor') {
      regs = regs.filter((r) => r.attendanceIntent === 'donation_only');
    }
    if (filters?.status) regs = regs.filter((r) => r.status === filters.status);
    if (filters?.branch) regs = regs.filter((r) => r.branch === filters.branch);
    if (filters?.participationType) {
      regs = regs.filter((r) => r.participationType === filters.participationType);
    }
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? regs.length;
    return regs.slice(offset, offset + limit);
  }

  async count(filters?: RegistrationFilters): Promise<number> {
    return (await this.list(filters)).length;
  }

  async countByStatus(filters?: { type?: 'attendee' | 'donor' }): Promise<{ pending: number; pendingVerification: number; confirmed: number }> {
    let regs = [...this.registrations.values()];
    if (filters?.type === 'attendee') regs = regs.filter((r) => r.attendanceIntent === 'attending');
    else if (filters?.type === 'donor') regs = regs.filter((r) => r.attendanceIntent === 'donation_only');
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
      full_celebration: zero(), campus_only: zero(), donation_only: zero(),
    };
    for (const reg of this.registrations.values()) {
      const pt = reg.participationType as string;
      if (!(pt in out)) continue;
      const b = out[pt];
      b.total++;
      if (reg.status === 'confirmed') b.confirmed++;
      else if (reg.status === 'pending') b.pending++;
      else if (reg.status === 'pending_verification') b.pendingVerification++;
    }
    return out as Record<
      'full_celebration' | 'campus_only' | 'donation_only',
      { total: number; confirmed: number; pending: number; pendingVerification: number }
    >;
  }

  async geographyAggregates(): Promise<{
    cities: { city: string; count: number }[];
    countries: { country: string; count: number }[];
  }> {
    // Mirror SQL: exclude donation_only (B10); blank/null → "Unknown" (B4)
    const attendees = [...this.registrations.values()].filter(
      (r) => r.participationType !== 'donation_only'
    );

    const cityMap = new Map<string, number>();
    const countryMap = new Map<string, number>();

    for (const r of attendees) {
      const city = (r.city && r.city.trim()) ? r.city : 'Unknown';
      const country = (r.country && r.country.trim()) ? r.country : 'Unknown';
      cityMap.set(city, (cityMap.get(city) ?? 0) + 1);
      countryMap.set(country, (countryMap.get(country) ?? 0) + 1);
    }

    const cities = [...cityMap.entries()]
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count);
    const countries = [...countryMap.entries()]
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);

    return { cities, countries };
  }

  async donorRecognitionRows(felicitationThreshold: number): Promise<{
    publicDonors: { displayName: string; amount: number; felicitationEligible: boolean }[];
    nonPublicCount: number;
    nonPublicTotal: number;
  }> {
    const donors = [...this.registrations.values()].filter(
      (r) => r.donationAmount > 0 && r.status === 'confirmed',
    );

    // Public donors: public_ack = true (domain type), sorted amount DESC
    // felicitationEligible: felicitation=true AND amount >= threshold
    const publicDonors = donors
      .filter((r) => r.publicAck === true)
      .sort((a, b) => b.donationAmount - a.donationAmount)
      .map((r) => ({
        // displayName: fall back to full_name when ack_display_name blank (B5)
        displayName: (r.ackDisplayName && r.ackDisplayName.trim()) ? r.ackDisplayName : r.fullName,
        amount: r.donationAmount,
        // felicitation is boolean in domain type (coerced from D1 0|1 in real repo)
        felicitationEligible: r.felicitation === true && r.donationAmount >= felicitationThreshold,
      }));

    const nonPublicDonors = donors.filter((r) => r.publicAck !== true);
    const nonPublicCount = nonPublicDonors.length;
    const nonPublicTotal = nonPublicDonors.reduce((sum, r) => sum + r.donationAmount, 0);

    return { publicDonors, nonPublicCount, nonPublicTotal };
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

class StubAttendeeRepo implements IAttendeeRepository {
  async findByRegistration(_id: number): Promise<Attendee[]> { return []; }
  async replaceForRegistration(_id: number, _a: NewAttendee[]): Promise<void> {}
  async countGrouped(_f?: { statuses?: string[]; branch?: string }): Promise<Array<{ type: string; meal: string; count: number }>> { return []; }
  async accommodationByNight(_f?: { statuses?: string[]; branch?: string }): Promise<Record<string, { private: number; privateByGender: { male: number; female: number; other: number }; shared_double: { count: number; rooms: number }; shared_doubleByGender: { male: number; female: number; other: number }; shared_triple: { count: number; rooms: number }; shared_tripleByGender: { male: number; female: number; other: number }; extraBeds: number }>> { return { '2026-08-14': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 }, '2026-08-15': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 } }; }
  async mealsByParticipationType(_f?: { statuses?: string[]; branch?: string }): Promise<{ campusDayCaterer: { headcount: number; veg: number; nonVeg: number }; ravizBanquet: { headcount: number; veg: number; nonVeg: number } }> { return { campusDayCaterer: { headcount: 0, veg: 0, nonVeg: 0 }, ravizBanquet: { headcount: 0, veg: 0, nonVeg: 0 } }; }
  async childrenByAgeBand(_f?: { statuses?: string[]; branch?: string }): Promise<{ under6: number; age6to12: number; age12plus: number }> { return { under6: 0, age6to12: 0, age12plus: 0 }; }
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
  private inventory: Record<string, number> = {};
  seed(inventory: Record<string, number>): void {
    this.inventory = inventory;
  }
  async get(): Promise<Record<string, number>> {
    return this.inventory;
  }
  async set(inventory: Record<string, number>): Promise<void> {
    this.inventory = inventory;
  }
}

// =============================================================================
// Domain object builder
// =============================================================================

const NOW = Date.now();

function makeReg(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 1001,
    regCode: "SMRTTESTCODE0001",
    status: "confirmed",
    fullName: "Test Alumnus",
    branch: "Computer Science",
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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// =============================================================================
// Test app factory
// =============================================================================

interface TestCtx {
  req: (input: string, init?: RequestInit) => Promise<Response>;
  registrationRepo: ReportsRegistrationRepo;
  inventoryRepo: StubInventoryRepo;
}

function createTestApp(): TestCtx {
  _scopeCache.clear();
  const registrationRepo = new ReportsRegistrationRepo();
  const inventoryRepo = new StubInventoryRepo();
  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);

  app.use("*", async (c, next) => {
    c.set("registrationRepo", registrationRepo);
    c.set("paymentRepo", new StubPaymentRepo());
    c.set("attendeeRepo", new StubAttendeeRepo());
    c.set("auditRepo", new StubAuditRepo());
    c.set("documentRepo", new StubDocumentRepo());
    c.set("fileStorage", new StubFileStorage());
    c.set("systemAuditRepo", new StubSystemAuditRepo());
    c.set("inventoryRepo", inventoryRepo);
    await next();
  });

  app.route("/staff", staffRoutes);

  const req = (input: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(app.request(input, init, TEST_ENV));

  return { req, registrationRepo, inventoryRepo };
}

async function staffJwt(): Promise<string> {
  return signToken({ sub: "10", role: "staff", email: "staff@example.test" }, TEST_JWT_SECRET, "7d");
}

// =============================================================================
// Reports — response shape (new fields present)
// =============================================================================

describe("GET /api/staff/reports — new field shapes", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("response includes geography with cities and countries arrays", async () => {
    // Catches: route omitting geography field or returning wrong shape
    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("geography");
    const geo = body["geography"] as Record<string, unknown>;
    expect(geo).toHaveProperty("cities");
    expect(geo).toHaveProperty("countries");
    expect(Array.isArray(geo["cities"])).toBe(true);
    expect(Array.isArray(geo["countries"])).toBe(true);
  });

  it("response includes donorRecognition with publicDonors, nonPublicCount, nonPublicTotal", async () => {
    // Catches: route omitting donorRecognition or wrong shape
    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("donorRecognition");
    const dr = body["donorRecognition"] as Record<string, unknown>;
    expect(dr).toHaveProperty("publicDonors");
    expect(dr).toHaveProperty("nonPublicCount");
    expect(dr).toHaveProperty("nonPublicTotal");
    expect(Array.isArray(dr["publicDonors"])).toBe(true);
  });

  it("existing fields (branchBreakdown, timeline, revenue, contributions, donations) are still present", async () => {
    // Catches: route accidentally dropping existing fields when adding new ones
    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("branchBreakdown");
    expect(body).toHaveProperty("timeline");
    expect(body).toHaveProperty("revenue");
    expect(body).toHaveProperty("contributions");
    expect(body).toHaveProperty("donations");
  });

  it("geography and donorRecognition are empty/zero when no registrations exist", async () => {
    // Catches: route returning null/undefined instead of zero-filled shapes
    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as {
      geography: { cities: unknown[]; countries: unknown[] };
      donorRecognition: { publicDonors: unknown[]; nonPublicCount: number; nonPublicTotal: number };
    };
    expect(body.geography.cities).toHaveLength(0);
    expect(body.geography.countries).toHaveLength(0);
    expect(body.donorRecognition.publicDonors).toHaveLength(0);
    expect(body.donorRecognition.nonPublicCount).toBe(0);
    expect(body.donorRecognition.nonPublicTotal).toBe(0);
  });
});

// =============================================================================
// Geography — city and country aggregation (B1, B4, B10)
// =============================================================================

describe("GET /api/staff/reports — geography aggregation", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("B4: blank city is bucketed as 'Unknown'", async () => {
    // Catches: blank city appearing as "" or being dropped from counts
    ctx.registrationRepo.seed(makeReg({ id: 1001, city: "", country: "India", participationType: "full_celebration", attendanceIntent: "attending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, city: "Kochi", country: "India", participationType: "full_celebration", attendanceIntent: "attending" }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { geography: { cities: Array<{ city: string; count: number }> } };
    const unknownCity = body.geography.cities.find((c) => c.city === "Unknown");
    expect(unknownCity).toBeDefined();
    expect(unknownCity!.count).toBe(1);
  });

  it("B4: blank country is bucketed as 'Unknown'", async () => {
    ctx.registrationRepo.seed(makeReg({ id: 1001, city: "Kochi", country: "", participationType: "full_celebration", attendanceIntent: "attending" }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { geography: { countries: Array<{ country: string; count: number }> } };
    const unknownCountry = body.geography.countries.find((c) => c.country === "Unknown");
    expect(unknownCountry).toBeDefined();
    expect(unknownCountry!.count).toBe(1);
  });

  it("B10: donation_only registrations excluded from geography", async () => {
    // Catches: geography including donors when it should count only attendees
    ctx.registrationRepo.seed(makeReg({ id: 1001, city: "Kochi", country: "India", participationType: "full_celebration", attendanceIntent: "attending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, city: "Mumbai", country: "India", participationType: "donation_only", attendanceIntent: "donation_only" }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { geography: { cities: Array<{ city: string; count: number }> } };
    // Only 1 city (Kochi from attendee); Mumbai from donor excluded
    const cities = body.geography.cities;
    expect(cities).toHaveLength(1);
    expect(cities[0].city).toBe("Kochi");
    expect(cities.find((c) => c.city === "Mumbai")).toBeUndefined();
  });

  it("cities are sorted count DESC", async () => {
    // Catches: route/repo not sorting geography results
    ctx.registrationRepo.seed(makeReg({ id: 1001, city: "Kochi", country: "India", participationType: "full_celebration", attendanceIntent: "attending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, city: "Thrissur", country: "India", participationType: "full_celebration", attendanceIntent: "attending" }));
    ctx.registrationRepo.seed(makeReg({ id: 1003, city: "Thrissur", country: "India", participationType: "campus_only", attendanceIntent: "attending" }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { geography: { cities: Array<{ city: string; count: number }> } };
    const cities = body.geography.cities;
    expect(cities[0].city).toBe("Thrissur"); // count=2, first
    expect(cities[0].count).toBe(2);
    expect(cities[1].city).toBe("Kochi");    // count=1, second
  });

  it("city and country entries have correct structure (city/country + count keys)", async () => {
    ctx.registrationRepo.seed(makeReg({ id: 1001, city: "Kochi", country: "India", participationType: "full_celebration", attendanceIntent: "attending" }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as {
      geography: {
        cities: Array<Record<string, unknown>>;
        countries: Array<Record<string, unknown>>;
      }
    };
    expect(body.geography.cities[0]).toHaveProperty("city");
    expect(body.geography.cities[0]).toHaveProperty("count");
    expect(body.geography.countries[0]).toHaveProperty("country");
    expect(body.geography.countries[0]).toHaveProperty("count");
  });
});

// =============================================================================
// Donor recognition — felicitation, displayName fallback, non-public (T2-10, B2, B5)
// =============================================================================

describe("GET /api/staff/reports — donorRecognition", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("T2-10: felicitation=1 AND amount<50000 → felicitationEligible=false", async () => {
    // Catches: felicitationEligible computed as felicitation=true alone (ignores threshold)
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      donationAmount: 10000, // below threshold
      publicAck: true,
      ackDisplayName: "Test Donor",
      felicitation: true,   // consented but below threshold
      attendanceIntent: "donation_only",
      participationType: "donation_only",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: Array<{ felicitationEligible: boolean }> } };
    expect(body.donorRecognition.publicDonors).toHaveLength(1);
    expect(body.donorRecognition.publicDonors[0].felicitationEligible).toBe(false);
  });

  it("excludes pending donation pledges from recognition", async () => {
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      status: "pending",
      donationAmount: 75000,
      publicAck: true,
      ackDisplayName: "Pending Pledge",
      felicitation: true,
    }));
    ctx.registrationRepo.seed(makeReg({
      id: 1002,
      status: "confirmed",
      donationAmount: 10000,
      publicAck: true,
      ackDisplayName: "Confirmed Donor",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: Array<{ displayName: string }> } };
    expect(body.donorRecognition.publicDonors.map((donor) => donor.displayName))
      .toEqual(["Confirmed Donor"]);
  });

  it("T2-10: felicitation=false AND amount>=50000 → felicitationEligible=false", async () => {
    // Catches: felicitationEligible computed as amount>=threshold alone (ignores consent)
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      donationAmount: 75000, // above threshold
      publicAck: true,
      ackDisplayName: "Rich Donor",
      felicitation: false,  // no consent
      attendanceIntent: "donation_only",
      participationType: "donation_only",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: Array<{ felicitationEligible: boolean }> } };
    expect(body.donorRecognition.publicDonors).toHaveLength(1);
    expect(body.donorRecognition.publicDonors[0].felicitationEligible).toBe(false);
  });

  it("felicitation=true AND amount>=50000 → felicitationEligible=true", async () => {
    // Confirms the happy path works when both conditions are satisfied
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      donationAmount: 50000, // exactly at threshold
      publicAck: true,
      ackDisplayName: "Generous Donor",
      felicitation: true,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: Array<{ felicitationEligible: boolean }> } };
    expect(body.donorRecognition.publicDonors[0].felicitationEligible).toBe(true);
  });

  it("B5: public_ack=true with blank ack_display_name → falls back to full_name", async () => {
    // Catches: route/repo returning blank displayName when ack_display_name is null/empty
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      fullName: "Suresh Pillai",
      donationAmount: 5000,
      publicAck: true,
      ackDisplayName: "",  // blank — should fall back to fullName
      felicitation: false,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: Array<{ displayName: string }> } };
    expect(body.donorRecognition.publicDonors).toHaveLength(1);
    expect(body.donorRecognition.publicDonors[0].displayName).toBe("Suresh Pillai");
  });

  it("B5: public_ack=true with non-blank ack_display_name → uses ack_display_name", async () => {
    // Confirms that a provided display name is not overridden
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      fullName: "Private Real Name",
      donationAmount: 5000,
      publicAck: true,
      ackDisplayName: "Anonymous Benefactor",
      felicitation: false,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: Array<{ displayName: string }> } };
    expect(body.donorRecognition.publicDonors[0].displayName).toBe("Anonymous Benefactor");
  });

  it("B2: non-public donors contribute to nonPublicCount and nonPublicTotal", async () => {
    // Catches: non-public donors leaking into publicDonors or aggregate being zero
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      donationAmount: 25000,
      publicAck: false,  // declined public acknowledgement
      ackDisplayName: null,
      felicitation: false,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
    }));
    ctx.registrationRepo.seed(makeReg({
      id: 1002,
      donationAmount: 15000,
      publicAck: false,
      ackDisplayName: null,
      felicitation: false,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: unknown[]; nonPublicCount: number; nonPublicTotal: number } };
    // Non-public donors must NOT appear in publicDonors
    expect(body.donorRecognition.publicDonors).toHaveLength(0);
    expect(body.donorRecognition.nonPublicCount).toBe(2);
    expect(body.donorRecognition.nonPublicTotal).toBe(40000);
  });

  it("public donors are sorted by amount DESC (B8)", async () => {
    // Catches: donors returned in insertion order rather than sorted
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      donationAmount: 5000,
      publicAck: true,
      ackDisplayName: "Small Donor",
      felicitation: false,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
    }));
    ctx.registrationRepo.seed(makeReg({
      id: 1002,
      donationAmount: 75000,
      publicAck: true,
      ackDisplayName: "Large Donor",
      felicitation: true,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: Array<{ displayName: string; amount: number }> } };
    expect(body.donorRecognition.publicDonors[0].displayName).toBe("Large Donor");
    expect(body.donorRecognition.publicDonors[0].amount).toBe(75000);
  });

  it("publicDonor entries have displayName, amount, felicitationEligible keys", async () => {
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      donationAmount: 10000,
      publicAck: true,
      ackDisplayName: "Test",
      felicitation: false,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: Array<Record<string, unknown>> } };
    const donor = body.donorRecognition.publicDonors[0];
    expect(donor).toHaveProperty("displayName");
    expect(donor).toHaveProperty("amount");
    expect(donor).toHaveProperty("felicitationEligible");
    expect(typeof donor["felicitationEligible"]).toBe("boolean");
  });

  it("registrations with donation_amount=0 are not included in publicDonors", async () => {
    // Catches: route/repo including non-donors just because public_ack=true
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      donationAmount: 0,  // no donation
      publicAck: true,
      ackDisplayName: "Not a donor",
      felicitation: false,
      attendanceIntent: "attending",
      participationType: "full_celebration",
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { donorRecognition: { publicDonors: unknown[] } };
    expect(body.donorRecognition.publicDonors).toHaveLength(0);
  });
});

// =============================================================================
// Timeline — participation split (B3)
// =============================================================================

describe("GET /api/staff/reports — timeline participation split (B3)", () => {
  let ctx: TestCtx;
  let token: string;

  const DAY1 = new Date("2026-06-01T10:00:00Z").getTime();
  const DAY2 = new Date("2026-06-02T10:00:00Z").getTime();

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("timeline entries have fullCelebration and campusOnly fields (additive, B3)", async () => {
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      participationType: "full_celebration",
      attendanceIntent: "attending",
      createdAt: DAY1,
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { timeline: Array<Record<string, unknown>> };
    expect(body.timeline).toHaveLength(1);
    const entry = body.timeline[0];
    expect(entry).toHaveProperty("fullCelebration");
    expect(entry).toHaveProperty("campusOnly");
  });

  it("timeline count = fullCelebration + campusOnly when only those types present", async () => {
    // Proves count keeps total-attendee semantics (back-compat) and
    // fullCelebration + campusOnly sums to count (no donation_only in attendees)
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      participationType: "full_celebration",
      attendanceIntent: "attending",
      createdAt: DAY1,
    }));
    ctx.registrationRepo.seed(makeReg({
      id: 1002,
      participationType: "campus_only",
      attendanceIntent: "attending",
      createdAt: DAY1,
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { timeline: Array<{ date: string; count: number; fullCelebration: number; campusOnly: number }> };
    expect(body.timeline).toHaveLength(1);
    const entry = body.timeline[0];
    expect(entry.fullCelebration).toBe(1);
    expect(entry.campusOnly).toBe(1);
    expect(entry.count).toBe(2);
    // Invariant: count = fullCelebration + campusOnly (when no other types)
    expect(entry.count).toBe(entry.fullCelebration + entry.campusOnly);
  });

  it("B10: donation_only registrations excluded from timeline", async () => {
    // Catches: timeline counting donation_only attendees when it should exclude them
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      participationType: "full_celebration",
      attendanceIntent: "attending",
      createdAt: DAY1,
    }));
    ctx.registrationRepo.seed(makeReg({
      id: 1002,
      participationType: "donation_only",
      attendanceIntent: "donation_only", // excluded by type:'attendee' filter
      createdAt: DAY1,
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { timeline: Array<{ count: number; fullCelebration: number }> };
    // Only 1 entry (1 day), count=1 (only the attendee)
    expect(body.timeline).toHaveLength(1);
    expect(body.timeline[0].count).toBe(1);
    expect(body.timeline[0].fullCelebration).toBe(1);
  });

  it("fullCelebration and campusOnly are 0 for days with no entries of that type", async () => {
    // Catches: fields being undefined/null instead of 0 on a day with only one type
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      participationType: "full_celebration",
      attendanceIntent: "attending",
      createdAt: DAY1,
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { timeline: Array<{ fullCelebration: number; campusOnly: number }> };
    expect(body.timeline[0].campusOnly).toBe(0);
    expect(body.timeline[0].fullCelebration).toBe(1);
  });

  it("multi-day timeline: each day has independent fullCelebration + campusOnly counts", async () => {
    // Day 1: 2 full, 1 campus. Day 2: 1 campus.
    ctx.registrationRepo.seed(makeReg({ id: 1001, participationType: "full_celebration", attendanceIntent: "attending", createdAt: DAY1 }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, participationType: "full_celebration", attendanceIntent: "attending", createdAt: DAY1 }));
    ctx.registrationRepo.seed(makeReg({ id: 1003, participationType: "campus_only", attendanceIntent: "attending", createdAt: DAY1 }));
    ctx.registrationRepo.seed(makeReg({ id: 1004, participationType: "campus_only", attendanceIntent: "attending", createdAt: DAY2 }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { timeline: Array<{ date: string; count: number; fullCelebration: number; campusOnly: number }> };
    expect(body.timeline).toHaveLength(2);

    const day1 = body.timeline.find((e) => e.date === "2026-06-01");
    const day2 = body.timeline.find((e) => e.date === "2026-06-02");
    expect(day1).toBeDefined();
    expect(day1!.count).toBe(3);
    expect(day1!.fullCelebration).toBe(2);
    expect(day1!.campusOnly).toBe(1);
    expect(day2).toBeDefined();
    expect(day2!.count).toBe(1);
    expect(day2!.fullCelebration).toBe(0);
    expect(day2!.campusOnly).toBe(1);
  });

  it("timeline count still reflects back-compat total (existing chart views unaffected)", async () => {
    // Catches: count field being replaced by fullCelebration or otherwise changed
    ctx.registrationRepo.seed(makeReg({ id: 1001, participationType: "full_celebration", attendanceIntent: "attending", createdAt: DAY1 }));
    ctx.registrationRepo.seed(makeReg({ id: 1002, participationType: "campus_only", attendanceIntent: "attending", createdAt: DAY1 }));
    ctx.registrationRepo.seed(makeReg({ id: 1003, participationType: "full_celebration", attendanceIntent: "attending", createdAt: DAY2 }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { timeline: Array<{ date: string; count: number }> };
    // count must equal total registrations that day (regardless of type split)
    const day1 = body.timeline.find((e) => e.date === "2026-06-01");
    const day2 = body.timeline.find((e) => e.date === "2026-06-02");
    expect(day1!.count).toBe(2);
    expect(day2!.count).toBe(1);
  });
});

// =============================================================================
// budgetProgress — event/accommodation actual-vs-target (server slice: budget progress)
// =============================================================================

describe("GET /api/staff/reports — budgetProgress", () => {
  let ctx: TestCtx;
  let token: string;

  beforeEach(async () => {
    ctx = createTestApp();
    token = await staffJwt();
  });

  it("event.actual + accommodation.actual equals revenue.expected (exact split invariant) across a mix of accommodation types", async () => {
    // Catches: splitPricingBreakup double-counting or dropping amounts across
    // registrations with different accommodation setups (none/private/shared).
    ctx.registrationRepo.seed(makeReg({
      id: 1001,
      accommodation: "none",
      pricingSnapshot: { base: 8500, lines: [], donation: 0, collegeContribution: 1000, total: 8500 },
      totalAmount: 8500,
    }));
    ctx.registrationRepo.seed(makeReg({
      id: 1002,
      accommodation: "private",
      pricingSnapshot: {
        base: 8500,
        lines: [
          { label: "Accommodation — Private · 2 nights", fee: 24000, free: false, category: "accommodation" },
          { label: "GST (18%) — accommodation", fee: 4320, free: false, category: "accommodation" },
        ],
        donation: 0,
        collegeContribution: 1000,
        total: 36820,
      },
      totalAmount: 36820,
    }));
    ctx.registrationRepo.seed(makeReg({
      id: 1003,
      accommodation: "shared_double",
      pricingSnapshot: {
        base: 5500,
        lines: [
          { label: "Accommodation — Shared Double · 1 night", fee: 3000, free: false, category: "accommodation" },
          { label: "GST (18%) — accommodation", fee: 540, free: false, category: "accommodation" },
        ],
        donation: 0,
        collegeContribution: 1000,
        total: 9040,
      },
      totalAmount: 9040,
    }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      revenue: { expected: number };
      budgetProgress: { event: { actual: number }; accommodation: { actual: number } };
    };

    expect(body.budgetProgress.event.actual + body.budgetProgress.accommodation.actual).toBe(body.revenue.expected);
    // Sanity: accommodation actual reflects the two accommodated registrations' tagged lines.
    expect(body.budgetProgress.accommodation.actual).toBe(24000 + 4320 + 3000 + 540);
  });

  it("accommodation.target matches the room-inventory formula given seeded inventory", async () => {
    // totalRoomNights = 10 + 6 = 16; target = round(16 * 12000 * 1.18)
    ctx.inventoryRepo.seed({ "2026-08-14": 10, "2026-08-15": 6 });
    ctx.registrationRepo.seed(makeReg({ id: 1001 }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { budgetProgress: { accommodation: { target: number } } };

    const expectedTarget = Math.round(16 * 12000 * 1.18);
    expect(body.budgetProgress.accommodation.target).toBe(expectedTarget);
  });

  it("event.target is the static EVENT_GOALS.eventBudgetTarget (2300000)", async () => {
    ctx.registrationRepo.seed(makeReg({ id: 1001 }));

    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { budgetProgress: { event: { target: number } } };

    expect(body.budgetProgress.event.target).toBe(2300000);
  });

  it("zero registrations and no inventory configured: actuals are 0 and accommodation.target is 0, no throw", async () => {
    const res = await ctx.req("/api/staff/reports", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      budgetProgress: {
        event: { actual: number; target: number };
        accommodation: { actual: number; target: number };
      };
    };

    expect(body.budgetProgress.event.actual).toBe(0);
    expect(body.budgetProgress.accommodation.actual).toBe(0);
    expect(body.budgetProgress.accommodation.target).toBe(0);
    expect(body.budgetProgress.event.target).toBe(2300000);
  });
});
