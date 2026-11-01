/**
 * D1MemoryStoryRepository — runs against SqliteD1 (real SQLite adapter, real
 * schema.sql), so the guarded-UPDATE / audit-ordering logic in
 * memory-story.repo.ts (VISIBILITY_GUARDED) is exercised against genuine
 * db.batch() transaction semantics, not a hand-rolled fake.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import { SqliteD1 } from "./helpers/sqlite-d1.js";
import { D1MemoryStoryRepository } from "../repositories/memory-story.repo.js";
import type { D1Database } from "@cloudflare/workers-types";

const schemaPath = fileURLToPath(new URL("../db/schema.sql", import.meta.url));
const SCHEMA_SQL = readFileSync(schemaPath, "utf8");

function seedRegistration(db: SqliteD1, overrides: { photoThumbKey?: string | null } = {}): number {
  const info = db.raw
    .prepare(
      `INSERT INTO registrations (
         reg_code, status, full_name, branch, email, whatsapp, city, country,
         attendance_intent, participation_type, alumni_meal, accommodation,
         contribution_splits, pricing_snapshot, total_amount, photo_thumb_key
       ) VALUES (?, 'confirmed', 'Anjali Nair', 'Computer Science & Engineering',
         ?, '+919800000000', 'Kochi', 'India',
         'attending', 'full_celebration', 'veg', 'none', '{}',
         '{"base":0,"lines":[],"donation":0,"collegeContribution":0,"total":0}',
         0, ?)`,
    )
    .run(
      `SMRT${Math.random().toString(36).slice(2, 10)}`,
      `${Math.random()}@example.com`,
      overrides.photoThumbKey ?? null,
    );
  return Number(info.lastInsertRowid);
}

function seedAdminUser(db: SqliteD1): number {
  const info = db.raw
    .prepare(`INSERT INTO users (email, name, role) VALUES (?, 'Admin', 'admin')`)
    .run(`admin-${Math.random()}@example.com`);
  return Number(info.lastInsertRowid);
}

function auditRows(db: SqliteD1, action: string): unknown[] {
  return db.raw
    .prepare("SELECT * FROM system_audit_log WHERE action = ?")
    .all(action);
}

describe("D1MemoryStoryRepository", () => {
  let db: SqliteD1;
  let repo: D1MemoryStoryRepository;

  beforeEach(() => {
    db = new SqliteD1();
    db.loadSchema(SCHEMA_SQL);
    repo = new D1MemoryStoryRepository(db as unknown as D1Database);
  });

  it("create() then findByRegistrationId() round-trips the story", async () => {
    const regId = seedRegistration(db);
    const now = Date.now();
    const created = await repo.create({
      registrationId: regId,
      authorName: "Anjali Nair",
      authorBranch: "Computer Science & Engineering",
      text: "A".repeat(60),
      now,
    });

    expect(created.visibility).toBe("visible");
    expect(created.published_at).toBe(now);

    const found = await repo.findByRegistrationId(regId);
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(created.id);
    expect(found[0]?.text).toBe("A".repeat(60));
  });

  it("create() allows multiple stories for the same registration", async () => {
    const regId = seedRegistration(db);
    const first = await repo.create({ registrationId: regId, authorName: "A", authorBranch: "B", text: "x".repeat(60), now: 1 });
    const second = await repo.create({ registrationId: regId, authorName: "A", authorBranch: "B", text: "y".repeat(60), now: 2 });

    expect(second.id).not.toBe(first.id);
    const all = await repo.findByRegistrationId(regId);
    expect(all).toHaveLength(2);
  });

  it("countByRegistrationId() returns the correct count", async () => {
    const regId = seedRegistration(db);
    expect(await repo.countByRegistrationId(regId)).toBe(0);

    await repo.create({ registrationId: regId, authorName: "A", authorBranch: "B", text: "x".repeat(60), now: 1 });
    expect(await repo.countByRegistrationId(regId)).toBe(1);

    await repo.create({ registrationId: regId, authorName: "A", authorBranch: "B", text: "y".repeat(60), now: 2 });
    expect(await repo.countByRegistrationId(regId)).toBe(2);
  });

  it("listVisible() computes has_photo from the joined registration and excludes hidden stories", async () => {
    const adminId = seedAdminUser(db);
    const withPhoto = seedRegistration(db, { photoThumbKey: "registrations/1/photo.jpg" });
    const withoutPhoto = seedRegistration(db, { photoThumbKey: null });

    await repo.create({ registrationId: withPhoto, authorName: "Has Photo", authorBranch: "B", text: "x".repeat(60), now: 1 });
    const hiddenRow = await repo.create({ registrationId: withoutPhoto, authorName: "No Photo", authorBranch: "B", text: "y".repeat(60), now: 2 });

    await repo.setVisibility(hiddenRow.id, {
      visibility: "hidden",
      comment: "z".repeat(15),
      adminUserId: adminId,
      adminEmail: "admin@example.com",
      now: 3,
    });

    const visible = await repo.listVisible();
    expect(visible).toHaveLength(1);
    expect(visible[0]?.has_photo).toBe(1);
    expect(visible[0]?.author_name).toBe("Has Photo");
  });

  it("updateOwned() changes text/updated_at but preserves visibility, author, and published_at", async () => {
    const adminId = seedAdminUser(db);
    const regId = seedRegistration(db);
    const created = await repo.create({ registrationId: regId, authorName: "Anjali Nair", authorBranch: "CSE", text: "x".repeat(60), now: 100 });
    await repo.setVisibility(created.id, { visibility: "hidden", comment: "z".repeat(15), adminUserId: adminId, adminEmail: "a@x.com", now: 200 });

    const updated = await repo.updateOwned(created.id, regId, "y".repeat(70), 300);

    expect(updated?.text).toBe("y".repeat(70));
    expect(updated?.updated_at).toBe(300);
    expect(updated?.published_at).toBe(100);
    expect(updated?.author_name).toBe("Anjali Nair");
    expect(updated?.visibility).toBe("hidden");
  });

  it("updateOwned() returns null when the story doesn't exist", async () => {
    const regId = seedRegistration(db);
    const result = await repo.updateOwned(99999, regId, "x".repeat(60), Date.now());
    expect(result).toBeNull();
  });

  it("updateOwned() returns null when storyId belongs to a different registration", async () => {
    const regA = seedRegistration(db);
    const regB = seedRegistration(db);
    const story = await repo.create({ registrationId: regA, authorName: "A", authorBranch: "B", text: "x".repeat(60), now: 1 });

    const result = await repo.updateOwned(story.id, regB, "y".repeat(60), Date.now());
    expect(result).toBeNull();
  });

  it("deleteOwned() atomically deletes the row and writes exactly one audit entry", async () => {
    const regId = seedRegistration(db);
    const created = await repo.create({ registrationId: regId, authorName: "A", authorBranch: "B", text: "x".repeat(60), now: 1 });

    const deleted = await repo.deleteOwned(created.id, regId, "author@example.com");
    expect(deleted).toBe(true);
    expect(await repo.findByRegistrationId(regId)).toHaveLength(0);
    expect(auditRows(db, "memory_story_deleted")).toHaveLength(1);
  });

  it("deleteOwned() returns false and writes no audit entry when nothing exists", async () => {
    const regId = seedRegistration(db);
    const deleted = await repo.deleteOwned(99999, regId, "author@example.com");
    expect(deleted).toBe(false);
    expect(auditRows(db, "memory_story_deleted")).toHaveLength(0);
  });

  it("setVisibility() hide: changes state, writes one audit row, and is idempotent on repeat", async () => {
    const adminId = seedAdminUser(db);
    const regId = seedRegistration(db);
    const created = await repo.create({ registrationId: regId, authorName: "A", authorBranch: "B", text: "x".repeat(60), now: 1 });

    const first = await repo.setVisibility(created.id, {
      visibility: "hidden",
      comment: "moderation reason".padEnd(20, "!"),
      adminUserId: adminId,
      adminEmail: "admin@example.com",
      now: 500,
    });
    expect(first.changed).toBe(true);
    expect(first.row?.visibility).toBe("hidden");
    expect(first.row?.hidden_at).toBe(500);
    expect(first.row?.hidden_by_user_id).toBe(adminId);
    expect(auditRows(db, "memory_story_hidden")).toHaveLength(1);

    // Idempotent repeat: no state change, no second audit row.
    const second = await repo.setVisibility(created.id, {
      visibility: "hidden",
      comment: "moderation reason".padEnd(20, "!"),
      adminUserId: adminId,
      adminEmail: "admin@example.com",
      now: 600,
    });
    expect(second.changed).toBe(false);
    expect(second.row?.hidden_at).toBe(500); // untouched by the no-op repeat
    expect(auditRows(db, "memory_story_hidden")).toHaveLength(1);
  });

  it("setVisibility() unhide: reverses hide, clears moderation fields, and is idempotent on repeat", async () => {
    const adminId = seedAdminUser(db);
    const regId = seedRegistration(db);
    const created = await repo.create({ registrationId: regId, authorName: "A", authorBranch: "B", text: "x".repeat(60), now: 1 });
    await repo.setVisibility(created.id, { visibility: "hidden", comment: "reason".padEnd(15, "!"), adminUserId: adminId, adminEmail: "a@x.com", now: 10 });

    const first = await repo.setVisibility(created.id, { visibility: "visible", adminEmail: "a@x.com", now: 20 });
    expect(first.changed).toBe(true);
    expect(first.row?.visibility).toBe("visible");
    expect(first.row?.hidden_at).toBeNull();
    expect(first.row?.hidden_by_user_id).toBeNull();
    expect(first.row?.moderation_comment).toBeNull();
    expect(auditRows(db, "memory_story_unhidden")).toHaveLength(1);

    const second = await repo.setVisibility(created.id, { visibility: "visible", adminEmail: "a@x.com", now: 30 });
    expect(second.changed).toBe(false);
    expect(auditRows(db, "memory_story_unhidden")).toHaveLength(1);
  });

  it("setVisibility() on a nonexistent id returns changed:false, row:null, writes no audit", async () => {
    const result = await repo.setVisibility(999999, { visibility: "visible", adminEmail: "a@x.com", now: 1 });
    expect(result).toEqual({ changed: false, row: null });
    expect(auditRows(db, "memory_story_unhidden")).toHaveLength(0);
  });
});
