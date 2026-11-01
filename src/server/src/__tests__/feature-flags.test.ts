/**
 * Route-level tests for feature-flags.routes.ts.
 *
 * Contract under test (see the route file's CONTRACT header):
 *  - AUTH_REQUIRED: 401 without a JWT; 403 for attendee/staff roles;
 *    admin reads succeed.
 *  - FAIL_CLOSED: unknown flag → enabled:false; DB failure (e.g. missing
 *    feature_flags table) → enabled:false, not a 500.
 *  - 400 on malformed flag names.
 *
 * Part of the debug-exposure layered defense (access-control.spec.md G8):
 * layer 2's client gate can only see enabled:true from a real enabled=1 row
 * read by an authenticated admin.
 *
 * Uses the Hono test client pattern: real route handlers, in-memory D1 fake.
 * No mock libraries.
 *
 * @module feature-flags.test
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { featureFlagsRoutes } from "../routes/feature-flags.routes.js";
import { signToken } from "../infra/jwt.js";

const TEST_JWT_SECRET = "test-secret-key-for-feature-flag-tests-32ch!";

// ---------------------------------------------------------------------------
// Minimal D1 fake for: SELECT enabled FROM feature_flags WHERE name = ?
// ---------------------------------------------------------------------------

function createFakeFlagsDb(flags: Record<string, number>, opts: { throwOnQuery?: boolean } = {}) {
  return {
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => ({
          async first<T>(): Promise<T | null> {
            if (opts.throwOnQuery) {
              throw new Error("no such table: feature_flags");
            }
            if (sql.includes("FROM feature_flags")) {
              const name = args[0] as string;
              if (name in flags) return { enabled: flags[name] } as T;
              return null;
            }
            return null;
          },
        }),
      };
    },
  };
}

function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.route("/feature-flags", featureFlagsRoutes);
  return app;
}

function envWith(db: unknown) {
  return { JWT_SECRET: TEST_JWT_SECRET, DB: db } as unknown as import("../env.js").Env;
}

function adminToken(): Promise<string> {
  return signToken({ sub: "1", role: "admin", email: "admin@test.dev" }, TEST_JWT_SECRET, "7d");
}

function staffToken(): Promise<string> {
  return signToken({ sub: "2", role: "staff", email: "staff@test.dev" }, TEST_JWT_SECRET, "7d");
}

function attendeeToken(): Promise<string> {
  return signToken({ sub: "3", role: "attendee" }, TEST_JWT_SECRET, "90d");
}

// ---------------------------------------------------------------------------
// AUTH_REQUIRED
// ---------------------------------------------------------------------------

describe("feature-flags routes — auth", () => {
  it("returns 401 without an Authorization header", async () => {
    const app = buildApp();
    const res = await app.request(
      "/feature-flags/debug_tools",
      {},
      envWith(createFakeFlagsDb({ debug_tools: 1 })),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for an attendee JWT", async () => {
    const app = buildApp();
    const res = await app.request(
      "/feature-flags/debug_tools",
      { headers: { Authorization: `Bearer ${await attendeeToken()}` } },
      envWith(createFakeFlagsDb({ debug_tools: 1 })),
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 for a staff JWT (admin role required)", async () => {
    const app = buildApp();
    const res = await app.request(
      "/feature-flags/debug_tools",
      { headers: { Authorization: `Bearer ${await staffToken()}` } },
      envWith(createFakeFlagsDb({ debug_tools: 1 })),
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Flag reads (admin)
// ---------------------------------------------------------------------------

describe("feature-flags routes — reads", () => {
  it("returns enabled:true for an enabled flag", async () => {
    const app = buildApp();
    const res = await app.request(
      "/feature-flags/debug_tools",
      { headers: { Authorization: `Bearer ${await adminToken()}` } },
      envWith(createFakeFlagsDb({ debug_tools: 1 })),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "debug_tools", enabled: true });
  });

  it("returns enabled:false for a disabled flag (seed state)", async () => {
    const app = buildApp();
    const res = await app.request(
      "/feature-flags/debug_tools",
      { headers: { Authorization: `Bearer ${await adminToken()}` } },
      envWith(createFakeFlagsDb({ debug_tools: 0 })),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "debug_tools", enabled: false });
  });

  it("fails closed on an unknown flag name (enabled:false, not 404/500)", async () => {
    const app = buildApp();
    const res = await app.request(
      "/feature-flags/nonexistent_flag",
      { headers: { Authorization: `Bearer ${await adminToken()}` } },
      envWith(createFakeFlagsDb({ debug_tools: 1 })),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "nonexistent_flag", enabled: false });
  });

  it("fails closed when the query throws (e.g. missing table)", async () => {
    const app = buildApp();
    const res = await app.request(
      "/feature-flags/debug_tools",
      { headers: { Authorization: `Bearer ${await adminToken()}` } },
      envWith(createFakeFlagsDb({}, { throwOnQuery: true })),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "debug_tools", enabled: false });
  });

  it("rejects malformed flag names with 400", async () => {
    const app = buildApp();
    const res = await app.request(
      "/feature-flags/Not%20A%20Flag!",
      { headers: { Authorization: `Bearer ${await adminToken()}` } },
      envWith(createFakeFlagsDb({ debug_tools: 1 })),
    );
    expect(res.status).toBe(400);
  });
});
