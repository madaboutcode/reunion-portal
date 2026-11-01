/**
 * Route-level tests for the MG2 machine gate: requireScope middleware,
 * roommate-preference constraints, and allocation endpoint authorization.
 *
 * Tests every externally observable guarantee from:
 *   - auth.middleware.ts (requireScope — null=full-access, scoped, admin
 *     bypass, per-user cache)
 *   - allocation.routes.ts (AUTH_GUARD, LIST_ELIGIBLE, REPLACE_PREFERENCES
 *     constraint validation)
 *
 * Uses the Hono test client pattern: real route handlers with a hand-rolled
 * FakeD1 that pattern-matches the exact SQL strings the code issues. No mock
 * libraries. Not a full D1Database implementation — cast at the env boundary
 * the same way auth-roles.test.ts casts TEST_ENV.
 *
 * @module allocation.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env } from "../env.js";
import { handleError } from "../middleware/error.middleware.js";
import { authMiddleware, requireRole, requireScope, _scopeCache } from "../middleware/auth.middleware.js";
import { allocationRoutes } from "../routes/allocation.routes.js";
import { signToken } from "../infra/jwt.js";
import type { SystemAuditAction } from "../domain/types.js";
import type { ISystemAuditRepository } from "../repositories/interfaces.js";

const TEST_JWT_SECRET = "test-secret-key-for-allocation-tests-32chars!";

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

  seedUser(id: number, permissions: string | null): void {
    this.users.set(id, { permissions });
  }

  seedPreference(row: PrefRow): void {
    this.preferences.push(row);
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
      // Parameter-less queries (e.g. LIST_ELIGIBLE) call .all()/.first()/.run()
      // directly on the prepared statement without .bind() first.
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

    if (s.includes("SELECT id, accommodation, gender FROM registrations WHERE id = ?")) {
      const id = args[0] as number;
      const reg = this.registrations.get(id);
      return reg ? { id: reg.id, accommodation: reg.accommodation, gender: reg.gender } : null;
    }

    if (s.includes("SELECT id FROM registrations WHERE id = ?")) {
      const id = args[0] as number;
      const reg = this.registrations.get(id);
      return reg ? { id: reg.id } : null;
    }

    if (s.includes("SELECT COUNT(*) as cnt FROM roommate_preferences WHERE registration_id = ?")) {
      const id = args[0] as number;
      const cnt = this.preferences.filter((p) => p.registration_id === id).length;
      return { cnt };
    }

    // R28.6 version token — MAX(updated_at) across the registration's OUTGOING
    // preference rows; null when it has none (mirrors SQLite MAX over 0 rows).
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

    if (s.includes("FROM registrations r") && s.includes("LEFT JOIN")) {
      const rows = [...this.registrations.values()].filter(
        (r) => r.accommodation === "shared_double" || r.accommodation === "shared_triple",
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
        preference_count: this.preferences.filter((p) => p.registration_id === r.id).length,
        incoming_preference_count: this.preferences.filter((p) => p.preferred_registration_id === r.id).length,
      }));
    }

    if (s.includes("FROM roommate_preferences rp") && s.includes("JOIN registrations r")) {
      const isBulk = s.includes("rp.registration_id IN");
      const eligibleIds = isBulk
        ? new Set([...this.registrations.values()]
            .filter((r) => r.accommodation === "shared_double" || r.accommodation === "shared_triple" || r.accommodation === "private")
            .map((r) => r.id))
        : null;
      const registrationId = isBulk ? null : (args[0] as number);
      const rows = this.preferences
        .filter((p) => isBulk ? eligibleIds!.has(p.registration_id) : p.registration_id === registrationId)
        .sort((a, b) => a.registration_id - b.registration_id || a.preference_order - b.preference_order);
      return rows.map((p) => {
        const preferred = this.registrations.get(p.preferred_registration_id);
        const isMutual = this.preferences.some(
          (rp2) =>
            rp2.registration_id === p.preferred_registration_id &&
            rp2.preferred_registration_id === p.registration_id,
        );
        return {
          ...(isBulk ? { registration_id: p.registration_id } : {}),
          preferred_registration_id: p.preferred_registration_id,
          preference_order: p.preference_order,
          reg_code: preferred?.reg_code ?? "",
          full_name: preferred?.full_name ?? "",
          branch: preferred?.branch ?? "",
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
        .map((r) => ({ id: r.id, accommodation: r.accommodation, gender: r.gender }));
    }

    throw new Error(`FakeD1.all: unhandled query: ${s}`);
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
        number | undefined,
      ];
      this.preferences.push({
        registration_id: registrationId,
        preferred_registration_id: preferredRegistrationId,
        preference_order: preferenceOrder,
        created_by: createdBy,
        updated_at: updatedAt ?? Date.now(),
      });
      return;
    }

    throw new Error(`FakeD1.run: unhandled query: ${s}`);
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
// JWT helpers
// =============================================================================

async function staffToken(userId = 10, email = "staff@example.test"): Promise<string> {
  return signToken({ sub: String(userId), role: "staff", email }, TEST_JWT_SECRET, "7d");
}

async function adminToken(userId = 99, email = "admin@example.test"): Promise<string> {
  return signToken({ sub: String(userId), role: "admin", email }, TEST_JWT_SECRET, "7d");
}

// =============================================================================
// Tests: requireScope middleware
// =============================================================================

describe("requireScope middleware", () => {
  let db: FakeD1;
  let testApp: Hono<AppEnv>;
  let req: (input: string, init?: RequestInit) => Response | Promise<Response>;

  beforeEach(() => {
    _scopeCache.clear();
    db = new FakeD1();
    testApp = new Hono<AppEnv>();
    testApp.onError(handleError);
    testApp.use("*", authMiddleware, requireRole("staff", "admin"), requireScope("allocation"));
    testApp.get("/test", (c) => c.json({ ok: true }));
    req = (input, init) => testApp.request(input, init, envFor(db));
  });

  it("admin bypasses scope check", async () => {
    const token = await adminToken();
    const res = await req("/test", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
  });

  it("staff with null permissions (full access) passes — carry-forward from HG2", async () => {
    db.seedUser(10, null);
    const token = await staffToken(10);
    const res = await req("/test", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
  });

  it("staff with matching scope passes", async () => {
    db.seedUser(10, JSON.stringify({ scopes: ["allocation"] }));
    const token = await staffToken(10);
    const res = await req("/test", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
  });

  it("staff with non-matching scope gets 403", async () => {
    db.seedUser(10, JSON.stringify({ scopes: ["dashboard"] }));
    const token = await staffToken(10);
    const res = await req("/test", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Insufficient permissions");
  });

  it("staff with empty scopes array gets 403", async () => {
    db.seedUser(10, JSON.stringify({ scopes: [] }));
    const token = await staffToken(10);
    const res = await req("/test", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
  });

  it("cache: second request uses cached value — D1 queried once for two sequential requests", async () => {
    db.seedUser(10, JSON.stringify({ scopes: ["allocation"] }));
    const token = await staffToken(10);

    const res1 = await req("/test", { headers: { Authorization: `Bearer ${token}` } });
    const res2 = await req("/test", { headers: { Authorization: `Bearer ${token}` } });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const permissionQueries = db.queryLog.filter((q) => q.includes("SELECT permissions FROM users"));
    expect(permissionQueries).toHaveLength(1);
  });
});

// =============================================================================
// Test app factory for allocation routes
// =============================================================================

function createAllocationTestApp() {
  const db = new FakeD1();
  const systemAuditRepo = new ObservableSystemAuditRepo();

  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);
  app.use("*", async (c, next) => {
    c.set("systemAuditRepo", systemAuditRepo);
    await next();
  });
  app.route("/allocation", allocationRoutes);

  const req = (input: string, init?: RequestInit) => app.request(input, init, envFor(db));

  return { app, db, systemAuditRepo, req };
}

// =============================================================================
// Tests: Allocation endpoint authorization
// =============================================================================

describe("Allocation endpoint authorization", () => {
  let ctx: ReturnType<typeof createAllocationTestApp>;

  beforeEach(() => {
    _scopeCache.clear();
    ctx = createAllocationTestApp();
  });

  it("staff with allocation scope can access GET /registrations", async () => {
    ctx.db.seedUser(10, JSON.stringify({ scopes: ["allocation"] }));
    const token = await staffToken(10);
    const res = await ctx.req("/api/allocation/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("staff without allocation scope gets 403", async () => {
    ctx.db.seedUser(10, JSON.stringify({ scopes: ["dashboard"] }));
    const token = await staffToken(10);
    const res = await ctx.req("/api/allocation/registrations", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("unauthenticated request gets 401", async () => {
    const res = await ctx.req("/api/allocation/registrations");
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// Tests: PUT preferences — constraint validation
// =============================================================================

describe("PUT /api/allocation/registrations/:id/preferences — constraints", () => {
  let ctx: ReturnType<typeof createAllocationTestApp>;
  let staffJwt: string;

  beforeEach(async () => {
    _scopeCache.clear();
    ctx = createAllocationTestApp();
    ctx.db.seedUser(10, JSON.stringify({ scopes: ["allocation"] }));
    staffJwt = await staffToken(10, "staff@example.test");

    ctx.db.seedRegistration(makeReg({ id: 1001, accommodation: "shared_double", gender: "male" }));
    ctx.db.seedRegistration(makeReg({ id: 1002, accommodation: "shared_double", gender: "male" }));
    ctx.db.seedRegistration(makeReg({ id: 1003, accommodation: "shared_triple", gender: "male" }));
    ctx.db.seedRegistration(makeReg({ id: 1004, accommodation: "shared_double", gender: "female" }));
    ctx.db.seedRegistration(makeReg({ id: 1005, accommodation: "private", gender: "male" }));
  });

  it("max 5 preferences enforced", async () => {
    const preferences = Array.from({ length: 6 }, (_, i) => ({
      preferredRegistrationId: 1002,
      preferenceOrder: (i % 5) + 1,
    }));

    const res = await ctx.req("/api/allocation/registrations/1001/preferences", {
      method: "PUT",
      body: JSON.stringify({ preferences, version: null }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { details: { invalid: Array<{ reason: string }> } };
    expect(body.details.invalid.some((e) => e.reason === "Maximum 5 preferences allowed")).toBe(true);
  });

  it("same accommodation type required", async () => {
    const res = await ctx.req("/api/allocation/registrations/1001/preferences", {
      method: "PUT",
      body: JSON.stringify({ preferences: [{ preferredRegistrationId: 1003, preferenceOrder: 1 }], version: null }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { details: { invalid: Array<{ reason: string }> } };
    expect(body.details.invalid[0].reason).toBe("Different accommodation type");
  });

  it("same gender required", async () => {
    const res = await ctx.req("/api/allocation/registrations/1001/preferences", {
      method: "PUT",
      body: JSON.stringify({ preferences: [{ preferredRegistrationId: 1004, preferenceOrder: 1 }], version: null }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { details: { invalid: Array<{ reason: string }> } };
    expect(body.details.invalid[0].reason).toBe("Different gender");
  });

  it("no self-preference", async () => {
    const res = await ctx.req("/api/allocation/registrations/1001/preferences", {
      method: "PUT",
      body: JSON.stringify({ preferences: [{ preferredRegistrationId: 1001, preferenceOrder: 1 }], version: null }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { details: { invalid: Array<{ reason: string }> } };
    expect(body.details.invalid[0].reason).toBe("Cannot prefer self");
  });

  it("not-shared registration rejected", async () => {
    const res = await ctx.req("/api/allocation/registrations/1001/preferences", {
      method: "PUT",
      body: JSON.stringify({ preferences: [{ preferredRegistrationId: 1005, preferenceOrder: 1 }], version: null }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { details: { invalid: Array<{ reason: string }> } };
    expect(body.details.invalid[0].reason).toBe("Not a shared-accommodation registration");
  });

  it("valid preferences accepted", async () => {
    const res = await ctx.req("/api/allocation/registrations/1001/preferences", {
      method: "PUT",
      body: JSON.stringify({ preferences: [{ preferredRegistrationId: 1002, preferenceOrder: 1 }], version: null }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      preferences: Array<{ preferredRegistrationId: number; preferenceOrder: number }>;
      version: number;
    };
    expect(body.preferences).toHaveLength(1);
    expect(typeof body.version).toBe("number");
    expect(body.preferences[0].preferredRegistrationId).toBe(1002);
    expect(body.preferences[0].preferenceOrder).toBe(1);
  });

  it("empty preferences array clears all", async () => {
    ctx.db.seedPreference({
      registration_id: 1001,
      preferred_registration_id: 1002,
      preference_order: 1,
      created_by: 10,
      updated_at: 5000,
    });

    const res = await ctx.req("/api/allocation/registrations/1001/preferences", {
      method: "PUT",
      body: JSON.stringify({ preferences: [], version: 5000 }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { preferences: unknown[]; version: number | null };
    expect(body.preferences).toHaveLength(0);
    expect(body.version).toBeNull();
  });

  it("registration not found returns 404", async () => {
    // version supplied so the R29.8 version-required 422 (which precedes the
    // existence check, mirroring R18.2) doesn't preempt the 404 under test.
    const res = await ctx.req("/api/allocation/registrations/99999/preferences", {
      method: "PUT",
      body: JSON.stringify({ preferences: [], version: null }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` },
    });

    expect(res.status).toBe(404);
  });
});
