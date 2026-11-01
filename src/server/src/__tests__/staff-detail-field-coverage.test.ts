/**
 * Staff detail endpoint field coverage — structural test that every
 * Registration domain field round-trips through GET /staff/registrations/:id.
 *
 * Seeds a fully-populated registration, fetches the detail endpoint, and
 * verifies every domain key appears in the response (under its mapped path)
 * with the correct value. Adding a new column to Registration without wiring
 * it into the API response will fail this test automatically.
 *
 * @module staff-detail-field-coverage.test
 */

import { describe, it, expect } from "vitest";
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
  SystemAuditAction,
} from "../domain/types.js";
import type { RegistrationStatus, PaymentStatus } from "../domain/status.js";
import type { RegistrationInsertSet } from "../domain/registration-insert-set.js";

const TEST_JWT_SECRET = "test-secret-key-for-field-coverage-tests-32!!";
const TEST_ENV = {
  JWT_SECRET: TEST_JWT_SECRET,
  DB: createFakePermissionsDb(),
} as unknown as import("../env.js").Env;

// =============================================================================
// Field mapping: Registration domain key → API response path
//
// Default: top-level key with the same name (e.g., fullName → fullName).
// Override: dot-path for renamed/nested fields.
// null: intentionally excluded from the API response — won't be checked.
//
// When you add a new column to Registration, the test will fail until you
// either wire it into the API response OR add it here with null + a comment.
// =============================================================================

const FIELD_MAP: Record<string, string | null> = {
  // Nested under attendance {}
  attendanceIntent: "attendance.intent",
  participationType: "attendance.participationType",
  alumniMeal: "attendance.mealPreference",
  tshirtSize: "attendance.tshirtSize",

  // Nested under accommodation {} (null when accommodation is "none")
  accommodation: "accommodation.type",
  checkIn: "accommodation.checkIn",
  checkOut: "accommodation.checkOut",
  extraBed: "accommodation.extraBed",
  breakfastAdult: "accommodation.breakfastAdult",
  breakfastChild: "accommodation.breakfastChild",

  // Renamed
  donationAmount: "donation",
  pricingSnapshot: "pricingBreakup",
};

// Value transforms: domain value → expected API value, for fields where the
// API intentionally transforms the stored value.
const VALUE_TRANSFORMS: Record<string, (v: unknown) => unknown> = {
  alumniMeal: (v) => (v === "none" ? null : v),
};

// =============================================================================
// Helpers
// =============================================================================

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce((o: unknown, k: string) => {
    if (o && typeof o === "object" && k in (o as Record<string, unknown>)) {
      return (o as Record<string, unknown>)[k];
    }
    return undefined;
  }, obj);
}

// =============================================================================
// In-memory repos
// =============================================================================

class InMemoryRegistrationRepo implements IRegistrationRepository {
  private registrations: Map<number, Registration> = new Map();
  private nextId = 1001;

  seed(reg: Registration): void {
    this.registrations.set(reg.id, reg);
  }

  async create(_reg: NewRegistration, _att: NewAttendee[]): Promise<{ id: number }> {
    return { id: this.nextId++ };
  }
  async createWithRelations(_s: RegistrationInsertSet): Promise<{ id: number }> {
    return { id: this.nextId++ };
  }
  async findById(id: number): Promise<Registration | null> {
    return this.registrations.get(id) ?? null;
  }
  async findByRegCode(code: string): Promise<Registration | null> {
    for (const r of this.registrations.values()) if (r.regCode === code) return r;
    return null;
  }
  async findByEmail(email: string): Promise<Registration[]> {
    return [...this.registrations.values()].filter((r) => r.email === email);
  }
  async findByWhatsapp(w: string): Promise<Registration[]> {
    return [...this.registrations.values()].filter((r) => r.whatsapp === w);
  }
  async updateStatus(id: number, status: RegistrationStatus): Promise<void> {
    const r = this.registrations.get(id);
    if (r) r.status = status;
  }
  async update(_id: number, _data: RegistrationUpdate, _att?: NewAttendee[]): Promise<void> {}
  async updateWithLock(_id: number, _data: RegistrationUpdate, _expected: number, _att?: NewAttendee[]): Promise<void> {}
  async list(filters?: RegistrationFilters): Promise<Registration[]> {
    const regs = [...this.registrations.values()];
    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? regs.length;
    return regs.slice(offset, offset + limit);
  }
  async count(_f?: RegistrationFilters): Promise<number> { return this.registrations.size; }
  async countByStatus(): Promise<{ pending: number; pendingVerification: number; confirmed: number }> {
    return { pending: 0, pendingVerification: 0, confirmed: 0 };
  }
  async countByParticipationAndStatus(): Promise<Record<string, { total: number; confirmed: number; pending: number; pendingVerification: number }>> {
    return { full_celebration: { total: 0, confirmed: 0, pending: 0, pendingVerification: 0 }, campus_only: { total: 0, confirmed: 0, pending: 0, pendingVerification: 0 }, donation_only: { total: 0, confirmed: 0, pending: 0, pendingVerification: 0 } };
  }
  async geographyAggregates() { return { cities: [], countries: [] }; }
  async donorRecognitionRows(_t: number) { return { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 }; }
  async getContributionAggregates() { return []; }
  async getDonationTotals() { return { count: 0, total: 0 }; }
  async findMissingThumbnails() { return []; }
  async findWithThumbnails() { return []; }
}

