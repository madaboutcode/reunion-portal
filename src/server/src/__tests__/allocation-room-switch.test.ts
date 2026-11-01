/**
 * Route-level tests for the allocation-room-switch cycle's server slice
 * (2026-08-03-allocation-room-switch):
 *   - GET /registrations list payload extension — status, pendingAmount,
 *     updatedAt (staff-api.spec.md R27.7-R27.9), field-absence check for
 *     total_amount/donation/breakdown (access-control.spec.md R2.6), plus the
 *     QA additions TC-L3 (pending_verification in list), TC-L6 (allocation-only
 *     scope passes), TC-L7 (private accommodation in list).
 *   - POST /registrations/:id/payment-link (staff-api.spec.md R42).
 *
 * Same hand-rolled FakeD1 / real-route-handler pattern as allocation.test.ts
 * and allocation-concurrency.test.ts. Kept as a per-file FakeD1 rather than
 * shared, matching this project's existing convention.
 *
 * Does NOT cover PUT /registrations/:id/accommodation (R41) — that endpoint
 * was not built this pass; see the builder report for the reason (an
 * undocumented third 409 path in EditService's accommodation-availability
 * guard, plus wording drift between EditService's thrown messages and R41.4/
 * R41.5's specced bodies).
 *
 * @module allocation-room-switch.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env } from "../env.js";
import { handleError } from "../middleware/error.middleware.js";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { allocationRoutes } from "../routes/allocation.routes.js";
import { signToken } from "../infra/jwt.js";
import type { SystemAuditAction } from "../domain/types.js";
import type { ISystemAuditRepository } from "../repositories/interfaces.js";
import type { AuthService } from "../services/auth.service.js";

const TEST_JWT_SECRET = "test-secret-key-for-allocation-room-switch-tests!";

// =============================================================================
// FakeD1
// =============================================================================

interface RegRow {
  id: number;
  reg_code: string;
  full_name: string;
  branch: string;
  gender: string | null;
  email: string;
  whatsapp: string;
  photo_thumb_key: string | null;
  accommodation: string;
  status: string;
  updated_at: number;
  total_amount: number;
}

interface PaymentRow {
  registration_id: number;
  amount: number;
  status: string;
}

function norm(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

class FakeD1 {
  registrations = new Map<number, RegRow>();
  payments: PaymentRow[] = [];
  users = new Map<number, { permissions: string | null }>();

  seedRegistration(row: RegRow): void {
    this.registrations.set(row.id, row);
  }

  seedPayment(row: PaymentRow): void {
    this.payments.push(row);
  }

  seedUser(id: number, permissions: string | null): void {
    this.users.set(id, { permissions });
  }

  verifiedSum(registrationId: number): number {
    return this.payments
      .filter((p) => p.registration_id === registrationId && p.status === "verified")
      .reduce((sum, p) => sum + p.amount, 0);
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
        return { meta: { last_row_id: 0, changes: 0 } };
      },
    });
    return {
      bind(...args: unknown[]) {
        return executable(args);
      },
      ...executable([]),
    };
  }

  private execFirst(sql: string, args: unknown[]): unknown {
    const s = norm(sql);

    if (s.includes("SELECT permissions FROM users")) {
      const id = args[0] as number;
      return this.users.get(id) ?? null;
    }

    if (s.includes("SELECT id, reg_code, status FROM registrations WHERE id = ?")) {
      const id = args[0] as number;
      const reg = this.registrations.get(id);
      return reg ? { id: reg.id, reg_code: reg.reg_code, status: reg.status } : null;
    }

    throw new Error(`FakeD1.first: unhandled query: ${s}`);
  }

  private execAll(sql: string, args: unknown[]): unknown[] {
    const s = norm(sql);

    if (s.includes("FROM registrations r") && s.includes("LEFT JOIN")) {
      const rows = [...this.registrations.values()].filter(
        (r) => r.accommodation === "shared_double" || r.accommodation === "shared_triple" || r.accommodation === "private",
      );
      return rows.map((r) => ({
        id: r.id,
        reg_code: r.reg_code,
        full_name: r.full_name,
        branch: r.branch,
        gender: r.gender,
        email: r.email,
        whatsapp: r.whatsapp,
        photo_thumb_key: r.photo_thumb_key,
        accommodation: r.accommodation,
        check_in: null,
        check_out: null,
        status: r.status,
        updated_at: r.updated_at,
        total_amount: r.total_amount,
        verified_sum: this.verifiedSum(r.id) || null,
        preference_count: 0,
        incoming_preference_count: 0,
      }));
    }

    if (s.includes("FROM roommate_preferences rp") && s.includes("JOIN registrations r")) {
      return [];
    }

    throw new Error(`FakeD1.all: unhandled query: ${s} args=${JSON.stringify(args)}`);
  }
}

function envFor(db: FakeD1): Env {
  return { JWT_SECRET: TEST_JWT_SECRET, DB: db } as unknown as Env;
}

function makeReg(overrides: Partial<RegRow> & { id: number }): RegRow {
  return {
    reg_code: `SMRT${overrides.id}`,
    full_name: `Reg ${overrides.id}`,
    branch: "CS",
    gender: "male",
    email: `reg${overrides.id}@example.com`,
    whatsapp: "+919876543210",
    photo_thumb_key: null,
    accommodation: "shared_double",
    status: "pending",
    updated_at: 1721628000000,
    total_amount: 10000,
    ...overrides,
  };
}

// =============================================================================
// System audit repo — observable stub
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
// authService stub — observable, matches AuthService.createPaymentLinkUrl
// =============================================================================

class ObservableAuthService {
  calls: Array<{ registrationId: number; regCode: string }> = [];
  async createPaymentLinkUrl(registrationId: number, regCode: string): Promise<string> {
    this.calls.push({ registrationId, regCode });
    return `https://example.com/pay/${regCode}?code=fake-token`;
  }
}

// =============================================================================
// JWT helpers
// =============================================================================

async function staffToken(userId = 10, email = "staff@example.test"): Promise<string> {
  return signToken({ sub: String(userId), role: "staff", email }, TEST_JWT_SECRET, "7d");
}

// =============================================================================
// Test app factory
// =============================================================================

function createTestApp() {
  const db = new FakeD1();
  const systemAuditRepo = new ObservableSystemAuditRepo();
  const authService = new ObservableAuthService();

  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);
  app.use("*", async (c, next) => {
    c.set("systemAuditRepo", systemAuditRepo);
    c.set("authService", authService as unknown as AuthService);
    await next();
  });
  app.route("/allocation", allocationRoutes);

  const req = (input: string, init?: RequestInit) => app.request(input, init, envFor(db));

  return { app, db, systemAuditRepo, authService, req };
}

// Seeds the staff user with full access (permissions = NULL, R2.1) so
// requireScope('allocation') passes without needing a scopes fixture for
// every test. requireScope's own resolution logic (null=full-access,
// scoped allow-list, admin bypass, 403 on mismatch) is already covered
// against this exact middleware instance by allocation.test.ts — the two
// scope-enforcement tests below only need one seeded, in-scope user and one
// seeded, out-of-scope user to confirm these two new routes are actually
// gated by it, not to re-prove the middleware's own resolution rules.
async function seedAllocationStaff(db: FakeD1, userId = 10) {
  db.seedUser(userId, null);
}

// =============================================================================
// Tests: GET /registrations — list payload extension (R27.7-R27.9, R2.6)
// =============================================================================

describe("GET /api/allocation/registrations — status/pendingAmount/updatedAt", () => {
  let ctx: ReturnType<typeof createTestApp>;
  let staffJwt: string;

  beforeEach(async () => {
    _scopeCache.clear();
    ctx = createTestApp();
    await seedAllocationStaff(ctx.db);
    staffJwt = await staffToken(10, "staff@example.test");
  });

  it("pending registration: status, updatedAt, and pendingAmount (total minus verified) present", async () => {
    ctx.db.seedRegistration(
      makeReg({ id: 1001, status: "pending", updated_at: 1721628000000, total_amount: 10000 }),
    );
    ctx.db.seedPayment({ registration_id: 1001, amount: 6460, status: "verified" });
    ctx.db.seedPayment({ registration_id: 1001, amount: 500, status: "payment_pending" });

    const res = await ctx.req("/api/allocation/registrations", {
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      registrations: Array<{ status: string; pendingAmount: number | null; updatedAt: number }>;
    };
    expect(body.registrations).toHaveLength(1);
    expect(body.registrations[0].status).toBe("pending");
    expect(body.registrations[0].updatedAt).toBe(1721628000000);
    expect(body.registrations[0].pendingAmount).toBe(3540);
  });

  it("confirmed registration: pendingAmount is null", async () => {
    ctx.db.seedRegistration(makeReg({ id: 1002, status: "confirmed", total_amount: 10000 }));
    ctx.db.seedPayment({ registration_id: 1002, amount: 10000, status: "verified" });

    const res = await ctx.req("/api/allocation/registrations", {
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    const body = (await res.json()) as { registrations: Array<{ status: string; pendingAmount: number | null }> };
    expect(body.registrations[0].status).toBe("confirmed");
    expect(body.registrations[0].pendingAmount).toBeNull();
  });

  it("registration with no payments at all: pendingAmount equals the full total", async () => {
    ctx.db.seedRegistration(makeReg({ id: 1003, status: "pending", total_amount: 5000 }));

    const res = await ctx.req("/api/allocation/registrations", {
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    const body = (await res.json()) as { registrations: Array<{ pendingAmount: number | null }> };
    expect(body.registrations[0].pendingAmount).toBe(5000);
  });

  it("R2.6 field-absence: no total_amount, donation, or breakdown field on any registration", async () => {
    ctx.db.seedRegistration(makeReg({ id: 1004, status: "pending", total_amount: 8000 }));

    const res = await ctx.req("/api/allocation/registrations", {
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    const body = (await res.json()) as { registrations: Array<Record<string, unknown>> };
    const keys = Object.keys(body.registrations[0]);
    expect(keys).not.toContain("total_amount");
    expect(keys).not.toContain("totalAmount");
    expect(keys).not.toContain("donation");
    expect(keys).not.toContain("donationAmount");
    expect(keys).not.toContain("breakdown");
    expect(keys).not.toContain("pricingBreakup");
    expect(keys.sort()).toEqual(
      [
        "id",
        "regCode",
        "fullName",
        "branch",
        "gender",
        "email",
        "whatsapp",
        "photoThumbUrl",
        "accommodationType",
        "checkIn",
        "checkOut",
        "status",
        "pendingAmount",
        "updatedAt",
        "preferenceCount",
        "incomingPreferenceCount",
        "preferences",
        "prefsVersion",
      ].sort(),
    );
  });

  it("scope enforcement: dashboard-only account gets 403", async () => {
    ctx.db.users.set(10, { permissions: JSON.stringify({ scopes: ["dashboard"] }) });
    ctx.db.seedRegistration(makeReg({ id: 1005 }));

    const res = await ctx.req("/api/allocation/registrations", {
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(403);
  });

  // TC-L3 (R27.7) — a pending_verification registration must surface in the
  // list with its status, not be filtered out or re-mapped.
  it("TC-L3: pending_verification registration appears in the list with its status", async () => {
    ctx.db.seedRegistration(
      makeReg({ id: 1006, status: "pending_verification", accommodation: "shared_double" }),
    );

    const res = await ctx.req("/api/allocation/registrations", {
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { registrations: Array<{ id: number; status: string }> };
    const reg = body.registrations.find((r) => r.id === 1006);
    expect(reg).toBeDefined();
    expect(reg?.status).toBe("pending_verification");
  });

  // TC-L6 (R27, access-control R6) — an allocation-only account (scopes =
  // ["allocation"], not null/full-access) must pass the list. The dashboard-only
  // 403 half of the case is the test directly above.
  it("TC-L6: allocation-only scope passes the list (dashboard-only 403 asserted above)", async () => {
    ctx.db.users.set(10, { permissions: JSON.stringify({ scopes: ["allocation"] }) });
    ctx.db.seedRegistration(makeReg({ id: 1007, status: "pending" }));

    const res = await ctx.req("/api/allocation/registrations", {
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { registrations: unknown[] };
    expect(body.registrations).toHaveLength(1);
  });

  // TC-L7 (R27.1) — private accommodation is list-eligible and must come back
  // with accommodationType "private".
  it("TC-L7: private registration appears in the list with accommodationType 'private'", async () => {
    ctx.db.seedRegistration(makeReg({ id: 1008, accommodation: "private", status: "pending" }));

    const res = await ctx.req("/api/allocation/registrations", {
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      registrations: Array<{ id: number; accommodationType: string }>;
    };
    const reg = body.registrations.find((r) => r.id === 1008);
    expect(reg).toBeDefined();
    expect(reg?.accommodationType).toBe("private");
  });
});

// =============================================================================
// Tests: POST /registrations/:id/payment-link (R42)
// =============================================================================

describe("POST /api/allocation/registrations/:id/payment-link", () => {
  let ctx: ReturnType<typeof createTestApp>;
  let staffJwt: string;

  beforeEach(async () => {
    _scopeCache.clear();
    ctx = createTestApp();
    await seedAllocationStaff(ctx.db);
    staffJwt = await staffToken(10, "staff@example.test");
  });

  it("happy path: returns a link, records a magic-link call, and audits payment_link_generated", async () => {
    ctx.db.seedRegistration(makeReg({ id: 2001, reg_code: "SMRT2001", status: "pending" }));

    const res = await ctx.req("/api/allocation/registrations/2001/payment-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { link: string };
    expect(body.link).toBe("https://example.com/pay/SMRT2001?code=fake-token");
    expect(Object.keys(body)).toEqual(["link"]);

    expect(ctx.authService.calls).toEqual([{ registrationId: 2001, regCode: "SMRT2001" }]);

    expect(ctx.systemAuditRepo.calls).toHaveLength(1);
    expect(ctx.systemAuditRepo.calls[0]).toMatchObject({
      action: "payment_link_generated",
      actor: "staff@example.test",
      targetType: "registration",
      targetId: 2001,
    });
  });

  it("pending_verification registration: link still generated (only confirmed is blocked)", async () => {
    ctx.db.seedRegistration(makeReg({ id: 2002, status: "pending_verification" }));

    const res = await ctx.req("/api/allocation/registrations/2002/payment-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(200);
  });

  it("unknown registration id returns 404", async () => {
    const res = await ctx.req("/api/allocation/registrations/99999/payment-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(404);
    expect(ctx.authService.calls).toHaveLength(0);
  });

  it("confirmed registration returns 409 and generates no link", async () => {
    ctx.db.seedRegistration(makeReg({ id: 2003, status: "confirmed" }));

    const res = await ctx.req("/api/allocation/registrations/2003/payment-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Registration is already confirmed");
    expect(ctx.authService.calls).toHaveLength(0);
    expect(ctx.systemAuditRepo.calls).toHaveLength(0);
  });

  it("scope enforcement: allocation-scoped account passes", async () => {
    ctx.db.users.set(10, { permissions: JSON.stringify({ scopes: ["allocation"] }) });
    ctx.db.seedRegistration(makeReg({ id: 2004, status: "pending" }));

    const res = await ctx.req("/api/allocation/registrations/2004/payment-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(200);
  });

  it("scope enforcement: dashboard-only account gets 403", async () => {
    ctx.db.users.set(10, { permissions: JSON.stringify({ scopes: ["dashboard"] }) });
    ctx.db.seedRegistration(makeReg({ id: 2005, status: "pending" }));

    const res = await ctx.req("/api/allocation/registrations/2005/payment-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(403);
    expect(ctx.authService.calls).toHaveLength(0);
  });
});
