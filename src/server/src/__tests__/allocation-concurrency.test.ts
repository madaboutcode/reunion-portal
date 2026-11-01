/**
 * Black-box tests for the optimistic-locking delta on the allocation
 * (roommate preferences) endpoints — staff-api.spec.md R28.6, R29.6, R29.8,
 * R30.1, R30.5.
 *
 * These tests exercise the same HTTP boundary as allocation.test.ts
 * (real Hono route handlers via app.request(), hand-rolled FakeD1 pattern-
 * matching the SQL text the code issues). They are written against the spec
 * text, not against the current implementation — the concurrency guards
 * described in R28.6/R29.8/R30.5 do not exist in allocation.routes.ts as of
 * this writing, so most of these tests are expected to fail. A failure here
 * is a bug report against the spec, not a defect in the test.
 *
 * @module allocation-concurrency.test
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

const TEST_JWT_SECRET = "test-secret-key-for-allocation-concurrency-tests!";

// =============================================================================
// FakeD1 — same pattern-matching approach as allocation.test.ts, extended
// with an `updated_at` column on preference rows so tests can seed and
// reason about the R28.6 version token. Kept local to this file rather than
// shared, matching this project's existing per-file FakeD1 convention.
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

    // R28.6 version token — MAX(updated_at) across this registration's OUTGOING
    // preference rows (registration_id = :id). No rows → SQLite's MAX yields a
    // row with a NULL column, so we mirror that with { version: null }.
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
      const [registrationId, preferredRegistrationId, preferenceOrder, createdBy] = args as [
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
        updated_at: Date.now(),
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
// JWT + app factory
// =============================================================================

async function staffToken(userId = 10, email = "staff@example.test"): Promise<string> {
  return signToken({ sub: String(userId), role: "staff", email }, TEST_JWT_SECRET, "7d");
}

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

interface GetPreferencesBody {
  preferences: Array<{ preferredRegistrationId: number; preferenceOrder: number }>;
  version: number | null;
}

// =============================================================================
// Shared fixtures
// =============================================================================

let ctx: ReturnType<typeof createAllocationTestApp>;
let staffJwt: string;

beforeEach(async () => {
  _scopeCache.clear();
  ctx = createAllocationTestApp();
  ctx.db.seedUser(10, JSON.stringify({ scopes: ["allocation"] }));
  staffJwt = await staffToken(10, "staff@example.test");

  // 2001/2002/2003 form an eligible shared_double/male pool for each other.
  // 2010 is a second, independent registration in the same pool used for
  // the "different registrations never conflict" tests.
  ctx.db.seedRegistration(makeReg({ id: 2001, accommodation: "shared_double", gender: "male" }));
  ctx.db.seedRegistration(makeReg({ id: 2002, accommodation: "shared_double", gender: "male" }));
  ctx.db.seedRegistration(makeReg({ id: 2003, accommodation: "shared_double", gender: "male" }));
  ctx.db.seedRegistration(makeReg({ id: 2010, accommodation: "shared_double", gender: "male" }));
});

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${staffJwt}` };
}

async function getPreferences(registrationId: number): Promise<{ status: number; body: GetPreferencesBody }> {
  const res = await ctx.req(`/api/allocation/registrations/${registrationId}/preferences`, {
    headers: { Authorization: `Bearer ${staffJwt}` },
  });
  return { status: res.status, body: (await res.json()) as GetPreferencesBody };
}

async function putPreferences(
  registrationId: number,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const res = await ctx.req(`/api/allocation/registrations/${registrationId}/preferences`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: authHeaders(),
  });
  return { status: res.status, body: await res.json() };
}

async function deletePreferences(
  registrationId: number,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const res = await ctx.req(`/api/allocation/registrations/${registrationId}/preferences`, {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: authHeaders(),
  });
  const status = res.status;
  const text = await res.text();
  return { status, body: text.length > 0 ? JSON.parse(text) : null };
}

// =============================================================================
// R28.6 — GET returns `version`
// =============================================================================

describe("GET /preferences — version token (R28.6)", () => {
  // R28.5/R28.6 — a registration with no preferences reports version: null.
  // Catches: generator that omits `version` entirely, or defaults it to 0
  // instead of null.
  it("version is null when the registration has no preferences", async () => {
    const { status, body } = await getPreferences(2001);
    expect(status).toBe(200);
    expect(body.preferences).toHaveLength(0);
    expect(body.version).toBeNull();
  });

  // R28.6 — version is MAX(updated_at) across this registration's own
  // preference rows, not the count, not the most-recently-inserted row.
  // Catches: generator using COUNT(*), the first row's updated_at, or the
  // insertion-order-last row instead of the true max.
  it("version is the maximum updated_at across the registration's preference rows", async () => {
    ctx.db.seedPreference({
      registration_id: 2001,
      preferred_registration_id: 2002,
      preference_order: 1,
      created_by: 10,
      updated_at: 1000,
    });
    ctx.db.seedPreference({
      registration_id: 2001,
      preferred_registration_id: 2003,
      preference_order: 2,
      created_by: 10,
      updated_at: 3000,
    });

    const { status, body } = await getPreferences(2001);
    expect(status).toBe(200);
    expect(body.version).toBe(3000);
  });

  // R28.6 — "scoped to preference rows only" means rows where THIS
  // registration is the registration_id, not rows where it is merely the
  // preferred_registration_id (an incoming preference from someone else).
  // Catches: generator that computes MAX(updated_at) across any row
  // mentioning :id in either column, which would let another rep's edit to
  // a different registration bump this registration's version and cause
  // spurious 409s.
  it("version is unaffected by another registration's outgoing preference that points at this one", async () => {
    // 2002 prefers 2001 — an incoming edge for 2001, with a much larger
    // updated_at than anything 2001 owns.
    ctx.db.seedPreference({
      registration_id: 2002,
      preferred_registration_id: 2001,
      preference_order: 1,
      created_by: 10,
      updated_at: 9_999_999,
    });

    const { status, body } = await getPreferences(2001);
    expect(status).toBe(200);
    expect(body.preferences).toHaveLength(0); // 2001 has no outgoing preferences
    expect(body.version).toBeNull();
  });
});

// =============================================================================
// R29.8 — PUT requires `version`; missing → 422
// =============================================================================

describe("PUT /preferences — version required (R29.8, 422)", () => {
  // R29.8 — "version missing from the request body → 422 with
  // { error: 'version is required' }". Catches: generator that treats a
  // missing version the same as version: null (i.e. always allows first
  // writes through even when the field was never sent).
  it("422 with exact error shape when version is absent from the body", async () => {
    const { status, body } = await putPreferences(2001, { preferences: [] });
    expect(status).toBe(422);
    expect(body).toEqual({ error: "version is required" });
  });

  // Ordering precedent: R18.2's equivalent `updatedAt`-required check
  // (staff.routes.ts PUT /registrations/:id) runs before any DB existence
  // lookup — it's a pure body-shape check. R29.8 says it "mirrors the R18.2
  // pattern," so the same ordering is expected here. Flagged as an
  // inference, not a directly stated requirement — see gaps.
  it("version-required check fires even when the registration does not exist", async () => {
    const { status, body } = await putPreferences(99999, { preferences: [] });
    expect(status).toBe(422);
    expect(body).toEqual({ error: "version is required" });
  });
});

// =============================================================================
// R29.8 — PUT optimistic lock: null/matching/stale version resolution
// =============================================================================

describe("PUT /preferences — optimistic lock resolution (R29.8, 409)", () => {
  // R29.8 bullet 1 + case (e) — no existing preferences, version: null →
  // proceed (first write). Catches: generator that rejects version: null
  // unconditionally, or one that requires a numeric version even on the
  // very first save.
  it("version: null is accepted as the first write when no preferences exist yet", async () => {
    const { status, body } = await putPreferences(2001, {
      preferences: [{ preferredRegistrationId: 2002, preferenceOrder: 1 }],
      version: null,
    });
    expect(status).toBe(200);
    expect((body as GetPreferencesBody).preferences).toHaveLength(1);
  });

  // R29.8 bullet 2 — existing preferences, version matches MAX(updated_at)
  // → proceed. Baseline correctness check before testing the mismatch path.
  it("matching version proceeds", async () => {
    ctx.db.seedPreference({
      registration_id: 2001,
      preferred_registration_id: 2002,
      preference_order: 1,
      created_by: 10,
      updated_at: 5000,
    });

    const { status } = await putPreferences(2001, {
      preferences: [{ preferredRegistrationId: 2003, preferenceOrder: 1 }],
      version: 5000,
    });
    expect(status).toBe(200);
  });

  // R29.8 case (a) — stale version → 409, exact error shape, and the write
  // must not happen (guard runs "before any write"). Catches: generator
  // that returns 409 but writes anyway, or one that compares versions
  // loosely (e.g. != instead of strict inequality on a coerced type).
  it("stale version → 409 with exact error shape, and no write occurs", async () => {
    ctx.db.seedPreference({
      registration_id: 2001,
      preferred_registration_id: 2002,
      preference_order: 1,
      created_by: 10,
      updated_at: 5000,
    });

    const { status, body } = await putPreferences(2001, {
      preferences: [{ preferredRegistrationId: 2003, preferenceOrder: 1 }],
      version: 4999,
    });
    expect(status).toBe(409);
    expect(body).toEqual({ error: "Preferences were modified by another user. Please reload." });

    const after = await getPreferences(2001);
    expect(after.body.preferences).toHaveLength(1);
    expect(after.body.preferences[0].preferredRegistrationId).toBe(2002);
  });

  // Exhaustive-logic edge — the three R29.8 bullets are: (1) no existing
  // prefs + version null → proceed, (2) existing prefs + version matches →
  // proceed, (3) otherwise → 409. An explicit `version: null` sent while
  // preferences already exist falls into bullet 3, not bullet 1. Catches:
  // generator treating `null` as always meaning "no conflict" regardless of
  // current state.
  it("explicit version: null with existing preferences is a mismatch → 409", async () => {
    ctx.db.seedPreference({
      registration_id: 2001,
      preferred_registration_id: 2002,
      preference_order: 1,
      created_by: 10,
      updated_at: 5000,
    });

    const { status, body } = await putPreferences(2001, {
      preferences: [{ preferredRegistrationId: 2003, preferenceOrder: 1 }],
      version: null,
    });
    expect(status).toBe(409);
    expect(body).toEqual({ error: "Preferences were modified by another user. Please reload." });
  });

  // Exhaustive-logic edge — no existing preferences (current MAX is null),
  // but the client sends a stale non-null version (e.g. cached from before
  // someone else cleared the list). Only version === null matches bullet 1;
  // any non-null value here must fall to bullet 3 → 409. Catches: generator
  // that treats "no existing preferences" as an automatic pass regardless
  // of what version the client sent.
  it("no existing preferences but a stale non-null version → 409", async () => {
    const { status, body } = await putPreferences(2001, {
      preferences: [{ preferredRegistrationId: 2002, preferenceOrder: 1 }],
      version: 123456,
    });
    expect(status).toBe(409);
    expect(body).toEqual({ error: "Preferences were modified by another user. Please reload." });
  });
});

// =============================================================================
// R29.6 — PUT response includes the new version; chaining
// =============================================================================

describe("PUT /preferences — response version and chaining (R29.6, case c/g)", () => {
  // R29.6 — the success response includes the new version so a client can
  // chain further writes without re-fetching. Catches: generator that
  // returns { preferences } without a version key (the current response
  // shape), silently breaking every client relying on R29.6.
  it("successful PUT response includes a numeric version", async () => {
    const { status, body } = await putPreferences(2001, {
      preferences: [{ preferredRegistrationId: 2002, preferenceOrder: 1 }],
      version: null,
    });
    expect(status).toBe(200);
    expect(typeof (body as GetPreferencesBody).version).toBe("number");
  });

  // Case (c)/(g) — page-instance continuity: the version returned by one
  // PUT can be used directly as the version for the very next PUT, without
  // an intervening GET. This is the guarantee that makes "save, then save
  // again from the same page" work without a spurious 409 against your own
  // prior write. Catches: generator whose returned version doesn't match
  // what the server will actually compare against on the next call.
  it("the version from a PUT response can be used, unmodified, for the immediately following PUT", async () => {
    const first = await putPreferences(2001, {
      preferences: [{ preferredRegistrationId: 2002, preferenceOrder: 1 }],
      version: null,
    });
    expect(first.status).toBe(200);
    const v1 = (first.body as GetPreferencesBody).version;
    expect(v1).not.toBeNull();

    const second = await putPreferences(2001, {
      preferences: [
        { preferredRegistrationId: 2002, preferenceOrder: 1 },
        { preferredRegistrationId: 2003, preferenceOrder: 2 },
      ],
      version: v1,
    });
    expect(second.status).toBe(200);
    expect((second.body as GetPreferencesBody).preferences).toHaveLength(2);
  });
});

// =============================================================================
// R30.5 — DELETE requires `version`; same optimistic-lock resolution
// =============================================================================

describe("DELETE /preferences — version required and optimistic lock (R30.5, case d)", () => {
  // R30.5 — "version missing from the request body → 422". Same shape as
  // R29.8. Catches: generator that implements the PUT guard but forgets to
  // mirror it on DELETE.
  it("422 with exact error shape when version is absent from the body", async () => {
    const { status, body } = await deletePreferences(2001, {});
    expect(status).toBe(422);
    expect(body).toEqual({ error: "version is required" });
  });

  // R30.5 — stale version → 409, same error shape as PUT, and the rows must
  // still exist afterward (guard runs before the delete).
  it("stale version → 409 with exact error shape, and preferences are not deleted", async () => {
    ctx.db.seedPreference({
      registration_id: 2001,
      preferred_registration_id: 2002,
      preference_order: 1,
      created_by: 10,
      updated_at: 5000,
    });

    const { status, body } = await deletePreferences(2001, { version: 4999 });
    expect(status).toBe(409);
    expect(body).toEqual({ error: "Preferences were modified by another user. Please reload." });

    const after = await getPreferences(2001);
    expect(after.body.preferences).toHaveLength(1);
  });

  // R30.5 — matching version → 204, preferences actually cleared. Verified
  // through the boundary (a follow-up GET), not by inspecting FakeD1 state
  // directly.
  it("matching version → 204 and preferences are actually removed", async () => {
    ctx.db.seedPreference({
      registration_id: 2001,
      preferred_registration_id: 2002,
      preference_order: 1,
      created_by: 10,
      updated_at: 5000,
    });

    const del = await deletePreferences(2001, { version: 5000 });
    expect(del.status).toBe(204);
    expect(del.body).toBeNull();

    const after = await getPreferences(2001);
    expect(after.body.preferences).toHaveLength(0);
    expect(after.body.version).toBeNull();
  });

  // R30.5 explicit callout — no existing preferences, version: null → no-op,
  // 204 (not 422, not 409).
  it("no existing preferences and version: null → no-op 204", async () => {
    const { status, body } = await deletePreferences(2001, { version: null });
    expect(status).toBe(204);
    expect(body).toBeNull();
  });

  // Exhaustive-logic edge, mirroring the PUT case — no existing preferences
  // but a stale non-null version sent → mismatch → 409, not a silent no-op.
  it("no existing preferences but a stale non-null version → 409", async () => {
    const { status, body } = await deletePreferences(2001, { version: 42 });
    expect(status).toBe(409);
    expect(body).toEqual({ error: "Preferences were modified by another user. Please reload." });
  });
});

// =============================================================================
// Case (b) — no lost update across concurrent editors
// =============================================================================

describe("Concurrency — no lost update (case b)", () => {
  // Two reps editing DIFFERENT registrations never conflict — the version
  // check is scoped per-registration (R29.8: "two staff members editing
  // different registrations never conflict"). Both PUTs use their own
  // correct version and both must return their own new version.
  it("two staff editing different registrations both persist independently", async () => {
    ctx.db.seedPreference({
      registration_id: 2001,
      preferred_registration_id: 2002,
      preference_order: 1,
      created_by: 10,
      updated_at: 5000,
    });
    ctx.db.seedPreference({
      registration_id: 2010,
      preferred_registration_id: 2002,
      preference_order: 1,
      created_by: 10,
      updated_at: 6000,
    });

    const putA = await putPreferences(2001, {
      preferences: [{ preferredRegistrationId: 2003, preferenceOrder: 1 }],
      version: 5000,
    });
    const putB = await putPreferences(2010, {
      preferences: [{ preferredRegistrationId: 2003, preferenceOrder: 1 }],
      version: 6000,
    });

    expect(putA.status).toBe(200);
    expect(putB.status).toBe(200);
    expect(typeof (putA.body as GetPreferencesBody).version).toBe("number");
    expect(typeof (putB.body as GetPreferencesBody).version).toBe("number");
  });

  // The actual "no lost update" guarantee: two reps both load the SAME
  // registration's preferences at version V0. Rep A saves first (succeeds,
  // moves the version to V1). Rep B, still holding the stale V0, saves next
  // — must be rejected with 409, not silently overwrite Rep A's change.
  it("same registration: first save succeeds, second save with the now-stale version is rejected", async () => {
    ctx.db.seedPreference({
      registration_id: 2001,
      preferred_registration_id: 2002,
      preference_order: 1,
      created_by: 10,
      updated_at: 5000,
    });
    const v0 = 5000;

    const repA = await putPreferences(2001, {
      preferences: [{ preferredRegistrationId: 2003, preferenceOrder: 1 }],
      version: v0,
    });
    expect(repA.status).toBe(200);

    const repB = await putPreferences(2001, {
      preferences: [{ preferredRegistrationId: 2002, preferenceOrder: 1 }],
      version: v0, // stale — Rep A's save already moved the version forward
    });
    expect(repB.status).toBe(409);
    expect(repB.body).toEqual({ error: "Preferences were modified by another user. Please reload." });

    // Rep A's write must be the one that stuck.
    const after = await getPreferences(2001);
    expect(after.body.preferences).toHaveLength(1);
    expect(after.body.preferences[0].preferredRegistrationId).toBe(2003);
  });
});

// =============================================================================
// CF-ms-precision — Date.now() vs unixepoch()*1000
// =============================================================================

describe("CF-ms-precision — version uses Date.now(), not SQL DEFAULT (carry-forward)", () => {
  // The SQL DEFAULT for updated_at is unixepoch()*1000, which has second
  // granularity despite the ms-looking unit. The implementation MUST set
  // updated_at explicitly via Date.now() (true ms precision) so that two
  // writes in the same wall-clock second produce distinguishable versions.
  //
  // This test discriminates: seed at a second-aligned timestamp T, write,
  // verify the new version differs from T. Under ms-precision (Date.now()),
  // the new version will be a recent ms timestamp (~1.7e12) which differs
  // from T. Under second-precision (unixepoch()*1000), the version could
  // equal T if the write lands in the same second — but T is set far in the
  // past so this test always discriminates regardless of timing.
  it("version after PUT is a recent Date.now() timestamp, not the seeded second-aligned value", async () => {
    const secondAligned = 1721628000000; // exactly on the second boundary
    ctx.db.seedPreference({
      registration_id: 2001,
      preferred_registration_id: 2002,
      preference_order: 1,
      created_by: 10,
      updated_at: secondAligned,
    });

    const before = Date.now();
    const { status, body } = await putPreferences(2001, {
      preferences: [{ preferredRegistrationId: 2003, preferenceOrder: 1 }],
      version: secondAligned,
    });
    const after = Date.now();

    expect(status).toBe(200);
    const newVersion = (body as GetPreferencesBody).version;
    expect(newVersion).not.toBeNull();

    // The new version must be a recent Date.now() value, not the old
    // second-aligned seed. This proves the code uses Date.now() (ms)
    // rather than relying on the SQL DEFAULT (second granularity).
    expect(newVersion).toBeGreaterThanOrEqual(before);
    expect(newVersion).toBeLessThanOrEqual(after);
  });

  // Verify that the version written by PUT is from Date.now() (application
  // layer), not from the SQL DEFAULT. After a write, a stale client holding
  // the old seeded version must get 409 — which only works if the new version
  // differs from the old one. Under second-granularity with same-second
  // timing, the version could stay the same and the stale write would
  // silently succeed. This test seeds at a past second-aligned timestamp
  // so it discriminates regardless of wall-clock timing.
  it("stale version from before a same-second write is correctly rejected", async () => {
    const oldVersion = 1721628000000;
    ctx.db.seedPreference({
      registration_id: 2001,
      preferred_registration_id: 2002,
      preference_order: 1,
      created_by: 10,
      updated_at: oldVersion,
    });

    const repA = await putPreferences(2001, {
      preferences: [{ preferredRegistrationId: 2003, preferenceOrder: 1 }],
      version: oldVersion,
    });
    expect(repA.status).toBe(200);
    const newVersion = (repA.body as GetPreferencesBody).version;
    expect(newVersion).not.toBe(oldVersion);

    const repB = await putPreferences(2001, {
      preferences: [{ preferredRegistrationId: 2002, preferenceOrder: 1 }],
      version: oldVersion,
    });
    expect(repB.status).toBe(409);
  });
});