class StubAttendeeRepo implements IAttendeeRepository {
  async findByRegistration(_id: number): Promise<Attendee[]> { return []; }
  async replaceForRegistration(_id: number, _att: NewAttendee[]): Promise<void> {}
  async countGrouped() { return []; }
  async accommodationByNight() { return {}; }
  async mealsByParticipationType() { return { campusDayCaterer: { headcount: 0, veg: 0, nonVeg: 0 }, ravizBanquet: { headcount: 0, veg: 0, nonVeg: 0 } }; }
  async childrenByAgeBand() { return { under6: 0, age6to12: 0, age12plus: 0 }; }
}

class StubPaymentRepo implements IPaymentRepository {
  async create(_p: NewPayment): Promise<{ id: number }> { return { id: 1 }; }
  async findById(_id: number): Promise<Payment | null> { return null; }
  async findByRegistration(_id: number): Promise<Payment[]> { return []; }
  async updateStatus(_id: number, _s: PaymentStatus, _g?: GatewayData, _p?: string, _v?: { verifiedBy: string; verifiedAt: number }): Promise<void> {}
  async sumVerified() { return 0; }
  async sumVerifiedByBranch() { return []; }
  async verify() {}
  async settleAtDesk() {}
  async findPendingByRegistration() { return null; }
  async deletePending() {}
  async updatePendingAmount() {}
  async sumVerifiedByRegistration() { return 0; }
}

class StubAuditRepo implements IAuditRepository {
  async append(_e: NewAuditEntry): Promise<void> {}
  async findByRegistration(_id: number): Promise<AuditEntry[]> { return []; }
}

class StubDocumentRepo implements IDocumentRepository {
  async create(_d: NewIdDocument): Promise<{ id: number }> { return { id: 1 }; }
  async findByRegistration(_id: number): Promise<IdDocument[]> { return []; }
  async updateR2Key(_id: number, _key: string): Promise<void> {}
}

class StubFileStorage implements IFileStorage {
  async upload() {}
  async getSignedUrl(_k: string, _e: number): Promise<string> { return ""; }
  async get() { return null; }
  async delete() {}
  async copy() { return true; }
  async move() {}
}

class StubSystemAuditRepo implements ISystemAuditRepository {
  async append(_e: { action: SystemAuditAction; actor: string; targetType?: string; targetId?: number; details?: string }): Promise<void> {}
}

// =============================================================================
// Test app factory
// =============================================================================

function createTestApp() {
  _scopeCache.clear();
  const registrationRepo = new InMemoryRegistrationRepo();
  const attendeeRepo = new StubAttendeeRepo();
  const paymentRepo = new StubPaymentRepo();
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
    c.set("tshirtRepo", createEmptyTshirtRepo());
    c.set("chargeRepo", createEmptyChargeRepo());
    await next();
  });

  app.route("/staff", staffRoutes);

  const req = (input: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(app.request(input, init, TEST_ENV));

  return { req, registrationRepo };
}

async function staffJwt(): Promise<string> {
  return signToken(
    { sub: "10", role: "staff", email: "staff@test.com" },
    TEST_JWT_SECRET,
    "7d",
  );
}

// =============================================================================
// Fully-populated registration — every field non-null / non-default
// =============================================================================

