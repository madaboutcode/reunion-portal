/**
 * Physical Room Assignment API — HTTP contract tests (room-assignment.spec.md).
 *
 * Runs the REAL route chain (authMiddleware → requireRole → requireScope →
 * handler), the REAL RoomAssignmentService, and REAL D1RoomRepository
 * against SqliteD1 (a genuine SQLite adapter).
 *
 * Coverage (spec ref → test):
 *   scope    allocation scope passes; staff without it gets 403; attendee
 *            JWT gets 403
 *   R1       room list shows number/notes/active state
 *   R1.1/R2.1 two registrations assigned to the same room+night are both
 *            retained — no capacity rejection
 *   R2       reassigning a registration for the same night replaces the
 *            assignment — still exactly one row
 *   R2.2     a registration may use different rooms on different nights
 *   R2.3     an unrecognized night_date is rejected at the boundary, no
 *            default invented
 *   R2.4     the assignment records the assigning staff user and the system
 *            audit log records the action
 *   Edge     inactive rooms reject new assignments; an assignment already
 *            pointing at a room that later goes inactive remains visible;
 *            deleting (archiving) a registration cascades its assignments
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env } from "../env.js";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { handleError } from "../middleware/error.middleware.js";
import { signToken } from "../infra/jwt.js";
import { SqliteD1 } from "./helpers/sqlite-d1.js";
import { D1RoomRepository } from "../repositories/room.repo.js";
import { D1SystemAuditRepository } from "../repositories/system-audit.repo.js";
import { RoomAssignmentService } from "../services/room-assignment.service.js";
import { roomAssignmentRoutes } from "../routes/room-assignment.routes.js";

const schemaPath = fileURLToPath(new URL("../db/schema.sql", import.meta.url));
const SCHEMA_SQL = readFileSync(schemaPath, "utf8");

const TEST_JWT_SECRET = "test-secret-key-for-room-api-tests-32chars!!!";

interface Harness {
  db: SqliteD1;
  req: (input: string, init?: RequestInit) => Promise<Response>;
  insertUser: (email: string, permissions: string | null) => number;
  insertRegistration: (overrides?: { regCode?: string; fullName?: string }) => number;
}

function createHarness(): Harness {
  const db = new SqliteD1();
  db.loadSchema(SCHEMA_SQL);
  const d1 = db as unknown as import("@cloudflare/workers-types").D1Database;

  const roomRepo = new D1RoomRepository(d1);
  const systemAuditRepo = new D1SystemAuditRepository(d1);

  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);
  app.use("*", async (c, next) => {
    c.set("roomRepo", roomRepo);
    c.set("roomAssignmentService", new RoomAssignmentService({ roomRepo, systemAuditRepo }));
    await next();
  });
  app.route("/staff/allocation", roomAssignmentRoutes);

  const env = { JWT_SECRET: TEST_JWT_SECRET, DB: db } as unknown as Env;
  const req = (input: string, init?: RequestInit) => Promise.resolve(app.request(input, init, env));

  let regSeq = 1001;
  return {
    db,
    req,
    insertUser(email: string, permissions: string | null) {
      const info = db.raw
        .prepare("INSERT INTO users (email, name, role, is_active, permissions) VALUES (?, ?, 'staff', 1, ?)")
        .run(email, email.split("@")[0], permissions);
      return Number(info.lastInsertRowid);
    },
    insertRegistration(overrides = {}) {
      const id = regSeq++;
      db.raw
        .prepare(
          `INSERT INTO registrations (
             id, reg_code, status, full_name, branch, email, whatsapp, city, country,
             attendance_intent, participation_type, alumni_meal, accommodation,
             contribution_splits, pricing_snapshot, total_amount
           ) VALUES (?, ?, 'pending', ?, 'CS', ?, ?, 'Kochi', 'India',
             'attending', 'full_celebration', 'veg', 'shared_double', '{}',
             '{"base":5500,"lines":[],"donation":0,"collegeContribution":0,"total":5500}', 5500)`,
        )
        .run(
          id,
          overrides.regCode ?? `SMRT${id}`,
          overrides.fullName ?? "Ravi Kumar",
          `ravi${id}@example.com`,
          `+9198765${id}`,
        );
      return id;
    },
  };
}

async function staffToken(userId: number, email = "alloc@example.com") {
  return signToken({ sub: String(userId), role: "staff", email }, TEST_JWT_SECRET, "7d");
}

async function adminToken(userId: number) {
  return signToken({ sub: String(userId), role: "admin", email: "admin@example.com" }, TEST_JWT_SECRET, "7d");
}

async function attendeeToken(regId: number) {
  return signToken({ sub: String(regId), role: "attendee" }, TEST_JWT_SECRET, "7d");
}

function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string) {
  return { ...auth(token), "Content-Type": "application/json" };
}

// ---------------------------------------------------------------------------
// Scope gate
// ---------------------------------------------------------------------------

describe("room-assignment API — scope gate", () => {
  let h: Harness;
  beforeEach(() => {
    _scopeCache.clear();
    h = createHarness();
  });

  it("403 for a staff user without the allocation scope", async () => {
    const user = h.insertUser("dashboard@example.com", JSON.stringify({ scopes: ["dashboard"] }));
    const token = await staffToken(user);
    const res = await h.req("/api/staff/allocation/rooms", { headers: auth(token) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Insufficient permissions" });
  });

  it("403 for an attendee JWT", async () => {
    const regId = h.insertRegistration();
    const token = await attendeeToken(regId);
    const res = await h.req("/api/staff/allocation/rooms", { headers: auth(token) });
    expect(res.status).toBe(403);
  });

  it("401 with no token", async () => {
    const res = await h.req("/api/staff/allocation/rooms");
    expect(res.status).toBe(401);
  });

  it("a staff user WITH the allocation scope can list rooms", async () => {
    const user = h.insertUser("alloc@example.com", JSON.stringify({ scopes: ["allocation"] }));
    const token = await staffToken(user);
    const res = await h.req("/api/staff/allocation/rooms", { headers: auth(token) });
    expect(res.status).toBe(200);
  });

  it("admin bypasses the scope check", async () => {
    const token = await adminToken(99);
    const res = await h.req("/api/staff/allocation/rooms", { headers: auth(token) });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// R1 — physical rooms
// ---------------------------------------------------------------------------

describe("room-assignment API — rooms (R1)", () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    _scopeCache.clear();
    h = createHarness();
    const user = h.insertUser("alloc@example.com", JSON.stringify({ scopes: ["allocation"] }));
    token = await staffToken(user);
  });

  it("creates a room and the list shows its number, notes, and active state (R1)", async () => {
    const createRes = await h.req("/api/staff/allocation/rooms", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomNumber: "204", notes: "Sea-facing" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: number; roomNumber: string; notes: string; isActive: boolean };
    expect(created).toMatchObject({ roomNumber: "204", notes: "Sea-facing", isActive: true });

    const listRes = await h.req("/api/staff/allocation/rooms", { headers: auth(token) });
    const body = (await listRes.json()) as { rooms: Array<{ roomNumber: string; notes: string; isActive: boolean }>; total: number };
    expect(body.total).toBe(1);
    expect(body.rooms[0]).toMatchObject({ roomNumber: "204", notes: "Sea-facing", isActive: true });
  });

  it("422 on a missing roomNumber", async () => {
    const res = await h.req("/api/staff/allocation/rooms", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ notes: "x" }),
    });
    expect(res.status).toBe(422);
  });

  it("409 on a duplicate room number", async () => {
    await h.req("/api/staff/allocation/rooms", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomNumber: "204" }),
    });
    const res = await h.req("/api/staff/allocation/rooms", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomNumber: "204" }),
    });
    expect(res.status).toBe(409);
  });

  it("PUT updates a room's active state; 404 for an unknown room", async () => {
    const createRes = await h.req("/api/staff/allocation/rooms", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomNumber: "204" }),
    });
    const { id } = (await createRes.json()) as { id: number };

    const updateRes = await h.req(`/api/staff/allocation/rooms/${id}`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ isActive: false }),
    });
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()) as { isActive: boolean }).toMatchObject({ isActive: false });

    const missingRes = await h.req("/api/staff/allocation/rooms/999999", {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ isActive: false }),
    });
    expect(missingRes.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// R1.1 / R2 / R2.1 / R2.2 / R2.3 / R2.4 — assignments
// ---------------------------------------------------------------------------

describe("room-assignment API — assignments", () => {
  let h: Harness;
  let token: string;
  let userId: number;

  async function createRoom(roomNumber: string) {
    const res = await h.req("/api/staff/allocation/rooms", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomNumber }),
    });
    return ((await res.json()) as { id: number }).id;
  }

  beforeEach(async () => {
    _scopeCache.clear();
    h = createHarness();
    userId = h.insertUser("alloc@example.com", JSON.stringify({ scopes: ["allocation"] }));
    token = await staffToken(userId);
  });

  it("R1.1/R2.1 — two registrations assigned to the same room+night are both retained", async () => {
    const roomId = await createRoom("204");
    const reg1 = h.insertRegistration({ fullName: "Ravi Kumar" });
    const reg2 = h.insertRegistration({ fullName: "Anu Menon" });

    for (const regId of [reg1, reg2]) {
      const res = await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments/2026-08-15`, {
        method: "PUT",
        headers: jsonHeaders(token),
        body: JSON.stringify({ roomId }),
      });
      expect(res.status).toBe(200);
    }

    const listRes = await h.req(`/api/staff/allocation/rooms/${roomId}/assignments?night=2026-08-15`, {
      headers: auth(token),
    });
    const body = (await listRes.json()) as { assignments: Array<{ fullName: string }> };
    expect(body.assignments).toHaveLength(2);
    expect(body.assignments.map((a) => a.fullName).sort()).toEqual(["Anu Menon", "Ravi Kumar"]);
  });

  it("R2 — reassigning the same registration+night replaces the assignment (still one row)", async () => {
    const room204 = await createRoom("204");
    const room205 = await createRoom("205");
    const regId = h.insertRegistration();

    await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments/2026-08-14`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomId: room204 }),
    });
    const secondRes = await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments/2026-08-14`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomId: room205 }),
    });
    expect(secondRes.status).toBe(200);
    expect((await secondRes.json()) as { roomId: number }).toMatchObject({ roomId: room205 });

    const listRes = await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments`, { headers: auth(token) });
    const body = (await listRes.json()) as { assignments: Array<{ nightDate: string; roomId: number }> };
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0]).toMatchObject({ nightDate: "2026-08-14", roomId: room205 });

    const rows = h.db.raw
      .prepare("SELECT COUNT(*) as cnt FROM registration_room_assignments WHERE registration_id = ?")
      .get(regId) as { cnt: number };
    expect(rows.cnt).toBe(1);
  });

  it("R2.2 — a registration may use different rooms on different nights, both remain visible", async () => {
    const room204 = await createRoom("204");
    const room305 = await createRoom("305");
    const regId = h.insertRegistration();

    await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments/2026-08-14`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomId: room204 }),
    });
    await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments/2026-08-15`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomId: room305 }),
    });

    const listRes = await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments`, { headers: auth(token) });
    const body = (await listRes.json()) as { assignments: Array<{ nightDate: string; roomId: number }> };
    expect(body.assignments).toHaveLength(2);
    expect(body.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nightDate: "2026-08-14", roomId: room204 }),
        expect.objectContaining({ nightDate: "2026-08-15", roomId: room305 }),
      ]),
    );
  });

  it("R2.3 — an unrecognized night_date is rejected at the boundary, no default invented", async () => {
    const roomId = await createRoom("204");
    const regId = h.insertRegistration();

    const res = await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments/2026-08-16`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomId }),
    });
    expect(res.status).toBe(422);

    const rows = h.db.raw
      .prepare("SELECT COUNT(*) as cnt FROM registration_room_assignments WHERE registration_id = ?")
      .get(regId) as { cnt: number };
    expect(rows.cnt).toBe(0);
  });

  it("R2.4 — the assignment records the assigning staff user and writes a system audit entry", async () => {
    const roomId = await createRoom("204");
    const regId = h.insertRegistration();

    const res = await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments/2026-08-14`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomId }),
    });
    const body = (await res.json()) as { assignedBy: number };
    expect(body.assignedBy).toBe(userId);

    const auditRow = h.db.raw
      .prepare("SELECT action, actor, target_type, target_id FROM system_audit_log WHERE action = 'room_assignment_created'")
      .get() as { action: string; actor: string; target_type: string; target_id: number };
    expect(auditRow).toMatchObject({
      action: "room_assignment_created",
      actor: "alloc@example.com",
      target_type: "registration",
      target_id: regId,
    });
  });

  it("404 for an unknown registration", async () => {
    const roomId = await createRoom("204");
    const res = await h.req("/api/staff/allocation/registrations/999999/room-assignments/2026-08-14", {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomId }),
    });
    expect(res.status).toBe(404);
  });

  it("404 for an unknown room", async () => {
    const regId = h.insertRegistration();
    const res = await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments/2026-08-14`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomId: 999999 }),
    });
    expect(res.status).toBe(404);
  });

  it("422 for a missing roomId", async () => {
    const regId = h.insertRegistration();
    const res = await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments/2026-08-14`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it("422 for an invalid ?night filter on the room occupant list", async () => {
    const roomId = await createRoom("204");
    const res = await h.req(`/api/staff/allocation/rooms/${roomId}/assignments?night=2026-12-25`, {
      headers: auth(token),
    });
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — inactive rooms, cascade delete
// ---------------------------------------------------------------------------

describe("room-assignment API — edge cases", () => {
  let h: Harness;
  let token: string;

  async function createRoom(roomNumber: string) {
    const res = await h.req("/api/staff/allocation/rooms", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomNumber }),
    });
    return ((await res.json()) as { id: number }).id;
  }

  beforeEach(async () => {
    _scopeCache.clear();
    h = createHarness();
    const user = h.insertUser("alloc@example.com", JSON.stringify({ scopes: ["allocation"] }));
    token = await staffToken(user);
  });

  it("an inactive room cannot receive a new assignment", async () => {
    const roomId = await createRoom("204");
    await h.req(`/api/staff/allocation/rooms/${roomId}`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ isActive: false }),
    });
    const regId = h.insertRegistration();

    const res = await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments/2026-08-14`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomId }),
    });
    expect(res.status).toBe(409);
  });

  it("an existing assignment to a room that later goes inactive remains visible", async () => {
    const roomId = await createRoom("204");
    const regId = h.insertRegistration();
    await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments/2026-08-14`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomId }),
    });

    await h.req(`/api/staff/allocation/rooms/${roomId}`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ isActive: false }),
    });

    const listRes = await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments`, { headers: auth(token) });
    const body = (await listRes.json()) as { assignments: Array<{ roomId: number; roomIsActive: boolean }> };
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0]).toMatchObject({ roomId, roomIsActive: false });
  });

  it("archiving (hard-deleting) a registration cascades its assignments away", async () => {
    const roomId = await createRoom("204");
    const regId = h.insertRegistration();
    await h.req(`/api/staff/allocation/registrations/${regId}/room-assignments/2026-08-14`, {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({ roomId }),
    });

    let rows = h.db.raw
      .prepare("SELECT COUNT(*) as cnt FROM registration_room_assignments WHERE registration_id = ?")
      .get(regId) as { cnt: number };
    expect(rows.cnt).toBe(1);

    // Mirrors the archive flow's hard delete (room-availability.spec.md R2.4):
    // registrations are hard-deleted, not soft-flagged.
    h.db.raw.prepare("DELETE FROM registrations WHERE id = ?").run(regId);

    rows = h.db.raw
      .prepare("SELECT COUNT(*) as cnt FROM registration_room_assignments WHERE registration_id = ?")
      .get(regId) as { cnt: number };
    expect(rows.cnt).toBe(0);
  });
});
