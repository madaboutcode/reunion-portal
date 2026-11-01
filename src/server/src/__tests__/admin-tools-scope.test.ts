/**
 * Route-level tests for the `admin-tools` scope (RBAC cycle 2026-07-23, slice t5).
 *
 * Proves the wire-up from `docs/specs/access-control.spec.md`:
 *   - R2 row 5 / R6 (admin-tools section): the three admin-system endpoints are
 *     gated on `requireScope('admin-tools')`, not `dashboard`.
 *   - R3.4 / G7(f): `VALID_SCOPES` in admin.routes.ts accepts `"admin-tools"`
 *     and still rejects unknown scope strings.
 *   - R2.2: admin role bypasses the scope check.
 *
 * Self-contained: builds its own Hono app with stub DI (does not import the
 * shared harness in auth-roles.test.ts), so the three handlers return a clean
 * 200 on the allow path regardless of service configuration.
 *
 * @module admin-tools-scope.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { handleError } from "../middleware/error.middleware.js";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { staffRoutes } from "../routes/staff.routes.js";
import { adminRoutes } from "../routes/admin.routes.js";
import { signToken } from "../infra/jwt.js";
import type {
  IUserRepository,
  ISystemAuditRepository,
  IRegistrationRepository,
  IPaymentRepository,
} from "../repositories/interfaces.js";
import type { AuthService } from "../services/auth.service.js";
import type { RegistrationService } from "../services/registration.service.js";

const TEST_JWT_SECRET = "test-secret-key-for-admin-tools-scope-32chars!";

// The three admin-tools endpoints under test (spec R6 admin-tools section).
const ADMIN_TOOLS_ENDPOINTS = [
  "/api/staff/regenerate-thumbnails",
  "/api/staff/sync-public-thumbnails",
  "/api/staff/reconcile-statuses",
] as const;

// ---------------------------------------------------------------------------
// Scope-probe D1 fake — resolveScopes() reads
// `SELECT permissions FROM users WHERE id = ?`. Returns the seeded permissions
// JSON string (or null) per userId; a missing row yields null (deleted user).
// ---------------------------------------------------------------------------
function createScopeDb(rows: Record<number, string | null>) {
  const table = new Map<number, string | null>(
    Object.entries(rows).map(([id, permissions]) => [Number(id), permissions]),
  );
  return {
    prepare(_sql: string) {
      return {
        bind: (...args: unknown[]) => ({
          async first<T>(): Promise<T | null> {
            const id = args[0] as number;
            if (!table.has(id)) return null;
            return { permissions: table.get(id) ?? null } as T;
          },
        }),
      };
    },
  };
}

function envWith(db: unknown) {
  return { JWT_SECRET: TEST_JWT_SECRET, DB: db } as unknown as import("../env.js").Env;
}

// ---------------------------------------------------------------------------
// Stub services/repos — just enough for the three handlers + admin create to
// run to a clean success once the scope/validation gate has passed.
// ---------------------------------------------------------------------------
const stubRegistrationService = {
  async regenerateMissingThumbnails() {
    return { total: 0, succeeded: 0, failed: 0, errors: [] };
  },
  async syncThumbsToPublicBucket() {
    return { total: 0, succeeded: 0, failed: 0, errors: [] };
  },
} as unknown as RegistrationService;

const stubRegistrationRepo = {
  async list() {
    return [];
  },
} as unknown as IRegistrationRepository;

const stubPaymentRepo = {
  async findByRegistration() {
    return [];
  },
} as unknown as IPaymentRepository;

const stubSystemAuditRepo = {
  async append() {
    /* no-op */
  },
} as unknown as ISystemAuditRepository;

const stubUserRepo = {
  async create() {
    return { id: 1 };
  },
  async findById(id: number) {
    return {
      id,
      email: "new-staff@example.test",
      name: "New Staff",
      role: "staff" as const,
      isActive: true,
      permissions: { scopes: ["admin-tools"] },
      createdBy: 99,
      createdAt: 0,
      updatedAt: 0,
    };
  },
} as unknown as IUserRepository;

const stubAuthService = {
  async requestMagicLink() {
    /* no-op */
  },
} as unknown as AuthService;

