/**
 * Feature/regression tests for staff cancellation & cancellation refunds
 * (plan tasks/2026-08-03-cancellation-refunds.plan.md).
 *
 * These tests run against a REAL SQLite database (SqliteD1 adapter on
 * node:sqlite) loaded from the canonical schema — foreign keys, unique
 * indexes, ON DELETE SET NULL and db.batch() transaction atomicity are all
 * genuinely exercised, not faked.
 *
 * The feature-verification test (CANCEL_FULL_FLOW) seeds a confirmed
 * registration with one verified payment, one bank link, one ID document,
 * one t-shirt, one additional charge, one magic link, roommate preferences
 * in both directions and an existing overpayment refund, then cancels it and
 * asserts the plan §7 feature-verification checklist: active row gone,
 * complete snapshot, one pending cancellation refund of the verified amount,
 * live links nulled, system audit retained, completion with a bank
 * reference, and exactly one completion audit row.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SqliteD1 } from "./helpers/sqlite-d1.js";
import { createFakePermissionsDb } from "./helpers/fake-permissions-db.js";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { staffRoutes } from "../routes/staff.routes.js";
import { signToken } from "../infra/jwt.js";
import type { AppEnv } from "../env.js";
import { handleError } from "../middleware/error.middleware.js";

import { D1RegistrationRepository } from "../repositories/registration.repo.js";
import { D1PaymentRepository } from "../repositories/payment.repo.js";
import { D1AttendeeRepository } from "../repositories/attendee.repo.js";
import { D1AuditRepository } from "../repositories/audit.repo.js";
import { D1DocumentRepository } from "../repositories/document.repo.js";
import { D1RefundRepository } from "../repositories/refund.repo.js";
import { D1TshirtRepository } from "../repositories/tshirt.repo.js";
import { D1AdditionalChargeRepository } from "../repositories/additional-charge.repo.js";
import { CancellationService } from "../services/cancellation.service.js";
import { ArchiveService } from "../services/archive.service.js";
import { PaymentService } from "../services/payment.service.js";
import { NotFoundError, RefundCreateNoRowsError } from "../services/errors.js";
import { toRefund, type RefundRow } from "../domain/types.js";

const schemaPath = fileURLToPath(new URL("../db/schema.sql", import.meta.url));
const SCHEMA_SQL = readFileSync(schemaPath, "utf8");

/** A real SQLite D1 that can inject a state change just before batch()
 *  executes — simulates a payment verify/upload committing between the
 *  service's read and its atomic batch. */
class RaceD1 extends SqliteD1 {
  beforeBatch: Array<() => void> = [];

  async batch(statements: Parameters<SqliteD1["batch"]>[0]): Promise<Awaited<ReturnType<SqliteD1["batch"]>>> {
    for (const fn of this.beforeBatch) fn();
    return super.batch(statements);
  }
}

/** A real SQLite D1 with a deterministic concurrency barrier: every batch()
 *  call parks until `target` calls have arrived, then they run in arrival
 *  order onto the single synchronous SQLite connection. With target=2, both
 *  concurrent service calls reach the batch (their reads have already
 *  happened) before either executes — the second arrival's batch sees the
 *  first one's committed writes. No lock is held while parked (super.batch
 *  has not begun), so the barrier cannot deadlock. */
class BarrierD1 extends SqliteD1 {
  private readonly target: number;
  private arrived = 0;
  private release: Array<() => void> = [];

  constructor(target: number) {
    super();
    this.target = target;
  }

  async batch(statements: Parameters<SqliteD1["batch"]>[0]): Promise<Awaited<ReturnType<SqliteD1["batch"]>>> {
    this.arrived += 1;
    if (this.arrived < this.target) {
      await new Promise<void>((resolve) => this.release.push(resolve));
    } else {
      for (const r of this.release) r();
    }
    return super.batch(statements);
  }
}

/** A real SQLite D1 whose batch() throws at a selected statement index AFTER
 *  the preceding statements have already executed inside BEGIN — the throw
 *  happens mid-transaction, so the ROLLBACK (not a pre-batch throw) is what
 *  undoes the already-executed statements. Exercises the real transaction
 *  rollback path, not a failure before the batch starts. */
class FailBatchD1 extends SqliteD1 {
  failAtStatement: number | null = null;

  async batch(statements: Parameters<SqliteD1["batch"]>[0]): Promise<Awaited<ReturnType<SqliteD1["batch"]>>> {
    this.raw.exec("BEGIN");
    try {
      const results: Array<{ meta: { changes: number; last_row_id: number } }> = [];
      for (let i = 0; i < statements.length; i++) {
        if (this.failAtStatement === i) {
          throw new Error(`injected batch failure at statement ${i}`);
        }
        results.push(statements[i].run());
      }
      this.raw.exec("COMMIT");
      return results;
    } catch (err) {
      this.raw.exec("ROLLBACK");
      throw err;
    }
  }
}

interface CancellationHarness {
  db: RaceD1;
  cancellationService: CancellationService;
  paymentService: PaymentService;
  archiveService: ArchiveService;
  refundRepo: D1RefundRepository;
  paymentRepo: D1PaymentRepository;
}

function makePaymentService(db: D1Database): PaymentService {
  const registrationRepo = new D1RegistrationRepository(db);
  const paymentRepo = new D1PaymentRepository(db);
  const attendeeRepo = new D1AttendeeRepository(db);
  const auditRepo = new D1AuditRepository(db);
  const refundRepo = new D1RefundRepository(db);
  return new PaymentService({
    db,
    registrationRepo,
    paymentRepo,
    attendeeRepo,
    auditRepo,
    refundRepo,
    fileStorage: {
      async upload(): Promise<void> {},
      async getSignedUrl(): Promise<string> { return ""; },
      async get() { return null; },
      async delete(): Promise<void> {},
      async copy(): Promise<boolean> { return true; },
      async move(): Promise<void> {},
    },
    emailService: {
      async sendConfirmation(): Promise<void> {},
      async sendMagicLink(): Promise<void> {},
      async sendPaymentConfirmed(): Promise<void> {},
      async sendPaymentRejected(): Promise<void> {},
      async sendStaffWelcome(): Promise<void> {},
      async sendPaymentLink(): Promise<void> {},
      async sendRevisedPayment(): Promise<void> {},
      async sendAdditionalPayment(): Promise<void> {},
      async sendStoryHidden(): Promise<void> {},
    },
    appBaseUrl: "http://localhost:5173",
  });
}

function makeCancellationService(d1: D1Database): CancellationService {
  const registrationRepo = new D1RegistrationRepository(d1);
  const paymentRepo = new D1PaymentRepository(d1);
  const attendeeRepo = new D1AttendeeRepository(d1);
  const auditRepo = new D1AuditRepository(d1);
  const documentRepo = new D1DocumentRepository(d1);
  const refundRepo = new D1RefundRepository(d1);
  const tshirtRepo = new D1TshirtRepository(d1);
  const chargeRepo = new D1AdditionalChargeRepository(d1);
  return new CancellationService({
    db: d1,
    registrationRepo,
    paymentRepo,
    attendeeRepo,
    auditRepo,
    documentRepo,
    refundRepo,
    tshirtRepo,
    chargeRepo,
  });
}

function createHarness(): CancellationHarness {
  const db = new RaceD1();
  db.loadSchema(SCHEMA_SQL);
  const d1 = db as unknown as D1Database;

  const registrationRepo = new D1RegistrationRepository(d1);
  const paymentRepo = new D1PaymentRepository(d1);
  const attendeeRepo = new D1AttendeeRepository(d1);
  const auditRepo = new D1AuditRepository(d1);
  const documentRepo = new D1DocumentRepository(d1);
  const refundRepo = new D1RefundRepository(d1);
  const tshirtRepo = new D1TshirtRepository(d1);
  const chargeRepo = new D1AdditionalChargeRepository(d1);

  const cancellationService = new CancellationService({
    db: d1,
    registrationRepo,
    paymentRepo,
    attendeeRepo,
    auditRepo,
    documentRepo,
    refundRepo,
    tshirtRepo,
    chargeRepo,
  });

  const archiveService = new ArchiveService({
    db: d1,
    registrationRepo,
    paymentRepo,
    attendeeRepo,
    auditRepo,
    documentRepo,
    refundRepo,
    tshirtRepo,
    chargeRepo,
  });

  const paymentService = makePaymentService(d1);

  return { db, cancellationService, paymentService, archiveService, refundRepo, paymentRepo };
}