function makeFullReg(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 5001,
    regCode: "SMRT-FULL-COVERAGE",
    status: "confirmed",
    fullName: "Priya Nair",
    branch: "Electrical Engineering",
    email: "priya@example.com",
    whatsapp: "+919812345678",
    mobileAlternate: "+919898989898",
    city: "Bangalore",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    gender: "female",
    tshirtSize: "M",
    alumniMeal: "veg",
    accommodation: "private",
    checkIn: "2026-08-14",
    checkOut: "2026-08-16",
    extraBed: true,
    breakfastAdult: 2,
    breakfastChild: 1,
    donationAmount: 5000,
    publicAck: false,
    ackDisplayName: "Priya N",
    felicitation: true,
    contributionSplits: { green_energy: 3000, campus_beautification: 2000 },
    pricingSnapshot: {
      base: 8500,
      collegeContribution: 5000,
      lines: [{ label: "Test line", fee: 1000, free: false, category: "event" }],
      donation: 5000,
      total: 30000,
    },
    totalAmount: 30000,
    idNote: "Indian passport",
    photoFileKey: "registrations/SMRT-FULL-COVERAGE/photo.jpg",
    photoThumbKey: "registrations/SMRT-FULL-COVERAGE/photo-thumb.jpg",
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("GET /staff/registrations/:id — field coverage", () => {
  it("every Registration domain key appears in the API response", async () => {
    const ctx = createTestApp();
    const token = await staffJwt();
    const seeded = makeFullReg();
    ctx.registrationRepo.seed(seeded);

    const res = await ctx.req("/api/staff/registrations/5001", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    const reg = body.registration;

    const missing: string[] = [];
    const wrong: string[] = [];

    for (const key of Object.keys(seeded) as (keyof Registration)[]) {
      const mapping = FIELD_MAP[key];
      if (mapping === null) continue; // intentionally excluded

      const apiPath = mapping ?? key; // default: same name at top level
      const actual = getPath(reg, apiPath);

      if (actual === undefined) {
        missing.push(`${key} → ${apiPath}`);
        continue;
      }

      let expected: unknown = seeded[key];
      if (VALUE_TRANSFORMS[key]) {
        expected = VALUE_TRANSFORMS[key](expected);
      }

      if (typeof expected === "object" && expected !== null) {
        try {
          expect(actual).toEqual(expected);
        } catch {
          wrong.push(`${key} → ${apiPath}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
      } else if (actual !== expected) {
        wrong.push(`${key} → ${apiPath}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    }

    if (missing.length > 0 || wrong.length > 0) {
      const lines: string[] = [];
      if (missing.length > 0) {
        lines.push("Missing from API response:");
        missing.forEach((m) => lines.push(`  - ${m}`));
      }
      if (wrong.length > 0) {
        lines.push("Value mismatches:");
        wrong.forEach((w) => lines.push(`  - ${w}`));
      }
      lines.push("");
      lines.push("To fix: wire the field into the response in staff.routes.ts,");
      lines.push("or add it to FIELD_MAP with null if intentionally excluded.");
      expect.fail(lines.join("\n"));
    }
  });

  it("null optional fields returned as null (not omitted)", async () => {
    const ctx = createTestApp();
    const token = await staffJwt();
    ctx.registrationRepo.seed(makeFullReg({
      id: 5002,
      gender: null,
      mobileAlternate: null,
      idNote: null,
      ackDisplayName: null,
      photoFileKey: null,
      photoThumbKey: null,
      accommodation: "none",
      checkIn: null,
      checkOut: null,
    }));

    const res = await ctx.req("/api/staff/registrations/5002", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    const reg = body.registration as Record<string, unknown>;

    expect(reg.gender).toBeNull();
    expect(reg.mobileAlternate).toBeNull();
    expect(reg.idNote).toBeNull();
    expect(reg.ackDisplayName).toBeNull();
    expect(reg.photoFileKey).toBeNull();
    expect(reg.photoThumbKey).toBeNull();
    expect(reg.accommodation).toBeNull();
  });

  it("donation-only profile: alumniMeal 'none' → mealPreference null, accommodation null", async () => {
    const ctx = createTestApp();
    const token = await staffJwt();
    ctx.registrationRepo.seed(makeFullReg({
      id: 5003,
      attendanceIntent: "donation_only",
      participationType: "donation_only",
      alumniMeal: "none",
      tshirtSize: null,
      accommodation: "none",
      checkIn: null,
      checkOut: null,
      extraBed: false,
      breakfastAdult: 0,
      breakfastChild: 0,
    }));

    const res = await ctx.req("/api/staff/registrations/5003", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    const reg = body.registration as Record<string, unknown>;
    const attendance = reg.attendance as Record<string, unknown>;

    expect(attendance.mealPreference).toBeNull();
    expect(attendance.tshirtSize).toBeNull();
    expect(attendance.intent).toBe("donation_only");
    expect(attendance.participationType).toBe("donation_only");
    expect(reg.accommodation).toBeNull();
  });
});
