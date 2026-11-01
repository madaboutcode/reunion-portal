/**
 * Route-level tests for `requireScope` scope enforcement (access-control spec
 * R3.2 cache TTL, R3.4 closed scope set, R3.5 fail-closed, R4.4 caching).
 *
 * DEDICATED FILE (RBAC cycle slice t9). Deliberately NOT added to
 * auth-roles.test.ts — that file is contended (t1 + tfix both landed there).
 * t1 already landed six fail-closed cases in auth-roles.test.ts
 * ("requireScope fail-closed on missing/malformed data"): deleted-user 403,
 * malformed-JSON 403, admin bypass ×2, cache-holds-[], and the NULL-permissions
 * regression pin. This file does NOT duplicate those; it covers what t1 did not:
 *   - null-permissions grants EVERY wired scope (cross-scope pass)          [case 1]
 *   - scoped user pass/fail MATRIX across every wired scope                 [case 2]
 *   - admin bypass with an empty-BUT-PRESENT scopes array (`{"scopes":[]}`) [case 3]
 *   - cache TTL semantics: a permission change is not seen until the cache
 *     is cleared, and the second read is served from cache (no re-query)    [case 4]
 * plus a registration-validation regression (Munshi, from the tfix R19 finding):
 *   - a donation-only submission missing ONLY the amount is rejected FOR the
 *     missing amount, not for meal/tshirt                                   [item 4]
 *
 * SCOPE MAP DERIVED FROM CODE, not the task file's assumed table. The task
 * assumed `admin-tools -> /api/staff/regenerate-thumbnails`, but as wired TODAY
 * that route is guarded by requireScope('dashboard') and 'admin-tools' is NOT in
 * VALID_SCOPES (admin.routes.ts). The `admin-tools` scope is intentionally
 * omitted here and reported as a finding; this map MUST be updated when the
 * admin-tools slices (t5/t6/t10) land and rewire those routes.
 *
 * Uses the Hono test-client pattern with in-memory fakes and a swappable
 * per-request env whose `DB` answers requireScope's `SELECT permissions` query.
 * Handlers reach past the scope gate to real (in-memory) repos, so a PASS is a
 * genuine 200, not merely "not a 403".
 *
 * @module require-scope.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env } from "../env.js";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { handleError } from "../middleware/error.middleware.js";
import { signToken } from "../infra/jwt.js";
import { staffRoutes } from "../routes/staff.routes.js";
import { allocationRoutes } from "../routes/allocation.routes.js";
import { bankTransactionRoutes } from "../routes/bank-transaction.routes.js";
import { createEmptyTshirtRepo, createEmptyChargeRepo } from "./helpers/fake-tshirt-charge-repos.js";
import { registrationSchema } from "@smriti/shared";
import type {
  IRegistrationRepository,
  IAttendeeRepository,
  IPaymentRepository,
  IDocumentRepository,
  IInventoryRepository,
  IBankTransactionRepository,
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
} from "../domain/types.js";
import type { RegistrationStatus, PaymentStatus } from "../domain/status.js";
import type { PricingBreakup } from "@smriti/shared";
import type { RegistrationInsertSet } from "../domain/registration-insert-set.js";

const TEST_JWT_SECRET = "test-secret-key-for-require-scope-tests-32chars!";

// =============================================================================
// Code-derived scope -> representative endpoint map (as wired TODAY).
// See the module docstring + t9-scopemap.txt for the file:line derivation and
// the mismatch list versus the task file's assumed map.
// =============================================================================

const SCOPE_ENDPOINTS: Record<string, string> = {
  dashboard: "/api/staff/dashboard", // staff.routes: requireScope('dashboard')
  resources: "/api/staff/resources", // staff.routes: requireScope('resources')
  reports: "/api/staff/reports", // staff.routes: requireScope('reports')
  allocation: "/api/staff/allocation/registrations", // allocation.routes: router-level requireScope('allocation')
  bank_txns: "/api/staff/bank-transactions", // bank-transaction.routes: router-level requireScope('bank_txns')
  // admin-tools: NOT WIRED — absent from VALID_SCOPES; regenerate-thumbnails is
  // on requireScope('dashboard') today. Add when t5/t6/t10 land. (reported finding)
};

const WIRED_SCOPES = Object.keys(SCOPE_ENDPOINTS);

// =============================================================================
// In-memory repositories (satisfy the real interfaces so handlers reached past
// the scope gate return genuine 200s). Trimmed to the repos the guarded GET
// endpoints touch: registration, attendee, payment, inventory, bank.
// =============================================================================

class InMemoryRegistrationRepo implements IRegistrationRepository {
  private registrations: Map<number, Registration> = new Map();
  private nextId = 1001;

  companionAttendeeRepo?: IAttendeeRepository & { replaceForRegistration(id: number, attendees: NewAttendee[]): Promise<void> };
  companionPaymentRepo?: IPaymentRepository;
  companionDocumentRepo?: IDocumentRepository;

  seed(reg: Registration): void {
    this.registrations.set(reg.id, reg);
  }

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
    if (reg) {
      reg.status = status;
      reg.updatedAt = Date.now();
    }
  }

  async update(id: number, data: RegistrationUpdate, _attendees?: NewAttendee[]): Promise<void> {
    const reg = this.registrations.get(id);
    if (!reg) return;
    if (data.full_name !== undefined) reg.fullName = data.full_name;
    if (data.email !== undefined) reg.email = data.email;
    reg.updatedAt = Date.now();
  }

  async list(filters?: RegistrationFilters): Promise<Registration[]> {
    let regs = [...this.registrations.values()];
    if (filters?.status) regs = regs.filter((r) => r.status === filters.status);
    if (filters?.branch) regs = regs.filter((r) => r.branch === filters.branch);
    return regs;
  }

  async count(filters?: RegistrationFilters): Promise<number> {
    const all = await this.list(filters);
    return all.length;
  }

  async countByStatus(filters?: { type?: "attendee" | "donor" }): Promise<{ pending: number; pendingVerification: number; confirmed: number }> {
    let regs = [...this.registrations.values()];
    if (filters?.type === "attendee") regs = regs.filter((r) => r.attendanceIntent !== "donation_only");
    else if (filters?.type === "donor") regs = regs.filter((r) => r.attendanceIntent === "donation_only");
    let pending = 0, pendingVerification = 0, confirmed = 0;
    for (const r of regs) {
      if (r.status === "pending") pending++;
      else if (r.status === "pending_verification") pendingVerification++;
      else if (r.status === "confirmed") confirmed++;
    }
    return { pending, pendingVerification, confirmed };
  }

  async countByParticipationAndStatus(): Promise<Record<
    "full_celebration" | "campus_only" | "donation_only",
    { total: number; confirmed: number; pending: number; pendingVerification: number }
  >> {
    const zero = () => ({ total: 0, confirmed: 0, pending: 0, pendingVerification: 0 });
    return { full_celebration: zero(), campus_only: zero(), donation_only: zero() };
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
  async updateWithLock(_id: number, _data: RegistrationUpdate, _expectedUpdatedAt: number, _attendees?: NewAttendee[]): Promise<void> {}
}

class InMemoryAttendeeRepo implements IAttendeeRepository {
  private attendees: Map<number, Attendee[]> = new Map();

  async findByRegistration(registrationId: number): Promise<Attendee[]> {
    return this.attendees.get(registrationId) ?? [];
  }

  async replaceForRegistration(registrationId: number, newAttendees: NewAttendee[]): Promise<void> {
    const converted: Attendee[] = newAttendees.map((na, i) => ({
      id: i + 1,
      registrationId,
      type: na.type,
      name: na.name,
      age: na.age,
      relationship: na.relationship,
      meal: na.meal,
      isChargeable: na.is_chargeable !== 0,
      createdAt: Date.now(),
    }));
    this.attendees.set(registrationId, converted);
  }

  async countGrouped(_filters?: { statuses?: string[]; branch?: string }): Promise<Array<{ type: string; meal: string; count: number }>> {
    return [];
  }
  async accommodationByNight(_f?: { statuses?: string[]; branch?: string }): Promise<Record<string, { private: number; privateByGender: { male: number; female: number; other: number }; shared_double: { count: number; rooms: number }; shared_doubleByGender: { male: number; female: number; other: number }; shared_triple: { count: number; rooms: number }; shared_tripleByGender: { male: number; female: number; other: number }; extraBeds: number }>> {
    return {};
  }
  async mealsByParticipationType(_f?: { statuses?: string[]; branch?: string }): Promise<{ campusDayCaterer: { headcount: number; veg: number; nonVeg: number }; ravizBanquet: { headcount: number; veg: number; nonVeg: number } }> {
    return { campusDayCaterer: { headcount: 0, veg: 0, nonVeg: 0 }, ravizBanquet: { headcount: 0, veg: 0, nonVeg: 0 } };
  }
  async childrenByAgeBand(_f?: { statuses?: string[]; branch?: string }): Promise<{ under6: number; age6to12: number; age12plus: number }> {
    return { under6: 0, age6to12: 0, age12plus: 0 };
  }
}

class InMemoryPaymentRepo implements IPaymentRepository {
  payments: Map<number, Payment> = new Map();
  private nextId = 1;

  async create(payment: NewPayment): Promise<{ id: number }> {
    const id = this.nextId++;
    const now = Date.now();
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
      createdAt: now,
      updatedAt: now,
    });
    return { id };
  }

  async findById(id: number): Promise<Payment | null> {
    return this.payments.get(id) ?? null;
  }

  async findByRegistration(registrationId: number): Promise<Payment[]> {
    return [...this.payments.values()].filter((p) => p.registrationId === registrationId);
  }

  async updateStatus(id: number, status: PaymentStatus, gatewayData?: GatewayData, proofFileKey?: string, verification?: { verifiedBy: string; verifiedAt: number }): Promise<void> {
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

  async sumVerified(_filters?: { type?: "attendee" | "donor" }): Promise<number> {
    return 0;
  }
  async sumVerifiedByBranch(_filters?: { type?: "attendee" | "donor" }): Promise<Array<{ branch: string; collected: number }>> {
    return [];
  }
  async verify(id: number, amount: number, gatewayRef: string, verifiedBy: string, verifiedAt: number): Promise<void> {
    const p = this.payments.get(id);
    if (!p) return;
    this.payments.set(id, { ...p, status: "verified", amount, gatewayRef, verifiedBy, verifiedAt, updatedAt: Date.now() });
  }
  async settleAtDesk(): Promise<void> {}
  async findPendingByRegistration(_registrationId: number): Promise<Payment | null> { return null; }
  async deletePending(_paymentId: number): Promise<void> {}
  async updatePendingAmount(_paymentId: number, _newAmount: number): Promise<void> {}
  async sumVerifiedByRegistration(_registrationId: number): Promise<number> { return 0; }
}

class StubInventoryRepo implements IInventoryRepository {
  async get(): Promise<Record<string, number>> { return {}; }
  async set(_inventory: Record<string, number>): Promise<void> {}
}

class StubBankTransactionRepo implements IBankTransactionRepository {
  async importBatch(): Promise<{ inserted: number; skipped: number }> { return { inserted: 0, skipped: 0 }; }
  async list(): Promise<{ transactions: never[]; total: number }> { return { transactions: [], total: 0 }; }
  async getById(): Promise<null> { return null; }
  async updateComment(): Promise<void> {}
  async linkPayment(): Promise<void> {}
  async unlinkPayment(): Promise<void> {}
  async summary(): Promise<{ totalCreditPaise: number; totalDebitPaise: number; latestBalancePaise: number; transactionCount: number }> {
    return { totalCreditPaise: 0, totalDebitPaise: 0, latestBalancePaise: 0, transactionCount: 0 };
  }
}

// =============================================================================
// Swappable DB fake for requireScope's `SELECT permissions FROM users WHERE id`.
// Distinguishes a MISSING row (deleted user) from a row with NULL permissions,
// answers allocation's `.all()` reads with an empty result set, exposes a
// mutable permissions map (cache-TTL test) and a query counter (cache-hit proof).
// =============================================================================

function makeScopeDb(rows: Record<number, string | null> = {}) {
  const table = new Map<number, string | null>(
    Object.entries(rows).map(([id, p]) => [Number(id), p]),
  );
  let queries = 0;

  const statement = (sql: string, args: unknown[]) => ({
    async first<T>(): Promise<T | null> {
      if (sql.includes("SELECT permissions FROM users")) {
        queries++;
        const id = args[0] as number;
        if (!table.has(id)) return null; // no users row — deleted user (R3.5)
        return { permissions: table.get(id) ?? null } as T;
      }
      return null;
    },
    async all<T>(): Promise<{ results: T[] }> {
      return { results: [] };
    },
    async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
      return { meta: { last_row_id: 0, changes: 0 } };
    },
  });

  const db = {
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => statement(sql, args),
        ...statement(sql, []),
      };
    },
  };

  return {
    db,
    setPerms(id: number, permissions: string | null) { table.set(id, permissions); },
    queryCount: () => queries,
  };
}

function envWith(db: unknown): Env {
  return { JWT_SECRET: TEST_JWT_SECRET, DB: db } as unknown as Env;
}

// =============================================================================
// Test app: mounts the REAL staff / allocation / bank-transaction routers with
// minimal DI, in the same order as app.ts. Requests carry a per-call env so the
// scope DB is swappable.
// =============================================================================

function createScopeApp(): Hono<AppEnv> {
  _scopeCache.clear();

  const registrationRepo = new InMemoryRegistrationRepo();
  const attendeeRepo = new InMemoryAttendeeRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const inventoryRepo = new StubInventoryRepo();
  const bankTransactionRepo = new StubBankTransactionRepo();

  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);

  app.use("*", async (c, next) => {
    c.set("registrationRepo", registrationRepo);
    c.set("attendeeRepo", attendeeRepo);
    c.set("paymentRepo", paymentRepo);
    c.set("inventoryRepo", inventoryRepo);
    c.set("bankTransactionRepo", bankTransactionRepo);
    c.set("tshirtRepo", createEmptyTshirtRepo());
    c.set("chargeRepo", createEmptyChargeRepo());
    await next();
  });

  // Mount order mirrors app.ts (allocation before the broader /staff mount).
  app.route("/staff/allocation", allocationRoutes);
  app.route("/staff", staffRoutes);
  app.route("/staff/bank-transactions", bankTransactionRoutes);

  return app;
}

async function staffToken(userId: number, email = "staff@example.test"): Promise<string> {
  return signToken({ sub: String(userId), role: "staff", email }, TEST_JWT_SECRET, "7d");
}

async function adminToken(userId: number, email = "admin@example.test"): Promise<string> {
  return signToken({ sub: String(userId), role: "admin", email }, TEST_JWT_SECRET, "7d");
}

/** True iff the response is the scope gate's denial (403 Insufficient permissions). */
async function scopeDenied(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  const body = (await res.clone().json()) as { error?: string };
  return body.error === "Insufficient permissions";
}