/** Inserts a registration row (NOT NULL surface) and returns its id. */
function insertRegistration(db: SqliteD1, regCode: string, email: string): number {
  db.raw
    .prepare(
      `INSERT INTO registrations (
         reg_code, status, full_name, branch, email, whatsapp, city, country,
         attendance_intent, participation_type, alumni_meal, accommodation,
         contribution_splits, pricing_snapshot, total_amount
       ) VALUES (?, 'confirmed', 'Sample Alumnus', 'Computer Science & Engineering', ?, '+919999999999',
         'Kochi', 'India', 'attending', 'full_celebration', 'non_veg', 'none',
         '{}', '{"base":5500,"lines":[],"donation":0,"collegeContribution":0,"total":5500}', 5500)`,
    )
    .run(regCode, email);
  const row = db.raw.prepare("SELECT id FROM registrations WHERE reg_code = ?").get(regCode) as { id: number };
  return row.id;
}

function insertUser(db: SqliteD1): number {
  const info = db.raw
    .prepare("INSERT INTO users (email, name, role, is_active) VALUES ('staff@smriti.com', 'Staff', 'staff', 1)")
    .run();
  return Number(info.lastInsertRowid);
}

/**
 * Seeds a confirmed registration with the full plan §7 feature-test fixture:
 * one verified payment (INR 5,500), one ID document, one audit entry, one
 * t-shirt, one additional charge, one magic link, one bank link, roommate
 * preferences in BOTH directions (against a second registration), and an
 * existing overpayment refund.
 */
function seedFullFixture(db: SqliteD1): { regId: number; regCode: string; paymentId: number; otherRegId: number } {
  const regId = insertRegistration(db, "SMRTCANCEL000001", "sample.alumnus@example.com");
  const otherRegId = insertRegistration(db, "SMRTCANCEL000002", "other@example.com");
  const userId = insertUser(db);

  // Verified payment — the refund target (INR 5,500).
  const payInfo = db.raw
    .prepare(
      `INSERT INTO payments (registration_id, amount, status, gateway, gateway_ref, proof_file_key, verified_by, verified_at)
       VALUES (?, 5500, 'verified', 'bank_transfer', 'UTR-SUNITH-5500', 'proofs/sunith.jpg', 'staff@smriti.com', 1754000000000)`,
    )
    .run(regId);
  const paymentId = Number(payInfo.lastInsertRowid);

  // Second verified payment on the same registration is NOT created — the
  // fixture is a single-payment confirmation.

  // ID document
  db.raw
    .prepare(
      `INSERT INTO id_documents (registration_id, file_name, mime_type, size_bytes, r2_key)
       VALUES (?, 'id.jpg', 'image/jpeg', 1024, 'id-docs/sunith-id.jpg')`,
    )
    .run(regId);

  // Registration-scoped audit entry (kept in snapshot; not the system audit)
  db.raw
    .prepare(
      `INSERT INTO audit_log (registration_id, action, actor, changes, snapshot)
       VALUES (?, 'created', 'system', NULL, '{"registration":{},"attendees":[]}')`,
    )
    .run(regId);

  // T-shirt + additional charge
  db.raw
    .prepare("INSERT INTO tshirts (registration_id, gender, size, is_included) VALUES (?, 'male', 'L', 1)")
    .run(regId);
  db.raw
    .prepare("INSERT INTO additional_charges (registration_id, description, amount, created_by) VALUES (?, 'Extra breakfast', 300, ?)")
    .run(regId, userId);

  // Magic link (token hash must NOT leak into the snapshot)
  db.raw
    .prepare("INSERT INTO magic_links (token_hash, registration_id, expires_at) VALUES ('hash-should-not-leak', ?, 1900000000000)")
    .run(regId);

  // Bank statement transaction + payment link
  const txnInfo = db.raw
    .prepare(
      `INSERT INTO bank_transactions (txn_hash, txn_date, txn_date_iso, value_date, description, debit_paise, credit_paise, balance_paise, txn_type, import_batch)
       VALUES ('hash-txn-1', '2026-08-01', '2026-08-01', '2026-08-01', 'SAMPLE ALUMNUS', 0, 550000, 550000, 'credit', 'batch-1')`,
    )
    .run();
  const txnId = Number(txnInfo.lastInsertRowid);
  db.raw
    .prepare("INSERT INTO bank_transaction_payments (bank_transaction_id, payment_id) VALUES (?, ?)")
    .run(txnId, paymentId);

  // Roommate preferences in BOTH directions (registration_id → other,
  // other → registration_id)
  db.raw
    .prepare(
      "INSERT INTO roommate_preferences (registration_id, preferred_registration_id, preference_order, created_by) VALUES (?, ?, 1, ?)",
    )
    .run(regId, otherRegId, userId);
  db.raw
    .prepare(
      "INSERT INTO roommate_preferences (registration_id, preferred_registration_id, preference_order, created_by) VALUES (?, ?, 1, ?)",
    )
    .run(otherRegId, regId, userId);

  // Existing overpayment refund (survives cancellation as a detached row)
  db.raw
    .prepare(
      `INSERT INTO refunds (
         registration_id, source_payment_id, amount, reason, status,
         original_registration_id, reg_code, full_name, email,
         source_payment_original_id, source_payment_amount, source_payment_reference,
         source_payment_gateway, source_payment_created_at, source_payment_verified_by,
         source_payment_verified_at, source_payment_proof_key
       ) VALUES (?, ?, 700, 'overpayment', 'pending',
         ?, 'SMRTCANCEL000001', 'Sample Alumnus', 'sample.alumnus@example.com',
         ?, 6200, 'UTR-OVERPAY', 'bank_transfer', 1753900000000, 'staff@smriti.com',
         1754000000000, 'proofs/overpay.jpg')`,
    )
    .run(regId, paymentId, regId, paymentId);

  return { regId, regCode: "SMRTCANCEL000001", paymentId, otherRegId };
}

function snapshotOf(db: SqliteD1, archivedId: number): Record<string, unknown> {
  const row = db.raw.prepare("SELECT snapshot FROM archived_registrations WHERE id = ?").get(archivedId) as {
    snapshot: string;
  };
  return JSON.parse(row.snapshot) as Record<string, unknown>;
}

let harness: CancellationHarness;

beforeEach(() => {
  harness = createHarness();
});

afterEach(() => {
  harness.db.close();
});

// ---------------------------------------------------------------------------
// CANCEL_FULL_FLOW — plan §7 feature verification test
// ---------------------------------------------------------------------------

