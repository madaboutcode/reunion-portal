/**
 * Registration Desk API — HTTP contract tests (docs/specs/interfaces/
 * registration-desk-api.ispec.md R1–R6).
 *
 * Runs the REAL route chain (authMiddleware → requireRole → requireScope →
 * handler), the REAL RegistrationDeskService, and REAL D1 repositories
 * against SqliteD1 (a genuine SQLite adapter) — only the storage bucket is a
 * fake. A passing test proves the wired contract, not a stubbed handler.
 *
 * Coverage (ispec ref → test):
 *   R1/R1.1  staff-without-scope 403; attendee JWT 403; admin bypass; desk
 *            scope grants nothing else
 *   R2/R2.1  search shape; donation-only excluded; empty query 422
 *   R3/R3.1  lookup shape; pending → payment_pending + amountDue; confirmed →
 *            confirmed; unknown code 404; donation-only 404; t-shirt rows
 *            (included-first ordering, empty array, no charge/amount leak)
 *   R3.3     photo serves image data, never the storage key; missing → 404
 *   R4/R4.1  check-in writes one row + audit; repeat returns original
 *            timestamp; donation-only 404
 *   R5       spot registration: missing key 422; unknown field 422; creation
 *            writes donor pseudo-email + pending payment + audit; same key/
 *            body replays; same key/different body 409; duplicate WhatsApp 409
 *
 * @module registration-desk-api.test
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env, ImagesBinding } from "../env.js";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { handleError } from "../middleware/error.middleware.js";
import { signToken } from "../infra/jwt.js";
import { SqliteD1 } from "./helpers/sqlite-d1.js";
import { D1DeskRepository } from "../repositories/desk.repo.js";
import { D1RegistrationRepository } from "../repositories/registration.repo.js";
import { D1AttendeeRepository } from "../repositories/attendee.repo.js";
import { D1PaymentRepository } from "../repositories/payment.repo.js";
import { D1RoomRepository } from "../repositories/room.repo.js";
import { D1AuditRepository } from "../repositories/audit.repo.js";
import { D1TshirtRepository } from "../repositories/tshirt.repo.js";
import { D1AdditionalChargeRepository } from "../repositories/additional-charge.repo.js";
import { D1RefundRepository } from "../repositories/refund.repo.js";
import { R2FileStorage } from "../repositories/file-storage.js";
import { RegistrationDeskService } from "../services/registration-desk.service.js";
import { RegistrationService } from "../services/registration.service.js";
import { TshirtChargeService } from "../services/tshirt-charge.service.js";
import { PricingService } from "../services/pricing.service.js";
import { MockEmailService } from "../infra/email.service.js";
import type {
  AdditionalPaymentEmailData,
  PaymentConfirmedEmailData,
  RevisedPaymentEmailData,
} from "../repositories/interfaces.js";
import { registrationDeskRoutes } from "../routes/registration-desk.routes.js";

/**
 * Observable email fake — records every additional/revised payment call so
 * tests can prove the desk add-charge notification actually fired (or
 * didn't), not just that the response came back 200. Everything else falls
 * through to MockEmailService's console-log no-ops.
 */
class SpyEmailService extends MockEmailService {
  additionalPaymentCalls: Array<{ to: string; data: AdditionalPaymentEmailData }> = [];
  revisedPaymentCalls: Array<{ to: string; data: RevisedPaymentEmailData }> = [];
  paymentConfirmedCalls: Array<{ to: string; data: PaymentConfirmedEmailData }> = [];

  override async sendAdditionalPayment(to: string, data: AdditionalPaymentEmailData): Promise<void> {
    this.additionalPaymentCalls.push({ to, data });
  }

  override async sendRevisedPayment(to: string, data: RevisedPaymentEmailData): Promise<void> {
    this.revisedPaymentCalls.push({ to, data });
  }

  override async sendPaymentConfirmed(to: string, data: PaymentConfirmedEmailData): Promise<void> {
    this.paymentConfirmedCalls.push({ to, data });
  }
}

const schemaPath = fileURLToPath(new URL("../db/schema.sql", import.meta.url));
const SCHEMA_SQL = readFileSync(schemaPath, "utf8");

const TEST_JWT_SECRET = "test-secret-key-for-desk-api-tests-32chars!!";

// ---------------------------------------------------------------------------
// Minimal in-memory R2 bucket (only what R2FileStorage.get/put touch).
// ---------------------------------------------------------------------------

class FakeBucket {
  private objects = new Map<string, { data: Uint8Array; contentType: string }>();
  /** Number of get() reads — lets tests prove a request never touched storage. */
  getCalls = 0;

  async put(key: string, data: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
    this.objects.set(key, {
      data: new Uint8Array(data),
      contentType: opts?.httpMetadata?.contentType ?? "",
    });
  }

  async get(key: string) {
    this.getCalls++;
    const obj = this.objects.get(key);
    if (!obj) return null;
    return {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(obj.data);
          controller.close();
        },
      }),
      // R2FileStorage.copy() (used by move(), which relocateFiles calls)
      // reads bytes via arrayBuffer() on the real R2Object, not the stream.
      arrayBuffer: async () => obj.data.slice().buffer as ArrayBuffer,
      httpMetadata: { contentType: obj.contentType },
      size: obj.data.byteLength,
    };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  has(key: string) {
    return this.objects.has(key);
  }
}

// ---------------------------------------------------------------------------
// Fakes for the photo finalization path (registrationService.relocateFiles,
// invoked via c.executionCtx.waitUntil — see registration-desk.routes.ts).
// ---------------------------------------------------------------------------

const THUMB_BYTES = new Uint8Array([9, 8, 7, 6]).buffer;

/** Fixed-output Images binding fake — same shape used across the suite (see photo-replacement.test.ts). */
function fakeImagesBinding(): ImagesBinding {
  return {
    input() {
      return {
        transform() {
          return this;
        },
        async output() {
          return { response: () => new Response(THUMB_BYTES) };
        },
      };
    },
  };
}

/** The transform/output options recorded for one Images pipeline call. */
interface RecordedImagesCall {
  transform: { width?: number; height?: number; fit?: string; gravity?: string };
  output: { format: string; quality?: number };
}

/**
 * Images binding fake that RECORDS the transform/output options so tests can
 * assert the resize arguments (square size, face crop, JPEG format/quality)
 * rather than only that bytes came back.
 */
function spyImagesBinding(): { binding: ImagesBinding; calls: RecordedImagesCall[] } {
  const calls: RecordedImagesCall[] = [];
  const binding: ImagesBinding = {
    input() {
      return {
        transform(opts: { width?: number; height?: number; fit?: string; gravity?: string }) {
          calls.push({ transform: opts, output: { format: "" } });
          return this;
        },
        async output(opts: { format: string; quality?: number }) {
          calls[calls.length - 1].output = opts;
          return { response: () => new Response(THUMB_BYTES) };
        },
      };
    },
  };
  return { binding, calls };
}

/** In-memory public thumbs bucket — records every publish. */
class FakePublicBucket {
  puts: Array<{ key: string; bytes: Uint8Array }> = [];