// =============================================================================
// Tests
// =============================================================================

describe("requireScope — scope enforcement through real routes (R3.2/R3.4/R3.5/R4.4)", () => {
  let app: Hono<AppEnv>;

  beforeEach(() => {
    app = createScopeApp();
  });

  // ── Case 1 — null permissions grants EVERY wired scope ─────────────────────
  describe("case 1: null permissions → all scopes pass", () => {
    it("a null-permissions staff user reaches every scoped endpoint (200)", async () => {
      const userId = 10;
      const { db } = makeScopeDb({ [userId]: null });
      const token = await staffToken(userId);

      for (const scope of WIRED_SCOPES) {
        _scopeCache.clear();
        const res = await app.request(
          SCOPE_ENDPOINTS[scope],
          { headers: { Authorization: `Bearer ${token}` } },
          envWith(db),
        );
        expect(res.status, `null-perms user must PASS scope '${scope}' at ${SCOPE_ENDPOINTS[scope]}`).toBe(200);
      }
    });
  });

  // ── Case 2 — scoped user pass/fail matrix ──────────────────────────────────
  describe("case 2: scoped user passes only its listed scope, denied the others", () => {
    it.each(WIRED_SCOPES)("scopes:['%s'] → 200 on its own endpoint, 403 on every other", async (owned) => {
      const userId = 20;
      const { db } = makeScopeDb({ [userId]: JSON.stringify({ scopes: [owned] }) });
      const token = await staffToken(userId);

      for (const target of WIRED_SCOPES) {
        _scopeCache.clear();
        const res = await app.request(
          SCOPE_ENDPOINTS[target],
          { headers: { Authorization: `Bearer ${token}` } },
          envWith(db),
        );
        if (target === owned) {
          expect(await scopeDenied(res), `scope '${owned}' must PASS its own endpoint`).toBe(false);
          expect(res.status, `scope '${owned}' own endpoint should be 200`).toBe(200);
        } else {
          expect(res.status, `scope '${owned}' must be DENIED at '${target}' endpoint`).toBe(403);
          expect(await scopeDenied(res), `denial at '${target}' must be the scope gate`).toBe(true);
        }
      }
    });

    it("a user with no scopes ('{\"scopes\":[]}') is denied every wired scope", async () => {
      const userId = 21;
      const { db } = makeScopeDb({ [userId]: JSON.stringify({ scopes: [] }) });
      const token = await staffToken(userId);

      for (const target of WIRED_SCOPES) {
        _scopeCache.clear();
        const res = await app.request(
          SCOPE_ENDPOINTS[target],
          { headers: { Authorization: `Bearer ${token}` } },
          envWith(db),
        );
        expect(res.status, `empty-scopes user must be denied at '${target}'`).toBe(403);
        expect(await scopeDenied(res)).toBe(true);
      }
    });
  });

  // ── Case 3 — admin bypass with empty-but-present scopes ─────────────────────
  describe("case 3: admin bypasses scope even with an empty scopes array", () => {
    it("admin with '{\"scopes\":[]}' passes every wired scope and never queries the DB", async () => {
      const userId = 99;
      const { db, queryCount } = makeScopeDb({ [userId]: JSON.stringify({ scopes: [] }) });
      const token = await adminToken(userId);

      for (const target of WIRED_SCOPES) {
        _scopeCache.clear();
        const res = await app.request(
          SCOPE_ENDPOINTS[target],
          { headers: { Authorization: `Bearer ${token}` } },
          envWith(db),
        );
        expect(res.status, `admin must bypass scope '${target}'`).toBe(200);
      }
      // Admin short-circuits before resolveScopes — the users table is never read.
      expect(queryCount(), "admin bypass must not trigger a scope DB lookup").toBe(0);
    });
  });

  // ── Case 4 — cache TTL semantics ───────────────────────────────────────────
  describe("case 4: cache reflects updated permissions only after clear (R3.2, R4.4)", () => {
    it("a permission downgrade is not seen until the cache is cleared; the second read is served from cache", async () => {
      const userId = 30;
      const { db, setPerms, queryCount } = makeScopeDb({ [userId]: null });
      const token = await staffToken(userId);
      const headers = { Authorization: `Bearer ${token}` };

      // 1st request: null perms → pass; the resolution (null) is cached.
      const res1 = await app.request("/api/staff/dashboard", { headers }, envWith(db));
      expect(res1.status).toBe(200);
      expect(queryCount(), "first request reads the DB once").toBe(1);

      // Downgrade permissions in the backing DB to deny everything.
      setPerms(userId, JSON.stringify({ scopes: [] }));

      // 2nd request WITHOUT clearing the cache: still passes on the cached
      // null value and does NOT re-query the DB within the 5-minute TTL (R4.4).
      const res2 = await app.request("/api/staff/dashboard", { headers }, envWith(db));
      expect(res2.status, "downgrade is invisible until the cache is cleared").toBe(200);
      expect(queryCount(), "second request is served from cache — no new DB read").toBe(1);

      // Clear the cache → the next request re-reads and now sees empty scopes → 403.
      _scopeCache.clear();
      const res3 = await app.request("/api/staff/dashboard", { headers }, envWith(db));
      expect(res3.status).toBe(403);
      expect(await scopeDenied(res3)).toBe(true);
      expect(queryCount(), "after clear, the DB is read again").toBe(2);
    });
  });

  // ── Item 4 — donation-only missing-amount validation (tfix R19) ────────────
  describe("registration validation: donation-only missing amount (tfix R19 regression)", () => {
    it("rejects a donation-only submission for the MISSING AMOUNT specifically, not for meal/tshirt", () => {
      // A donation-only submission that is valid in every other respect: no
      // meal/tshirt (correctly omitted for donation-only), no other invalid
      // fields, and NO donation amount. The sole failure must be the donation.
      const submission = {
        contact: {
          fullName: "Donor Test",
          branch: "Mechanical Engineering",
          gender: "male" as const,
          email: "donor@example.com",
          whatsapp: "+919876543210",
          city: "Kochi",
          country: "India",
        },
        attendance: {
          intent: "donation_only" as const,
          participationType: "donation_only" as const,
          // alumniMeal / tshirtSize deliberately omitted — not applicable here
        },
        attendees: { children: [], guests: [] },
        // accommodation, donation, contributionSplits, idDocument all omitted
      };

      const result = registrationSchema.safeParse(submission);
      expect(result.success, "donation-only submission with no amount must be rejected").toBe(false);
      if (result.success) return;

      const paths = result.error.issues.map((i) => i.path.join("."));
      // Rejected FOR the missing amount:
      expect(paths, "the rejection must cite the missing donation").toContain("donation");
      // NOT rejected for meal/tshirt (the R19 wrong-reason the fixture masked):
      expect(paths.some((p) => p.includes("alumniMeal"))).toBe(false);
      expect(paths.some((p) => p.includes("tshirtSize"))).toBe(false);
    });
  });
});