describe("CANCEL_FULL_FLOW — plan §7 feature verification", () => {
  it("cancels a confirmed registration: snapshot complete, one 5,500 refund, links nulled, audit retained, refund completable", async () => {
    const { db, cancellationService, paymentService, refundRepo } = harness;
    const { regId, regCode, paymentId } = seedFullFixture(db);

    const result = await cancellationService.cancel(regId, "Alumni requested cancellation", "staff@smriti.com");

    // Response: archived identity + one pending cancellation refund (5,500)
    expect(result.originalRegistrationId).toBe(regId);
    expect(result.regCode).toBe(regCode);
    expect(result.fullName).toBe("Sample Alumnus");
    expect(result.totalRefundAmount).toBe(5500);
    expect(result.refunds).toHaveLength(1);
    expect(result.refunds[0].reason).toBe("cancellation");
    expect(result.refunds[0].amount).toBe(5500);
    expect(result.refunds[0].cancellationReason).toBe("Alumni requested cancellation");
    expect(result.refunds[0].status).toBe("pending");
    expect(result.refunds[0].ownerKind).toBe("cancelled");
    expect(result.refunds[0].registrationId).toBeNull();
    expect(result.refunds[0].sourcePaymentId).toBeNull();

    // 1. The active registration is gone.
    const regCount = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
    expect(regCount.c).toBe(0);
    // Payments are gone (verified payment deleted with the registration).
    const payCount = db.raw.prepare("SELECT COUNT(*) AS c FROM payments WHERE id = ?").get(paymentId) as { c: number };
    expect(payCount.c).toBe(0);
    // Roommate preferences removed from BOTH FK directions.
    const roomCount = db.raw
      .prepare("SELECT COUNT(*) AS c FROM roommate_preferences WHERE registration_id = ? OR preferred_registration_id = ?")
      .get(regId, regId) as { c: number };
    expect(roomCount.c).toBe(0);
    // Magic links deleted (and never copied into the snapshot).
    const mlCount = db.raw.prepare("SELECT COUNT(*) AS c FROM magic_links WHERE registration_id = ?").get(regId) as { c: number };
    expect(mlCount.c).toBe(0);

    // 2. The archive snapshot contains every listed child record + keys.
    const snapshot = snapshotOf(db, result.archivedId);
    const expectedKeys = [
      "registration", "attendees", "documents", "auditLog", "payments", "tshirts",
      "additionalCharges", "roommatePreferences", "refunds", "bankTransactionLinks",
      "bankTransactions", "cancellation",
    ].sort();
    expect(Object.keys(snapshot).sort()).toEqual(expectedKeys);
    expect((snapshot.documents as unknown[]).length).toBe(1);
    expect((snapshot.auditLog as unknown[]).length).toBe(1);
    expect((snapshot.tshirts as unknown[]).length).toBe(1);
    expect((snapshot.additionalCharges as unknown[]).length).toBe(1);
    expect((snapshot.roommatePreferences as unknown[]).length).toBe(2);
    expect((snapshot.bankTransactionLinks as unknown[]).length).toBe(1);
    const bankTxns = snapshot.bankTransactions as Array<{ txn_hash: string; credit_paise: number }>;
    expect(bankTxns).toHaveLength(1);
    expect(bankTxns[0].txn_hash).toBe("hash-txn-1");
    expect(bankTxns[0].credit_paise).toBe(550000);
    expect((snapshot.payments as unknown[]).length).toBe(1);
    const cancellation = snapshot.cancellation as { reason: string; actor: string; refundTotal: number };
    expect(cancellation.reason).toBe("Alumni requested cancellation");
    expect(cancellation.actor).toBe("staff@smriti.com");
    expect(cancellation.refundTotal).toBe(5500);

    // 3. Snapshot refunds preserve the EXISTING overpayment refund AND the
    //    proposed cancellation source facts (no generated refund ids, no
    //    magic-link hashes anywhere in the snapshot).
    const snapRefunds = snapshot.refunds as unknown[];
    expect(snapRefunds).toHaveLength(2);
    const overpaymentSnap = snapRefunds.find((r) => (r as { reason: string }).reason === "overpayment") as {
      id: number; amount: number; reason: string;
    };
    const proposedCancellation = snapRefunds.find((r) => (r as { reason: string }).reason === "cancellation") as {
      amount: number; sourcePaymentId: number; cancellationReason: string;
    };
    expect(overpaymentSnap.id).toBeTypeOf("number");
    expect(overpaymentSnap.amount).toBe(700);
    expect(proposedCancellation.amount).toBe(5500);
    expect(proposedCancellation.sourcePaymentId).toBe(paymentId);
    expect(proposedCancellation.cancellationReason).toBe("Alumni requested cancellation");
    expect(proposedCancellation).not.toHaveProperty("id");
    expect(JSON.stringify(snapshot)).not.toContain("hash-should-not-leak");

    // 4. Refund rows survive deletion: both the overpayment refund and the
    //    cancellation refund exist as detached rows (live links nulled).
    const allRefunds = await refundRepo.list();
    expect(allRefunds).toHaveLength(2);
    for (const r of allRefunds) {
      expect(r.registrationId).toBeNull();
      expect(r.ownerKind).toBe("cancelled");
      expect(r.originalRegistrationId).toBe(regId);
      expect(r.regCode).toBe(regCode);
      expect(r.fullName).toBe("Sample Alumnus");
    }
    const cancellationRefund = allRefunds.find((r) => r.reason === "cancellation");
    expect(cancellationRefund?.sourcePaymentAmount).toBe(5500);
    expect(cancellationRefund?.sourcePaymentReference).toBe("UTR-SUNITH-5500");

    // 5. The system audit log retains cancellation + refund-creation entries
    //    after the active row is deleted, targeting the original id.
    const systemAudit = db.raw.prepare("SELECT action, target_id, details FROM system_audit_log ORDER BY id").all() as Array<{
      action: string; target_id: number; details: string;
    }>;
    const actions = systemAudit.map((a) => a.action);
    expect(actions).toContain("registration_cancelled");
    expect(actions).toContain("cancellation_refund_created");
    for (const entry of systemAudit) {
      expect(entry.target_id).toBe(regId);
    }
    const cancelled = systemAudit.find((a) => a.action === "registration_cancelled");
    const cancelledDetails = JSON.parse(cancelled!.details) as { refundTotal: number; refunds: Array<{ amount: number; sourcePaymentId: number }> };
    expect(cancelledDetails.refundTotal).toBe(5500);
    expect(cancelledDetails.refunds).toHaveLength(1);
    expect(cancelledDetails.refunds[0].amount).toBe(5500);
    expect(cancelledDetails.refunds[0].sourcePaymentId).toBe(paymentId);
    const refundCreated = systemAudit.find((a) => a.action === "cancellation_refund_created");
    expect(JSON.parse(refundCreated!.details).amount).toBe(5500);

    // 6. The detached cancellation refund can be completed with a bank
    //    reference, writing exactly one completion system-audit entry.
    const completed = await paymentService.completeRefund(cancellationRefund!.id, "IMPS/SUNITH-REFUND", "staff@smriti.com");
    expect(completed.status).toBe("completed");
    const afterComplete = await refundRepo.findById(cancellationRefund!.id);
    expect(afterComplete?.status).toBe("completed");
    expect(afterComplete?.bankReference).toBe("IMPS/SUNITH-REFUND");
    const completionAudits = db.raw
      .prepare("SELECT action FROM system_audit_log WHERE action = 'refund_completed'")
      .all() as Array<{ action: string }>;
    expect(completionAudits).toHaveLength(1);

    // 7. Repeat completion is a 409 with no additional audit row.
    await expect(
      paymentService.completeRefund(cancellationRefund!.id, "IMPS/AGAIN", "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 409 });
    const completionAuditsAfter = db.raw
      .prepare("SELECT action FROM system_audit_log WHERE action = 'refund_completed'")
      .all() as Array<{ action: string }>;
    expect(completionAuditsAfter).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Cancellation preconditions
// ---------------------------------------------------------------------------

describe("Cancellation — preconditions", () => {
  it("rejects a blank reason with 422", async () => {
    const { db, cancellationService } = harness;
    const { regId } = seedFullFixture(db);
    await expect(
      cancellationService.cancel(regId, "   ", "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 422 });
    // Nothing deleted.
    const c = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
    expect(c.c).toBe(1);
  });

  it("404 when the registration never existed", async () => {
    const { cancellationService } = harness;
    await expect(
      cancellationService.cancel(99999, "No such reg", "staff@smriti.com"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("409 (not 404) when the registration was already cancelled/archived", async () => {
    const { db, cancellationService } = harness;
    const { regId } = seedFullFixture(db);
    await cancellationService.cancel(regId, "First cancellation", "staff@smriti.com");

    // The active row is gone — a repeat must surface as a known conflict.
    await expect(
      cancellationService.cancel(regId, "Second cancellation", "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 409 });

    // No duplicate archive or refund history.
    const archives = db.raw.prepare("SELECT COUNT(*) AS c FROM archived_registrations WHERE original_id = ?").get(regId) as { c: number };
    expect(archives.c).toBe(1);
    const refunds = db.raw
      .prepare("SELECT COUNT(*) AS c FROM refunds WHERE original_registration_id = ? AND reason = 'cancellation'")
      .get(regId) as { c: number };
    expect(refunds.c).toBe(1);
  });

  it("409 when a payment is pending_verification (unreviewed proof)", async () => {
    const { db, cancellationService } = harness;
    const regId = insertRegistration(db, "SMRTCANCEL000010", "pending@example.com");
    db.raw
      .prepare("INSERT INTO payments (registration_id, amount, status, proof_file_key) VALUES (?, 5500, 'pending_verification', 'proofs/p.jpg')")
      .run(regId);

    await expect(
      cancellationService.cancel(regId, "Cancel anyway", "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 409 });

    // Nothing deleted.
    const c = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
    expect(c.c).toBe(1);
  });

  it("cancels an unpaid registration (payment_pending stub only) with zero refunds", async () => {
    const { db, cancellationService } = harness;
    const regId = insertRegistration(db, "SMRTCANCEL000011", "unpaid@example.com");
    db.raw
      .prepare("INSERT INTO payments (registration_id, amount, status) VALUES (?, 5500, 'payment_pending')")
      .run(regId);

    const result = await cancellationService.cancel(regId, "No show", "staff@smriti.com");
    expect(result.totalRefundAmount).toBe(0);
    expect(result.refunds).toHaveLength(0);

    const regCount = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
    expect(regCount.c).toBe(0);
    const refundCount = db.raw
      .prepare("SELECT COUNT(*) AS c FROM refunds WHERE original_registration_id = ?")
      .get(regId) as { c: number };
    expect(refundCount.c).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Atomicity — race between the read and the batch (defect 3)
// ---------------------------------------------------------------------------

describe("Cancellation — atomic race protection", () => {
  it("a payment verified between the read and the batch still gets a refund (never deleted without one)", async () => {
    const { db, cancellationService } = harness;
    // Unpaid registration at read time: a payment_pending stub.
    const regId = insertRegistration(db, "SMRTCANCEL000020", "race-verify@example.com");
    const payInfo = db.raw
      .prepare("INSERT INTO payments (registration_id, amount, status) VALUES (?, 5500, 'payment_pending')")
      .run(regId);
    const paymentId = Number(payInfo.lastInsertRowid);

    // The concurrent verify commits just before the batch executes: the stub
    // becomes a verified payment. The cancellation must refund it.
    db.beforeBatch.push(() => {
      db.raw
        .prepare("UPDATE payments SET status = 'verified', verified_by = 'staff@smriti.com', verified_at = 1754000000000 WHERE id = ?")
        .run(paymentId);
    });

    const result = await cancellationService.cancel(regId, "Race verify", "staff@smriti.com");
    expect(result.totalRefundAmount).toBe(5500);
    expect(result.refunds).toHaveLength(1);
    expect(result.refunds[0].amount).toBe(5500);

    // The snapshot is the read-time in-memory assembly (plan §4 step 5) and
    // is stored unchanged; the plan does not require it to be reconciled to
    // batch-time payment state for this read→batch race.

    const regCount = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
    expect(regCount.c).toBe(0);
    const payCount = db.raw.prepare("SELECT COUNT(*) AS c FROM payments WHERE id = ?").get(paymentId) as { c: number };
    expect(payCount.c).toBe(0);
  });

  it("a payment moving to pending_verification between the read and the batch aborts the whole cancellation with 409 and no partial state", async () => {
    const { db, cancellationService } = harness;
    // One verified payment (would be refunded) plus one stub that gets a
    // proof uploaded (→ pending_verification) before the batch runs.
    const regId = insertRegistration(db, "SMRTCANCEL000021", "race-pending@example.com");
    const verifiedInfo = db.raw
      .prepare("INSERT INTO payments (registration_id, amount, status, verified_by, verified_at) VALUES (?, 5500, 'verified', 'staff@smriti.com', 1754000000000)")
      .run(regId);
    const verifiedId = Number(verifiedInfo.lastInsertRowid);
    const stubInfo = db.raw
      .prepare("INSERT INTO payments (registration_id, amount, status) VALUES (?, 2000, 'payment_pending')")
      .run(regId);
    const stubId = Number(stubInfo.lastInsertRowid);

    db.beforeBatch.push(() => {
      db.raw.prepare("UPDATE payments SET status = 'pending_verification' WHERE id = ?").run(stubId);
    });

    await expect(
      cancellationService.cancel(regId, "Race pending", "staff@smriti.com"),
    ).rejects.toMatchObject({ statusCode: 409 });

    // Atomic no-op: registration, both payments, no refunds, no archive,
    // no audit rows.
    const regCount = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
    expect(regCount.c).toBe(1);
    const payCount = db.raw
      .prepare("SELECT COUNT(*) AS c FROM payments WHERE registration_id = ?")
      .get(regId) as { c: number };
    expect(payCount.c).toBe(2);
    const refundCount = db.raw
      .prepare("SELECT COUNT(*) AS c FROM refunds WHERE original_registration_id = ?")
      .get(regId) as { c: number };
    expect(refundCount.c).toBe(0);
    const archiveCount = db.raw
      .prepare("SELECT COUNT(*) AS c FROM archived_registrations WHERE original_id = ?")
      .get(regId) as { c: number };
    expect(archiveCount.c).toBe(0);
    const auditCount = db.raw
      .prepare("SELECT COUNT(*) AS c FROM system_audit_log WHERE target_id = ?")
      .get(regId) as { c: number };
    expect(auditCount.c).toBe(0);
    void verifiedId;
  });
});

// ---------------------------------------------------------------------------
// Injected failure at each batch step (plan §7 integration tests): a throw
// mid-transaction — after earlier statements executed inside BEGIN — must
// ROLL BACK the whole batch. No partial archive, refund, or audit may survive.
// ---------------------------------------------------------------------------

describe("Cancellation — injected batch failure rolls back atomically", () => {
  // Statement order of CancellationService.cancel()'s batch (service source):
  //   0 archive insert, 1 cancellation refund insert, 2 snapshot materialize,
  //   3 registration_cancelled audit, 4 cancellation_refund_created audit,
  //   5-6 roommate cleanup (both directions), 7 magic-link delete,
  //   8 payment_pending delete, 9 payment delete, 10 registration delete.
  const BATCH_STATEMENT_COUNT = 11;

  it("a failure at ANY batch statement leaves registration, payments, refunds, archive and audit unchanged", async () => {
    for (let failAt = 0; failAt < BATCH_STATEMENT_COUNT; failAt++) {
      const db = new FailBatchD1();
      db.loadSchema(SCHEMA_SQL);
      const d1 = db as unknown as D1Database;
      const { regId } = seedFullFixture(db);
      const cancellationService = makeCancellationService(d1);

      db.failAtStatement = failAt;
      await expect(
        cancellationService.cancel(regId, `Injected failure at statement ${failAt}`, "staff@smriti.com"),
      ).rejects.toThrow(/injected batch failure/);

      // No partial state from the rolled-back batch: the registration and its
      // verified payment are alive, the seeded overpayment refund is the only
      // refund, and no archive or system-audit row was written.
      const regCount = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
      expect(regCount.c).toBe(1);
      const payCount = db.raw
        .prepare("SELECT COUNT(*) AS c FROM payments WHERE registration_id = ? AND status = 'verified'")
        .get(regId) as { c: number };
      expect(payCount.c).toBe(1);
      const refundCount = db.raw.prepare("SELECT COUNT(*) AS c FROM refunds").get() as { c: number };
      expect(refundCount.c).toBe(1);
      const refundStatus = db.raw.prepare("SELECT status FROM refunds").get() as { status: string };
      expect(refundStatus.status).toBe("pending");
      const archiveCount = db.raw.prepare("SELECT COUNT(*) AS c FROM archived_registrations").get() as { c: number };
      expect(archiveCount.c).toBe(0);
      const auditCount = db.raw.prepare("SELECT COUNT(*) AS c FROM system_audit_log").get() as { c: number };
      expect(auditCount.c).toBe(0);
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// verifyPayment overpayment + cancellation integration: an overpayment refund
// (the excess) and the cancellation refund (the effective amount) together
// account for the full actual amount and survive as two detached refunds.
// ---------------------------------------------------------------------------

describe("verifyPayment overpayment — cancellation integration", () => {
  it("verify wins then cancellation: overpayment refund + cancellation refund fully account for the actual amount", async () => {
    const { db, paymentService, cancellationService, refundRepo } = harness;
    const regId = insertRegistration(db, "SMRTRACEVERIFY0002", "race-overpay2@example.com");
    const payInfo = db.raw
      .prepare("INSERT INTO payments (registration_id, amount, status, proof_file_key) VALUES (?, 5500, 'pending_verification', 'proofs/r2.jpg')")
      .run(regId);
    const paymentId = Number(payInfo.lastInsertRowid);

    // Verify first — payment verified for the effective amount with the
    // excess (700) recorded as an overpayment refund.
    const verifyResult = await paymentService.verifyPayment(paymentId, "UTR-OVERPAY", "staff@smriti.com", 6200);
    expect(verifyResult.paymentStatus).toBe("verified");
    expect(verifyResult.refundCreated).toEqual({ id: expect.any(Number), amount: 700 });

    // Cancellation then runs against the verified payment: it refunds the
    // effective (verified) amount and deletes the registration.
    const cancelResult = await cancellationService.cancel(regId, "Cancel after overpayment verify", "staff@smriti.com");
    expect(cancelResult.totalRefundAmount).toBe(5500);

    // The full actual amount (6200 = 5500 effective + 700 excess) is accounted
    // across the two detached refunds — the overpayment excess was never lost.
    const refunds = await refundRepo.list();
    expect(refunds).toHaveLength(2);
    const overpayment = refunds.find((r) => r.reason === "overpayment");
    const cancellationRefund = refunds.find((r) => r.reason === "cancellation");
    expect(overpayment).toBeDefined();
    expect(cancellationRefund).toBeDefined();
    expect(overpayment!.amount).toBe(700);
    expect(cancellationRefund!.amount).toBe(5500);
    expect(overpayment!.amount + cancellationRefund!.amount).toBe(6200);
    for (const r of refunds) {
      expect(r.registrationId).toBeNull();
      expect(r.ownerKind).toBe("cancelled");
      expect(r.originalRegistrationId).toBe(regId);
    }

    // Active rows are gone; the cancellation events survive in system_audit_log.
    const regCount = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
    expect(regCount.c).toBe(0);
    const payCount = db.raw.prepare("SELECT COUNT(*) AS c FROM payments WHERE id = ?").get(paymentId) as { c: number };
    expect(payCount.c).toBe(0);
    const cancelledAudits = db.raw
      .prepare("SELECT COUNT(*) AS c FROM system_audit_log WHERE action = 'registration_cancelled' AND target_id = ?")
      .get(regId) as { c: number };
    expect(cancelledAudits.c).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Archive — atomic race protection (defect: read-time guard, batch deletes
// everything)
// ---------------------------------------------------------------------------

describe("Archive — atomic race protection", () => {
  it("a payment verified between the read and the batch aborts the archive with 409 and deletes nothing (force included)", async () => {
    const { db, archiveService } = harness;
    // Stub-only registration at read time — archive is allowed. The concurrent
    // verify commits just before the batch executes.
    const regId = insertRegistration(db, "SMRTARCHIVE000040", "archive-race@example.com");
    const payInfo = db.raw
      .prepare("INSERT INTO payments (registration_id, amount, status) VALUES (?, 5500, 'payment_pending')")
      .run(regId);
    const paymentId = Number(payInfo.lastInsertRowid);

    db.beforeBatch.push(() => {
      db.raw
        .prepare("UPDATE payments SET status = 'verified', verified_by = 'staff@smriti.com', verified_at = 1754000000000 WHERE id = ?")
        .run(paymentId);
    });

    // force=true must not bypass the batch guard either.
    await expect(
      archiveService.archive(regId, "staff@smriti.com", { force: true }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // No state mutated: registration alive, payment intact and VERIFIED (not
    // deleted without its refund trail), no archive row.
    const regCount = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
    expect(regCount.c).toBe(1);
    const payRow = db.raw.prepare("SELECT status FROM payments WHERE id = ?").get(paymentId) as { status: string };
    expect(payRow.status).toBe("verified");
    const archiveCount = db.raw
      .prepare("SELECT COUNT(*) AS c FROM archived_registrations WHERE original_id = ?")
      .get(regId) as { c: number };
    expect(archiveCount.c).toBe(0);
  });

  it("ordinary unpaid archive still succeeds and deletes the payment_pending stub", async () => {
    const { db, archiveService } = harness;
    const regId = insertRegistration(db, "SMRTARCHIVE000041", "archive-clean@example.com");
    const payInfo = db.raw
      .prepare("INSERT INTO payments (registration_id, amount, status) VALUES (?, 5500, 'payment_pending')")
      .run(regId);
    const paymentId = Number(payInfo.lastInsertRowid);

    const result = await archiveService.archive(regId, "staff@smriti.com");
    expect(result.archivedId).toBeGreaterThan(0);
    const regCount = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
    expect(regCount.c).toBe(0);
    const payCount = db.raw.prepare("SELECT COUNT(*) AS c FROM payments WHERE id = ?").get(paymentId) as { c: number };
    expect(payCount.c).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Refund completion — concurrent completion race (plan §7: "concurrent
// completion has one winner")
// ---------------------------------------------------------------------------

describe("Refund completion — concurrent completion race", () => {
  it("two concurrent completion calls: one success, one 409, one completed refund, exactly one audit row", async () => {
    const db = new BarrierD1(2);
    db.loadSchema(SCHEMA_SQL);
    const d1 = db as unknown as D1Database;
    const regId = insertRegistration(db, "SMRTCOMPLETE000050", "complete-race@example.com");
    const payInfo = db.raw
      .prepare(
        `INSERT INTO payments (registration_id, amount, status, gateway, gateway_ref, verified_by, verified_at)
         VALUES (?, 5500, 'verified', 'bank_transfer', 'UTR-COMPLETE', 'staff@smriti.com', 1754000000000)`,
      )
      .run(regId);
    const paymentId = Number(payInfo.lastInsertRowid);

    // A pending cancellation refund with a full snapshot (the detached shape
    // the cancellation flow produces — live links already nulled).
    const refundInfo = db.raw
      .prepare(
        `INSERT INTO refunds (
           registration_id, source_payment_id, amount, reason, cancellation_reason, status,
           original_registration_id, reg_code, full_name, email,
           source_payment_original_id, source_payment_amount, source_payment_reference
         ) VALUES (NULL, NULL, 5500, 'cancellation', 'Concurrent completion', 'pending',
           ?, 'SMRTCOMPLETE000050', 'Sample Alumnus', 'complete-race@example.com', ?, 5500, 'UTR-COMPLETE')`,
      )
      .run(regId, paymentId);
    const refundId = Number(refundInfo.lastInsertRowid);

    const paymentService = makePaymentService(d1);

    // Both calls start from a pending refund: the barrier parks both batch()
    // calls before either executes, so the loser's guarded UPDATE runs after
    // the winner committed and must see status='completed' (zero rows).
    const results = await Promise.allSettled([
      paymentService.completeRefund(refundId, "NEFT/RACE-A", "staff@smriti.com"),
      paymentService.completeRefund(refundId, "NEFT/RACE-B", "staff@smriti.com"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });

    // One completed refund with the winner's bank reference.
    const row = db.raw.prepare("SELECT status, bank_reference FROM refunds WHERE id = ?").get(refundId) as {
      status: string; bank_reference: string;
    };
    expect(row.status).toBe("completed");
    expect(["NEFT/RACE-A", "NEFT/RACE-B"]).toContain(row.bank_reference);

    // Exactly one refund_completed system-audit row — the loser wrote none.
    const auditRows = db.raw
      .prepare("SELECT action FROM system_audit_log WHERE action = 'refund_completed'")
      .all() as Array<{ action: string }>;
    expect(auditRows).toHaveLength(1);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Concurrent duplicate cancellation — exercises the narrowed duplicate-guard
// catch (plan §4 step 3): the loser hits uq_archived_original_id in the batch
// and must surface as a documented 409, not an unrelated unique error.
// ---------------------------------------------------------------------------

describe("Cancellation — concurrent duplicate cancellation", () => {
  it("two concurrent cancel() calls: one wins, the loser is a 409 with exactly one archive/refund/audit set", async () => {
    const db = new BarrierD1(2);
    db.loadSchema(SCHEMA_SQL);
    const { regId } = seedFullFixture(db);

    const d1 = db as unknown as D1Database;
    const registrationRepo = new D1RegistrationRepository(d1);
    const paymentRepo = new D1PaymentRepository(d1);
    const attendeeRepo = new D1AttendeeRepository(d1);
    const auditRepo = new D1AuditRepository(d1);
    const documentRepo = new D1DocumentRepository(d1);
    const refundRepo = new D1RefundRepository(d1);
    const tshirtRepo = new D1TshirtRepository(d1);
    const chargeRepo = new D1AdditionalChargeRepository(d1);

    const cancellationService = new CancellationService({
      db: d1,
      registrationRepo,
      paymentRepo,
      attendeeRepo,
      auditRepo,
      documentRepo,
      refundRepo,
      tshirtRepo,
      chargeRepo,
    });

    // Both calls read the still-live registration; the barrier parks both
    // batches, so one commits and the other violates uq_archived_original_id
    // (mapped to 409 by the duplicate-guard catch).
    const results = await Promise.allSettled([
      cancellationService.cancel(regId, "Concurrent A", "staff@smriti.com"),
      cancellationService.cancel(regId, "Concurrent B", "staff@smriti.com"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });

    // Exactly one archive, one cancellation refund, registration gone, and
    // one registration_cancelled + one cancellation_refund_created audit row.
    const archives = db.raw
      .prepare("SELECT COUNT(*) AS c FROM archived_registrations WHERE original_id = ?")
      .get(regId) as { c: number };
    expect(archives.c).toBe(1);
    const refunds = db.raw
      .prepare("SELECT COUNT(*) AS c FROM refunds WHERE original_registration_id = ? AND reason = 'cancellation'")
      .get(regId) as { c: number };
    expect(refunds.c).toBe(1);
    const regCount = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
    expect(regCount.c).toBe(0);
    const cancelledAudits = db.raw
      .prepare("SELECT COUNT(*) AS c FROM system_audit_log WHERE action = 'registration_cancelled' AND target_id = ?")
      .get(regId) as { c: number };
    expect(cancelledAudits.c).toBe(1);
    const refundCreatedAudits = db.raw
      .prepare("SELECT COUNT(*) AS c FROM system_audit_log WHERE action = 'cancellation_refund_created' AND target_id = ?")
      .get(regId) as { c: number };
    expect(refundCreatedAudits.c).toBe(1);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Detached refund listing & completion (defect 6 / defect 10 server side)
// ---------------------------------------------------------------------------

describe("Detached refunds — listing and completion", () => {
  it("listWithRegistration returns detached refunds with stored identity and ownerKind 'cancelled'", async () => {
    const { db, cancellationService, refundRepo } = harness;
    const { regId, regCode } = seedFullFixture(db);
    await cancellationService.cancel(regId, "Detached listing", "staff@smriti.com");

    const listed = await refundRepo.listWithRegistration({ status: "pending" });
    const cancellationRefund = listed.find((r) => r.reason === "cancellation");
    expect(cancellationRefund).toBeDefined();
    expect(cancellationRefund?.ownerKind).toBe("cancelled");
    expect(cancellationRefund?.registrationId).toBeNull();
    expect(cancellationRefund?.fullName).toBe("Sample Alumnus");
    expect(cancellationRefund?.regCode).toBe(regCode);
    expect(cancellationRefund?.originalRegistrationId).toBe(regId);
    expect(cancellationRefund?.sourcePaymentAmount).toBe(5500);
    expect(cancellationRefund?.cancellationReason).toBe("Detached listing");
  });

  it("completeRefund works for a detached refund after registration and payment deletion", async () => {
    const { db, cancellationService, paymentService, refundRepo } = harness;
    const { regId } = seedFullFixture(db);
    const result = await cancellationService.cancel(regId, "Detached complete", "staff@smriti.com");

    const refundId = result.refunds[0].id;
    const completed = await paymentService.completeRefund(refundId, "NEFT/DETACHED-1", "staff@smriti.com");
    expect(completed.status).toBe("completed");

    const refund = await refundRepo.findById(refundId);
    expect(refund?.status).toBe("completed");
    expect(refund?.bankReference).toBe("NEFT/DETACHED-1");
  });
});

// ---------------------------------------------------------------------------
// Legacy overpayment rows during the expand/backfill rollout (defect 6)
// ---------------------------------------------------------------------------

describe("Refund readers — live-row fallback and malformed detached rejection", () => {  it("an active overpayment refund with NULL snapshot columns reads via the live-row fallback", async () => {
    const { db, refundRepo } = harness;
    const regId = insertRegistration(db, "SMRTCANCEL000030", "legacy@example.com");
    const payInfo = db.raw
      .prepare(
        `INSERT INTO payments (registration_id, amount, status, gateway, gateway_ref, proof_file_key, verified_by, verified_at, created_at)
         VALUES (?, 6200, 'verified', 'bank_transfer', 'UTR-LIVE-FALLBACK', 'proofs/live.jpg', 'staff@smriti.com', 1754000000000, 1753900000000)`,
      )
      .run(regId);
    const paymentId = Number(payInfo.lastInsertRowid);

    // Pre-deploy writer shape (0020 expand/backfill rollout): live links +
    // amount/status only — EVERY snapshot column is NULL.
    db.raw
      .prepare("INSERT INTO refunds (registration_id, source_payment_id, amount, status) VALUES (?, ?, 700, 'pending')")
      .run(regId, paymentId);

    const refund = await refundRepo.findById(1);
    expect(refund).not.toBeNull();
    expect(refund?.ownerKind).toBe("active");
    // Identity fields filled from the live registration via COALESCE.
    expect(refund?.regCode).toBe("SMRTCANCEL000030");
    expect(refund?.fullName).toBe("Sample Alumnus");
    expect(refund?.email).toBe("legacy@example.com");
    expect(refund?.originalRegistrationId).toBe(regId);
    // Source-payment snapshot fields filled from the LIVE payment via
    // COALESCE — the reader must never fabricate NULLs where live data
    // exists (source_payment_reference and the gateway/created/verified/
    // proof columns are all part of the same fallback).
    expect(refund?.originalPaymentId).toBe(paymentId);
    expect(refund?.sourcePaymentAmount).toBe(6200);
    expect(refund?.sourcePaymentReference).toBe("UTR-LIVE-FALLBACK");
    // The remaining snapshot columns round-trip through the same COALESCE
    // fallback the repository's SELECT applies to the live payment.
    const rawRow = db.raw
      .prepare(
        `SELECT
           COALESCE(rf.source_payment_gateway, pay.gateway) AS source_payment_gateway,
           COALESCE(rf.source_payment_created_at, pay.created_at) AS source_payment_created_at,
           COALESCE(rf.source_payment_verified_by, pay.verified_by) AS source_payment_verified_by,
           COALESCE(rf.source_payment_verified_at, pay.verified_at) AS source_payment_verified_at,
           COALESCE(rf.source_payment_proof_key, pay.proof_file_key) AS source_payment_proof_key
         FROM refunds rf LEFT JOIN payments pay ON pay.id = rf.source_payment_id WHERE rf.id = 1`,
      )
      .get() as { source_payment_gateway: string; source_payment_created_at: number; source_payment_verified_by: string; source_payment_verified_at: number; source_payment_proof_key: string };
    expect(rawRow.source_payment_gateway).toBe("bank_transfer");
    expect(rawRow.source_payment_created_at).toBe(1753900000000);
    expect(rawRow.source_payment_verified_by).toBe("staff@smriti.com");
    expect(rawRow.source_payment_verified_at).toBe(1754000000000);
    expect(rawRow.source_payment_proof_key).toBe("proofs/live.jpg");
  });

  it("a detached row with NULL snapshot fields is rejected explicitly (no fabricated values)", async () => {
    const { db } = harness;
    // Detached legacy row (live links nulled by an old deletion path) whose
    // snapshot columns were never backfilled.
    db.raw
      .prepare("INSERT INTO refunds (registration_id, source_payment_id, amount, status) VALUES (NULL, NULL, 700, 'pending')")
      .run();

    expect(() => toRefund({
      id: 1,
      registration_id: null,
      original_registration_id: null,
      reg_code: null,
      full_name: null,
      email: null,
      source_payment_id: null,
      source_payment_original_id: null,
      source_payment_amount: null,
      source_payment_reference: null,
      source_payment_gateway: null,
      source_payment_created_at: null,
      source_payment_verified_by: null,
      source_payment_verified_at: null,
      source_payment_proof_key: null,
      amount: 700,
      reason: 'overpayment',
      cancellation_reason: null,
      status: 'pending',
      bank_reference: null,
      resolved_by: null,
      resolved_at: null,
      created_at: 1754000000000,
    } as RefundRow)).toThrow(/missing immutable owner\/source snapshot fields/);
  });
});

// ---------------------------------------------------------------------------
// Legacy overpayment materialization on cancellation — pre-deploy overpayment
// rows have NULL snapshot columns; the live-row COALESCE fallback reads them
// while active, so the cancellation batch must materialize the snapshot from
// the live rows BEFORE deleting them or the detached row becomes unreadable
// (toRefund() rejects it).
// ---------------------------------------------------------------------------

describe("Cancellation — legacy overpayment snapshot materialization", () => {
  it("materializes NULL snapshot fields before deletion, keeping the detached overpayment readable beside the cancellation refund", async () => {
    const { db, cancellationService, refundRepo } = harness;
    const regId = insertRegistration(db, "SMRTCANCEL000060", "legacy-cancel@example.com");
    const payInfo = db.raw
      .prepare(
        `INSERT INTO payments (registration_id, amount, status, gateway, gateway_ref, proof_file_key, verified_by, verified_at, created_at)
         VALUES (?, 6200, 'verified', 'bank_transfer', 'UTR-LEGACY', 'proofs/legacy.jpg', 'staff@smriti.com', 1754000000000, 1753900000000)`,
      )
      .run(regId);
    const paymentId = Number(payInfo.lastInsertRowid);

    // Pre-deploy writer shape (0020 rollout): live links + amount/status only
    // — EVERY snapshot column is NULL in storage.
    db.raw
      .prepare("INSERT INTO refunds (registration_id, source_payment_id, amount, status) VALUES (?, ?, 700, 'pending')")
      .run(regId, paymentId);
    const activeRow = db.raw
      .prepare("SELECT original_registration_id, source_payment_amount FROM refunds WHERE registration_id = ?")
      .get(regId) as { original_registration_id: number | null; source_payment_amount: number | null };
    expect(activeRow.original_registration_id).toBeNull();
    expect(activeRow.source_payment_amount).toBeNull();

    const result = await cancellationService.cancel(regId, "Legacy overpayment", "staff@smriti.com");

    // The cancellation response still reports only the cancellation refund —
    // the materialized overpayment does not leak into the response.
    expect(result.totalRefundAmount).toBe(6200);
    expect(result.refunds).toHaveLength(1);
    expect(result.refunds[0].reason).toBe("cancellation");

    // Both refunds survive as detached rows and remain readable.
    const allRefunds = await refundRepo.list();
    expect(allRefunds).toHaveLength(2);
    const overpayment = allRefunds.find((r) => r.reason === "overpayment");
    const cancellationRefund = allRefunds.find((r) => r.reason === "cancellation");
    expect(overpayment).toBeDefined();
    expect(cancellationRefund).toBeDefined();

    // The detached overpayment's stored identity/source facts were
    // materialized from the live rows before deletion.
    expect(overpayment?.ownerKind).toBe("cancelled");
    expect(overpayment?.registrationId).toBeNull();
    expect(overpayment?.sourcePaymentId).toBeNull();
    expect(overpayment?.originalRegistrationId).toBe(regId);
    expect(overpayment?.regCode).toBe("SMRTCANCEL000060");
    expect(overpayment?.fullName).toBe("Sample Alumnus");
    expect(overpayment?.email).toBe("legacy-cancel@example.com");
    expect(overpayment?.originalPaymentId).toBe(paymentId);
    expect(overpayment?.sourcePaymentAmount).toBe(6200);
    expect(overpayment?.sourcePaymentReference).toBe("UTR-LEGACY");

    // The remaining source-payment snapshot columns were materialized too
    // (the same column set the reader's COALESCE fallback covers).
    const rawRow = db.raw
      .prepare(
        `SELECT source_payment_gateway, source_payment_created_at, source_payment_verified_by,
                source_payment_verified_at, source_payment_proof_key
         FROM refunds WHERE id = ?`,
      )
      .get(overpayment!.id) as {
        source_payment_gateway: string | null;
        source_payment_created_at: number | null;
        source_payment_verified_by: string | null;
        source_payment_verified_at: number | null;
        source_payment_proof_key: string | null;
      };
    expect(rawRow.source_payment_gateway).toBe("bank_transfer");
    expect(rawRow.source_payment_created_at).toBe(1753900000000);
    expect(rawRow.source_payment_verified_by).toBe("staff@smriti.com");
    expect(rawRow.source_payment_verified_at).toBe(1754000000000);
    expect(rawRow.source_payment_proof_key).toBe("proofs/legacy.jpg");

    // The cancellation refund alongside it is untouched by the materialization.
    expect(cancellationRefund?.sourcePaymentAmount).toBe(6200);
    expect(cancellationRefund?.originalPaymentId).toBe(paymentId);
    expect(cancellationRefund?.cancellationReason).toBe("Legacy overpayment");
  });
});

// ---------------------------------------------------------------------------
// Overpayment refund creation — the INSERT ... SELECT must write exactly one
// row. A zero-row insert (source payment gone or belonging to a different
// registration) must fail loudly with RefundCreateNoRowsError instead of
// reporting a bogus meta.last_row_id that PaymentService would audit/return
// as a refund that does not exist (refund.repo.ts CREATE_EXACTLY_ONE_ROW).
// ---------------------------------------------------------------------------

describe("D1RefundRepository.create — overpayment insert writes exactly one row", () => {
  function makeRepo(): { db: SqliteD1; refundRepo: D1RefundRepository } {
    const db = new SqliteD1();
    db.loadSchema(SCHEMA_SQL);
    return { db, refundRepo: new D1RefundRepository(db as unknown as D1Database) };
  }

  it("rejects a zero-row insert when the source payment does not exist — no refund row, no bogus id", async () => {
    const { db, refundRepo } = makeRepo();
    const regId = insertRegistration(db, "SMRTREFUND000001", "refund-missing@example.com");

    await expect(
      refundRepo.create({
        registration_id: regId,
        source_payment_id: 999999,
        amount: 500,
        status: 'pending',
      }),
    ).rejects.toBeInstanceOf(RefundCreateNoRowsError);

    // Nothing was written, so no refund id can have been reported.
    const refunds = db.raw.prepare("SELECT COUNT(*) AS c FROM refunds").get() as { c: number };
    expect(refunds.c).toBe(0);
    db.close();
  });

  it("rejects a zero-row insert when the payment belongs to a different registration", async () => {
    const { db, refundRepo } = makeRepo();
    const regA = insertRegistration(db, "SMRTREFUND000002", "refund-a@example.com");
    const regB = insertRegistration(db, "SMRTREFUND000003", "refund-b@example.com");
    const payInfo = db.raw
      .prepare("INSERT INTO payments (registration_id, amount, status) VALUES (?, 5500, 'verified')")
      .run(regB);
    const otherPaymentId = Number(payInfo.lastInsertRowid);

    await expect(
      refundRepo.create({
        registration_id: regA,
        source_payment_id: otherPaymentId,
        amount: 500,
        status: 'pending',
      }),
    ).rejects.toBeInstanceOf(RefundCreateNoRowsError);

    const refunds = db.raw.prepare("SELECT COUNT(*) AS c FROM refunds").get() as { c: number };
    expect(refunds.c).toBe(0);
    db.close();
  });

  it("preserves normal overpayment behavior: one row created, snapshot facts from the live rows", async () => {
    const { db, refundRepo } = makeRepo();
    const regId = insertRegistration(db, "SMRTREFUND000004", "refund-ok@example.com");
    const payInfo = db.raw
      .prepare(
        `INSERT INTO payments (registration_id, amount, status, gateway, gateway_ref, proof_file_key, verified_by, verified_at)
         VALUES (?, 6200, 'verified', 'bank_transfer', 'UTR-OVERPAY-OK', 'proofs/ok.jpg', 'staff@smriti.com', 1754000000000)`,
      )
      .run(regId);
    const paymentId = Number(payInfo.lastInsertRowid);

    const { id } = await refundRepo.create({
      registration_id: regId,
      source_payment_id: paymentId,
      amount: 700,
      status: 'pending',
    });

    const row = db.raw.prepare("SELECT * FROM refunds WHERE id = ?").get(id) as Record<string, unknown>;
    expect(row["registration_id"]).toBe(regId);
    expect(row["source_payment_id"]).toBe(paymentId);
    expect(row["amount"]).toBe(700);
    expect(row["reason"]).toBe("overpayment");
    expect(row["original_registration_id"]).toBe(regId);
    expect(row["reg_code"]).toBe("SMRTREFUND000004");
    expect(row["full_name"]).toBe("Sample Alumnus");
    expect(row["source_payment_original_id"]).toBe(paymentId);
    expect(row["source_payment_amount"]).toBe(6200);
    expect(row["source_payment_reference"]).toBe("UTR-OVERPAY-OK");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// POST /api/staff/registrations/:id/cancel — route wiring (defect 4)
// ---------------------------------------------------------------------------

describe("POST /api/staff/registrations/:id/cancel — route", () => {
  const JWT_SECRET = "test-secret-key-for-cancel-route-32chars!";

  function buildApp(db: RaceD1): { req: (input: string, init?: RequestInit) => Response | Promise<Response>; token: Promise<string> } {
    _scopeCache.clear();
    const d1 = db as unknown as D1Database;

    const registrationRepo = new D1RegistrationRepository(d1);
    const paymentRepo = new D1PaymentRepository(d1);
    const attendeeRepo = new D1AttendeeRepository(d1);
    const auditRepo = new D1AuditRepository(d1);
    const documentRepo = new D1DocumentRepository(d1);
    const refundRepo = new D1RefundRepository(d1);
    const tshirtRepo = new D1TshirtRepository(d1);
    const chargeRepo = new D1AdditionalChargeRepository(d1);

    const cancellationService = new CancellationService({
      db: d1,
      registrationRepo,
      paymentRepo,
      attendeeRepo,
      auditRepo,
      documentRepo,
      refundRepo,
      tshirtRepo,
      chargeRepo,
    });

    const paymentService = makePaymentService(d1);

    const app = new Hono<AppEnv>().basePath("/api");
    app.onError(handleError);
    app.use("*", async (c, next) => {
      c.set("cancellationService", cancellationService);
      c.set("refundRepo", refundRepo);
      c.set("paymentService", paymentService);
      await next();
    });
    app.route("/staff", staffRoutes);

    const env = { JWT_SECRET, DB: createFakePermissionsDb() } as unknown as AppEnv["Bindings"];
    const token = signToken({ sub: "10", role: "staff", email: "staff@smriti.com" }, JWT_SECRET, "7d");
    return { req: (input, init) => app.request(input, init, env), token };
  }

  it("returns the cancellation response with pending refunds and deletes the registration", async () => {
    const db = new RaceD1();
    db.loadSchema(SCHEMA_SQL);
    const { regId } = seedFullFixture(db);
    const { req, token } = buildApp(db);

    const res = await req(`/api/staff/registrations/${regId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: "Route-level cancellation" }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { archivedId: number; totalRefundAmount: number; refunds: Array<{ reason: string; amount: number }> };
    expect(body.archivedId).toBeGreaterThan(0);
    expect(body.totalRefundAmount).toBe(5500);
    expect(body.refunds).toHaveLength(1);
    expect(body.refunds[0].reason).toBe("cancellation");
    expect(body.refunds[0].amount).toBe(5500);

    const regCount = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
    expect(regCount.c).toBe(0);
    db.close();
  });

  it("422 when reason is missing or blank after trimming", async () => {
    const db = new RaceD1();
    db.loadSchema(SCHEMA_SQL);
    const { regId } = seedFullFixture(db);
    const { req, token } = buildApp(db);
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token}` };

    const missing = await req(`/api/staff/registrations/${regId}/cancel`, {
      method: "POST", body: JSON.stringify({}), headers,
    });
    expect(missing.status).toBe(422);

    const blank = await req(`/api/staff/registrations/${regId}/cancel`, {
      method: "POST", body: JSON.stringify({ reason: "   " }), headers,
    });
    expect(blank.status).toBe(422);

    // Nothing was deleted.
    const regCount = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
    expect(regCount.c).toBe(1);
    db.close();
  });

  it("400 (not 422) for a malformed JSON body — the malformed-JSON state is named, not mislabeled as a missing reason", async () => {
    const db = new RaceD1();
    db.loadSchema(SCHEMA_SQL);
    const { regId } = seedFullFixture(db);
    const { req, token } = buildApp(db);

    const res = await req(`/api/staff/registrations/${regId}/cancel`, {
      method: "POST",
      body: "{not-json",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token}` },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Invalid JSON body");

    // Nothing was deleted.
    const regCount = db.raw.prepare("SELECT COUNT(*) AS c FROM registrations WHERE id = ?").get(regId) as { c: number };
    expect(regCount.c).toBe(1);
    db.close();
  });

  it("404 for a never-existing registration and 409 for an already-cancelled one", async () => {
    const db = new RaceD1();
    db.loadSchema(SCHEMA_SQL);
    const { regId } = seedFullFixture(db);
    const { req, token } = buildApp(db);
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token}` };
    const body = JSON.stringify({ reason: "Conflict test" });

    const missing = await req(`/api/staff/registrations/99999/cancel`, {
      method: "POST", body, headers,
    });
    expect(missing.status).toBe(404);

    const first = await req(`/api/staff/registrations/${regId}/cancel`, { method: "POST", body, headers });
    expect(first.status).toBe(200);

    // Repeat cancellation of the same registration is a known 409 conflict.
    const repeat = await req(`/api/staff/registrations/${regId}/cancel`, { method: "POST", body, headers });
    expect(repeat.status).toBe(409);
    const repeatBody = await repeat.json() as { error: string };
    expect(repeatBody.error).toMatch(/already been archived or cancelled/i);
    db.close();
  });

  it("detached refund route flow: cancel → pending list → complete → completed list", async () => {
    const db = new RaceD1();
    db.loadSchema(SCHEMA_SQL);
    const { regId } = seedFullFixture(db);
    const { req, token } = buildApp(db);
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${await token}` };

    // 1. Cancel the full fixture through the route.
    const cancelRes = await req(`/api/staff/registrations/${regId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: "Alumni moved abroad" }),
      headers,
    });
    expect(cancelRes.status).toBe(200);
    const cancelBody = await cancelRes.json() as { refunds: Array<{ id: number }> };
    const refundId = cancelBody.refunds[0].id;

    // 2. Pending list: the detached cancellation refund carries null live
    //    links and the stored identity snapshot.
    const pendingRes = await req(`/api/staff/refunds?status=pending`, { headers });
    expect(pendingRes.status).toBe(200);
    const pendingBody = await pendingRes.json() as { refunds: Array<Record<string, unknown>> };
    expect(pendingBody.refunds).toHaveLength(2); // seeded overpayment + cancellation
    const detached = pendingBody.refunds.find((r) => r["reason"] === "cancellation");
    expect(detached).toBeDefined();
    expect(detached!["id"]).toBe(refundId);
    expect(detached!["registrationId"]).toBeNull();
    expect(detached!["sourcePaymentId"]).toBeNull();
    expect(detached!["ownerKind"]).toBe("cancelled");
    expect(detached!["originalRegistrationId"]).toBe(regId);
    expect(detached!["fullName"]).toBe("Sample Alumnus");
    expect(detached!["cancellationReason"]).toBe("Alumni moved abroad");

    // 3. Complete the detached refund through the route.
    const completeRes = await req(`/api/staff/refunds/${refundId}/complete`, {
      method: "POST",
      body: JSON.stringify({ bankReference: "IMPS/ROUTE-DETACHED" }),
      headers,
    });
    expect(completeRes.status).toBe(200);
    expect(await completeRes.json()).toEqual({ status: "completed" });

    // 4. Completed filter shows exactly the completed cancellation refund.
    const completedRes = await req(`/api/staff/refunds?status=completed`, { headers });
    expect(completedRes.status).toBe(200);
    const completedBody = await completedRes.json() as { refunds: Array<Record<string, unknown>> };
    expect(completedBody.refunds).toHaveLength(1);
    expect(completedBody.refunds[0]["id"]).toBe(refundId);
    expect(completedBody.refunds[0]["reason"]).toBe("cancellation");
    expect(completedBody.refunds[0]["status"]).toBe("completed");
    db.close();
  });
});