function createApp() {
  _scopeCache.clear();

  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);

  app.use("*", async (c, next) => {
    c.set("registrationService", stubRegistrationService);
    c.set("registrationRepo", stubRegistrationRepo);
    c.set("paymentRepo", stubPaymentRepo);
    c.set("systemAuditRepo", stubSystemAuditRepo);
    c.set("userRepo", stubUserRepo);
    c.set("authService", stubAuthService);
    await next();
  });

  app.route("/staff", staffRoutes);
  app.route("/admin", adminRoutes);

  return app;
}

function staffToken(userId: number, email = "staff@example.test") {
  return signToken({ sub: String(userId), role: "staff", email }, TEST_JWT_SECRET, "7d");
}

function adminTokenFor(userId: number, email = "admin@example.test") {
  return signToken({ sub: String(userId), role: "admin", email }, TEST_JWT_SECRET, "7d");
}

function post(app: Hono<AppEnv>, path: string, token: string, db: unknown, body?: unknown) {
  return app.request(
    path,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    },
    envWith(db),
  );
}

describe("admin-tools scope gate on system-maintenance endpoints (R2 row 5, R6)", () => {
  let app: Hono<AppEnv>;

  beforeEach(() => {
    app = createApp();
  });

  it("a staff user with [\"admin-tools\"] gets 200 on all three endpoints", async () => {
    const db = createScopeDb({ 10: JSON.stringify({ scopes: ["admin-tools"] }) });
    const token = await staffToken(10);
    for (const path of ADMIN_TOOLS_ENDPOINTS) {
      const res = await post(app, path, token, db, { dryRun: true });
      expect(res.status, `${path} should allow admin-tools`).toBe(200);
    }
  });

  it("a staff user with only [\"dashboard\"] gets 403 on all three endpoints", async () => {
    const db = createScopeDb({ 11: JSON.stringify({ scopes: ["dashboard"] }) });
    const token = await staffToken(11);
    for (const path of ADMIN_TOOLS_ENDPOINTS) {
      const res = await post(app, path, token, db, { dryRun: true });
      expect(res.status, `${path} should deny dashboard-only`).toBe(403);
      const bodyJson = (await res.json()) as { error: string };
      expect(bodyJson.error).toBe("Insufficient permissions");
    }
  });

  it("an admin (role) gets 200 on all three endpoints regardless of permissions (R2.2 bypass)", async () => {
    // Admin has no users row at all — admin bypass must not consult the DB.
    const db = createScopeDb({});
    const token = await adminTokenFor(99);
    for (const path of ADMIN_TOOLS_ENDPOINTS) {
      const res = await post(app, path, token, db, { dryRun: true });
      expect(res.status, `${path} should bypass for admin`).toBe(200);
    }
  });

  it("a staff user with NULL permissions (unscoped default) gets 200 (R2.1 full access)", async () => {
    const db = createScopeDb({ 12: null });
    const token = await staffToken(12);
    const res = await post(app, ADMIN_TOOLS_ENDPOINTS[0], token, db, { dryRun: true });
    expect(res.status).toBe(200);
  });
});

describe("VALID_SCOPES accepts admin-tools (R3.4, G7f)", () => {
  let app: Hono<AppEnv>;

  beforeEach(() => {
    app = createApp();
  });

  it("admin can create a staff user scoped to [\"admin-tools\"] — 201, not 422", async () => {
    const db = createScopeDb({});
    const token = await adminTokenFor(99);
    const res = await post(app, "/api/admin/users", token, db, {
      email: "new-staff@example.test",
      name: "New Staff",
      role: "staff",
      permissions: { scopes: ["admin-tools"] },
    });
    expect(res.status).toBe(201);
  });

  it("still rejects an unknown scope string with 422 (validator is real)", async () => {
    const db = createScopeDb({});
    const token = await adminTokenFor(99);
    const res = await post(app, "/api/admin/users", token, db, {
      email: "new-staff@example.test",
      name: "New Staff",
      role: "staff",
      permissions: { scopes: ["not-a-real-scope"] },
    });
    expect(res.status).toBe(422);
    const bodyJson = (await res.json()) as { error: string };
    expect(bodyJson.error).toContain("Invalid scope");
  });
});
