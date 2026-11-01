/**
 * GET /api/public/desk-roster — HTTP contract tests for the LED-wall live
 * data source (tasks/2026-08-14-led-wall-live-source.plan.md, "Server — full
 * mode" / "Server — delta mode").
 *
 * Runs the REAL route (publicRoutes) against SqliteD1 (a genuine SQLite
 * adapter loaded with the real schema.sql) and the REAL RegistrationDeskService
 * to seed check-ins/undos — so every audit row this test relies on is the one
 * the desk actually writes in production, not a hand-built row that might
 * drift from desk.repo.ts's actual INSERT.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv, Env } from "../env.js";
import { SqliteD1 } from "./helpers/sqlite-d1.js";
import { publicRoutes } from "../routes/public.routes.js";
import { D1DeskRepository } from "../repositories/desk.repo.js";
import { D1RegistrationRepository } from "../repositories/registration.repo.js";
import { D1AttendeeRepository } from "../repositories/attendee.repo.js";
import { D1PaymentRepository } from "../repositories/payment.repo.js";
import { D1RoomRepository } from "../repositories/room.repo.js";
import { D1AuditRepository } from "../repositories/audit.repo.js";
import { D1TshirtRepository } from "../repositories/tshirt.repo.js";
import { D1AdditionalChargeRepository } from "../repositories/additional-charge.repo.js";
import { D1RefundRepository } from "../repositories/refund.repo.js";
import { RegistrationDeskService } from "../services/registration-desk.service.js";
import { TshirtChargeService } from "../services/tshirt-charge.service.js";
import { PricingService } from "../services/pricing.service.js";
import { MockEmailService } from "../infra/email.service.js";

const schemaPath = fileURLToPath(new URL("../db/schema.sql", import.meta.url));
const SCHEMA_SQL = readFileSync(schemaPath, "utf8");

const PORTRAITS_BASE = "https://cdn.example.test/portraits";
// Deliberately a different host from PORTRAITS_BASE — a bug that swaps the
// two env vars (PUBLIC_THUMBS_URL <-> PUBLIC_PORTRAITS_URL) would fail these
// tests instead of passing by coincidence.
const THUMBS_BASE = "https://thumbs.example.test";

interface DeskRosterEntry {
  registrationId: number;
  name: string;
  branch: string;
  checkedInAt: number;
  portraitUrl: string | null;
  thumbnailUrl: string | null;
}
interface DeskRosterFullBody {
  now: number;
  seq: number;
  count: number;
  entries: DeskRosterEntry[];
}
interface DeskRosterEvent {
  seq: number;
  type: "arrival" | "departure";
  registrationId: number;
  name?: string;
  branch?: string;
  checkedInAt?: number;
  portraitUrl?: string | null;
  thumbnailUrl?: string | null;
}
interface DeskRosterDeltaBody {
  now: number;
  seq: number;
  events: DeskRosterEvent[];
}

// ---------------------------------------------------------------------------
// Harness — real D1 (SqliteD1 + real schema.sql), real RegistrationDeskService
// (so check-ins/undos go through markPresent/markAbsent and write real audit
// rows), real publicRoutes for the endpoint under test.
// ---------------------------------------------------------------------------

interface Harness {
  db: SqliteD1;
  deskService: RegistrationDeskService;
  req: (path: string) => Promise<Response>;
  insertRegistration: (overrides?: {
    regCode?: string;
    fullName?: string;
    branch?: string;
    participationType?: string;
    totalAmount?: number;
    photoThumbKey?: string | null;
  }) => number;
}

function createHarness(envOverrides: Partial<Env> = {}): Harness {
  const db = new SqliteD1();
  db.loadSchema(SCHEMA_SQL);
  const d1 = db as unknown as import("@cloudflare/workers-types").D1Database;

  // checked_in_by is a FK to users(id) — markPresent needs a real row to point at.
  db.raw
    .prepare("INSERT INTO users (id, email, name, role, is_active) VALUES (1, 'desk@example.com', 'Desk', 'staff', 1)")
    .run();

  const deskRepo = new D1DeskRepository(d1);
  const registrationRepo = new D1RegistrationRepository(d1);
  const attendeeRepo = new D1AttendeeRepository(d1);
  const paymentRepo = new D1PaymentRepository(d1);
  const roomRepo = new D1RoomRepository(d1);
  const auditRepo = new D1AuditRepository(d1);
  const tshirtRepo = new D1TshirtRepository(d1);
  const chargeRepo = new D1AdditionalChargeRepository(d1);
  const refundRepo = new D1RefundRepository(d1);
  const tshirtChargeService = new TshirtChargeService({
    registrationRepo,
    attendeeRepo,
    paymentRepo,
    auditRepo,
    tshirtRepo,
    chargeRepo,
  });
  const deskService = new RegistrationDeskService({
    deskRepo,
    registrationRepo,
    attendeeRepo,
    paymentRepo,
    roomRepo,
    pricingService: new PricingService(),
    auditRepo,
    tshirtChargeService,
    emailService: new MockEmailService("http://localhost:5173"),
    refundRepo,
    appBaseUrl: "https://app.example.test",
  });

  const app = new Hono<AppEnv>().basePath("/api");
  // Production wires repos into context in app.ts middleware; the manifest
  // route reads c.var.deskRepo, so the harness must set it too.
  app.use("*", async (c, next) => {
    c.set("deskRepo", deskRepo);
    await next();
  });
  app.route("/public", publicRoutes);

  const env = {
    DB: db,
    STORAGE: {} as R2Bucket,
    JWT_SECRET: "unused",
    ENVIRONMENT: "development",
    PUBLIC_PORTRAITS_URL: PORTRAITS_BASE,
    PUBLIC_THUMBS_URL: THUMBS_BASE,
    ...envOverrides,
  } as unknown as Env;

  return {
    db,
    deskService,
    req: async (path: string) => app.request(path, undefined, env),
    insertRegistration(overrides = {}) {
      const info = db.raw
        .prepare(
          `INSERT INTO registrations (
             reg_code, status, full_name, branch, email, whatsapp, city, country,
             attendance_intent, participation_type, alumni_meal, accommodation,
             contribution_splits, pricing_snapshot, total_amount, photo_thumb_key
           ) VALUES (?, 'confirmed', ?, ?, ?, ?, 'Kochi', 'India',
             'attending', ?, 'veg', 'none', '{}',
             '{"base":0,"lines":[],"donation":0,"collegeContribution":0,"total":0}',
             ?, ?)`,
        )
        .run(
          overrides.regCode ?? `SMRT${Math.random().toString(36).slice(2, 10)}`,
          overrides.fullName ?? "Ravi Kumar",
          overrides.branch ?? "Civil Engineering",
          `${overrides.regCode ?? Math.random()}@example.com`,
          `+9198${Math.floor(Math.random() * 100000000)}`,
          overrides.participationType ?? "full_celebration",
          // Zero balance so RegistrationDeskService.checkIn's payment gate
          // (PAYMENT_GATES_CHECK_IN) never blocks the seeded check-in — this
          // test's subject is desk-roster, not the payment gate.
          overrides.totalAmount ?? 0,
          overrides.photoThumbKey ?? null,
        );
      return Number(info.lastInsertRowid);
    },
  };
}

const ACTOR = { userId: 1, email: "desk@example.com" };

describe("GET /api/public/desk-roster — full mode", () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
  });

  it("returns every eligible checked-in attendee with resolved portraitUrl and seq == MAX(system_audit_log.id)", async () => {
    const withPhoto = h.insertRegistration({ fullName: "Asha Nair", branch: "Architecture", photoThumbKey: "registrations/ASHA/photo-thumb.jpg" });
    const withoutPhoto = h.insertRegistration({ fullName: "Ravi Kumar", branch: "Civil Engineering", photoThumbKey: null });
    const notCheckedIn = h.insertRegistration({ fullName: "Never Arrived" });
    void notCheckedIn;

    await h.deskService.checkIn(withPhoto, ACTOR);
    await h.deskService.checkIn(withoutPhoto, ACTOR);

    const maxSeq = h.db.raw.prepare("SELECT MAX(id) AS seq FROM system_audit_log").get() as { seq: number };

    const res = await h.req("/api/public/desk-roster");
    expect(res.status).toBe(200);
    const body = (await res.json()) as DeskRosterFullBody;

    expect(body.seq).toBe(maxSeq.seq);
    expect(body.count).toBe(2);
    expect(typeof body.now).toBe("number");

    const asha = body.entries.find((e) => e.registrationId === withPhoto);
    expect(asha).toMatchObject({
      name: "Asha Nair",
      branch: "Architecture",
      portraitUrl: `${PORTRAITS_BASE}/${withPhoto}.webp`,
      thumbnailUrl: `${THUMBS_BASE}/${withPhoto}.jpg`,
    });
    expect(typeof asha?.checkedInAt).toBe("number");

    const ravi = body.entries.find((e) => e.registrationId === withoutPhoto);
    expect(ravi?.portraitUrl).toBeNull();
    expect(ravi?.thumbnailUrl).toBeNull();
  });

  it("never lists a donation-only registration even if somehow checked in", async () => {
    const donor = h.insertRegistration({ participationType: "donation_only" });
    // checked_in_at is desk-only in practice, but the eligibility filter is
    // the endpoint's own guarantee — prove it directly against the column.
    h.db.raw.prepare("UPDATE registrations SET checked_in_at = ? WHERE id = ?").run(Date.now(), donor);

    const res = await h.req("/api/public/desk-roster");
    const body = (await res.json()) as DeskRosterFullBody;
    expect(body.entries.find((e) => e.registrationId === donor)).toBeUndefined();
  });

  it.each([["abc"], ["-1"], [""], [undefined]])("falls back to full mode for since=%s", async (since) => {
    const id = h.insertRegistration();
    await h.deskService.checkIn(id, ACTOR);

    const url = since === undefined ? "/api/public/desk-roster" : `/api/public/desk-roster?since=${since}`;
    const res = await h.req(url);
    const body = (await res.json()) as DeskRosterFullBody & { events?: unknown };
    expect(body.entries).toBeDefined();
    expect(body.events).toBeUndefined();
    expect(body.count).toBe(1);
  });

  it("sets Cache-Control: no-store", async () => {
    const res = await h.req("/api/public/desk-roster");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("never leaks actor, checkedInBy, email, or city in the response body", async () => {
    const id = h.insertRegistration({ fullName: "Ravi Kumar" });
    await h.deskService.checkIn(id, ACTOR);

    const res = await h.req("/api/public/desk-roster");
    const text = await res.text();
    expect(text).not.toContain("@");
    expect(text).not.toContain("actor");
    expect(text).not.toContain("checkedInBy");
    // Every seeded registration's city is "Kochi" (createHarness.insertRegistration)
    // — a canary for an accidental future column add, not just today's known fields.
    expect(text).not.toContain("Kochi");
  });
});

describe("GET /api/public/desk-roster — delta mode", () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
  });

  it("returns exactly one arrival with correct fields and an advanced seq after a check-in", async () => {
    const id = h.insertRegistration({ fullName: "Asha Nair", branch: "Architecture", photoThumbKey: "registrations/ASHA/photo-thumb.jpg" });

    const before = (await (await h.req("/api/public/desk-roster")).json()) as DeskRosterFullBody;
    await h.deskService.checkIn(id, ACTOR);

    const res = await h.req(`/api/public/desk-roster?since=${before.seq}`);
    const body = (await res.json()) as DeskRosterDeltaBody;

    expect(body.events).toHaveLength(1);
    const [arrival] = body.events;
    expect(arrival.type).toBe("arrival");
    expect(arrival.registrationId).toBe(id);
    expect(arrival.name).toBe("Asha Nair");
    expect(arrival.branch).toBe("Architecture");
    expect(typeof arrival.checkedInAt).toBe("number");
    expect(arrival.portraitUrl).toBe(`${PORTRAITS_BASE}/${id}.webp`);
    expect(arrival.thumbnailUrl).toBe(`${THUMBS_BASE}/${id}.jpg`);
    expect(body.seq).toBeGreaterThan(before.seq);
  });

  it("thumbnailUrl is null on an arrival when photo_thumb_key IS NULL", async () => {
    const id = h.insertRegistration({ fullName: "Ravi Kumar", photoThumbKey: null });
    const before = (await (await h.req("/api/public/desk-roster")).json()) as DeskRosterFullBody;
    await h.deskService.checkIn(id, ACTOR);

    const res = await h.req(`/api/public/desk-roster?since=${before.seq}`);
    const body = (await res.json()) as DeskRosterDeltaBody;
    expect(body.events[0].thumbnailUrl).toBeNull();
  });

  it("returns exactly one departure carrying only registrationId after an undo", async () => {
    const id = h.insertRegistration({ fullName: "Asha Nair" });
    await h.deskService.checkIn(id, ACTOR);
    const afterCheckIn = (await (await h.req("/api/public/desk-roster")).json()) as DeskRosterFullBody;

    await h.deskService.unmarkPresent(id, ACTOR);

    const res = await h.req(`/api/public/desk-roster?since=${afterCheckIn.seq}`);
    const body = (await res.json()) as DeskRosterDeltaBody;

    expect(body.events).toHaveLength(1);
    const [departure] = body.events;
    expect(departure).toEqual({ seq: departure.seq, type: "departure", registrationId: id });
  });

  it("returns both events, in seq order, when a check-in and its undo land in the same delta window", async () => {
    // The exact input the wall's client-side collapse (arrival+departure for
    // the same person in one poll -> drop both) is specified against.
    const id = h.insertRegistration({ fullName: "Asha Nair" });
    const before = (await (await h.req("/api/public/desk-roster")).json()) as DeskRosterFullBody;

    await h.deskService.checkIn(id, ACTOR);
    await h.deskService.unmarkPresent(id, ACTOR);

    const res = await h.req(`/api/public/desk-roster?since=${before.seq}`);
    const body = (await res.json()) as DeskRosterDeltaBody;

    expect(body.events).toHaveLength(2);
    expect(body.events[0]).toMatchObject({ type: "arrival", registrationId: id });
    expect(body.events[1]).toEqual({ seq: body.events[1].seq, type: "departure", registrationId: id });
    expect(body.events[0].seq).toBeLessThan(body.events[1].seq);
  });

  it("reports the identical checkedInAt in full mode and delta mode for the same check-in", async () => {
    // Pins the invariant the wall's no-double-spotlight design rests on: the
    // wall dedups a delta arrival against a full-mode entry for the same
    // person with `===`, so the two modes must emit the exact same value.
    const id = h.insertRegistration({ fullName: "Asha Nair" });
    const before = (await (await h.req("/api/public/desk-roster")).json()) as DeskRosterFullBody;
    await h.deskService.checkIn(id, ACTOR);

    const full = (await (await h.req("/api/public/desk-roster")).json()) as DeskRosterFullBody;
    const delta = (await (await h.req(`/api/public/desk-roster?since=${before.seq}`)).json()) as DeskRosterDeltaBody;

    const fullEntry = full.entries.find((e) => e.registrationId === id);
    const deltaEvent = delta.events.find((e) => e.registrationId === id);
    expect(fullEntry?.checkedInAt).toBe(deltaEvent?.checkedInAt);
    expect(typeof fullEntry?.checkedInAt).toBe("number");
  });

  it("advances seq to the global audit-log max even when a later row doesn't match the event filter", async () => {
    const id = h.insertRegistration({ fullName: "Asha Nair" });
    const before = (await (await h.req("/api/public/desk-roster")).json()) as DeskRosterFullBody;

    await h.deskService.checkIn(id, ACTOR);
    // An unrelated desk action (spot registration) — id > since, but never
    // matches the event WHERE clause (action not in the check-in/undo pair).
    h.db.raw
      .prepare(
        `INSERT INTO system_audit_log (action, actor, target_type, target_id, details)
         VALUES ('spot_registration_created', 'desk@example.com', 'registration', ?, '{}')`,
      )
      .run(id);
    const globalMax = h.db.raw.prepare("SELECT MAX(id) AS seq FROM system_audit_log").get() as { seq: number };

    const res = await h.req(`/api/public/desk-roster?since=${before.seq}`);
    const body = (await res.json()) as DeskRosterDeltaBody;

    expect(body.events).toHaveLength(1);
    expect(body.events[0].type).toBe("arrival");
    expect(body.seq).toBe(globalMax.seq);
  });

  it("holds since steady with no crash when since is ahead of the current audit-log max", async () => {
    const id = h.insertRegistration();
    await h.deskService.checkIn(id, ACTOR);
    const maxSeq = h.db.raw.prepare("SELECT MAX(id) AS seq FROM system_audit_log").get() as { seq: number };
    const aheadOfLog = maxSeq.seq + 1000;

    const res = await h.req(`/api/public/desk-roster?since=${aheadOfLog}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DeskRosterDeltaBody;
    expect(body.events).toHaveLength(0);
    expect(body.seq).toBe(aheadOfLog);
  });

  it("sets Cache-Control: no-store", async () => {
    const res = await h.req("/api/public/desk-roster?since=0");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("excludes a donation-only registration's check-in from the delta", async () => {
    const donor = h.insertRegistration({ participationType: "donation_only" });
    const before = (await (await h.req("/api/public/desk-roster")).json()) as DeskRosterFullBody;

    // Desk service rejects check-in for donation-only (NotFoundError) — write
    // the audit row + timestamp directly to prove the endpoint's own filter,
    // independent of that unrelated guard.
    h.db.raw.prepare("UPDATE registrations SET checked_in_at = ? WHERE id = ?").run(Date.now(), donor);
    h.db.raw
      .prepare(
        `INSERT INTO system_audit_log (action, actor, target_type, target_id, details)
         VALUES ('attendee_checked_in', 'desk@example.com', 'registration', ?, '{"checkedInAt":1,"checkedInBy":1}')`,
      )
      .run(donor);

    const res = await h.req(`/api/public/desk-roster?since=${before.seq}`);
    const body = (await res.json()) as DeskRosterDeltaBody;
    expect(body.events).toHaveLength(0);
  });

  it("keeps the caller's since when the delta is empty (cursor never rewinds)", async () => {
    const id = h.insertRegistration();
    await h.deskService.checkIn(id, ACTOR);
    const after = (await (await h.req("/api/public/desk-roster")).json()) as DeskRosterFullBody;

    const res = await h.req(`/api/public/desk-roster?since=${after.seq}`);
    const body = (await res.json()) as DeskRosterDeltaBody;
    expect(body.events).toHaveLength(0);
    expect(body.seq).toBe(after.seq);
  });

  it("never leaks actor, checkedInBy, email, or city in the response body", async () => {
    const id = h.insertRegistration({ fullName: "Ravi Kumar" });
    const before = (await (await h.req("/api/public/desk-roster")).json()) as DeskRosterFullBody;
    await h.deskService.checkIn(id, ACTOR);

    const res = await h.req(`/api/public/desk-roster?since=${before.seq}`);
    const text = await res.text();
    expect(text).not.toContain("@");
    expect(text).not.toContain("actor");
    expect(text).not.toContain("checkedInBy");
    expect(text).not.toContain("Kochi");
  });
});

// ---------------------------------------------------------------------------
// GET /api/public/wall-image-manifest — the LED-wall photo pre-cache manifest.
// Reuses the same harness/route/env as desk-roster above (same publicRoutes,
// same PORTRAITS_BASE/THUMBS_BASE), because the manifest's whole contract is
// that its URLs are byte-identical to what the wall (desk-roster) requests.
// ---------------------------------------------------------------------------

interface WallImage {
  id: number;
  portraitUrl: string | null;
  thumbnailUrl: string | null;
}
interface WallImageManifestBody {
  count: number;
  images: WallImage[];
}

describe("GET /api/public/wall-image-manifest", () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
  });

  it("lists every eligible attendee WITH a photo — not filtered by check-in — with the wall's exact URLs", async () => {
    const a = h.insertRegistration({ fullName: "Asha Nair", photoThumbKey: "registrations/ASHA/photo-thumb.jpg" });
    const b = h.insertRegistration({ fullName: "Biju Rao", photoThumbKey: "registrations/BIJU/photo-thumb.jpg" });
    // No check-in for either — pre-cache runs before anyone arrives.

    const res = await h.req("/api/public/wall-image-manifest");
    expect(res.status).toBe(200);
    const body = (await res.json()) as WallImageManifestBody;

    expect(body.count).toBe(2);
    expect(body.images.find((i) => i.id === a)).toEqual({
      id: a,
      portraitUrl: `${PORTRAITS_BASE}/${a}.webp`,
      thumbnailUrl: `${THUMBS_BASE}/${a}.jpg`,
    });
    expect(body.images.find((i) => i.id === b)).toEqual({
      id: b,
      portraitUrl: `${PORTRAITS_BASE}/${b}.webp`,
      thumbnailUrl: `${THUMBS_BASE}/${b}.jpg`,
    });
  });

  it("excludes attendees without a photo (nothing to cache — the wall shows initials)", async () => {
    const noPhoto = h.insertRegistration({ fullName: "Ravi Kumar", photoThumbKey: null });

    const res = await h.req("/api/public/wall-image-manifest");
    const body = (await res.json()) as WallImageManifestBody;

    expect(body.count).toBe(0);
    expect(body.images.find((i) => i.id === noPhoto)).toBeUndefined();
  });

  it("excludes ineligible participation types even with a photo", async () => {
    const donor = h.insertRegistration({ participationType: "donation_only", photoThumbKey: "registrations/DONOR/photo-thumb.jpg" });

    const res = await h.req("/api/public/wall-image-manifest");
    const body = (await res.json()) as WallImageManifestBody;
    expect(body.images.find((i) => i.id === donor)).toBeUndefined();
  });

  it("produces URLs byte-identical to what the desk-roster (the wall) requests for the same attendee", async () => {
    // The core contract: pre-cache is keyed by exact URL, so a mismatch here
    // would make every pre-cached image a wall cache miss.
    const id = h.insertRegistration({ fullName: "Asha Nair", photoThumbKey: "registrations/ASHA/photo-thumb.jpg" });
    await h.deskService.checkIn(id, ACTOR);

    const roster = (await (await h.req("/api/public/desk-roster")).json()) as DeskRosterFullBody;
    const manifest = (await (await h.req("/api/public/wall-image-manifest")).json()) as WallImageManifestBody;

    const fromRoster = roster.entries.find((e) => e.registrationId === id);
    const fromManifest = manifest.images.find((i) => i.id === id);
    expect(fromManifest?.portraitUrl).toBe(fromRoster?.portraitUrl);
    expect(fromManifest?.thumbnailUrl).toBe(fromRoster?.thumbnailUrl);
  });

  it("sets Cache-Control: no-store", async () => {
    const res = await h.req("/api/public/wall-image-manifest");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
