/**
 * Mutating-endpoint audit coverage (access-control.spec.md R6.6,
 * staff-operations.spec.md R12.2).
 *
 * Slice t3: every staff-mutating endpoint that previously wrote no
 * system_audit_log entry now appends one on completion. This file asserts,
 * per action, that the endpoint appends the expected payload shape:
 *   - action (the new SystemAuditAction member)
 *   - actor = staff email (from c.var.auth.email, spec G9)
 *   - targetType / targetId
 *   - details (JSON) carrying the operation's payload
 *
 * The endpoints exercised here are driven through in-memory repo stubs; the
 * assertion target is the audit entry, not the business result.
 *
 * @module staff-audit.test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { createFakePermissionsDb } from "./helpers/fake-permissions-db.js";
import { staffRoutes } from "../routes/staff.routes.js";
import { bankTransactionRoutes } from "../routes/bank-transaction.routes.js";
import { signToken } from "../infra/jwt.js";
import type { AppEnv, Env } from "../env.js";
import type {
  IRegistrationRepository,
  IPaymentRepository,
  IInventoryRepository,
  IAttendeeRepository,
  IBankTransactionRepository,
  ISystemAuditRepository,
} from "../repositories/interfaces.js";
import type { Registration, Payment, SystemAuditAction } from "../domain/types.js";

// The bank-txn import handler runs the raw body through parseSbiStatement
// before importing. Stub it so the audit assertion does not depend on
// fixed-width statement fixtures.
vi.mock("../lib/sbi-statement-parser.js", () => ({
  parseSbiStatement: async () => ({
    accountName: "TEST",
    accountNumber: "0",
    startDate: "",
    endDate: "",
    openingBalance: 0,
    closingBalance: 0,
    transactions: [
      {
        txnHash: "h1",
        txnDate: "13 Apr 2026",
        txnDateIso: "2026-04-13",
        valueDate: "13 Apr 2026",
        description: "TEST CREDIT",
        refNo: "R1",
        branchCode: "BR",
        debitPaise: 0,
        creditPaise: 2_500_000,
        balancePaise: 2_500_000,
        txnType: "credit",
      },
    ],
  }),
}));

// ---------------------------------------------------------------------------
// Recording audit repo — captures every append for assertion.
// ---------------------------------------------------------------------------

interface AuditEntry {
  action: SystemAuditAction;
  actor: string;
  targetType?: string;
  targetId?: number;
  details?: string;
}

class RecordingAuditRepo implements ISystemAuditRepository {
  entries: AuditEntry[] = [];
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  only(action: SystemAuditAction): AuditEntry {
    const matches = this.entries.filter((e) => e.action === action);
    expect(matches, `exactly one '${action}' entry`).toHaveLength(1);
    return matches[0];
  }
}

// ---------------------------------------------------------------------------
// Minimal repo stubs — only the methods the exercised endpoints call.
// ---------------------------------------------------------------------------

class StubRegistrationRepo {
  updated: Array<{ id: number; status: string }> = [];
  async list(): Promise<Registration[]> {
    // One reg whose derived status (confirmed, via the verified payment below)
    // differs from its stored status (pending) -> produces exactly one fix.
    return [
      { id: 1, regCode: "SMRT000000000001", status: "pending", totalAmount: 1000 },
    ] as unknown as Registration[];
  }
  async updateStatus(id: number, status: string): Promise<void> {
    this.updated.push({ id, status });
  }
}

class StubPaymentRepo {
  async findByRegistration(): Promise<Payment[]> {
    return [{ status: "verified", amount: 1000 }] as unknown as Payment[];
  }
}

class StubInventoryRepo {
  saved: Record<string, number> | null = null;
  async set(inventory: Record<string, number>): Promise<void> {
    this.saved = inventory;
  }
}

class StubAttendeeRepo {
  async accommodationByNight(): Promise<Record<string, never>> {
    return {};
  }
}

class StubBankTransactionRepo {
  comments: Array<{ id: number; comment: string | null }> = [];
  links: Array<{ txn: number; payment: number }> = [];
  unlinks: Array<{ txn: number; payment: number }> = [];
  async importBatch() {
    return { inserted: 1, skipped: 0 };
  }
  async getById(id: number) {
    return { id } as unknown as Awaited<ReturnType<IBankTransactionRepository["getById"]>>;
  }
  async updateComment(id: number, comment: string | null): Promise<void> {
    this.comments.push({ id, comment });
  }
  async linkPayment(txn: number, payment: number): Promise<void> {
    this.links.push({ txn, payment });
  }
  async unlinkPayment(txn: number, payment: number): Promise<void> {
    this.unlinks.push({ txn, payment });
  }
}

// ---------------------------------------------------------------------------
// Test app + auth
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = "test-secret-key-for-staff-audit-route-tests-32!";
const STAFF_EMAIL = "staff@example.test";
const TEST_ENV = {
  JWT_SECRET: TEST_JWT_SECRET,
  DB: createFakePermissionsDb(),
} as unknown as Env;

async function staffToken(userId = 10, email = STAFF_EMAIL): Promise<string> {
  return signToken({ sub: String(userId), role: "staff", email }, TEST_JWT_SECRET, "7d");
}

interface Ctx {
  req: (input: string, init?: RequestInit) => Promise<Response>;
  audit: RecordingAuditRepo;
  registrationRepo: StubRegistrationRepo;
  inventoryRepo: StubInventoryRepo;
  bankRepo: StubBankTransactionRepo;
}

function createApp(): Ctx {
  _scopeCache.clear();
  const audit = new RecordingAuditRepo();
  const registrationRepo = new StubRegistrationRepo();
  const inventoryRepo = new StubInventoryRepo();
  const bankRepo = new StubBankTransactionRepo();

  const app = new Hono<AppEnv>().basePath("/api");
  app.use("*", async (c, next) => {
    c.set("systemAuditRepo", audit as ISystemAuditRepository);
    c.set("registrationRepo", registrationRepo as unknown as IRegistrationRepository);
    c.set("paymentRepo", new StubPaymentRepo() as unknown as IPaymentRepository);
    c.set("inventoryRepo", inventoryRepo as unknown as IInventoryRepository);
    c.set("attendeeRepo", new StubAttendeeRepo() as unknown as IAttendeeRepository);
    c.set("bankTransactionRepo", bankRepo as unknown as IBankTransactionRepository);
    await next();
  });
  app.route("/staff", staffRoutes);
  app.route("/staff/bank-transactions", bankTransactionRoutes);

  const req = (input: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(app.request(input, init, TEST_ENV));
  return { req, audit, registrationRepo, inventoryRepo, bankRepo };
}

async function authed(
  ctx: Ctx,
  path: string,
  method: string,
  body?: unknown,
  contentType = "application/json",
): Promise<Response> {
  const token = await staffToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = contentType;
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }
  return ctx.req(path, { method, headers, body: payload });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("R6.6 — staff mutating endpoints write system_audit_log", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = createApp();
  });

  describe("POST /staff/reconcile-statuses -> statuses_reconciled", () => {
    it("audits on live mode with actor + fix details", async () => {
      const res = await authed(ctx, "/api/staff/reconcile-statuses", "POST", { dryRun: false });
      expect(res.status).toBe(200);

      const entry = ctx.audit.only("statuses_reconciled");
      expect(entry.actor).toBe(STAFF_EMAIL);
      expect(entry.targetType).toBe("registration");
      const details = JSON.parse(entry.details!);
      expect(details).toMatchObject({ totalChecked: 1, fixesCount: 1, dryRun: false });
      expect(details.fixes).toEqual([
        { id: 1, regCode: "SMRT000000000001", from: "pending", to: "confirmed" },
      ]);
      // live mode actually persisted the fix
      expect(ctx.registrationRepo.updated).toEqual([{ id: 1, status: "confirmed" }]);
    });

    it("audits on dry-run mode too, without persisting", async () => {
      const res = await authed(ctx, "/api/staff/reconcile-statuses", "POST", { dryRun: true });
      expect(res.status).toBe(200);

      const entry = ctx.audit.only("statuses_reconciled");
      expect(entry.actor).toBe(STAFF_EMAIL);
      const details = JSON.parse(entry.details!);
      expect(details.dryRun).toBe(true);
      expect(details.fixesCount).toBe(1);
      expect(ctx.registrationRepo.updated).toEqual([]);
    });
  });

  describe("PUT /staff/room-inventory -> room_inventory_updated", () => {
    it("audits actor + new inventory payload", async () => {
      const res = await authed(ctx, "/api/staff/room-inventory", "PUT", { "2026-04-13": 40 });
      expect(res.status).toBe(200);

      const entry = ctx.audit.only("room_inventory_updated");
      expect(entry.actor).toBe(STAFF_EMAIL);
      expect(entry.targetType).toBe("inventory");
      const details = JSON.parse(entry.details!);
      expect(details.newInventory).toEqual({ "2026-04-13": 40 });
      expect(details).toHaveProperty("overCommitted");
    });
  });

  describe("POST /staff/bank-transactions/import -> bank_txn_imported", () => {
    it("audits a batch entry with counts", async () => {
      const res = await authed(
        ctx,
        "/api/staff/bank-transactions/import",
        "POST",
        "raw statement text",
        "text/plain",
      );
      expect(res.status).toBe(200);

      const entry = ctx.audit.only("bank_txn_imported");
      expect(entry.actor).toBe(STAFF_EMAIL);
      expect(entry.targetType).toBe("bank_transaction_batch");
      const details = JSON.parse(entry.details!);
      expect(details).toMatchObject({ imported: 1, skipped: 0, total: 1 });
      expect(typeof details.batchId).toBe("string");
    });
  });

  describe("POST /staff/bank-transactions/:id/comment -> bank_txn_commented", () => {
    it("audits with targetId + comment", async () => {
      const res = await authed(ctx, "/api/staff/bank-transactions/42/comment", "POST", {
        comment: "matched by hand",
      });
      expect(res.status).toBe(200);

      const entry = ctx.audit.only("bank_txn_commented");
      expect(entry.actor).toBe(STAFF_EMAIL);
      expect(entry.targetType).toBe("bank_transaction");
      expect(entry.targetId).toBe(42);
      expect(JSON.parse(entry.details!)).toEqual({ comment: "matched by hand" });
    });
  });

  describe("POST /staff/bank-transactions/:id/link -> bank_txn_linked", () => {
    it("audits one entry covering all payment ids", async () => {
      const res = await authed(ctx, "/api/staff/bank-transactions/7/link", "POST", {
        paymentIds: [101, 102],
      });
      expect(res.status).toBe(200);

      const entry = ctx.audit.only("bank_txn_linked");
      expect(entry.actor).toBe(STAFF_EMAIL);
      expect(entry.targetType).toBe("bank_transaction");
      expect(entry.targetId).toBe(7);
      expect(JSON.parse(entry.details!)).toEqual({ paymentIds: [101, 102] });
    });
  });

  describe("DELETE /staff/bank-transactions/:id/link/:paymentId -> bank_txn_unlinked", () => {
    it("audits with targetId + unlinked paymentId", async () => {
      const res = await authed(ctx, "/api/staff/bank-transactions/7/link/101", "DELETE");
      expect(res.status).toBe(200);

      const entry = ctx.audit.only("bank_txn_unlinked");
      expect(entry.actor).toBe(STAFF_EMAIL);
      expect(entry.targetType).toBe("bank_transaction");
      expect(entry.targetId).toBe(7);
      expect(JSON.parse(entry.details!)).toEqual({ paymentId: 101 });
    });
  });
});
