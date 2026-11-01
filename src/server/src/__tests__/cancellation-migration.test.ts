/**
 * Migration 0020 verification — the expand/backfill refund rebuild must
 * apply on top of the pre-0020 migrations and preserve existing refund rows
 * with identity/source snapshot facts backfilled from the live registration
 * and payment (plan §9 "Migration notes", Task 1 verify checkpoint).
 *
 * The migrations run on a real SQLite database in order; a legacy refund row
 * is seeded through the 0012-era shape (live links + amount/status only) and
 * then 0020 is applied. The rebuilt row must keep its id/amount/status and
 * gain the snapshot columns with reason='overpayment'.
 */

import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationsDir = fileURLToPath(new URL("../../migrations", import.meta.url));

function migrationSql(name: string): string {
  return readFileSync(`${migrationsDir}/${name}`, "utf8");
}

describe("0020_cancellation_refunds migration", () => {
  it("applies after the full pre-0020 chain and backfills existing refund rows", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");

    for (const name of [
      "0000_init.sql",
      "0001_add_gender_tshirt.sql",
      "0002_add_payment_proof_columns.sql",
      "0003_users_and_auth.sql",
      "0004_email_unique.sql",
      "0005_drop_id_doc_uploaded.sql",
      "0006_add_extra_bed.sql",
      "0007_add_photo_file_key.sql",
      "0008_add_participation_type.sql",
      "0009_add_photo_thumb_key.sql",
      "0010_add_contribution_splits.sql",
      "0011_archived_registrations.sql",
      "0012_add_refunds_table.sql",
      "0013_room_inventory.sql",
      "0014_add_breakfast.sql",
      "0015_bank_transactions.sql",
      "0016_add_permissions.sql",
      "0017_roommate_preferences.sql",
      "0018_feature_flags.sql",
      "0019_tshirts_and_charges.sql",
    ]) {
      db.exec(migrationSql(name));
    }

    // Seed a legacy confirmed registration + verified payment + overpayment
    // refund using the 0012-era refund shape (live links, amount, status).
    const regInfo = db
      .prepare(
        `INSERT INTO registrations (reg_code, status, full_name, branch, email, whatsapp, city, country, attendance_intent, participation_type, alumni_meal, accommodation, contribution_splits, pricing_snapshot, total_amount)
         VALUES ('SMRTMIGRATION00001', 'confirmed', 'Legacy Alumni', '2005', 'legacy@example.com', '+919999999999', 'Kochi', 'India', 'attending', 'full_celebration', 'veg', 'none', '{}', '{}', 5500)`,
      )
      .run();
    const regId = Number(regInfo.lastInsertRowid);

    const payInfo = db
      .prepare(
        `INSERT INTO payments (registration_id, amount, status, gateway, gateway_ref, proof_file_key, verified_by, verified_at)
         VALUES (?, 6200, 'verified', 'bank_transfer', 'UTR-LEGACY', 'proofs/legacy.jpg', 'staff@smriti.com', 1754000000000)`,
      )
      .run(regId);
    const paymentId = Number(payInfo.lastInsertRowid);
    const payCreatedAt = db.prepare("SELECT created_at FROM payments WHERE id = ?").get(paymentId) as { created_at: number };

    const refundInfo = db
      .prepare(
        `INSERT INTO refunds (registration_id, source_payment_id, amount, status, bank_reference, resolved_by, resolved_at, created_at)
         VALUES (?, ?, 700, 'completed', 'IMPS/LEGACY', 'staff@smriti.com', 1754100000000, 1753900000000)`,
      )
      .run(regId, paymentId);
    const refundId = Number(refundInfo.lastInsertRowid);

    // Apply 0020.
    db.exec(migrationSql("0020_cancellation_refunds.sql"));

    // The rebuilt row preserves id/amount/status/bank fields and gains the
    // snapshot columns backfilled from the live registration and payment.
    const row = db
      .prepare("SELECT * FROM refunds WHERE id = ?")
      .get(refundId) as Record<string, unknown>;
    expect(row["amount"]).toBe(700);
    expect(row["status"]).toBe("completed");
    expect(row["reason"]).toBe("overpayment");
    expect(row["cancellation_reason"]).toBeNull();
    expect(row["bank_reference"]).toBe("IMPS/LEGACY");
    expect(row["resolved_by"]).toBe("staff@smriti.com");
    expect(row["resolved_at"]).toBe(1754100000000);
    expect(row["created_at"]).toBe(1753900000000);
    expect(row["original_registration_id"]).toBe(regId);
    expect(row["reg_code"]).toBe("SMRTMIGRATION00001");
    expect(row["full_name"]).toBe("Legacy Alumni");
    expect(row["email"]).toBe("legacy@example.com");
    expect(row["source_payment_original_id"]).toBe(paymentId);
    expect(row["source_payment_amount"]).toBe(6200);
    expect(row["source_payment_reference"]).toBe("UTR-LEGACY");
    expect(row["source_payment_gateway"]).toBe("bank_transfer");
    expect(row["source_payment_created_at"]).toBe(payCreatedAt.created_at);
    expect(row["source_payment_verified_by"]).toBe("staff@smriti.com");
    expect(row["source_payment_verified_at"]).toBe(1754000000000);
    expect(row["source_payment_proof_key"]).toBe("proofs/legacy.jpg");

    // FK integrity holds after the rebuild.
    const fkViolations = db.prepare("PRAGMA foreign_key_check").all();
    expect(fkViolations).toHaveLength(0);

    // Indexes created by 0020.
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'refunds' ORDER BY name").all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name).sort();
    expect(indexNames).toEqual([
      "idx_refund_original_registration",
      "idx_refund_registration",
      "idx_refund_source_payment",
      "idx_refund_status",
      "uq_refund_cancellation_once",
    ]);

    const archiveIndexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'archived_registrations' AND name = 'uq_archived_original_id'").all();
    expect(archiveIndexes).toHaveLength(1);

    db.close();
  });

  it("keeps the partial cancellation-refund unique guard enforced", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const name of [
      "0000_init.sql",
      "0001_add_gender_tshirt.sql",
      "0002_add_payment_proof_columns.sql",
      "0003_users_and_auth.sql",
      "0004_email_unique.sql",
      "0005_drop_id_doc_uploaded.sql",
      "0006_add_extra_bed.sql",
      "0007_add_photo_file_key.sql",
      "0008_add_participation_type.sql",
      "0009_add_photo_thumb_key.sql",
      "0010_add_contribution_splits.sql",
      "0011_archived_registrations.sql",
      "0012_add_refunds_table.sql",
      "0013_room_inventory.sql",
      "0014_add_breakfast.sql",
      "0015_bank_transactions.sql",
      "0016_add_permissions.sql",
      "0017_roommate_preferences.sql",
      "0018_feature_flags.sql",
      "0019_tshirts_and_charges.sql",
      "0020_cancellation_refunds.sql",
    ]) {
      db.exec(migrationSql(name));
    }

    const regInfo = db
      .prepare(
        `INSERT INTO registrations (reg_code, status, full_name, branch, email, whatsapp, city, country, attendance_intent, participation_type, alumni_meal, accommodation, contribution_splits, pricing_snapshot, total_amount)
         VALUES ('SMRTMIGRATION00002', 'confirmed', 'Duplicate Alumni', '2005', 'dup@example.com', '+919999999999', 'Kochi', 'India', 'attending', 'full_celebration', 'veg', 'none', '{}', '{}', 5500)`,
      )
      .run();
    const regId = Number(regInfo.lastInsertRowid);

    db.prepare(
      `INSERT INTO refunds (registration_id, original_registration_id, source_payment_id, source_payment_original_id, amount, reason, status)
       VALUES (?, ?, NULL, 77, 5500, 'cancellation', 'pending')`,
    ).run(regId, regId);

    // Second cancellation refund for the same (original registration, source
    // payment) pair must violate the partial unique index.
    expect(() => {
      db.prepare(
        `INSERT INTO refunds (registration_id, original_registration_id, source_payment_id, source_payment_original_id, amount, reason, status)
         VALUES (?, ?, NULL, 77, 5500, 'cancellation', 'pending')`,
      ).run(regId, regId);
    }).toThrow(/UNIQUE constraint failed/);

    // Overpayment rows are NOT covered by the partial guard.
    expect(() => {
      db.prepare(
        `INSERT INTO refunds (registration_id, original_registration_id, source_payment_id, source_payment_original_id, amount, reason, status)
         VALUES (?, ?, NULL, 77, 100, 'overpayment', 'pending')`,
      ).run(regId, regId);
    }).not.toThrow();

    db.close();
  });
});