  async put(key: string, data: ArrayBuffer) {
    this.puts.push({ key, bytes: new Uint8Array(data) });
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  db: SqliteD1;
  bucket: FakeBucket;
  publicThumbsBucket: FakePublicBucket;
  emailService: SpyEmailService;
  req: (input: string, init?: RequestInit) => Promise<Response>;
  insertUser: (email: string, permissions: string | null) => number;
  insertRegistration: (overrides?: {
    regCode?: string;
    status?: string;
    fullName?: string;
    email?: string;
    whatsapp?: string;
    participationType?: string;
    totalAmount?: number;
    photoThumbKey?: string | null;
    photoFileKey?: string | null;
    checkedInAt?: number | null;
    checkedInBy?: number | null;
  }) => number;
  insertAttendee: (regId: number, type: string, name: string, meal: string, age?: number) => void;
  insertTshirt: (regId: number, gender: string | null, size: string, isIncluded: 0 | 1) => void;
  insertCharge: (regId: number, description: string, amount: number, createdBy: number) => void;
  /** Creates the room if needed (idempotent by room_number), then assigns it for a night. */
  insertRoomAssignment: (regId: number, roomNumber: string, nightDate: string, assignedBy: number) => void;
  insertPayment: (
    regId: number,
    status: "payment_pending" | "pending_verification" | "verified",
    amount: number,
  ) => number;
  getPayments: (regId: number) => Array<{
    id: number;
    status: string;
    amount: number;
    method: string | null;
    note: string | null;
    verified_by: string | null;
    verified_at: number | null;
    proof_file_key: string | null;
    gateway_ref: string | null;
    gateway_response: string | null;
  }>;
  getAuditSnapshots: (regId: number) => Array<{ action: string; snapshot: unknown }>;
  getAuditActions: (regId: number) => string[];
}

function createHarness(envOverrides: Partial<Env> = {}, options: { omitImagesBinding?: boolean } = {}): Harness {
  const db = new SqliteD1();
  db.loadSchema(SCHEMA_SQL);
  const bucket = new FakeBucket();
  const publicThumbsBucket = new FakePublicBucket();
  const d1 = db as unknown as import("@cloudflare/workers-types").D1Database;

  const deskRepo = new D1DeskRepository(d1);
  const registrationRepo = new D1RegistrationRepository(d1);
  const attendeeRepo = new D1AttendeeRepository(d1);
  const paymentRepo = new D1PaymentRepository(d1);
  const roomRepo = new D1RoomRepository(d1);
  const auditRepo = new D1AuditRepository(d1);
  const tshirtRepo = new D1TshirtRepository(d1);
  const chargeRepo = new D1AdditionalChargeRepository(d1);
  const refundRepo = new D1RefundRepository(d1);
  const emailService = new SpyEmailService("http://localhost:5173");
  const tshirtChargeService = new TshirtChargeService({
    registrationRepo,
    attendeeRepo,
    paymentRepo,
    auditRepo,
    tshirtRepo,
    chargeRepo,
  });
  const fileStorage = new R2FileStorage(bucket as unknown as import("@cloudflare/workers-types").R2Bucket);

  // Drives the SAME finalization self-registration uses (relocateFiles) — the
  // desk route calls c.var.registrationService.relocateFiles(id, regCode) via
  // c.executionCtx.waitUntil after a successful spot registration with a photo.
  const registrationService = new RegistrationService({
    registrationRepo,
    attendeeRepo,
    auditRepo: { append: async () => {}, findByRegistration: async () => [] } as never,
    documentRepo: { findByRegistration: async () => [] } as never,
    emailService: {} as never,
    fileStorage,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FakePublicBucket only implements .put
    publicThumbsBucket: publicThumbsBucket as any,
    imagesBinding: options.omitImagesBinding ? undefined : fakeImagesBinding(),
    pricingService: new PricingService(),
    availabilityService: {} as never,
    authService: { issueAttendeeToken: async () => "", createPaymentLinkUrl: async () => "" },
  });

  const app = new Hono<AppEnv>().basePath("/api");
  app.onError(handleError);
  app.use("*", async (c, next) => {
    c.set("deskRepo", deskRepo);
    c.set("roomRepo", roomRepo);
    c.set("deskService", new RegistrationDeskService({
      deskRepo,
      registrationRepo,
      attendeeRepo,
      paymentRepo,
      roomRepo,
      pricingService: new PricingService(),
      auditRepo,
      tshirtChargeService,
      emailService,
      refundRepo,
      appBaseUrl: "https://app.example.test",
    }));
    c.set("registrationService", registrationService);
    c.set("registrationRepo", registrationRepo);
    c.set("attendeeRepo", attendeeRepo);
    c.set("paymentRepo", paymentRepo);
    c.set("fileStorage", fileStorage);
    await next();
  });
  app.route("/staff/desk", registrationDeskRoutes);

  const env = { JWT_SECRET: TEST_JWT_SECRET, DB: db, ...envOverrides } as unknown as Env;

  // registration-desk.routes.ts calls c.executionCtx.waitUntil() to finalize
  // a spot registration's photo in the background — app.request() needs a
  // fake ExecutionContext, or that call throws. Each request awaits its own
  // captured waitUntil promise(s) before resolving, so tests can assert on
  // the finalized state deterministically without racing the background work.
  const req = async (input: string, init?: RequestInit) => {
    const captured: Promise<unknown>[] = [];
    const execCtx = {
      waitUntil: (p: Promise<unknown>) => { captured.push(p.catch(() => {})); },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    const res = await app.request(input, init, env, execCtx);
    await Promise.all(captured);
    return res;
  };

  return {
    db,
    bucket,
    publicThumbsBucket,
    emailService,
    req,
    insertUser(email: string, permissions: string | null) {
      const info = db.raw
        .prepare("INSERT INTO users (email, name, role, is_active, permissions) VALUES (?, ?, 'staff', 1, ?)")
        .run(email, email.split("@")[0], permissions);
      return Number(info.lastInsertRowid);
    },
    insertRegistration(overrides = {}) {
      const info = db.raw
        .prepare(
          `INSERT INTO registrations (
             reg_code, status, full_name, branch, email, whatsapp, city, country,
             attendance_intent, participation_type, alumni_meal, accommodation,
             contribution_splits, pricing_snapshot, total_amount, photo_thumb_key,
             photo_file_key, checked_in_at, checked_in_by
           ) VALUES (?, ?, ?, 'CS', ?, ?, 'Kochi', 'India',
             'attending', ?, 'veg', 'none', '{}',
             '{"base":5500,"lines":[],"donation":0,"collegeContribution":0,"total":5500}',
             ?, ?, ?, ?, ?)`,
        )
        .run(
          overrides.regCode ?? "SMRT79WW4A25NWG1",
          overrides.status ?? "pending",
          overrides.fullName ?? "Ravi Kumar",
          overrides.email ?? "ravi@example.com",
          overrides.whatsapp ?? "+919876543210",
          overrides.participationType ?? "full_celebration",
          overrides.totalAmount ?? 5500,
          overrides.photoThumbKey ?? null,
          overrides.photoFileKey ?? null,
          overrides.checkedInAt ?? null,
          overrides.checkedInBy ?? null,
        );
      return Number(info.lastInsertRowid);
    },
    insertAttendee(regId: number, type: string, name: string, meal: string, age?: number) {
      db.raw
        .prepare("INSERT INTO attendees (registration_id, type, name, age, relationship, meal, is_chargeable) VALUES (?, ?, ?, ?, NULL, ?, 1)")
        .run(regId, type, name, age ?? null, meal);
    },
    insertTshirt(regId: number, gender: string | null, size: string, isIncluded: 0 | 1) {
      db.raw
        .prepare("INSERT INTO tshirts (registration_id, gender, size, is_included) VALUES (?, ?, ?, ?)")
        .run(regId, gender, size, isIncluded);
    },
    insertCharge(regId: number, description: string, amount: number, createdBy: number) {
      db.raw
        .prepare("INSERT INTO additional_charges (registration_id, description, amount, created_by) VALUES (?, ?, ?, ?)")
        .run(regId, description, amount, createdBy);
    },
    insertRoomAssignment(regId: number, roomNumber: string, nightDate: string, assignedBy: number) {
      db.raw
        .prepare("INSERT OR IGNORE INTO rooms (room_number) VALUES (?)")
        .run(roomNumber);
      const room = db.raw
        .prepare("SELECT id FROM rooms WHERE room_number = ?")
        .get(roomNumber) as { id: number };
      db.raw
        .prepare(
          "INSERT INTO registration_room_assignments (registration_id, room_id, night_date, assigned_by) VALUES (?, ?, ?, ?)",
        )
        .run(regId, room.id, nightDate, assignedBy);
    },
    insertPayment(regId: number, status: "payment_pending" | "pending_verification" | "verified", amount: number) {
      const info = db.raw
        .prepare("INSERT INTO payments (registration_id, amount, status) VALUES (?, ?, ?)")
        .run(regId, amount, status);
      return Number(info.lastInsertRowid);
    },
    getPayments(regId: number) {
      return db.raw
        .prepare(
          `SELECT id, status, amount, method, note, verified_by, verified_at,
                  proof_file_key, gateway_ref, gateway_response
           FROM payments WHERE registration_id = ? ORDER BY id`,
        )
        .all(regId) as Array<{
          id: number;
          status: string;
          amount: number;
          method: string | null;
          note: string | null;
          verified_by: string | null;
          verified_at: number | null;
          proof_file_key: string | null;
          gateway_ref: string | null;
          gateway_response: string | null;
        }>;
    },
    getAuditSnapshots(regId: number) {
      return (
        db.raw
          .prepare("SELECT action, snapshot FROM audit_log WHERE registration_id = ? ORDER BY id")
          .all(regId) as Array<{ action: string; snapshot: string }>
      ).map((r) => ({ action: r.action, snapshot: JSON.parse(r.snapshot) as unknown }));
    },
    getAuditActions(regId: number) {
      return (
        db.raw
          .prepare("SELECT action FROM audit_log WHERE registration_id = ? ORDER BY id")
          .all(regId) as Array<{ action: string }>
      ).map((r) => r.action);
    },
  };
}

async function staffToken(userId: number, email = "desk@example.com") {
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

const SPOT_BODY = {
  fullName: "Priya Nair",
  whatsapp: "+919812345678",
  branch: "ECE",
  participationType: "campus_only",
  alumniMeal: "non_veg",
  photoFileKey: "photos/pending/ece/priya/abc123.jpg",
  email: "priya.nair@example.com",
  children: [],
  guests: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("desk API — scope gate (ispec R1/R1.1)", () => {
  let h: Harness;
  beforeEach(() => {
    _scopeCache.clear();
    h = createHarness();
  });

  it("403 for a staff user without registration_desk", async () => {
    const deskUser = h.insertUser("desk@example.com", JSON.stringify({ scopes: ["dashboard"] }));
    const token = await staffToken(deskUser);
    const res = await h.req("/api/staff/desk/search?q=ravi", { headers: auth(token) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Insufficient permissions" });
  });

  it("403 for an attendee JWT", async () => {
    h.insertRegistration();
    const token = await attendeeToken(1001);
    const res = await h.req("/api/staff/desk/lookup?code=SMRT79WW4A25NWG1", {
      headers: auth(token),
    });
    expect(res.status).toBe(403);
  });

  it("admin bypasses the scope check", async () => {
    h.insertUser("desk@example.com", null);
    const token = await adminToken(99);
    const res = await h.req("/api/staff/desk/search?q=ravi", { headers: auth(token) });
    expect(res.status).toBe(200);
  });

  it("401 with no token", async () => {
    const res = await h.req("/api/staff/desk/search?q=ravi");
    expect(res.status).toBe(401);
  });
});

describe("desk API — stats (roster counts)", () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    _scopeCache.clear();
    h = createHarness();
    const deskUser = h.insertUser("desk@example.com", JSON.stringify({ scopes: ["registration_desk"] }));
    token = await staffToken(deskUser);
  });

  async function getStats() {
    const res = await h.req("/api/staff/desk/stats", { headers: auth(token) });
    return { res, body: (await res.json()) as import("../domain/desk-mapper.js").DeskStatsResponse };
  }

  it("counts total and present, broken down by participation type", async () => {
    // 3 full (1 present) + 2 campus (1 present). Donation-only must NOT count.
    h.insertRegistration({ regCode: "SMRT0000000000F1", email: "f1@x.com", whatsapp: "+910000000001", participationType: "full_celebration", checkedInAt: 111 });
    h.insertRegistration({ regCode: "SMRT0000000000F2", email: "f2@x.com", whatsapp: "+910000000002", participationType: "full_celebration" });
    h.insertRegistration({ regCode: "SMRT0000000000F3", email: "f3@x.com", whatsapp: "+910000000003", participationType: "full_celebration" });
    h.insertRegistration({ regCode: "SMRT0000000000C1", email: "c1@x.com", whatsapp: "+910000000004", participationType: "campus_only", checkedInAt: 222 });
    h.insertRegistration({ regCode: "SMRT0000000000C2", email: "c2@x.com", whatsapp: "+910000000005", participationType: "campus_only" });
    h.insertRegistration({ regCode: "SMRT0000000000D1", email: "d1@x.com", whatsapp: "+910000000006", participationType: "donation_only", checkedInAt: 333 });

    const { res, body } = await getStats();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      total: 5,
      checkedIn: 2,
      byType: {
        full_celebration: { total: 3, checkedIn: 1 },
        campus_only: { total: 2, checkedIn: 1 },
      },
    });
  });

  it("returns zeros for a type with no registrations", async () => {
    h.insertRegistration({ regCode: "SMRT0000000000F9", email: "f9@x.com", whatsapp: "+910000000009", participationType: "full_celebration" });
    const { body } = await getStats();
    expect(body).toEqual({
      total: 1,
      checkedIn: 0,
      byType: {
        full_celebration: { total: 1, checkedIn: 0 },
        campus_only: { total: 0, checkedIn: 0 },
      },
    });
  });

  it("requires the registration_desk scope", async () => {
    const noScope = h.insertUser("noscope@example.com", JSON.stringify({ scopes: ["dashboard"] }));
    const noScopeToken = await staffToken(noScope);
    const res = await h.req("/api/staff/desk/stats", { headers: auth(noScopeToken) });
    expect(res.status).toBe(403);
  });
});

describe("desk API — search (ispec R2)", () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    _scopeCache.clear();
    h = createHarness();
    const deskUser = h.insertUser("desk@example.com", JSON.stringify({ scopes: ["registration_desk"] }));
    token = await staffToken(deskUser);
  });

  it("returns only the documented narrow result fields", async () => {
    h.insertRegistration({ regCode: "SMRT79WW4A25NWG1", fullName: "Ravi Kumar" });
    const res = await h.req("/api/staff/desk/search?q=ravi", { headers: auth(token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<Record<string, unknown>>;
      thumbsBaseUrl: string;
      photosVersion: number;
    };
    expect(body.results).toHaveLength(1);
    expect(Object.keys(body.results[0]).sort()).toEqual([
      "branch",
      "checkIn",
      "fullName",
      "hasPhoto",
      "id",
      "participationType",
      "regCode",
    ]);
    expect(body.results[0]).toMatchObject({
      id: 1001,
      fullName: "Ravi Kumar",
      regCode: "SMRT79WW4A25NWG1",
      participationType: "full_celebration",
      hasPhoto: false,
      checkIn: { present: false, checkedInAt: null },
    });
  });

  it("hasPhoto is true when a thumbnail is stored; thumbsBaseUrl/photosVersion mirror Who's Coming (ispec R2/R2.5)", async () => {
    h.insertRegistration({
      regCode: "SMRT79WW4A25NWG1",
      fullName: "Ravi Kumar",
      photoThumbKey: "registrations/SMRT79WW4A25NWG1/thumbs/ravi.jpg",
    });
    const res = await h.req("/api/staff/desk/search?q=ravi", { headers: auth(token) });
    const body = (await res.json()) as {
      results: Array<{ hasPhoto: boolean }>;
      thumbsBaseUrl: string;
      photosVersion: number;
    };
    expect(body.results[0].hasPhoto).toBe(true);
    expect(body.thumbsBaseUrl).toBe("/api/public/photos");
    expect(typeof body.photosVersion).toBe("number");
    expect(body.photosVersion).toBeGreaterThan(0);
  });

  it("thumbsBaseUrl comes from PUBLIC_THUMBS_URL when configured", async () => {
    const custom = createHarness({ PUBLIC_THUMBS_URL: "https://cdn.example.test" });
    const deskUser = custom.insertUser("desk2@example.com", JSON.stringify({ scopes: ["registration_desk"] }));
    const customToken = await staffToken(deskUser);
    custom.insertRegistration({ regCode: "SMRT79WW4A25NWG1", fullName: "Ravi Kumar" });
    const res = await custom.req("/api/staff/desk/search?q=ravi", { headers: auth(customToken) });
    const body = (await res.json()) as { thumbsBaseUrl: string };
    expect(body.thumbsBaseUrl).toBe("https://cdn.example.test");
  });

  it("excludes donation-only registrations (spec R3.2)", async () => {
    h.insertRegistration({ fullName: "Ravi Kumar" });
    h.insertRegistration({
      regCode: "SMRT79WW4A25NWG2",
      fullName: "Donor Ravi",
      participationType: "donation_only",
      email: "donor@example.com",
    });
    const res = await h.req("/api/staff/desk/search?q=ravi", { headers: auth(token) });
    const body = (await res.json()) as { results: Array<{ fullName: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0].fullName).toBe("Ravi Kumar");
  });

  it("422 for an empty or whitespace query (ispec R2.1)", async () => {
    for (const q of ["", "   "]) {
      const res = await h.req(`/api/staff/desk/search?q=${encodeURIComponent(q)}`, {
        headers: auth(token),
      });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "Search query is required" });
    }
  });

  it("empty result list for no match (ispec R2.2)", async () => {
    const res = await h.req("/api/staff/desk/search?q=zzzznomatch", { headers: auth(token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[]; thumbsBaseUrl: string; photosVersion: number };
    expect(body.results).toEqual([]);
    // Still carries the documented top-level fields (0 = no rows to version).
    expect(body.thumbsBaseUrl).toBe("/api/public/photos");
    expect(body.photosVersion).toBe(0);
  });
});

