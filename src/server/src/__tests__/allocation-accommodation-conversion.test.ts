/**
 * Route-level tests for PUT /api/allocation/registrations/:id/accommodation
 * (staff-api.spec.md R41, amended 2026-08-03 to quote EditService's real
 * error text for R41.4/R41.5 and to document the inherited capacity guard
 * as R41.5.1 — see docs/decisions/20260803-allocation-scope-upgrade-carveout.md
 * and tasks/2026-08-03-allocation-room-switch/log.md's ESCALATION entry).
 *
 * Two layers of fakes, mirroring the two things the route touches:
 *   - FakeD1 (c.env.DB) — only the route's own pre-delegation guards touch
 *     D1 directly (id lookup + accommodation-direction check). Its query
 *     log is also used to prove the route never touches roommate_preferences
 *     (R41.7 — retention, not re-implemented, not accidentally broken).
 *   - A REAL EditService wired with minimal in-memory repos (c.var.editService)
 *     — the guard order compdes-notes.md specifies delegates everything past
 *     the direction check to EditService, so the happy path's pricing/status/
 *     payment-delta math must run through the real shared pricing engine
 *     (calculateTotal), not be re-derived by the test.
 *
 * QA additions (2026-08-03, spec-test-cases.md):
 *   - TC-CV7: preferences seeded via PUT /preferences, then GET /preferences
 *     after a conversion must still return both rows (R41.7) — the black-box
 *     replacement for the query-log negative below.
 *   - TC-CV8: the conversion's audit entry (audit_log via EditService) carries
 *     registration_id, action "amended", actor = staff email, and parsed
 *     changes.fields = { accommodation: "shared_double" } (R41.6).
 *   - TC-CV9: an allocation-only staff account passes the conversion; the
 *     dashboard-only 403 sits with the route-owned guards.
 *
 * @module allocation-accommodation-conversion.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env } from "../env.js";
import { handleError } from "../middleware/error.middleware.js";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { allocationRoutes } from "../routes/allocation.routes.js";
import { signToken } from "../infra/jwt.js";
import { EditService } from "../services/edit.service.js";
import type {
  Registration,
  RegistrationUpdate,
  Payment,
  NewPayment,
  AuditEntry,
  NewAuditEntry,
  Attendee,
  SystemAuditAction,
} from "../domain/types.js";
import type {
  IRegistrationRepository,
  IPaymentRepository,
  IAttendeeRepository,
  IAuditRepository,
  IEmailService,
  ISystemAuditRepository,
} from "../repositories/interfaces.js";
import type { AvailabilityService } from "../services/availability.service.js";
import { calculateTotal, PRICING_DEFAULTS } from "@smriti/shared";
import type { Registration as SharedRegistration } from "@smriti/shared";
import { toSharedRegistration } from "../domain/to-shared-registration.js";

const TEST_JWT_SECRET = "test-secret-key-for-accommodation-conversion-tests!";

// =============================================================================
// FakeD1 — the route's own pre-delegation queries (id lookup, direction check)
// plus, for TC-CV7, the roommate_preferences flow: PUT /preferences and
// GET /preferences are routed through this same fake, so the conversion's
// retention guarantee is verified black-box (rows seeded over the PUT
// boundary must still come back over the GET boundary after the convert).
// EditService is wired to this same FakeD1 handle, so any preference cleanup
// the production edit path attempted would be observable through the GET.
// =============================================================================

interface RegRow {
  id: number;
  accommodation: string;
  gender?: string | null;
  reg_code?: string;
  full_name?: string;
  branch?: string;
}

interface PrefRow {
  registration_id: number;
  preferred_registration_id: number;
  preference_order: number;
  created_by: number;
  updated_at: number;
}

function norm(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

class FakeD1 {
  registrations = new Map<number, RegRow>();
  preferences: PrefRow[] = [];
  users = new Map<number, { permissions: string | null }>();
  queryLog: string[] = [];

  seedRegistration(row: RegRow): void {
    this.registrations.set(row.id, row);
  }

  seedPreference(row: PrefRow): void {
    this.preferences.push(row);
  }

  seedUser(id: number, permissions: string | null): void {
    this.users.set(id, { permissions });
  }

  prepare(sql: string) {
    const self = this;
    const executable = (args: unknown[]) => ({
      async first<T>(): Promise<T | null> {
        return self.execFirst(sql, args) as T | null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        return { results: self.execAll(sql, args) as T[] };
      },
      async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
        self.execRun(sql, args);
        return { meta: { last_row_id: 0, changes: 0 } };
      },
    });
    return {
      bind(...args: unknown[]) {
        self.queryLog.push(sql);
        return executable(args);
      },
      ...executable([]),
    };
  }

  async batch<T = unknown>(stmts: Array<{ run: () => Promise<T> }>): Promise<T[]> {
    const out: T[] = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }

  private execFirst(sql: string, args: unknown[]): unknown {
    const s = norm(sql);

    if (s.includes("SELECT permissions FROM users")) {
      const id = args[0] as number;
      return this.users.get(id) ?? null;
    }

    if (s.includes("SELECT id, accommodation FROM registrations WHERE id = ?")) {
      const id = args[0] as number;
      const reg = this.registrations.get(id);
      return reg ?? null;
    }

    if (s.includes("SELECT id, accommodation, gender FROM registrations WHERE id = ?")) {
      const id = args[0] as number;
      const reg = this.registrations.get(id);
      return reg ? { id: reg.id, accommodation: reg.accommodation, gender: reg.gender ?? null } : null;
    }

    if (s.includes("SELECT MAX(updated_at) as version FROM roommate_preferences WHERE registration_id = ?")) {
      const id = args[0] as number;
      const rows = this.preferences.filter((p) => p.registration_id === id);
      const version = rows.length === 0 ? null : Math.max(...rows.map((p) => p.updated_at));
      return { version };
    }

    throw new Error(`FakeD1.first: unhandled query: ${s}`);
  }

  private execAll(sql: string, args: unknown[]): unknown[] {
    const s = norm(sql);

    if (s.includes("FROM roommate_preferences rp") && s.includes("JOIN registrations r")) {
      const registrationId = args[0] as number;
      const rows = this.preferences
        .filter((p) => p.registration_id === registrationId)
        .sort((a, b) => a.preference_order - b.preference_order);
      return rows.map((p) => {
        const preferred = this.registrations.get(p.preferred_registration_id);
        const isMutual = this.preferences.some(
          (rp2) =>
            rp2.registration_id === p.preferred_registration_id &&
            rp2.preferred_registration_id === registrationId,
        );
        return {
          preferred_registration_id: p.preferred_registration_id,
          preference_order: p.preference_order,
          reg_code: preferred?.reg_code ?? `SMRT${p.preferred_registration_id}`,
          full_name: preferred?.full_name ?? `Reg ${p.preferred_registration_id}`,
          branch: preferred?.branch ?? "CS",
          gender: preferred?.gender ?? null,
          updated_at: p.updated_at,
          is_mutual: isMutual ? 1 : 0,
        };
      });
    }

    if (s.includes("SELECT id, accommodation, gender FROM registrations WHERE id IN")) {
      const ids = args as number[];
      return ids
        .map((id) => this.registrations.get(id))
        .filter((r): r is RegRow => r !== undefined)
        .map((r) => ({ id: r.id, accommodation: r.accommodation, gender: r.gender ?? null }));
    }

    throw new Error(`FakeD1.all: unhandled query: ${s} args=${JSON.stringify(args)}`);
  }

  private execRun(sql: string, args: unknown[]): void {
    const s = norm(sql);

    if (s.includes("DELETE FROM roommate_preferences WHERE registration_id = ?")) {
      const id = args[0] as number;
      this.preferences = this.preferences.filter((p) => p.registration_id !== id);
      return;
    }

    if (s.includes("INSERT INTO roommate_preferences")) {
      const [registrationId, preferredRegistrationId, preferenceOrder, createdBy, updatedAt] = args as [
        number,
        number,
        number,
        number,
        number,
      ];
      this.preferences.push({
        registration_id: registrationId,
        preferred_registration_id: preferredRegistrationId,
        preference_order: preferenceOrder,
        created_by: createdBy,
        updated_at: updatedAt,
      });
      return;
    }

    throw new Error(`FakeD1.run: unhandled query: ${s}`);
  }
}

function envFor(db: FakeD1): Env {
  return { JWT_SECRET: TEST_JWT_SECRET, DB: db } as unknown as Env;
}

// =============================================================================
// EditService in-memory repos — minimal, implementing only what edit()
// actually calls for an accommodation-only field change (no email change,
// no attendee replacement). Cast `as unknown as I...Repository` rather than
// implementing the full interface, matching this codebase's existing
// stubbing convention (see payment-link.test.ts's stubAvailabilityService).
// =============================================================================

class InMemoryRegistrationRepo {
  regs = new Map<number, Registration>();

  seed(reg: Registration): void {
    this.regs.set(reg.id, reg);
  }

  async findById(id: number): Promise<Registration | null> {
    return this.regs.get(id) ?? null;
  }

  async findByEmail(): Promise<Registration[]> {
    throw new Error("findByEmail should not be called — this endpoint never changes email");
  }

  async updateStatus(id: number, status: Registration["status"]): Promise<void> {
    const reg = this.regs.get(id);
    if (reg) reg.status = status;
  }

  async updateWithLock(
    id: number,
    data: RegistrationUpdate,
    expectedUpdatedAt: number,
  ): Promise<void> {
    const reg = this.regs.get(id);
    if (!reg) throw new Error("Registration not found");
    if (reg.updatedAt !== expectedUpdatedAt) {
      throw new Error("OPTIMISTIC_LOCK_CONFLICT");
    }
    if (data.accommodation !== undefined) reg.accommodation = data.accommodation;
    if (data.total_amount !== undefined) reg.totalAmount = data.total_amount;
    if (data.pricing_snapshot !== undefined) reg.pricingSnapshot = JSON.parse(data.pricing_snapshot);
    reg.updatedAt = Date.now();
  }
}

class InMemoryPaymentRepo {
  payments = new Map<number, Payment>();
  private nextId = 1;

  seed(payment: Payment): void {
    this.payments.set(payment.id, payment);
    this.nextId = Math.max(this.nextId, payment.id + 1);
  }

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

  async findById(id: number): Promise<Payment | null> {
    return this.payments.get(id) ?? null;
  }

  async findByRegistration(registrationId: number): Promise<Payment[]> {
    return [...this.payments.values()].filter((p) => p.registrationId === registrationId);
  }

  async sumVerifiedByRegistration(registrationId: number): Promise<number> {
    return [...this.payments.values()]
      .filter((p) => p.registrationId === registrationId && p.status === "verified")
      .reduce((sum, p) => sum + p.amount, 0);
  }

  async findPendingByRegistration(registrationId: number): Promise<Payment | null> {
    return (
      [...this.payments.values()].find(
        (p) => p.registrationId === registrationId && p.status === "payment_pending",
      ) ?? null
    );
  }

  async deletePending(paymentId: number): Promise<void> {
    const p = this.payments.get(paymentId);
    if (p && p.status === "payment_pending") this.payments.delete(paymentId);
  }

  async updatePendingAmount(paymentId: number, newAmount: number): Promise<void> {
    const p = this.payments.get(paymentId);
    if (p && p.status === "payment_pending") p.amount = newAmount;
  }
}

class InMemoryAttendeeRepo {
  async findByRegistration(): Promise<Attendee[]> {
    return [];
  }
  async replaceForRegistration(): Promise<void> {
    throw new Error("replaceForRegistration should not be called — no attendees in the edit request");
  }
}

class InMemoryAuditRepo {
  entries: NewAuditEntry[] = [];
  async append(entry: NewAuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  async findByRegistration(): Promise<AuditEntry[]> {
    return [];
  }
}

class StubEmailService {
  async sendConfirmation(): Promise<void> {}
  async sendMagicLink(): Promise<void> {}
  async sendPaymentConfirmed(): Promise<void> {}
  async sendPaymentRejected(): Promise<void> {}
  async sendStaffWelcome(): Promise<void> {}
  async sendPaymentLink(): Promise<void> {}
  async sendRevisedPayment(): Promise<void> {}
  async sendAdditionalPayment(): Promise<void> {}
}

// =============================================================================
// Test data
// =============================================================================

function baseSharedRegistration(reg: Registration): SharedRegistration {
  return toSharedRegistration(reg, []);
}

function priceFor(accommodation: Registration["accommodation"], checkIn: string, checkOut: string): number {
  const reg = makeRegistration({ id: 0, accommodation, checkIn, checkOut });
  return calculateTotal(baseSharedRegistration(reg), PRICING_DEFAULTS).total;
}

function makeRegistration(
  overrides: Partial<Registration> & { id: number; checkIn?: string; checkOut?: string },
): Registration {
  const checkIn = overrides.checkIn ?? "2026-08-14";
  const checkOut = overrides.checkOut ?? "2026-08-15";
  return {
    regCode: `SMRT${overrides.id}`,
    status: "confirmed",
    fullName: "Ravi Kumar",
    branch: "CS",
    email: `reg${overrides.id}@example.com`,
    whatsapp: "+919876543210",
    mobileAlternate: null,
    city: "Chennai",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    gender: "male",
    tshirtSize: "M",
    alumniMeal: "veg",
    accommodation: "shared_triple",
    checkIn,
    checkOut,
    extraBed: false,
    breakfastAdult: 0,
    breakfastChild: 0,
    donationAmount: 0,
    publicAck: false,
    ackDisplayName: null,
    felicitation: false,
    contributionSplits: {},
    pricingSnapshot: { base: 0, lines: [], donation: 0, collegeContribution: 0, total: 0 },
    totalAmount: 0,
    idNote: null,
    photoFileKey: null,
    photoThumbKey: null,
    createdAt: Date.now(),
    updatedAt: 1721628000000,
    ...overrides,
  };
}

// =============================================================================
// System audit repo — observable stub. Only the preferences PUT route audits
// via c.var.systemAuditRepo (the conversion's own 'amended' entry goes through
// EditService's auditRepo — see TC-CV8).
// =============================================================================

interface SystemAuditCall {
  action: SystemAuditAction;
  actor: string;
  targetType?: string;
  targetId?: number;
  details?: string;
}

class ObservableSystemAuditRepo implements ISystemAuditRepository {
  calls: SystemAuditCall[] = [];
  async append(entry: SystemAuditCall): Promise<void> {
    this.calls.push(entry);
  }
}

// =============================================================================
// JWT + test app
// =============================================================================

async function staffToken(userId = 10, email = "staff@example.test"): Promise<string> {
  return signToken({ sub: String(userId), role: "staff", email }, TEST_JWT_SECRET, "7d");
}

function createTestApp(opts?: { availabilityService?: AvailabilityService }) {
  const db = new FakeD1();
  const registrationRepo = new InMemoryRegistrationRepo();
  const paymentRepo = new InMemoryPaymentRepo();
  const attendeeRepo = new InMemoryAttendeeRepo();
  const auditRepo = new InMemoryAuditRepo();
  const emailService = new StubEmailService();
  const systemAuditRepo = new ObservableSystemAuditRepo();

  const editService = new EditService({
    db: db as unknown as { prepare(sql: string): { bind(...args: unknown[]): { run(): Promise<unknown> } } },
    registrationRepo: registrationRepo as unknown as IRegistrationRepository,
    paymentRepo: paymentRepo as unknown as IPaymentRepository,
    attendeeRepo: attendeeRepo as unknown as IAttendeeRepository,
    auditRepo: auditRepo as unknown as IAuditRepository,
    emailService: emailService as unknown as IEmailService,
    availabilityService: opts?.availabilityService,
  });

  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);
  app.use("*", async (c, next) => {
    c.set("editService", editService);
    c.set("systemAuditRepo", systemAuditRepo);
    await next();
  });
  app.route("/allocation", allocationRoutes);

  const req = (input: string, init?: RequestInit) => app.request(input, init, envFor(db));

  return { app, db, registrationRepo, paymentRepo, auditRepo, systemAuditRepo, req };
}

async function seedAllocationStaff(db: FakeD1, userId = 10) {
  db.seedUser(userId, null);
}

// =============================================================================
// Tests: guard order (route-owned guards before delegation)
// =============================================================================

describe("PUT /api/allocation/registrations/:id/accommodation — route-owned guards", () => {
  let ctx: ReturnType<typeof createTestApp>;
  let staffJwt: string;

  beforeEach(async () => {
    _scopeCache.clear();
    ctx = createTestApp();
    await seedAllocationStaff(ctx.db);
    staffJwt = await staffToken(10, "staff@example.test");
  });

  it("R41.1: missing accommodationType → 422", async () => {
    const res = await ctx.req("/api/allocation/registrations/1/accommodation", {
      method: "PUT",
      body: JSON.stringify({ updatedAt: 1721628000000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });
    expect(res.status).toBe(422);
  });

  it("R41.1: missing updatedAt → 422", async () => {
    const res = await ctx.req("/api/allocation/registrations/1/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "shared_double" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });
    expect(res.status).toBe(422);
  });

  it("R41.1: unparseable JSON body → 422", async () => {
    const res = await ctx.req("/api/allocation/registrations/1/accommodation", {
      method: "PUT",
      body: "{not json",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });
    expect(res.status).toBe(422);
  });

  it("R41.2: unknown registration id → 404", async () => {
    const res = await ctx.req("/api/allocation/registrations/99999/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "shared_double", updatedAt: 1721628000000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });
    expect(res.status).toBe(404);
  });

  it("R41.3: shared_double → shared_double (already converted) → 422 with the specced body", async () => {
    ctx.db.seedRegistration({ id: 1001, accommodation: "shared_double" });
    const res = await ctx.req("/api/allocation/registrations/1001/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "shared_double", updatedAt: 1721628000000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Only shared_triple to shared_double conversion is allowed");
  });

  it("R41.3: private → shared_double → 422", async () => {
    ctx.db.seedRegistration({ id: 1002, accommodation: "private" });
    const res = await ctx.req("/api/allocation/registrations/1002/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "shared_double", updatedAt: 1721628000000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });
    expect(res.status).toBe(422);
  });

  it("R41.3: shared_triple → private (wrong requested type) → 422", async () => {
    ctx.db.seedRegistration({ id: 1003, accommodation: "shared_triple" });
    const res = await ctx.req("/api/allocation/registrations/1003/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "private", updatedAt: 1721628000000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });
    expect(res.status).toBe(422);
  });

  it("scope enforcement: dashboard-only account gets 403", async () => {
    ctx.db.users.set(10, { permissions: JSON.stringify({ scopes: ["dashboard"] }) });
    ctx.db.seedRegistration({ id: 1004, accommodation: "shared_triple" });
    const res = await ctx.req("/api/allocation/registrations/1004/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "shared_double", updatedAt: 1721628000000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });
    expect(res.status).toBe(403);
  });

  // TC-CV9 (R41, access-control R6) — an allocation-only account (scopes =
  // ["allocation"], not null/full-access) must pass the conversion. The
  // dashboard-only 403 half of the case is the test directly above.
  it("TC-CV9: allocation-only scope passes the conversion", async () => {
    ctx.db.users.set(10, { permissions: JSON.stringify({ scopes: ["allocation"] }) });
    ctx.db.seedRegistration({ id: 1005, accommodation: "shared_triple" });
    ctx.registrationRepo.seed(
      makeRegistration({ id: 1005, accommodation: "shared_triple", updatedAt: 1721628000000 }),
    );
    const res = await ctx.req("/api/allocation/registrations/1005/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "shared_double", updatedAt: 1721628000000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// Tests: delegated guards (EditService's own 409s, passed through verbatim)
// =============================================================================

describe("PUT /api/allocation/registrations/:id/accommodation — delegated guards (R41.4/R41.5/R41.5.1)", () => {
  let ctx: ReturnType<typeof createTestApp>;
  let staffJwt: string;

  beforeEach(async () => {
    _scopeCache.clear();
    staffJwt = await staffToken(10, "staff@example.test");
  });

  it("R41.4: stale updatedAt → 409 with EditService's exact pass-through text", async () => {
    ctx = createTestApp();
    await seedAllocationStaff(ctx.db);
    const reg = makeRegistration({ id: 2001, accommodation: "shared_triple", updatedAt: 1721628000000 });
    ctx.registrationRepo.seed(reg);
    ctx.db.seedRegistration({ id: 2001, accommodation: "shared_triple" });

    const res = await ctx.req("/api/allocation/registrations/2001/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "shared_double", updatedAt: 1721627999999 }), // stale
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Registration was modified by another request. Please reload and try again.");
  });

  it("R41.5: pending_verification payment → 409 with EditService's exact pass-through text", async () => {
    ctx = createTestApp();
    await seedAllocationStaff(ctx.db);
    const reg = makeRegistration({
      id: 2002,
      accommodation: "shared_triple",
      updatedAt: 1721628000000,
      status: "pending_verification",
    });
    ctx.registrationRepo.seed(reg);
    ctx.db.seedRegistration({ id: 2002, accommodation: "shared_triple" });
    ctx.paymentRepo.seed({
      id: 1,
      registrationId: 2002,
      amount: 4500,
      status: "pending_verification",
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
    });

    const res = await ctx.req("/api/allocation/registrations/2002/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "shared_double", updatedAt: 1721628000000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(
      "Cannot make cost-affecting changes while a payment is awaiting verification. Verify or reject the pending payment first.",
    );
  });

  it("R41.5.1: shared_double inventory at capacity → 409, nothing changes", async () => {
    const fullAvailability = {
      isAccommodationAvailable: async () => false,
    } as unknown as AvailabilityService;
    ctx = createTestApp({ availabilityService: fullAvailability });
    await seedAllocationStaff(ctx.db);
    const reg = makeRegistration({ id: 2003, accommodation: "shared_triple", updatedAt: 1721628000000 });
    ctx.registrationRepo.seed(reg);
    ctx.db.seedRegistration({ id: 2003, accommodation: "shared_triple" });

    const res = await ctx.req("/api/allocation/registrations/2003/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "shared_double", updatedAt: 1721628000000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Cannot upgrade accommodation — rooms at capacity");

    // Nothing changed.
    const stored = await ctx.registrationRepo.findById(2003);
    expect(stored?.accommodation).toBe("shared_triple");
  });
});

// =============================================================================
// Tests: happy path (R41.6, R41.8) — pricing asserted against calculateTotal
// =============================================================================

describe("PUT /api/allocation/registrations/:id/accommodation — happy path", () => {
  it("confirmed shared_triple, 2 nights → shared_double, status pending, pendingAmount from calculateTotal, response has exactly 4 fields", async () => {
    _scopeCache.clear();
    const ctx = createTestApp();
    await seedAllocationStaff(ctx.db);
    const staffJwt = await staffToken(10, "staff@example.test");

    const checkIn = "2026-08-14";
    const checkOut = "2026-08-16"; // 2 nights
    const tripleTotal = priceFor("shared_triple", checkIn, checkOut);
    const doubleTotal = priceFor("shared_double", checkIn, checkOut);
    expect(doubleTotal).toBeGreaterThan(tripleTotal); // sanity: upgrade costs more

    const reg = makeRegistration({
      id: 3001,
      accommodation: "shared_triple",
      checkIn,
      checkOut,
      status: "confirmed",
      totalAmount: tripleTotal,
      updatedAt: 1721628000000,
    });
    ctx.registrationRepo.seed(reg);
    ctx.db.seedRegistration({ id: 3001, accommodation: "shared_triple" });
    ctx.paymentRepo.seed({
      id: 1,
      registrationId: 3001,
      amount: tripleTotal,
      status: "verified",
      gateway: null,
      gatewayRef: null,
      gatewayResponse: null,
      proofFileKey: null,
      verifiedBy: "staff@example.test",
      verifiedAt: Date.now(),
      method: null,
      note: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await ctx.req("/api/allocation/registrations/3001/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "shared_double", updatedAt: 1721628000000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accommodationType: string;
      status: string;
      pendingAmount: number | null;
      updatedAt: number;
    };

    expect(Object.keys(body).sort()).toEqual(["accommodationType", "pendingAmount", "status", "updatedAt"].sort());
    expect(body.accommodationType).toBe("shared_double");
    expect(body.status).toBe("pending");
    // Asserted against calculateTotal's own output, not a hardcoded constant.
    expect(body.pendingAmount).toBe(doubleTotal - tripleTotal);
    expect(body.updatedAt).not.toBe(1721628000000);

    // Persisted state actually reflects the conversion.
    const stored = await ctx.registrationRepo.findById(3001);
    expect(stored?.accommodation).toBe("shared_double");
    expect(stored?.totalAmount).toBe(doubleTotal);

    // A payment_pending row for exactly the delta now exists.
    const payments = await ctx.paymentRepo.findByRegistration(3001);
    const pending = payments.find((p) => p.status === "payment_pending");
    expect(pending?.amount).toBe(doubleTotal - tripleTotal);

    // Audited.
    expect(ctx.auditRepo.entries.some((e) => e.action === "amended")).toBe(true);
  });

  it("R41.7: roommate_preferences is never touched by the route (retention — not re-implemented, not broken)", async () => {
    _scopeCache.clear();
    const ctx = createTestApp();
    await seedAllocationStaff(ctx.db);
    const staffJwt = await staffToken(10, "staff@example.test");

    const reg = makeRegistration({ id: 3002, accommodation: "shared_triple", updatedAt: 1721628000000 });
    ctx.registrationRepo.seed(reg);
    ctx.db.seedRegistration({ id: 3002, accommodation: "shared_triple" });

    const res = await ctx.req("/api/allocation/registrations/3002/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "shared_double", updatedAt: 1721628000000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(200);
    expect(ctx.db.queryLog.some((q) => q.includes("roommate_preferences"))).toBe(false);
  });

  // TC-CV7 (R41.7) — black-box retention: seed two outgoing preferences over
  // the real PUT /preferences boundary, convert, then read them back over the
  // GET /preferences boundary. Both rows must survive with the same targets.
  // Unlike the query-log negative above, this proves pre-existing rows are
  // preserved, not merely that the route never mentioned the table.
  it("TC-CV7: preference rows survive conversion — seeded via PUT /preferences, verified via GET /preferences", async () => {
    _scopeCache.clear();
    const ctx = createTestApp();
    await seedAllocationStaff(ctx.db);
    const staffJwt = await staffToken(10, "staff@example.test");

    const checkIn = "2026-08-14";
    const checkOut = "2026-08-16"; // 2 nights
    const tripleTotal = priceFor("shared_triple", checkIn, checkOut);

    // 4001 is the convert source; 4002/4003 are its two preferences. All three
    // are shared_triple/male so the PUT /preferences per-entry validation
    // (same accommodation type, same gender) passes.
    ctx.db.seedRegistration({ id: 4001, accommodation: "shared_triple", gender: "male" });
    ctx.db.seedRegistration({ id: 4002, accommodation: "shared_triple", gender: "male" });
    ctx.db.seedRegistration({ id: 4003, accommodation: "shared_triple", gender: "male" });

    const reg = makeRegistration({
      id: 4001,
      accommodation: "shared_triple",
      checkIn,
      checkOut,
      status: "confirmed",
      totalAmount: tripleTotal,
      updatedAt: 1721628000000,
    });
    ctx.registrationRepo.seed(reg);
    ctx.paymentRepo.seed({
      id: 1,
      registrationId: 4001,
      amount: tripleTotal,
      status: "verified",
      gateway: null,
      gatewayRef: null,
      gatewayResponse: null,
      proofFileKey: null,
      verifiedBy: "staff@example.test",
      verifiedAt: Date.now(),
      method: null,
      note: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // First write, no pre-existing preferences → version: null is the correct
    // optimistic-lock token (R29.8).
    const putRes = await ctx.req("/api/allocation/registrations/4001/preferences", {
      method: "PUT",
      body: JSON.stringify({
        preferences: [
          { preferredRegistrationId: 4002, preferenceOrder: 1 },
          { preferredRegistrationId: 4003, preferenceOrder: 2 },
        ],
        version: null,
      }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });
    expect(putRes.status).toBe(200);

    const convertRes = await ctx.req("/api/allocation/registrations/4001/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "shared_double", updatedAt: 1721628000000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });
    expect(convertRes.status).toBe(200);

    const getRes = await ctx.req("/api/allocation/registrations/4001/preferences", {
      headers: { Authorization: `Bearer ${staffJwt}` },
    });
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as {
      preferences: Array<{ preferredRegistrationId: number; preferenceOrder: number }>;
      version: number | null;
    };
    expect(
      body.preferences.map((p) => ({
        preferredRegistrationId: p.preferredRegistrationId,
        preferenceOrder: p.preferenceOrder,
      })),
    ).toEqual([
      { preferredRegistrationId: 4002, preferenceOrder: 1 },
      { preferredRegistrationId: 4003, preferenceOrder: 2 },
    ]);
    expect(body.version).not.toBeNull();
  });

  // TC-CV8 (R41.6) — the conversion's audit entry: registration_id = the
  // converted registration, action "amended", actor = the authenticated staff
  // email, and parsed changes.fields = { accommodation: "shared_double" }.
  it("TC-CV8: audit entry records registration_id, amended action, staff actor, and the accommodation field change", async () => {
    _scopeCache.clear();
    const ctx = createTestApp();
    await seedAllocationStaff(ctx.db);
    const staffJwt = await staffToken(10, "staff@example.test");

    ctx.db.seedRegistration({ id: 5001, accommodation: "shared_triple" });
    ctx.registrationRepo.seed(
      makeRegistration({ id: 5001, accommodation: "shared_triple", updatedAt: 1721628000000 }),
    );

    const res = await ctx.req("/api/allocation/registrations/5001/accommodation", {
      method: "PUT",
      body: JSON.stringify({ accommodationType: "shared_double", updatedAt: 1721628000000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });
    expect(res.status).toBe(200);

    const amended = ctx.auditRepo.entries.filter((e) => e.action === "amended");
    expect(amended).toHaveLength(1);
    expect(amended[0].registration_id).toBe(5001);
    expect(amended[0].actor).toBe("staff@example.test");
    const changes = JSON.parse(amended[0].changes ?? "null") as { fields: Record<string, unknown> };
    expect(changes.fields).toEqual({ accommodation: "shared_double" });
  });
});