describe("desk API — lookup (ispec R3)", () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    _scopeCache.clear();
    h = createHarness();
    const deskUser = h.insertUser("desk@example.com", JSON.stringify({ scopes: ["registration_desk"] }));
    token = await staffToken(deskUser);
  });

  it("returns the exact allowlisted overview for a pending attendee", async () => {
    h.insertRegistration({
      status: "pending",
      totalAmount: 5500,
      photoThumbKey: "registrations/SMRT79WW4A25NWG1/thumbs/ravi.jpg",
    });
    h.insertAttendee(1001, "spouse", "Priya Kumar", "veg");
    h.insertAttendee(1001, "child", "Asha Kumar", "veg", 8);
    h.insertAttendee(1001, "guest", "Maya Nair", "non_veg");

    const res = await h.req("/api/staff/desk/lookup?code=SMRT79WW4A25NWG1", {
      headers: auth(token),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      attendee: {
        id: number;
        fullName: string;
        photo: { available: boolean; url: string };
        whatsapp: string;
        rooms: string[];
        additionalAttendees: Record<string, unknown>;
        payment: { state: string; amountDue?: number };
        checkIn: { present: boolean; checkedInAt: number | null };
      };
    };
    // Photo url is the desk endpoint — never a storage key.
    expect(body.attendee.photo).toEqual({
      available: true,
      url: "/api/staff/desk/registrations/1001/photo",
    });
    // whatsapp is the one permitted contact field (spec R1.2/R3.6).
    expect(body.attendee.whatsapp).toBe("+919876543210");
    // No room assigned — empty list, not omitted (spec R3.7).
    expect(body.attendee.rooms).toEqual([]);
    expect(body.attendee.additionalAttendees).toEqual({
      spouse: [{ name: "Priya Kumar", mealPreference: "veg" }],
      children: [{ name: "Asha Kumar", age: 8, mealPreference: "veg" }],
      guests: [{ name: "Maya Nair", mealPreference: "non_veg" }],
    });
    expect(body.attendee.payment).toEqual({ state: "payment_pending", amountDue: 5500 });
    expect(body.attendee.checkIn).toEqual({ present: false, checkedInAt: null });
    // The allowlist must not leak prohibited fields. whatsapp/rooms are the
    // two deliberate exceptions (spec R1.1/R1.2/R3.7) — email stays forbidden.
    expect(JSON.stringify(body)).not.toMatch(/email|photo_thumb|donation|payment-proof|proof_file|audit/i);
  });

  it("returns distinct sorted room numbers assigned across nights (ispec R3.7)", async () => {
    h.insertRegistration({ status: "pending", totalAmount: 5500 });
    const staffUserId = h.insertUser("rooms-staff@example.com", null);
    h.insertRoomAssignment(1001, "14", "2026-08-14", staffUserId);
    h.insertRoomAssignment(1001, "12", "2026-08-15", staffUserId);

    const res = await h.req("/api/staff/desk/lookup?code=SMRT79WW4A25NWG1", {
      headers: auth(token),
    });
    const body = (await res.json()) as { attendee: { rooms: string[] } };
    expect(body.attendee.rooms).toEqual(["12", "14"]);
  });

  it("returns a single distinct room number when the same room is assigned every night", async () => {
    h.insertRegistration({ status: "pending", totalAmount: 5500 });
    const staffUserId = h.insertUser("rooms-staff2@example.com", null);
    h.insertRoomAssignment(1001, "12", "2026-08-14", staffUserId);
    h.insertRoomAssignment(1001, "12", "2026-08-15", staffUserId);

    const res = await h.req("/api/staff/desk/lookup?code=SMRT79WW4A25NWG1", {
      headers: auth(token),
    });
    const body = (await res.json()) as { attendee: { rooms: string[] } };
    expect(body.attendee.rooms).toEqual(["12"]);
  });

  it("returns t-shirt rows including an additional shirt, ordered included-first (registration-desk.spec.md R3)", async () => {
    h.insertRegistration({ status: "pending", totalAmount: 5500 });
    // Inserted out of included-first order (extra shirt has the lower row id)
    // to prove the ordering is is_included DESC, not insertion/id order.
    h.insertTshirt(1001, "female", "M", 0);
    h.insertTshirt(1001, "male", "L", 1);

    const res = await h.req("/api/staff/desk/lookup?code=SMRT79WW4A25NWG1", {
      headers: auth(token),
    });
    const body = (await res.json()) as {
      attendee: { tshirts: Array<{ size: string; gender: string | null; isIncluded: boolean }> };
    };
    expect(body.attendee.tshirts).toEqual([
      { size: "L", gender: "male", isIncluded: true },
      { size: "M", gender: "female", isIncluded: false },
    ]);
    expect(Object.keys(body.attendee.tshirts[0]).sort()).toEqual(["gender", "isIncluded", "size"]);
  });

  it("returns an empty tshirts array when the registration has no shirt rows", async () => {
    h.insertRegistration({ status: "pending", totalAmount: 5500 });
    const res = await h.req("/api/staff/desk/lookup?code=SMRT79WW4A25NWG1", {
      headers: auth(token),
    });
    const body = (await res.json()) as { attendee: { tshirts: unknown[] } };
    expect(body.attendee.tshirts).toEqual([]);
  });

  it("t-shirt display never leaks additional_charges fields (allowlist regression)", async () => {
    // confirmed status so the response carries no amountDue — isolates the
    // assertion to charge/price leakage rather than the legitimate field.
    h.insertRegistration({ status: "confirmed", totalAmount: 5500 });
    h.insertTshirt(1001, "male", "L", 1);
    const staffUserId = h.insertUser("charges-staff@example.com", null);
    h.insertCharge(1001, "Extra tshirt fee", 300, staffUserId);

    const res = await h.req("/api/staff/desk/lookup?code=SMRT79WW4A25NWG1", {
      headers: auth(token),
    });
    const body = (await res.json()) as {
      attendee: { tshirts: Array<{ size: string; gender: string | null; isIncluded: boolean }> };
    };
    expect(body.attendee.tshirts).toEqual([{ size: "L", gender: "male", isIncluded: true }]);
    expect(JSON.stringify(body)).not.toMatch(/charge|amount|price|Extra tshirt fee/i);
  });

  it("confirmed status returns payment.state confirmed with no amountDue", async () => {
    h.insertRegistration({ status: "confirmed" });
    const res = await h.req("/api/staff/desk/lookup?code=SMRT79WW4A25NWG1", {
      headers: auth(token),
    });
    const body = (await res.json()) as { attendee: { payment: { state: string; amountDue?: number } } };
    expect(body.attendee.payment).toEqual({ state: "confirmed" });
    expect(body.attendee.payment.amountDue).toBeUndefined();
  });

  it("pending_verification is presented as payment_pending (spec R3.1)", async () => {
    h.insertRegistration({ status: "pending_verification" });
    const res = await h.req("/api/staff/desk/lookup?code=SMRT79WW4A25NWG1", {
      headers: auth(token),
    });
    const body = (await res.json()) as { attendee: { payment: { state: string } } };
    expect(body.attendee.payment.state).toBe("payment_pending");
  });

  it("unknown or malformed code returns 404 (ispec R3.2)", async () => {
    for (const code of ["SMRTZZZZZZZZZZZZ", "NOTACODE", "smrt79ww4a25nwg1"]) {
      const res = await h.req(`/api/staff/desk/lookup?code=${encodeURIComponent(code)}`, {
        headers: auth(token),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Attendee not found" });
    }
  });

  it("donation-only registration returns 404 (ispec R3.1)", async () => {
    h.insertRegistration({ participationType: "donation_only", email: "donor@example.com" });
    const res = await h.req("/api/staff/desk/lookup?code=SMRT79WW4A25NWG1", {
      headers: auth(token),
    });
    expect(res.status).toBe(404);
  });
});

describe("desk API — photo (ispec R3.3; 2026-08-12 plan Photo variant request)", () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    _scopeCache.clear();
    h = createHarness();
    const deskUser = h.insertUser("desk@example.com", JSON.stringify({ scopes: ["registration_desk"] }));
    token = await staffToken(deskUser);
  });

  const THUMB_KEY = "registrations/SMRT79WW4A25NWG1/thumbs/ravi.jpg";
  const ORIGINAL_KEY = "registrations/SMRT79WW4A25NWG1/photo.jpg";

  async function seedPhoto(overrides: { photoFileKey?: string | null; photoThumbKey?: string | null } = {}) {
    h.insertRegistration({ photoThumbKey: THUMB_KEY, ...overrides });
    await h.bucket.put(THUMB_KEY, new TextEncoder().encode("fake-thumb-bytes").buffer, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    if (overrides.photoFileKey) {
      await h.bucket.put(overrides.photoFileKey, new TextEncoder().encode("ORIGINAL-PRIVATE-BYTES").buffer, {
        httpMetadata: { contentType: "image/jpeg" },
      });
    }
  }

  it("serves the thumbnail as image data, never the storage key", async () => {
    await seedPhoto();
    const res = await h.req("/api/staff/desk/registrations/1001/photo", {
      headers: auth(token),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    const bodyText = await res.text();
    expect(bodyText).toBe("fake-thumb-bytes");
    expect(bodyText).not.toContain("registrations/SMRT79WW4A25NWG1");
  });

  it("size=200 serves the same thumbnail with the private 24-hour cache", async () => {
    await seedPhoto();
    const res = await h.req("/api/staff/desk/registrations/1001/photo?size=200", {
      headers: auth(token),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(await res.text()).toBe("fake-thumb-bytes");
  });

  it("size=560 and size=960 serve transformed image bytes — never the original, never the key (privacy boundary)", async () => {
    for (const size of ["560", "960"]) {
      const { binding: imagesBinding, calls: imagesCalls } = spyImagesBinding();
      const sized = createHarness({ IMAGES: imagesBinding });
      const deskUser = sized.insertUser("desk@example.com", JSON.stringify({ scopes: ["registration_desk"] }));
      const sizedToken = await staffToken(deskUser);
      sized.insertRegistration({ photoThumbKey: THUMB_KEY, photoFileKey: ORIGINAL_KEY });
      await sized.bucket.put(THUMB_KEY, new TextEncoder().encode("fake-thumb-bytes").buffer, {
        httpMetadata: { contentType: "image/jpeg" },
      });
      await sized.bucket.put(ORIGINAL_KEY, new TextEncoder().encode("ORIGINAL-PRIVATE-BYTES").buffer, {
        httpMetadata: { contentType: "image/jpeg" },
      });

      const res = await sized.req(`/api/staff/desk/registrations/1001/photo?size=${size}`, {
        headers: auth(sizedToken),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/jpeg");
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
      // The transformed (resized) bytes from the Images binding — NOT the
      // original bytes.
      const bodyText = await res.text();
      expect(bodyText).toBe("\t\b\u0007\u0006");
      expect(bodyText).not.toContain("ORIGINAL-PRIVATE-BYTES");
      // The response never leaks either storage key.
      expect(bodyText).not.toContain("registrations/SMRT79WW4A25NWG1");
      expect(bodyText).not.toContain("photo.jpg");

      // The resize request asked for a SQUARE face-cropped image at the
      // requested size, output as JPEG at quality 80 (plan "Photo variant
      // request"). Would fail if the route resized to an arbitrary shape.
      const expectedSize = Number(size);
      expect(imagesCalls).toHaveLength(1);
      expect(imagesCalls[0].transform).toEqual({
        width: expectedSize,
        height: expectedSize,
        fit: "cover",
        gravity: "face",
      });
      expect(imagesCalls[0].output).toEqual({ format: "image/jpeg", quality: 80 });
    }
  });

  it("invalid sizes are rejected with 422 before any storage read", async () => {
    // Seed both keys + a registration so an allowlist leak WOULD be visible —
    // an invalid size must never select arbitrary storage (plan Data Models).
    await seedPhoto({ photoFileKey: ORIGINAL_KEY });
    for (const bad of ["999", "0", "original", "photos/pending/..", "560x560", ""]) {
      const res = await h.req(`/api/staff/desk/registrations/1001/photo?size=${encodeURIComponent(bad)}`, {
        headers: auth(token),
      });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "Invalid photo size" });
    }
    // The 422 boundary fires before any storage access — neither the
    // thumbnail nor the original key was read. Would fail if the allowlist
    // check were moved after the storage reads.
    expect(h.bucket.getCalls).toBe(0);
  });

  it("size=560/960 with no stored original returns 404", async () => {
    await seedPhoto({ photoFileKey: null });
    const res = await h.req("/api/staff/desk/registrations/1001/photo?size=960", {
      headers: auth(token),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Photo not found" });
  });

  it("size=560/960 without an Images binding fails closed (500) and never reads the original key", async () => {
    // Same harness as the beforeEach (no IMAGES binding).
    await seedPhoto({ photoFileKey: ORIGINAL_KEY });
    const res = await h.req("/api/staff/desk/registrations/1001/photo?size=960", {
      headers: auth(token),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Image processing is not configured" });
  });

  it("the 200px thumbnail still works when the Images binding is absent (fallback retained)", async () => {
    await seedPhoto({ photoFileKey: ORIGINAL_KEY });
    const res = await h.req("/api/staff/desk/registrations/1001/photo?size=200", {
      headers: auth(token),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("fake-thumb-bytes");
  });

  it("404 when no photo is available", async () => {
    h.insertRegistration({ photoThumbKey: null });
    const res = await h.req("/api/staff/desk/registrations/1001/photo", {
      headers: auth(token),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Photo not found" });
  });
});

describe("desk API — check-in (ispec R4)", () => {
  let h: Harness;
  let token: string;
  let deskUserId: number;
  beforeEach(async () => {
    _scopeCache.clear();
    h = createHarness();
    deskUserId = h.insertUser("desk@example.com", JSON.stringify({ scopes: ["registration_desk"] }));
    token = await staffToken(deskUserId);
  });

  it("marks present with one row + audit entry, and repeats return the original timestamp", async () => {
    // Payment must be settled — check-in now gates on outstanding balance
    // (correction: PAYMENT_GATES_CHECK_IN). This test's subject is check-in's
    // own idempotency, so the fixture models an already-paid attendee.
    h.insertRegistration({ status: "confirmed" });
    h.insertPayment(1001, "verified", 5500);
    const first = await h.req("/api/staff/desk/registrations/1001/present", {
      method: "POST",
      headers: auth(token),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { checkIn: { present: boolean; checkedInAt: number } };
    expect(firstBody.checkIn.present).toBe(true);
    expect(typeof firstBody.checkIn.checkedInAt).toBe("number");

    const repeated = await h.req("/api/staff/desk/registrations/1001/present", {
      method: "POST",
      headers: auth(token),
    });
    const repeatedBody = (await repeated.json()) as { checkIn: { checkedInAt: number } };
    expect(repeated.status).toBe(200);
    expect(repeatedBody.checkIn.checkedInAt).toBe(firstBody.checkIn.checkedInAt);

    // Exactly one audit row, written once.
    const audit = h.db.raw
      .prepare("SELECT action, actor FROM system_audit_log WHERE action = 'attendee_checked_in'")
      .all() as unknown as Array<{ action: string; actor: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe("desk@example.com");

    // Exactly one check-in state in the DB, unchanged by the repeat.
    const row = h.db.raw
      .prepare("SELECT checked_in_at, checked_in_by FROM registrations WHERE id = 1001")
      .get() as { checked_in_at: number; checked_in_by: number };
    expect(row.checked_in_at).toBe(firstBody.checkIn.checkedInAt);
    expect(row.checked_in_by).toBe(deskUserId);
  });

  it("check-in does not mutate payment state (spec R11)", async () => {
    // A pending_verification (or any unsettled) payment now BLOCKS check-in
    // (correction: PAYMENT_GATES_CHECK_IN) rather than allowing it through
    // untouched — R11's "check-in never mutates payment state" guarantee is
    // now provable only from a settled registration: check-in succeeds, and
    // the already-verified payment row is left exactly as it was.
    h.insertRegistration({ status: "confirmed" });
    h.insertPayment(1001, "verified", 5500);
    const res = await h.req("/api/staff/desk/registrations/1001/present", {
      method: "POST",
      headers: auth(token),
    });
    expect(res.status).toBe(200);
    const pay = h.db.raw
      .prepare("SELECT status, amount, verified_by FROM payments WHERE registration_id = 1001")
      .get() as { status: string; amount: number; verified_by: string | null };
    expect(pay).toMatchObject({ status: "verified", amount: 5500 });
  });

  it("409 payment_required when checking in a registration with an outstanding balance (correction: reverses old R4.3)", async () => {
    h.insertRegistration({ status: "pending" });
    h.insertPayment(1001, "payment_pending", 5500);
    const res = await h.req("/api/staff/desk/registrations/1001/present", {
      method: "POST",
      headers: auth(token),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("payment_required");

    // Would fail if the gate were removed: no check-in row/audit was written.
    const row = h.db.raw
      .prepare("SELECT checked_in_at FROM registrations WHERE id = 1001")
      .get() as { checked_in_at: number | null };
    expect(row.checked_in_at).toBeNull();
    const audit = h.db.raw
      .prepare("SELECT COUNT(*) AS c FROM system_audit_log WHERE action = 'attendee_checked_in'")
      .get() as { c: number };
    expect(audit.c).toBe(0);
  });

  it("settling the payment via the desk collect-payment endpoint unblocks check-in", async () => {
    h.insertRegistration({ status: "pending" });
    h.insertPayment(1001, "payment_pending", 5500);

    const blocked = await h.req("/api/staff/desk/registrations/1001/present", {
      method: "POST",
      headers: auth(token),
    });
    expect(blocked.status).toBe(409);

    const settle = await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ method: "cash" }),
    });
    expect(settle.status).toBe(200);

    const afterSettle = await h.req("/api/staff/desk/registrations/1001/present", {
      method: "POST",
      headers: auth(token),
    });
    expect(afterSettle.status).toBe(200);
    const body = (await afterSettle.json()) as { checkIn: { present: boolean } };
    expect(body.checkIn.present).toBe(true);
  });

  it("donation-only registration cannot be checked in (ispec R4.2)", async () => {
    h.insertRegistration({ participationType: "donation_only", email: "donor@example.com" });
    const res = await h.req("/api/staff/desk/registrations/1001/present", {
      method: "POST",
      headers: auth(token),
    });
    expect(res.status).toBe(404);
    const audit = h.db.raw
      .prepare("SELECT COUNT(*) AS c FROM system_audit_log WHERE action = 'attendee_checked_in'")
      .get() as { c: number };
    expect(audit.c).toBe(0);
  });
});

describe("desk API — undo check-in (ispec R4.5)", () => {
  let h: Harness;
  let token: string;
  let deskUserId: number;
  beforeEach(async () => {
    _scopeCache.clear();
    h = createHarness();
    deskUserId = h.insertUser("desk@example.com", JSON.stringify({ scopes: ["registration_desk"] }));
    token = await staffToken(deskUserId);
  });

  it("clears an existing check-in and writes one 'undone' audit row", async () => {
    // Payment must be settled to seed the present state (correction:
    // PAYMENT_GATES_CHECK_IN) — undo is what this test exercises, not gating.
    h.insertRegistration({ status: "confirmed" });
    h.insertPayment(1001, "verified", 5500);
    // Seed a present state.
    await h.req("/api/staff/desk/registrations/1001/present", {
      method: "POST",
      headers: auth(token),
    });

    const res = await h.req("/api/staff/desk/registrations/1001/absent", {
      method: "POST",
      headers: auth(token),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checkIn: { present: boolean; checkedInAt: number | null } };
    expect(body.checkIn).toEqual({ present: false, checkedInAt: null });

    // DB reflects the clear.
    const row = h.db.raw
      .prepare("SELECT checked_in_at, checked_in_by FROM registrations WHERE id = 1001")
      .get() as { checked_in_at: number | null; checked_in_by: number | null };
    expect(row.checked_in_at).toBeNull();
    expect(row.checked_in_by).toBeNull();

    // One check-in audit + one undo audit, no double-write.
    const checkIns = h.db.raw
      .prepare("SELECT COUNT(*) AS c FROM system_audit_log WHERE action = 'attendee_checked_in'")
      .get() as { c: number };
    const undos = h.db.raw
      .prepare("SELECT COUNT(*) AS c FROM system_audit_log WHERE action = 'attendee_check_in_undone'")
      .get() as { c: number };
    expect(checkIns.c).toBe(1);
    expect(undos.c).toBe(1);
  });

  it("is idempotent — a repeat undo writes no second audit row", async () => {
    h.insertRegistration({ status: "confirmed" });
    h.insertPayment(1001, "verified", 5500);
    await h.req("/api/staff/desk/registrations/1001/present", {
      method: "POST",
      headers: auth(token),
    });
    await h.req("/api/staff/desk/registrations/1001/absent", {
      method: "POST",
      headers: auth(token),
    });
    const repeat = await h.req("/api/staff/desk/registrations/1001/absent", {
      method: "POST",
      headers: auth(token),
    });
    expect(repeat.status).toBe(200);
    const undos = h.db.raw
      .prepare("SELECT COUNT(*) AS c FROM system_audit_log WHERE action = 'attendee_check_in_undone'")
      .get() as { c: number };
    expect(undos.c).toBe(1);
  });

  it("undo on a never-checked-in registration is a no-op (no audit, no error)", async () => {
    h.insertRegistration({ status: "pending_verification" });
    const res = await h.req("/api/staff/desk/registrations/1001/absent", {
      method: "POST",
      headers: auth(token),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checkIn: { present: boolean; checkedInAt: number | null } };
    expect(body.checkIn).toEqual({ present: false, checkedInAt: null });
    const undos = h.db.raw
      .prepare("SELECT COUNT(*) AS c FROM system_audit_log WHERE action = 'attendee_check_in_undone'")
      .get() as { c: number };
    expect(undos.c).toBe(0);
  });

  it("404 for an unknown registration id", async () => {
    const res = await h.req("/api/staff/desk/registrations/9999/absent", {
      method: "POST",
      headers: auth(token),
    });
    expect(res.status).toBe(404);
  });

  it("donation-only registration cannot be unmarked (same guard as check-in)", async () => {
    h.insertRegistration({ participationType: "donation_only", email: "donor@example.com" });
    const res = await h.req("/api/staff/desk/registrations/1001/absent", {
      method: "POST",
      headers: auth(token),
    });
    expect(res.status).toBe(404);
  });
});

describe("desk API — spot registration (ispec R5)", () => {
  let h: Harness;
  let token: string;
  let deskUserId: number;
  beforeEach(async () => {
    _scopeCache.clear();
    h = createHarness();
    deskUserId = h.insertUser("desk@example.com", JSON.stringify({ scopes: ["registration_desk"] }));
    token = await staffToken(deskUserId);
  });

  const spotHeaders = (key: string) => ({ ...auth(token), "Idempotency-Key": key, "Content-Type": "application/json" });

  it("422 when Idempotency-Key is missing (ispec R5.0.1)", async () => {
    const res = await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify(SPOT_BODY),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Idempotency-Key is required" });
    const count = h.db.raw.prepare("SELECT COUNT(*) AS c FROM registrations").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it("422 for unknown (forbidden) fields — never silently stored (spec R5.1)", async () => {
    const res = await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: spotHeaders("key-1"),
      body: JSON.stringify({ ...SPOT_BODY, accommodation: "private", tshirtSize: "L" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { details?: { fieldErrors?: Record<string, string> } };
    expect(body.details?.fieldErrors).toBeDefined();
    const count = h.db.raw.prepare("SELECT COUNT(*) AS c FROM registrations").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it("422 when email is missing — no registration is created", async () => {
    const { email: _email, ...bodyWithoutEmail } = SPOT_BODY;
    const res = await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: spotHeaders("key-1"),
      body: JSON.stringify(bodyWithoutEmail),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { details?: { fieldErrors?: Record<string, string> } };
    expect(body.details?.fieldErrors).toBeDefined();
    const count = h.db.raw.prepare("SELECT COUNT(*) AS c FROM registrations").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it("creates one pending registration with the submitted email and audits it", async () => {
    const res = await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: spotHeaders("key-1"),
      body: JSON.stringify(SPOT_BODY),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      registration: {
        id: number;
        regCode: string;
        participationType: string;
        payment: { state: string; amountDue: number };
        checkIn: { present: boolean; checkedInAt: null };
        passUrl: string;
      };
    };
    expect(Object.keys(body.registration).sort()).toEqual([
      "checkIn",
      "id",
      "participationType",
      "passUrl",
      "payment",
      "regCode",
    ]);
    expect(body.registration.payment).toEqual({ state: "payment_pending", amountDue: 5500 });
    expect(body.registration.checkIn).toEqual({ present: false, checkedInAt: null });
    expect(body.registration.passUrl).toBe(`/pass#${body.registration.regCode}`);
    expect(body.registration.regCode).toMatch(/^SMRT/);

    // Registration row: submitted email, not present, not donation-only.
    const row = h.db.raw
      .prepare("SELECT email, checked_in_at, participation_type FROM registrations WHERE id = ?")
      .get(body.registration.id) as { email: string; checked_in_at: number | null; participation_type: string };
    expect(row.email).toBe(SPOT_BODY.email);
    expect(row.checked_in_at).toBeNull();
    expect(row.participation_type).toBe("campus_only");

    // Pending payment row + one audit entry.
    const pay = h.db.raw
      .prepare("SELECT status FROM payments WHERE registration_id = ?")
      .get(body.registration.id) as { status: string };
    expect(pay.status).toBe("payment_pending");
    const audit = h.db.raw
      .prepare("SELECT action, actor FROM system_audit_log WHERE action = 'spot_registration_created'")
      .all() as unknown as Array<{ action: string; actor: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe("desk@example.com");
  });

  it("replays the original response for the same key + body (ispec R5.5)", async () => {
    const first = await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: spotHeaders("retry-key"),
      body: JSON.stringify(SPOT_BODY),
    });
    const firstBody = await first.json();
    const second = await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: spotHeaders("retry-key"),
      body: JSON.stringify(SPOT_BODY),
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    const count = h.db.raw.prepare("SELECT COUNT(*) AS c FROM registrations").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("409 for the same key with a different body (ispec R5.6)", async () => {
    await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: spotHeaders("conflict-key"),
      body: JSON.stringify(SPOT_BODY),
    });
    const res = await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: spotHeaders("conflict-key"),
      body: JSON.stringify({ ...SPOT_BODY, fullName: "Another Name" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Idempotency key already used" });
    const count = h.db.raw.prepare("SELECT COUNT(*) AS c FROM registrations").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("409 for a fresh key matching an existing WhatsApp, without leaking the existing record (ispec R6.2)", async () => {
    h.insertRegistration({ whatsapp: "+919812345678" });
    const res = await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: spotHeaders("fresh-key"),
      body: JSON.stringify(SPOT_BODY),
    });
    expect(res.status).toBe(409);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("ravi@example.com");
    const count = h.db.raw.prepare("SELECT COUNT(*) AS c FROM registrations").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("409 for a fresh key matching an existing email, without leaking the existing record (ispec R6.1)", async () => {
    // Distinct whatsapp from SPOT_BODY so this exercises the email duplicate
    // check specifically, not the whatsapp one above.
    h.insertRegistration({ email: SPOT_BODY.email });
    const res = await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: spotHeaders("fresh-key"),
      body: JSON.stringify(SPOT_BODY),
    });
    expect(res.status).toBe(409);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("Ravi Kumar");
    const count = h.db.raw.prepare("SELECT COUNT(*) AS c FROM registrations").get() as { c: number };
    expect(count.c).toBe(1);
  });
});

// =============================================================================
// Spot registration — photo finalization off the response path (bug fix)
//
// Self-registration relocates the pending photo and generates+publishes its
// thumbnail via registration.routes.ts: c.executionCtx.waitUntil(
// registrationService.relocateFiles(regId, regCode)). Spot registration
// previously did neither — the photo stayed under photos/pending/ forever
// and photo_thumb_key was never set, so both desk surfaces (search hasPhoto,
// lookup photo.available) gated on it forever. registration-desk.routes.ts
// now fires the SAME relocateFiles call via waitUntil for a freshly created
// spot registration with a photo.
// =============================================================================

describe("desk API — spot registration photo finalization (bug fix)", () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    _scopeCache.clear();
    h = createHarness();
    const deskUser = h.insertUser("desk@example.com", JSON.stringify({ scopes: ["registration_desk"] }));
    token = await staffToken(deskUser);
  });

  const spotHeaders = (key: string) => ({ ...auth(token), "Idempotency-Key": key, "Content-Type": "application/json" });

  it("relocates the pending photo and generates+publishes a thumbnail after a successful creation", async () => {
    await h.bucket.put(
      SPOT_BODY.photoFileKey,
      new TextEncoder().encode("original-photo-bytes").buffer,
      { httpMetadata: { contentType: "image/jpeg" } },
    );

    const res = await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: spotHeaders("finalize-key"),
      body: JSON.stringify(SPOT_BODY),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { registration: { id: number; regCode: string } };
    const { id, regCode } = body.registration;

    const row = h.db.raw
      .prepare("SELECT photo_file_key, photo_thumb_key FROM registrations WHERE id = ?")
      .get(id) as { photo_file_key: string; photo_thumb_key: string | null };

    // Relocated to the canonical key — no longer under photos/pending/.
    expect(row.photo_file_key).toBe(`registrations/${regCode}/photo.jpg`);
    expect(h.bucket.has(SPOT_BODY.photoFileKey)).toBe(false);
    expect(h.bucket.has(`registrations/${regCode}/photo.jpg`)).toBe(true);

    // Thumbnail generated from the relocated key and published publicly.
    expect(row.photo_thumb_key).toBe(`registrations/${regCode}/photo-thumb.jpg`);
    expect(h.bucket.has(`registrations/${regCode}/photo-thumb.jpg`)).toBe(true);
    expect(h.publicThumbsBucket.puts).toEqual([{
      key: `${id}.jpg`,
      bytes: new Uint8Array(THUMB_BYTES),
    }]);
  });

  it("still returns 200 and creates exactly one registration when the pending photo is missing from storage", async () => {
    // Deliberately do NOT upload anything at SPOT_BODY.photoFileKey — the
    // relocation move and/or thumbnail read will find nothing. This must
    // never surface as a failed spot registration.
    const res = await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: spotHeaders("finalize-missing-photo-key"),
      body: JSON.stringify(SPOT_BODY),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { registration: { id: number } };

    const count = h.db.raw.prepare("SELECT COUNT(*) AS c FROM registrations").get() as { c: number };
    expect(count.c).toBe(1);

    const row = h.db.raw
      .prepare("SELECT photo_thumb_key FROM registrations WHERE id = ?")
      .get(body.registration.id) as { photo_thumb_key: string | null };
    expect(row.photo_thumb_key).toBeNull();
    expect(h.publicThumbsBucket.puts).toEqual([]);
  });

  it("still returns 200 and never touches photo state when the Images binding is absent", async () => {
    const noImages = createHarness({}, { omitImagesBinding: true });
    const deskUser = noImages.insertUser("desk2@example.com", JSON.stringify({ scopes: ["registration_desk"] }));
    const noImagesToken = await staffToken(deskUser);
    await noImages.bucket.put(
      SPOT_BODY.photoFileKey,
      new TextEncoder().encode("original-photo-bytes").buffer,
      { httpMetadata: { contentType: "image/jpeg" } },
    );

    const res = await noImages.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: { ...auth(noImagesToken), "Idempotency-Key": "no-images-key", "Content-Type": "application/json" },
      body: JSON.stringify(SPOT_BODY),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { registration: { id: number } };

    const row = noImages.db.raw
      .prepare("SELECT photo_thumb_key FROM registrations WHERE id = ?")
      .get(body.registration.id) as { photo_thumb_key: string | null };
    expect(row.photo_thumb_key).toBeNull();
    expect(noImages.publicThumbsBucket.puts).toEqual([]);
  });

  it("does not re-run finalization on an idempotent replay", async () => {
    await h.bucket.put(
      SPOT_BODY.photoFileKey,
      new TextEncoder().encode("original-photo-bytes").buffer,
      { httpMetadata: { contentType: "image/jpeg" } },
    );

    await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: spotHeaders("replay-finalize-key"),
      body: JSON.stringify(SPOT_BODY),
    });
    const replayed = await h.req("/api/staff/desk/registrations", {
      method: "POST",
      headers: spotHeaders("replay-finalize-key"),
      body: JSON.stringify(SPOT_BODY),
    });
    expect(replayed.status).toBe(200);

    // Exactly one publish — the replay did not re-run relocateFiles.
    expect(h.publicThumbsBucket.puts).toHaveLength(1);
  });
});

// =============================================================================
// desk-payment-collection plan — req #1: collect payment in person
// POST /staff/desk/registrations/:id/payment
// =============================================================================

describe("desk API — collect payment (desk-payment-collection plan req #1)", () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    _scopeCache.clear();
    h = createHarness();
    const deskUser = h.insertUser("desk@example.com", JSON.stringify({ scopes: ["registration_desk"] }));
    token = await staffToken(deskUser);
  });

  it("settles the full outstanding balance for cash, confirms the registration, and writes the audit row", async () => {
    h.insertRegistration({ status: "pending", totalAmount: 5500 });
    h.insertPayment(1001, "payment_pending", 5500);

    const res = await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ method: "cash", note: "Received by Ajith at 3pm" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendee: { payment: { state: string; amountDue?: number } } };
    // Would fail if settleAtDesk / settleDeskPayment were removed — this is
    // the feature-verifying assertion, not a regression check.
    expect(body.attendee.payment).toEqual({ state: "confirmed" });

    const payments = h.getPayments(1001);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      status: "verified",
      amount: 5500,
      method: "cash",
      note: "Received by Ajith at 3pm",
      verified_by: "desk@example.com",
    });
    expect(payments[0].verified_at).not.toBeNull();

    const reg = h.db.raw.prepare("SELECT status FROM registrations WHERE id = ?").get(1001) as { status: string };
    expect(reg.status).toBe("confirmed");

    expect(h.getAuditActions(1001)).toContain("desk_payment_collected");

    // The desk_payment_collected audit snapshot must use the SAME
    // { registration, attendees } shape createSnapshot() produces — a plain
    // { registration } snapshot violates the audit contract (consumers read
    // snapshot.attendees). Proves the fix, not just that an entry exists.
    const collected = h.getAuditSnapshots(1001).find((a) => a.action === "desk_payment_collected");
    expect(collected?.snapshot).toMatchObject({
      registration: expect.objectContaining({ id: 1001 }),
      attendees: expect.any(Array),
    });
  });

  it("sends the payment-confirmed email with the settled payment when an existing pending row is settled", async () => {
    h.insertRegistration({ status: "pending", totalAmount: 5500, email: "ravi@example.com" });
    h.insertPayment(1001, "payment_pending", 5500);

    const res = await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ method: "upi" }),
    });
    expect(res.status).toBe(200);

    // Feature-verifying: would fail if sendPaymentConfirmedEmail / its call
    // site were removed. Mirrors verifyPayment's confirmed-email send.
    expect(h.emailService.paymentConfirmedCalls).toHaveLength(1);
    expect(h.emailService.paymentConfirmedCalls[0].to).toBe("ravi@example.com");
    expect(h.emailService.paymentConfirmedCalls[0].data.payments).toEqual([
      expect.objectContaining({ amount: 5500, referenceId: "upi" }),
    ]);
  });

  it("sends the payment-confirmed email with the settled payment when settle creates the pending row itself (no prior payment row)", async () => {
    // No insertPayment call — the registration has an outstanding balance
    // but zero rows in `payments`. settleDeskPayment must create one, then
    // the confirmation email must still show it as verified. Regression
    // guard: the email helper was previously built from the `payments` array
    // read BEFORE this create, so it received payments: [] here — the
    // just-settled payment silently vanished from the email in exactly this
    // branch.
    h.insertRegistration({ status: "pending", totalAmount: 5500, email: "priya@example.com" });
    expect(h.getPayments(1001)).toHaveLength(0);

    const res = await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ method: "bank_transfer" }),
    });
    expect(res.status).toBe(200);

    expect(h.emailService.paymentConfirmedCalls).toHaveLength(1);
    expect(h.emailService.paymentConfirmedCalls[0].to).toBe("priya@example.com");
    // Would fail (payments: []) if sendPaymentConfirmedEmail were called
    // with the pre-settle `payments` array instead of `freshPayments`.
    expect(h.emailService.paymentConfirmedCalls[0].data.payments).toEqual([
      expect.objectContaining({ amount: 5500, referenceId: "bank_transfer" }),
    ]);

    // The row settle created is itself verified in the DB, confirming the
    // email's view matches reality, not a coincidence of the override.
    const payments = h.getPayments(1001);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: "verified", amount: 5500, method: "bank_transfer" });
  });

  it("does not send the payment-confirmed email when settle 409s on an already-settled balance", async () => {
    h.insertRegistration({ status: "confirmed", totalAmount: 5500, email: "ravi@example.com" });
    h.insertPayment(1001, "verified", 5500);

    const res = await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ method: "cash" }),
    });
    expect(res.status).toBe(409);
    expect(h.emailService.paymentConfirmedCalls).toHaveLength(0);
  });

  it("settles a payment that is pending_verification — desk cash collection overrides an in-flight online proof", async () => {
    h.insertRegistration({ status: "pending_verification", totalAmount: 5500 });
    h.insertPayment(1001, "pending_verification", 5500);

    const res = await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ method: "upi" }),
    });

    expect(res.status).toBe(200);
    const payments = h.getPayments(1001);
    expect(payments[0]).toMatchObject({ status: "verified", method: "upi" });
  });

  it("clears proof_file_key/gateway_ref/gateway_response when settling a pending_verification (online proof) payment", async () => {
    h.insertRegistration({ status: "pending_verification", totalAmount: 5500 });
    const paymentId = h.insertPayment(1001, "pending_verification", 5500);
    // Simulates a genuine online bank-transfer proof upload already attached
    // to this payment before the desk collects in person.
    h.db.raw
      .prepare(
        "UPDATE payments SET proof_file_key = ?, gateway_ref = ?, gateway_response = ? WHERE id = ?",
      )
      .run("payment-proofs/SMRT79WW4A25NWG1/1/proof.jpg", "UTR123456", '{"raw":"data"}', paymentId);

    const res = await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ method: "cash" }),
    });
    expect(res.status).toBe(200);

    // Would fail if settleAtDesk's NULL clauses were removed — the row would
    // still carry the online proof evidence alongside the desk method/note,
    // looking like both an online transfer and an in-person collection.
    const payments = h.getPayments(1001);
    expect(payments[0]).toMatchObject({
      status: "verified",
      method: "cash",
      proof_file_key: null,
      gateway_ref: null,
      gateway_response: null,
    });
  });

  it("stores no note when none is given", async () => {
    h.insertRegistration({ status: "pending", totalAmount: 5500 });
    h.insertPayment(1001, "payment_pending", 5500);

    await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ method: "bank_transfer" }),
    });

    expect(h.getPayments(1001)[0].note).toBeNull();
  });

  it("409 when the balance is already settled — nothing to collect", async () => {
    h.insertRegistration({ status: "confirmed", totalAmount: 5500 });
    h.insertPayment(1001, "verified", 5500);

    const res = await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ method: "cash" }),
    });
    expect(res.status).toBe(409);
  });

  it("404 for a donation-only registration", async () => {
    h.insertRegistration({ participationType: "donation_only", email: "donor@example.com" });
    const res = await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ method: "cash" }),
    });
    expect(res.status).toBe(404);
  });

  it("422 for a method outside the enum (boundary validation)", async () => {
    h.insertRegistration({ status: "pending", totalAmount: 5500 });
    h.insertPayment(1001, "payment_pending", 5500);
    const res = await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ method: "cheque" }),
    });
    expect(res.status).toBe(422);
  });

  it("401 with no token, 403 without registration_desk scope", async () => {
    h.insertRegistration({ status: "pending", totalAmount: 5500 });
    h.insertPayment(1001, "payment_pending", 5500);

    const noAuth = await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "cash" }),
    });
    expect(noAuth.status).toBe(401);

    const otherUser = h.insertUser("dashboard@example.com", JSON.stringify({ scopes: ["dashboard"] }));
    const otherToken = await staffToken(otherUser, "dashboard@example.com");
    const noScope = await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { ...auth(otherToken), "Content-Type": "application/json" },
      body: JSON.stringify({ method: "cash" }),
    });
    expect(noScope.status).toBe(403);
  });

  it("response never leaks proof/bank/donation/email fields (desk allowlist)", async () => {
    h.insertRegistration({ status: "pending", totalAmount: 5500 });
    h.insertPayment(1001, "payment_pending", 5500);
    const res = await h.req("/api/staff/desk/registrations/1001/payment", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ method: "cash" }),
    });
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/email|photo_thumb|donation|payment-proof|proof_file|audit/i);
  });
});

// =============================================================================
// desk-payment-collection plan — req #2: add an ad-hoc charge
// POST /staff/desk/registrations/:id/charge
// =============================================================================

describe("desk API — add charge (desk-payment-collection plan req #2)", () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    _scopeCache.clear();
    h = createHarness();
    const deskUser = h.insertUser("desk@example.com", JSON.stringify({ scopes: ["registration_desk"] }));
    token = await staffToken(deskUser);
  });

  it("raises total_amount, creates a pending payment for the delta, and sends the additional-payment email", async () => {
    // campus_only: PRICING_DEFAULTS.campusOnlyBaseFee is exactly 5500 with no
    // accommodation/attendees/donation, so the recalc pipeline's recomputed
    // total_amount matches the raw-inserted 5500 — recalcAndPersist always
    // recomputes total_amount from canonical pricing rules (calculateTotal),
    // it never trusts the stored column.
    h.insertRegistration({ status: "confirmed", totalAmount: 5500, email: "ravi@example.com", participationType: "campus_only" });
    h.insertPayment(1001, "verified", 5500);

    const res = await h.req("/api/staff/desk/registrations/1001/charge", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Extra t-shirt XL", amount: 300 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { attendee: { payment: { state: string; amountDue?: number } } };
    // Would fail if addDeskCharge / the recalc pipeline were removed.
    expect(body.attendee.payment).toEqual({ state: "payment_pending", amountDue: 300 });

    const reg = h.db.raw.prepare("SELECT total_amount FROM registrations WHERE id = ?").get(1001) as {
      total_amount: number;
    };
    expect(reg.total_amount).toBe(5800);

    const payments = h.getPayments(1001);
    expect(payments.map((p) => p.status).sort()).toEqual(["payment_pending", "verified"]);
    const pending = payments.find((p) => p.status === "payment_pending");
    expect(pending?.amount).toBe(300);

    expect(h.getAuditActions(1001)).toContain("charge_added");

    // Reversed decision (correction, not the original plan): the desk
    // add-charge path DOES send the same notification the staff edit page
    // sends — this is the feature-verifying assertion for that behavior.
    // It would fail if sendChargeEmail / the emailService call were removed.
    expect(h.emailService.additionalPaymentCalls).toHaveLength(1);
    expect(h.emailService.additionalPaymentCalls[0].to).toBe("ravi@example.com");
    expect(h.emailService.additionalPaymentCalls[0].data.amount).toBe(300);
    expect(h.emailService.revisedPaymentCalls).toHaveLength(0);
  });

  it("sends the revised-payment email when the charge grows an existing pending balance", async () => {
    // Partially paid: 5000 verified + a 500 pending balance (total 5500,
    // campus_only). recalcAndPersist always sets the single pending row to
    // the FULL outstanding delta (total - verified), not the raw charge
    // amount — so after a 200 charge the pending row (and the revised-payment
    // email amount) is 700 = (5500 + 200) - 5000, not 200.
    h.insertRegistration({ status: "pending", totalAmount: 5500, email: "priya@example.com", participationType: "campus_only" });
    h.insertPayment(1001, "verified", 5000);
    h.insertPayment(1001, "payment_pending", 500);

    const res = await h.req("/api/staff/desk/registrations/1001/charge", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Extra guest meal", amount: 200 }),
    });

    expect(res.status).toBe(200);
    const payments = h.getPayments(1001);
    expect(payments.map((p) => p.status).sort()).toEqual(["payment_pending", "verified"]);
    const pending = payments.find((p) => p.status === "payment_pending");
    expect(pending?.amount).toBe(700);

    expect(h.emailService.revisedPaymentCalls).toHaveLength(1);
    expect(h.emailService.revisedPaymentCalls[0].to).toBe("priya@example.com");
    expect(h.emailService.revisedPaymentCalls[0].data.amount).toBe(700);
    expect(h.emailService.additionalPaymentCalls).toHaveLength(0);
  });

  it("422 for a non-positive amount or empty description", async () => {
    h.insertRegistration({ status: "pending", totalAmount: 5500 });
    h.insertPayment(1001, "payment_pending", 5500);

    const badAmount = await h.req("/api/staff/desk/registrations/1001/charge", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Extra shirt", amount: 0 }),
    });
    expect(badAmount.status).toBe(422);

    const badDescription = await h.req("/api/staff/desk/registrations/1001/charge", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ description: "   ", amount: 300 }),
    });
    expect(badDescription.status).toBe(422);

    expect(h.emailService.additionalPaymentCalls).toHaveLength(0);
  });

  it("409 payment_under_verification when a payment is pending_verification, and sends no email", async () => {
    h.insertRegistration({ status: "pending_verification", totalAmount: 5500 });
    h.insertPayment(1001, "pending_verification", 5500);

    const res = await h.req("/api/staff/desk/registrations/1001/charge", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Extra shirt", amount: 300 }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("payment_under_verification");
    expect(h.emailService.additionalPaymentCalls).toHaveLength(0);
    expect(h.emailService.revisedPaymentCalls).toHaveLength(0);
  });

  it("404 for a donation-only registration", async () => {
    h.insertRegistration({ participationType: "donation_only", email: "donor@example.com" });
    const res = await h.req("/api/staff/desk/registrations/1001/charge", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Extra shirt", amount: 300 }),
    });
    expect(res.status).toBe(404);
  });

  it("401 with no token, 403 without registration_desk scope", async () => {
    h.insertRegistration({ status: "pending", totalAmount: 5500 });
    h.insertPayment(1001, "payment_pending", 5500);

    const noAuth = await h.req("/api/staff/desk/registrations/1001/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Extra shirt", amount: 300 }),
    });
    expect(noAuth.status).toBe(401);

    const otherUser = h.insertUser("dashboard2@example.com", JSON.stringify({ scopes: ["dashboard"] }));
    const otherToken = await staffToken(otherUser, "dashboard2@example.com");
    const noScope = await h.req("/api/staff/desk/registrations/1001/charge", {
      method: "POST",
      headers: { ...auth(otherToken), "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Extra shirt", amount: 300 }),
    });
    expect(noScope.status).toBe(403);
  });

  it("response never leaks proof/bank/donation/email/pricing-internal fields (desk allowlist)", async () => {
    h.insertRegistration({ status: "pending", totalAmount: 5500 });
    h.insertPayment(1001, "payment_pending", 5500);
    const res = await h.req("/api/staff/desk/registrations/1001/charge", {
      method: "POST",
      headers: { ...auth(token), "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Extra shirt", amount: 300 }),
    });
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/email|photo_thumb|donation|payment-proof|proof_file|pricing_snapshot/i);
  });
});
