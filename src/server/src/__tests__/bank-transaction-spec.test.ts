/**
 * Adversarial QA — Bank Transaction Import System
 *
 * Enforces every GUARANTEE from the three CONTRACT blocks that make up this
 * feature's spec:
 *   - src/lib/sbi-statement-parser.ts        (parser — no formal CONTRACT
 *     block, but a documented column/tokenizer format)
 *   - src/repositories/bank-transaction.repo.ts (DEDUP_VIA_UNIQUE,
 *     BATCH_CHUNKED, NO_SQL_INJECTION, DOMAIN_TYPES, NO_N_PLUS_ONE,
 *     RECONCILED_FILTER, LIST_ORDER, PAGE_DEFAULTS, IDEMPOTENT_LINK)
 *   - src/routes/bank-transaction.routes.ts  (AUTH_GUARD, IMPORT, LIST,
 *     DETAIL, COMMENT, LINK, UNLINK)
 *
 * Loyal to the CONTRACT text, not to the implementation. Where a test
 * documents an actual (undocumented) behavior rather than a promised
 * GUARANTEE, it is labeled FINDING.
 *
 * @module bank-transaction-spec.test
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { parseSbiStatement } from "../lib/sbi-statement-parser.js";
import { _scopeCache } from "../middleware/auth.middleware.js";
import { createFakePermissionsDb } from "./helpers/fake-permissions-db.js";
import { D1BankTransactionRepository } from "../repositories/bank-transaction.repo.js";
import { bankTransactionRoutes } from "../routes/bank-transaction.routes.js";
import { signToken } from "../infra/jwt.js";
import type { AppEnv, Env } from "../env.js";
import type { IBankTransactionRepository, ISystemAuditRepository } from "../repositories/interfaces.js";
import type {
  BankTransactionRow,
  BankTransactionWithLinks,
  BankTransactionFilters,
  NewBankTransaction,
} from "../domain/bank-transaction-types.js";
import type { PaymentStatus } from "../domain/status.js";

// =============================================================================
// Shared fixed-width statement builders (mirror the parser's private column
// constants: COL_VALUE_DATE=13, COL_DESCRIPTION=36, COL_REF_NO=108,
// COL_BRANCH_CODE=148, DEBIT_CREDIT_THRESHOLD=(172+191)/2=181.5).
// =============================================================================

const COL_VALUE_DATE = 13;
const COL_DESCRIPTION = 36;
const COL_REF_NO = 108;
const COL_BRANCH_CODE = 148;

function buildHeader(opts?: { closingBalanceLine?: string; acctNumberLine?: string }): string[] {
  return [
    "Account Name:                      YOUR ALUMNI ASSOCIATION",
    "Address:                           YOUR ADDRESS LINE 1",
    "                                   YOUR CITY",
    "                                   India - 000000",
    "Date:                              19 Jul 2026",
    opts?.acctNumberLine ?? "Account Number:                    _00000000000000000",
    opts?.closingBalanceLine ?? "",
    "Branch:                            YOUR BRANCH",
    "",
    "Interest Rate(% p.a.):             0.0",
    "IFS Code            :              XXXX0000000",
    "Account Description:               CA-REGULAR-PUB-OTH-ALL-INR",
    "Currency:                          INR",
    "Book Balance:                      2150884.14",
    "Hold Value:                        0.00",
    "Available Balance:                 2150884.14",
    "Uncleared Amount:                  0.0",
    "Opening Balance as on 19 Jan 2026  0.00",
    "Start Date:                        19 Jan 2026",
    "End Date:                          19 Jul 2026",
    "Txn Date:    Value Date:            Description:                                                            Ref No./Cheque No.:                     Branch Code:            Debit:             Credit:            Balance:",
  ];
}

/**
 * Builds one fixed-width transaction line. Amount tokens are positioned by
 * controlling whitespace before them (not by exact column right-alignment),
 * which is what actually determines debit/credit classification per the
 * tokenizer: a token's start offset relative to COL_BRANCH_CODE must be
 * < 33.5 to classify as debit, >= 33.5 to classify as credit. This lets us
 * exercise arbitrarily wide amounts (e.g. 1 crore) without needing to
 * reproduce real column alignment.
 */
function buildTxnLine(opts: {
  txnDate: string;
  valueDate?: string;
  description?: string;
  refNo?: string;
  branchCode?: string;
  debit?: string;
  credit?: string;
  balance: string;
}): string {
  const txnDate = opts.txnDate.padEnd(COL_VALUE_DATE);
  const valueDate = (opts.valueDate ?? opts.txnDate).padEnd(COL_DESCRIPTION - COL_VALUE_DATE);
  const description = (opts.description ?? "TEST DESCRIPTION").padEnd(COL_REF_NO - COL_DESCRIPTION);
  const refNo = (opts.refNo ?? "").padEnd(COL_BRANCH_CODE - COL_REF_NO);
  const branchCode = opts.branchCode ?? "0000";

  let tail: string;
  if (opts.debit !== undefined && opts.credit !== undefined) {
    let s = `${branchCode.padEnd(4)} ${opts.debit}`;
    s = s.padEnd(50);
    tail = `${s}${opts.credit}  ${opts.balance}`;
  } else if (opts.debit !== undefined) {
    tail = `${branchCode} ${opts.debit}  ${opts.balance}`;
  } else if (opts.credit !== undefined) {
    tail = `${branchCode.padEnd(50)}${opts.credit}  ${opts.balance}`;
  } else {
    tail = `${branchCode}  ${opts.balance}`;
  }

  return txnDate + valueDate + description + refNo + tail;
}

// =============================================================================
// Parser — parseSbiStatement CONTRACT gap coverage
// =============================================================================

describe("parseSbiStatement — CONTRACT gap coverage", () => {
  describe("Indian amount formatting", () => {
    it("parses a 1-crore amount (1,00,00,000.00) to 1,000,000,000 paise", async () => {
      const header = buildHeader().join("\n");
      const txn = buildTxnLine({ txnDate: "13 Apr 2026", credit: "1,00,00,000.00", balance: "1,00,00,000.00" });
      const result = await parseSbiStatement(`${header}\n${txn}\n`);
      expect(result.transactions[0].creditPaise).toBe(1000000000);
      expect(result.transactions[0].balancePaise).toBe(1000000000);
    });

    it("parses an amount with non-zero paise (15,055.16) to exactly 1,505,516 paise", async () => {
      const header = buildHeader().join("\n");
      const txn = buildTxnLine({ txnDate: "13 Apr 2026", debit: "15,055.16", balance: "9,944.84" });
      const result = await parseSbiStatement(`${header}\n${txn}\n`);
      expect(result.transactions[0].debitPaise).toBe(1505516);
      expect(result.transactions[0].balancePaise).toBe(994484);
    });
  });

  describe("hash stability & collision resistance (dedup identity contract)", () => {
    it("identical (txnDate, description, amount) across two separate parses of the same line yields the same hash", async () => {
      const header = buildHeader().join("\n");
      const txn = buildTxnLine({ txnDate: "13 Apr 2026", description: "SAME TXN", credit: "5,000.00", balance: "5,000.00" });
      const r1 = await parseSbiStatement(`${header}\n${txn}\n`);
      const r2 = await parseSbiStatement(`${header}\n${txn}\n`);
      expect(r1.transactions[0].txnHash).toBe(r2.transactions[0].txnHash);
    });

    it("transactions differing only in amount get different hashes", async () => {
      const header = buildHeader().join("\n");
      const a = buildTxnLine({ txnDate: "13 Apr 2026", description: "SAME DESC", credit: "5,000.00", balance: "5,000.00" });
      const b = buildTxnLine({ txnDate: "13 Apr 2026", description: "SAME DESC", credit: "6,000.00", balance: "11,000.00" });
      const result = await parseSbiStatement(`${header}\n${a}\n${b}\n`);
      expect(result.transactions[0].txnHash).not.toBe(result.transactions[1].txnHash);
    });

    it("transactions differing only in description get different hashes", async () => {
      const header = buildHeader().join("\n");
      const a = buildTxnLine({ txnDate: "13 Apr 2026", description: "DESC ONE", credit: "5,000.00", balance: "5,000.00" });
      const b = buildTxnLine({ txnDate: "13 Apr 2026", description: "DESC TWO", credit: "5,000.00", balance: "10,000.00" });
      const result = await parseSbiStatement(`${header}\n${a}\n${b}\n`);
      expect(result.transactions[0].txnHash).not.toBe(result.transactions[1].txnHash);
    });

    it("transactions differing only in date get different hashes", async () => {
      const header = buildHeader().join("\n");
      const a = buildTxnLine({ txnDate: "13 Apr 2026", description: "SAME DESC", credit: "5,000.00", balance: "5,000.00" });
      const b = buildTxnLine({ txnDate: "14 Apr 2026", description: "SAME DESC", credit: "5,000.00", balance: "10,000.00" });
      const result = await parseSbiStatement(`${header}\n${a}\n${b}\n`);
      expect(result.transactions[0].txnHash).not.toBe(result.transactions[1].txnHash);
    });
  });

  describe("closing balance extraction", () => {
    it("extracts an explicit 'Closing Balance as on ...' header line", async () => {
      const header = buildHeader({
        closingBalanceLine: "Closing Balance as on 19 Jul 2026    1,00,000.00",
      }).join("\n");
      const txn = buildTxnLine({ txnDate: "13 Apr 2026", credit: "25,000.00", balance: "25,000.00" });
      const result = await parseSbiStatement(`${header}\n${txn}\n`);
      expect(result.closingBalance).toBe(10000000);
    });

    it("falls back to the last transaction's balance when no closing balance line is present", async () => {
      const header = buildHeader().join("\n");
      const t1 = buildTxnLine({ txnDate: "13 Apr 2026", credit: "25,000.00", balance: "25,000.00" });
      const t2 = buildTxnLine({ txnDate: "14 Apr 2026", credit: "10,000.00", balance: "35,000.00" });
      const result = await parseSbiStatement(`${header}\n${t1}\n${t2}\n`);
      expect(result.closingBalance).toBe(3500000);
    });

    it("is 0 when there is no closing balance line and no transactions", async () => {
      const header = buildHeader().join("\n");
      const result = await parseSbiStatement(`${header}\n`);
      expect(result.closingBalance).toBe(0);
      expect(result.transactions).toHaveLength(0);
    });
  });

  describe("header field variants", () => {
    it("recognizes 'Account No.' as a variant of the account number label", async () => {
      const header = buildHeader({ acctNumberLine: "Account No.:                       12345678901" }).join("\n");
      const result = await parseSbiStatement(`${header}\n`);
      expect(result.accountNumber).toBe("12345678901");
    });
  });

  describe("line-ending and truncation robustness", () => {
    it("handles CRLF line endings", async () => {
      const header = buildHeader().join("\r\n");
      const txn = buildTxnLine({ txnDate: "13 Apr 2026", credit: "25,000.00", balance: "25,000.00" });
      const result = await parseSbiStatement(`${header}\r\n${txn}\r\n`);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].creditPaise).toBe(2500000);
    });

    it("a line truncated before the branch-code column yields null branchCode and zero amounts without crashing", async () => {
      const header = buildHeader().join("\n");
      const shortLine = "13 Apr 2026".padEnd(COL_VALUE_DATE) + "13 Apr 2026";
      const result = await parseSbiStatement(`${header}\n${shortLine}\n`);
      expect(result.transactions).toHaveLength(1);
      const t = result.transactions[0];
      expect(t.branchCode).toBeNull();
      expect(t.debitPaise).toBe(0);
      expect(t.creditPaise).toBe(0);
      expect(t.balancePaise).toBe(0);
    });

    it("refNo is null when the reference-number field is blank", async () => {
      const header = buildHeader().join("\n");
      const txn = buildTxnLine({ txnDate: "13 Apr 2026", refNo: "", credit: "25,000.00", balance: "25,000.00" });
      const result = await parseSbiStatement(`${header}\n${txn}\n`);
      expect(result.transactions[0].refNo).toBeNull();
    });
  });

  describe("tokenizer edge case: both debit and credit tokens on one line", () => {
    it("classifies each amount token independently by its position relative to the threshold", async () => {
      const header = buildHeader().join("\n");
      const txn = buildTxnLine({ txnDate: "13 Apr 2026", debit: "1,000.00", credit: "2,000.00", balance: "1,000.00" });
      const result = await parseSbiStatement(`${header}\n${txn}\n`);
      const t = result.transactions[0];
      expect(t.debitPaise).toBe(100000);
      expect(t.creditPaise).toBe(200000);
    });
  });
});

// =============================================================================
// D1BankTransactionRepository — CONTRACT enforcement
//
// FakeD1Bank is a purpose-built, stateful fake that dispatches on the exact
// SQL text the repository emits (same technique as
// staff-report-correctness.repo.test.ts's FakeD1) but additionally maintains
// real relational state (rows, UNIQUE-constraint dedup, EXISTS-subquery
// semantics, ORDER BY / LIMIT / OFFSET) so that DEDUP_VIA_UNIQUE,
// RECONCILED_FILTER, LIST_ORDER, and PAGE_DEFAULTS are proven behaviorally,
// not just by SQL-string inspection.
// =============================================================================

interface FakeLink {
  id: number;
  bank_transaction_id: number;
  payment_id: number;
  created_at: number;
}

interface FakePayment {
  id: number;
  registration_id: number;
  amount: number;
  status: PaymentStatus;
}

interface FakeRegistration {
  reg_code: string;
  full_name: string;
}

class FakeD1BankStatement {
  readonly sql: string;
  private readonly db: FakeD1Bank;
  bindings: unknown[] = [];

  constructor(sql: string, db: FakeD1Bank) {
    this.sql = sql;
    this.db = db;
  }

  bind(...args: unknown[]): this {
    this.bindings = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.queryFirst(this.sql, this.bindings) as T | null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.queryAll(this.sql, this.bindings) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const changed = this.db.execWrite(this.sql, this.bindings);
    return { meta: { changes: changed } };
  }
}

class FakeD1Bank {
  transactions: BankTransactionRow[] = [];
  links: FakeLink[] = [];
  payments: Map<number, FakePayment> = new Map();
  registrations: Map<number, FakeRegistration> = new Map();
  preparedSqls: string[] = [];
  batchCalls: number[] = [];
  throwOnPrepare: string | null = null;

  private nextTxnId = 1;
  private nextLinkId = 1;

  prepare(sql: string): FakeD1BankStatement {
    if (this.throwOnPrepare) throw new Error(this.throwOnPrepare);
    this.preparedSqls.push(sql);
    return new FakeD1BankStatement(sql, this);
  }

  async batch(stmts: FakeD1BankStatement[]): Promise<{ meta: { changes: number; rows_written: number } }[]> {
    this.batchCalls.push(stmts.length);
    return stmts.map((s) => {
      const changed = this.execWrite(s.sql, s.bindings);
      return { meta: { changes: changed, rows_written: changed } };
    });
  }

  queryFirst(sql: string, bindings: unknown[]): unknown {
    if (sql.includes("SELECT COUNT(*) as count FROM bank_transactions")) {
      return { count: this.filterTransactions(sql, bindings).length };
    }
    if (sql.includes("SELECT * FROM bank_transactions WHERE id = ?")) {
      const id = bindings[0] as number;
      return this.transactions.find((row) => row.id === id) ?? null;
    }
    throw new Error(`FakeD1Bank.queryFirst: unrecognized SQL: ${sql}`);
  }

  queryAll(sql: string, bindings: unknown[]): unknown[] {
    if (sql.includes("SELECT bt.* FROM bank_transactions")) {
      const limit = bindings[bindings.length - 2] as number;
      const offset = bindings[bindings.length - 1] as number;
      const filterBindings = bindings.slice(0, bindings.length - 2);
      const filtered = this.filterTransactions(sql, filterBindings);
      const sorted = [...filtered].sort((a, b) => {
        if (a.txn_date_iso !== b.txn_date_iso) return a.txn_date_iso < b.txn_date_iso ? 1 : -1;
        return a.id - b.id;
      });
      return sorted.slice(offset, offset + limit);
    }
    if (sql.includes("FROM bank_transaction_payments btp") && sql.includes("JOIN payments p")) {
      const ids = bindings as number[];
      return this.links
        .filter((l) => ids.includes(l.bank_transaction_id))
        .sort((a, b) => a.created_at - b.created_at)
        .map((l) => {
          const p = this.payments.get(l.payment_id);
          const r = p ? this.registrations.get(p.registration_id) : undefined;
          return {
            link_id: l.id,
            bank_transaction_id: l.bank_transaction_id,
            payment_id: p?.id ?? l.payment_id,
            registration_id: p?.registration_id ?? 0,
            reg_code: r?.reg_code ?? "",
            full_name: r?.full_name ?? "",
            amount: p?.amount ?? 0,
            status: p?.status ?? "verified",
          };
        });
    }
    throw new Error(`FakeD1Bank.queryAll: unrecognized SQL: ${sql}`);
  }

  execWrite(sql: string, bindings: unknown[]): number {
    if (sql.includes("INSERT OR IGNORE INTO bank_transactions") && !sql.includes("bank_transaction_payments")) {
      const [txn_hash, txn_date, txn_date_iso, value_date, description, ref_no, branch_code, debit_paise, credit_paise, balance_paise, txn_type, import_batch] = bindings;
      if (this.transactions.some((row) => row.txn_hash === txn_hash)) return 0;
      this.transactions.push({
        id: this.nextTxnId++,
        txn_hash: txn_hash as string,
        txn_date: txn_date as string,
        txn_date_iso: txn_date_iso as string,
        value_date: value_date as string,
        description: description as string,
        ref_no: (ref_no as string | null) ?? null,
        branch_code: (branch_code as string | null) ?? null,
        debit_paise: debit_paise as number,
        credit_paise: credit_paise as number,
        balance_paise: balance_paise as number,
        txn_type: txn_type as "credit" | "debit",
        comment: null,
        import_batch: import_batch as string,
        created_at: Date.now(),
      });
      return 1;
    }
    if (sql.includes("UPDATE bank_transactions SET comment")) {
      const [comment, id] = bindings;
      const row = this.transactions.find((t) => t.id === id);
      if (row) row.comment = comment as string | null;
      return row ? 1 : 0;
    }
    if (sql.includes("INSERT OR IGNORE INTO bank_transaction_payments")) {
      const [bankTransactionId, paymentId] = bindings as [number, number];
      if (this.links.some((l) => l.bank_transaction_id === bankTransactionId && l.payment_id === paymentId)) return 0;
      this.links.push({ id: this.nextLinkId++, bank_transaction_id: bankTransactionId, payment_id: paymentId, created_at: Date.now() });
      return 1;
    }
    if (sql.includes("DELETE FROM bank_transaction_payments")) {
      const [bankTransactionId, paymentId] = bindings as [number, number];
      const before = this.links.length;
      this.links = this.links.filter((l) => !(l.bank_transaction_id === bankTransactionId && l.payment_id === paymentId));
      return before - this.links.length;
    }
    throw new Error(`FakeD1Bank.execWrite: unrecognized SQL: ${sql}`);
  }

  private filterTransactions(sql: string, bindings: unknown[]): BankTransactionRow[] {
    let result = this.transactions;
    let bi = 0;
    if (sql.includes("bt.txn_type = ?")) {
      const v = bindings[bi++] as string;
      result = result.filter((t) => t.txn_type === v);
    }
    if (sql.includes("NOT EXISTS")) {
      result = result.filter((t) => !this.links.some((l) => l.bank_transaction_id === t.id));
    } else if (sql.includes("EXISTS (SELECT 1 FROM bank_transaction_payments")) {
      result = result.filter((t) => this.links.some((l) => l.bank_transaction_id === t.id));
    }
    if (sql.includes("LOWER(bt.description) LIKE ?")) {
      const raw = bindings[bi++] as string;
      const term = raw.slice(1, -1);
      result = result.filter((t) => t.description.toLowerCase().includes(term));
    }
    return result;
  }
}

let rowIdCounter = 1000;
function makeRow(overrides: Partial<BankTransactionRow> = {}): BankTransactionRow {
  const id = overrides.id ?? rowIdCounter++;
  return {
    id,
    txn_hash: `row-hash-${id}`,
    txn_date: "13 Apr 2026",
    txn_date_iso: "2026-04-13",
    value_date: "13 Apr 2026",
    description: "DEFAULT DESCRIPTION",
    ref_no: null,
    branch_code: "3355",
    debit_paise: 0,
    credit_paise: 2500000,
    balance_paise: 2500000,
    txn_type: "credit",
    comment: null,
    import_batch: "batch-default",
    created_at: Date.now(),
    ...overrides,
  };
}

let hashCounter = 1;
function makeNewTxn(overrides: Partial<NewBankTransaction> = {}): NewBankTransaction {
  return {
    txn_hash: `new-hash-${hashCounter++}`,
    txn_date: "13 Apr 2026",
    txn_date_iso: "2026-04-13",
    value_date: "13 Apr 2026",
    description: "TEST TXN",
    ref_no: null,
    branch_code: "3355",
    debit_paise: 0,
    credit_paise: 2500000,
    balance_paise: 2500000,
    txn_type: "credit",
    ...overrides,
  };
}

describe("D1BankTransactionRepository — CONTRACT enforcement", () => {
  describe("DEDUP_VIA_UNIQUE", () => {
    it("importing the same txn_hash twice skips the duplicate silently, no error", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      const txn = makeNewTxn({ txn_hash: "dedup-hash-a" });

      const r1 = await repo.importBatch([txn], "batch-1");
      expect(r1).toEqual({ inserted: 1, skipped: 0 });

      const r2 = await repo.importBatch([txn], "batch-2");
      expect(r2).toEqual({ inserted: 0, skipped: 1 });
      expect(db.transactions).toHaveLength(1);
    });

    it("a mixed batch of new + duplicate hashes reports the correct inserted/skipped split", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      await repo.importBatch(
        [makeNewTxn({ txn_hash: "mix-h1" }), makeNewTxn({ txn_hash: "mix-h2" })],
        "batch-1",
      );

      const result = await repo.importBatch(
        [makeNewTxn({ txn_hash: "mix-h1" }), makeNewTxn({ txn_hash: "mix-h2" }), makeNewTxn({ txn_hash: "mix-h3" })],
        "batch-2",
      );
      expect(result).toEqual({ inserted: 1, skipped: 2 });
    });

    it("importBatch([]) short-circuits to { inserted: 0, skipped: 0 } without touching the DB", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      const result = await repo.importBatch([], "batch-empty");
      expect(result).toEqual({ inserted: 0, skipped: 0 });
      expect(db.batchCalls).toHaveLength(0);
    });
  });

  describe("BATCH_CHUNKED", () => {
    it("splits 250 transactions into db.batch() chunks of at most 100", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      const txns = Array.from({ length: 250 }, (_, i) => makeNewTxn({ txn_hash: `chunk-hash-${i}` }));

      const result = await repo.importBatch(txns, "batch-chunks");

      expect(db.batchCalls).toEqual([100, 100, 50]);
      expect(result).toEqual({ inserted: 250, skipped: 0 });
    });

    it("101 transactions produce exactly two batch() calls, not one", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      const txns = Array.from({ length: 101 }, (_, i) => makeNewTxn({ txn_hash: `chunk101-${i}` }));

      await repo.importBatch(txns, "batch-101");

      expect(db.batchCalls).toEqual([100, 1]);
    });
  });

  describe("NO_SQL_INJECTION", () => {
    it("a malicious search string is bound as a parameter, never interpolated into the SQL text", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      db.transactions.push(makeRow({ id: 1, description: "NORMAL TXN" }));
      const malicious = "'; DROP TABLE bank_transactions; --";

      db.preparedSqls.length = 0;
      const { transactions, total } = await repo.list({ search: malicious });

      expect(total).toBe(0);
      expect(transactions).toEqual([]);
      for (const sql of db.preparedSqls) {
        expect(sql).not.toContain(malicious);
      }
      expect(db.transactions).toHaveLength(1);
    });
  });

  describe("DOMAIN_TYPES", () => {
    it("list() and getById() return camelCase domain shape with linkedPayments, never raw snake_case row fields", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      db.transactions.push(makeRow({ id: 1 }));

      const { transactions } = await repo.list();
      const t = transactions[0] as unknown as Record<string, unknown>;
      expect(t.txnHash).toBeTypeOf("string");
      expect(t.txnDate).toBeTypeOf("string");
      expect(t.debitPaise).toBeTypeOf("number");
      expect(t.linkedPayments).toEqual([]);
      expect(t.txn_hash).toBeUndefined();
      expect(t.txn_date).toBeUndefined();
      expect(t.debit_paise).toBeUndefined();

      const detail = await repo.getById(1) as unknown as Record<string, unknown>;
      expect(detail.txnHash).toBeTypeOf("string");
      expect(detail.txn_hash).toBeUndefined();
    });
  });

  describe("NO_N_PLUS_ONE", () => {
    it("prepared-statement count for list() stays constant as the result set grows", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      for (let i = 0; i < 5; i++) db.transactions.push(makeRow({ id: i + 1 }));

      db.preparedSqls.length = 0;
      await repo.list({ limit: 50 });
      const smallCallCount = db.preparedSqls.length;

      for (let i = 5; i < 30; i++) db.transactions.push(makeRow({ id: i + 1 }));
      db.preparedSqls.length = 0;
      await repo.list({ limit: 50 });
      const largeCallCount = db.preparedSqls.length;

      expect(smallCallCount).toBe(largeCallCount);
      expect(smallCallCount).toBeLessThanOrEqual(3);
    });
  });

  describe("RECONCILED_FILTER", () => {
    it("reconciled=true with a multi-payment transaction returns exactly one row (no LEFT JOIN duplication)", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      db.transactions.push(makeRow({ id: 1 }));
      db.payments.set(100, { id: 100, registration_id: 501, amount: 5000, status: "verified" });
      db.payments.set(101, { id: 101, registration_id: 502, amount: 3000, status: "verified" });
      db.registrations.set(501, { reg_code: "SMRTAAA0000000A", full_name: "Alice" });
      db.registrations.set(502, { reg_code: "SMRTBBB0000000B", full_name: "Bob" });
      await repo.linkPayment(1, 100);
      await repo.linkPayment(1, 101);

      db.preparedSqls.length = 0;
      const { transactions, total } = await repo.list({ reconciled: true });

      expect(total).toBe(1);
      expect(transactions).toHaveLength(1);
      expect(transactions[0].linkedPayments).toHaveLength(2);

      const outerQueries = db.preparedSqls.filter((sql) => sql.includes("FROM bank_transactions bt"));
      expect(outerQueries.length).toBeGreaterThan(0);
      for (const sql of outerQueries) {
        expect(sql).toContain("EXISTS");
        expect(sql).not.toMatch(/\bJOIN\b/);
      }
    });

    it("reconciled=false excludes any transaction with at least one linked payment", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      db.transactions.push(makeRow({ id: 1 }), makeRow({ id: 2 }));
      db.payments.set(1, { id: 1, registration_id: 1, amount: 1000, status: "verified" });
      db.registrations.set(1, { reg_code: "SMRTCCC0000000C", full_name: "Carol" });
      await repo.linkPayment(1, 1);

      const { transactions, total } = await repo.list({ reconciled: false });
      expect(total).toBe(1);
      expect(transactions[0].id).toBe(2);
    });
  });

  describe("LIST_ORDER", () => {
    it("orders by txn_date_iso DESC, id ASC — newest dates first, bank order within each date", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      db.transactions.push(
        makeRow({ id: 1, txn_date: "01 Jan 2026", txn_date_iso: "2026-01-01" }),
        makeRow({ id: 3, txn_date: "05 Jan 2026", txn_date_iso: "2026-01-05" }),
        makeRow({ id: 2, txn_date: "05 Jan 2026", txn_date_iso: "2026-01-05" }),
      );

      const { transactions } = await repo.list();
      expect(transactions.map((t) => t.id)).toEqual([2, 3, 1]);

      const listSql = db.preparedSqls.find((sql) => sql.includes("SELECT bt.* FROM bank_transactions"));
      expect(listSql).toContain("ORDER BY bt.txn_date_iso DESC, bt.id ASC");
    });
  });

  describe("PAGE_DEFAULTS", () => {
    it("list() with no filters defaults to page=1, limit=50", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      for (let i = 0; i < 60; i++) db.transactions.push(makeRow({ id: i + 1, txn_date: "01 Jan 2026" }));

      const { transactions, total } = await repo.list();
      expect(transactions).toHaveLength(50);
      expect(total).toBe(60);
    });

    it("falsy page/limit (0) fall back to defaults, not to page=0/limit=0", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      for (let i = 0; i < 60; i++) db.transactions.push(makeRow({ id: i + 1, txn_date: "01 Jan 2026" }));

      const { transactions } = await repo.list({ page: 0, limit: 0 });
      expect(transactions).toHaveLength(50);
    });

    it("list({ page: 2, limit: 20 }) returns the correct second page", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      for (let i = 0; i < 60; i++) db.transactions.push(makeRow({ id: i + 1, txn_date: "01 Jan 2026" }));

      const { transactions } = await repo.list({ page: 2, limit: 20 });
      expect(transactions).toHaveLength(20);
      expect(transactions[0].id).toBe(21);
      expect(transactions[19].id).toBe(40);
    });
  });

  describe("IDEMPOTENT_LINK", () => {
    it("linking the same (bankTransactionId, paymentId) pair twice is a no-op, not an error", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      db.transactions.push(makeRow({ id: 1 }));
      db.payments.set(100, { id: 100, registration_id: 501, amount: 5000, status: "verified" });
      db.registrations.set(501, { reg_code: "SMRTAAA0000000A", full_name: "Alice" });

      await repo.linkPayment(1, 100);
      await expect(repo.linkPayment(1, 100)).resolves.toBeUndefined();

      const detail = await repo.getById(1);
      expect(detail!.linkedPayments).toHaveLength(1);
      expect(db.links).toHaveLength(1);
    });
  });

  describe("FAILURE BEHAVIOR", () => {
    it("getById returns null for a non-existent id, does not throw", async () => {
      const db = new FakeD1Bank();
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      await expect(repo.getById(99999)).resolves.toBeNull();
    });

    it("D1 errors propagate as thrown errors, not swallowed", async () => {
      const db = new FakeD1Bank();
      db.throwOnPrepare = "D1_ERROR: database is locked";
      const repo = new D1BankTransactionRepository(db as unknown as D1Database);
      await expect(repo.list()).rejects.toThrow("D1_ERROR: database is locked");
    });
  });
});

// =============================================================================
// bank-transaction routes — CONTRACT enforcement
// =============================================================================

class InMemoryBankTransactionRepo implements IBankTransactionRepository {
  transactions: Map<number, BankTransactionWithLinks> = new Map();
  private nextId = 1;

  importBatchCalls: { transactions: NewBankTransaction[]; importBatchId: string }[] = [];
  linkPaymentCalls: { bankTransactionId: number; paymentId: number }[] = [];
  unlinkPaymentCalls: { bankTransactionId: number; paymentId: number }[] = [];
  updateCommentCalls: { id: number; comment: string | null }[] = [];
  listCalls: (BankTransactionFilters | undefined)[] = [];

  seed(txn: BankTransactionWithLinks): void {
    this.transactions.set(txn.id, txn);
  }

  async importBatch(transactions: NewBankTransaction[], importBatchId: string): Promise<{ inserted: number; skipped: number }> {
    this.importBatchCalls.push({ transactions, importBatchId });
    for (const t of transactions) {
      const id = this.nextId++;
      this.transactions.set(id, {
        id,
        txnHash: t.txn_hash,
        txnDate: t.txn_date,
        txnDateIso: t.txn_date_iso,
        valueDate: t.value_date,
        description: t.description,
        refNo: t.ref_no,
        branchCode: t.branch_code,
        debitPaise: t.debit_paise,
        creditPaise: t.credit_paise,
        balancePaise: t.balance_paise,
        txnType: t.txn_type,
        comment: null,
        importBatch: importBatchId,
        createdAt: Date.now(),
        linkedPayments: [],
      });
    }
    return { inserted: transactions.length, skipped: 0 };
  }

  async list(filters?: BankTransactionFilters): Promise<{ transactions: BankTransactionWithLinks[]; total: number }> {
    this.listCalls.push(filters);
    const all = [...this.transactions.values()];
    return { transactions: all, total: all.length };
  }

  async getById(id: number): Promise<BankTransactionWithLinks | null> {
    return this.transactions.get(id) ?? null;
  }

  async updateComment(id: number, comment: string | null): Promise<void> {
    this.updateCommentCalls.push({ id, comment });
    const t = this.transactions.get(id);
    if (t) t.comment = comment;
  }

  async linkPayment(bankTransactionId: number, paymentId: number): Promise<void> {
    this.linkPaymentCalls.push({ bankTransactionId, paymentId });
  }

  async unlinkPayment(bankTransactionId: number, paymentId: number): Promise<void> {
    this.unlinkPaymentCalls.push({ bankTransactionId, paymentId });
  }

  async summary(_filters?: { fromDate?: string; toDate?: string }): Promise<{
    totalCreditPaise: number;
    totalDebitPaise: number;
    latestBalancePaise: number;
    transactionCount: number;
  }> {
    const txns = Array.from(this.transactions.values());
    return {
      totalCreditPaise: txns.reduce((s, t) => s + t.creditPaise, 0),
      totalDebitPaise: txns.reduce((s, t) => s + t.debitPaise, 0),
      latestBalancePaise: txns.length > 0 ? txns[txns.length - 1].balancePaise : 0,
      transactionCount: txns.length,
    };
  }
}

function makeWithLinks(overrides: Partial<BankTransactionWithLinks> = {}): BankTransactionWithLinks {
  return {
    id: 1,
    txnHash: `route-hash-${overrides.id ?? 1}`,
    txnDate: "13 Apr 2026",
    txnDateIso: "2026-04-13",
    valueDate: "13 Apr 2026",
    description: "DEFAULT",
    refNo: null,
    branchCode: "3355",
    debitPaise: 0,
    creditPaise: 2500000,
    balancePaise: 2500000,
    txnType: "credit",
    comment: null,
    importBatch: "batch-1",
    createdAt: Date.now(),
    linkedPayments: [],
    ...overrides,
  };
}

const TEST_JWT_SECRET = "test-secret-key-for-bank-txn-route-tests-32ch!";
const TEST_ENV = {
  JWT_SECRET: TEST_JWT_SECRET,
  DB: createFakePermissionsDb(),
} as unknown as Env;

async function staffToken(userId = 10, email = "staff@example.test"): Promise<string> {
  return signToken({ sub: String(userId), role: "staff", email }, TEST_JWT_SECRET, "7d");
}
async function adminToken(userId = 99, email = "admin@example.test"): Promise<string> {
  return signToken({ sub: String(userId), role: "admin", email }, TEST_JWT_SECRET, "7d");
}
async function attendeeToken(registrationId = 1001): Promise<string> {
  return signToken({ sub: String(registrationId), role: "attendee" }, TEST_JWT_SECRET, "90d");
}

interface RouteTestContext {
  req: (input: string, init?: RequestInit) => Response | Promise<Response>;
  repo: InMemoryBankTransactionRepo;
}

function createRouteTestApp(): RouteTestContext {
  _scopeCache.clear();
  const repo = new InMemoryBankTransactionRepo();
  const app = new Hono<AppEnv>().basePath("/api");
  app.use("*", async (c, next) => {
    c.set("bankTransactionRepo", repo);
    c.set("systemAuditRepo", { append: async () => {} } as ISystemAuditRepository);
    await next();
  });
  app.route("/staff/bank-transactions", bankTransactionRoutes);
  const req = (input: string, init?: RequestInit) => app.request(input, init, TEST_ENV);
  return { req, repo };
}

const IMPORT_FIXTURE = `${buildHeader().join("\n")}\n${buildTxnLine({
  txnDate: "13 Apr 2026",
  credit: "25,000.00",
  balance: "25,000.00",
})}\n${buildTxnLine({ txnDate: "14 Apr 2026", debit: "5,000.00", balance: "20,000.00" })}\n`;

const TAB_IMPORT_FIXTURE = [
  "Account Name       :\tTest Alumni Account",
  "Account Number     :\t_TEST_ACCOUNT_001",
  "Opening Balance as on 1 Aug 2026        :\t22,20,634.14",
  "Start Date          :\t1 Aug 2026",
  "End Date            :\t6 Aug 2026",
  "Txn Date\tValue Date\tDescription\tRef No./Cheque No.\tBranch Code\t        Debit\tCredit\tBalance\t",
  "1 Aug 2026 \t1 Aug 2026 \tCHQ TRANSFER-NEFT UTR NO: SBIN000000000000--84322 TEST STORE\t/ 84322\t0001\t75,004.72\t \t21,45,629.42",
  "1 Aug 2026 \t1 Aug 2026 \t   BY TRANSFER-UPI/CR/000000000000/TEST PERSON/ICIC/test/UPI--\tTRANSFER FROM\t3355\t \t20,000.00\t21,65,629.42",
  "**This is a computer generated statement and does not require a signature",
].join("\n");

describe("bank-transaction routes — CONTRACT enforcement", () => {
  let ctx: RouteTestContext;

  beforeEach(() => {
    ctx = createRouteTestApp();
    ctx.repo.transactions.set(1, makeWithLinks({ id: 1 }));
  });

  describe("AUTH_GUARD", () => {
    it("missing Authorization header -> 401", async () => {
      const res = await ctx.req("/api/staff/bank-transactions");
      expect(res.status).toBe(401);
    });

    it("invalid JWT -> 401", async () => {
      const res = await ctx.req("/api/staff/bank-transactions", {
        headers: { Authorization: "Bearer not.a.real.jwt" },
      });
      expect(res.status).toBe(401);
    });

    it("attendee role -> 403 with 'Insufficient permissions' body", async () => {
      const token = await attendeeToken();
      const res = await ctx.req("/api/staff/bank-transactions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("Insufficient permissions");
    });

    it("staff role -> 200 (passes the auth guard)", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it("admin role -> 200 (passes the auth guard)", async () => {
      const token = await adminToken();
      const res = await ctx.req("/api/staff/bank-transactions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("IMPORT — POST /import", () => {
    it("returns 400 for an empty body", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/import", {
        method: "POST",
        body: "",
        headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(400);
    });

    it("GAP: returns 400 for a whitespace-only body — CONTRACT says '400 if body is empty', which is ambiguous about whitespace-only input; this documents the implementation's choice (text.trim() === '') rather than a confirmed spec requirement", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/import", {
        method: "POST",
        body: "   \n\n   ",
        headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(400);
    });

    it("parses a valid statement and returns { imported, skipped, total }", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/import", {
        method: "POST",
        body: IMPORT_FIXTURE,
        headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { imported: number; skipped: number; total: number };
      expect(body.total).toBe(2);
      expect(body.imported).toBe(2);
      expect(body.skipped).toBe(0);
    });

    it("imports the known tab-delimited statement shape", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/import", {
        method: "POST",
        body: TAB_IMPORT_FIXTURE,
        headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ imported: 2, skipped: 0, total: 2 });
      expect(ctx.repo.importBatchCalls[0].transactions).toMatchObject([
        {
          txn_date: "1 Aug 2026",
          description: "CHQ TRANSFER-NEFT UTR NO: SBIN000000000000-84322 TEST STORE",
          debit_paise: 7500472,
          credit_paise: 0,
          txn_type: "debit",
        },
        {
          txn_date: "1 Aug 2026",
          description: "BY TRANSFER-UPI/CR/000000000000/TEST PERSON/ICIC/test/UPI",
          debit_paise: 0,
          credit_paise: 2000000,
          txn_type: "credit",
        },
      ]);
    });

    it("passes an ISO-timestamp batchId to importBatch", async () => {
      const token = await staffToken();
      await ctx.req("/api/staff/bank-transactions/import", {
        method: "POST",
        body: IMPORT_FIXTURE,
        headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}` },
      });
      expect(ctx.repo.importBatchCalls).toHaveLength(1);
      expect(ctx.repo.importBatchCalls[0].importBatchId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("maps parsed transactions to NewBankTransaction rows with the correct fields", async () => {
      const token = await staffToken();
      await ctx.req("/api/staff/bank-transactions/import", {
        method: "POST",
        body: IMPORT_FIXTURE,
        headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}` },
      });
      const mapped = ctx.repo.importBatchCalls[0].transactions;
      expect(mapped).toHaveLength(2);
      expect(mapped[0]).toMatchObject({ txn_date: "13 Apr 2026", credit_paise: 2500000, debit_paise: 0, txn_type: "credit" });
      expect(mapped[1]).toMatchObject({ txn_date: "14 Apr 2026", debit_paise: 500000, credit_paise: 0, txn_type: "debit" });
    });
  });

  describe("LIST — GET /", () => {
    it("defaults to page=1, limit=50 with no query params", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json() as { page: number; limit: number };
      expect(body.page).toBe(1);
      expect(body.limit).toBe(50);
    });

    it("caps limit at 100 even when a larger limit is requested", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions?limit=500", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json() as { limit: number };
      expect(body.limit).toBe(100);
    });

    it("GAP: clamps limit up to 1 when zero or negative — CONTRACT only specifies the default (50) and the cap (100), not a floor; this documents the implementation's Math.max(1, ...) choice, not a confirmed spec requirement", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions?limit=-5", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json() as { limit: number };
      expect(body.limit).toBe(1);
    });

    it("GAP: clamps page up to 1 when zero or negative — CONTRACT only specifies the default (1), not a floor for invalid input; documents implementation behavior, not a confirmed spec requirement", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions?page=-3", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json() as { page: number };
      expect(body.page).toBe(1);
    });

    it("parses reconciled=true/false as booleans; absent stays undefined in the repo filters", async () => {
      const token = await staffToken();
      await ctx.req("/api/staff/bank-transactions?reconciled=true", { headers: { Authorization: `Bearer ${token}` } });
      expect(ctx.repo.listCalls[0]?.reconciled).toBe(true);

      await ctx.req("/api/staff/bank-transactions?reconciled=false", { headers: { Authorization: `Bearer ${token}` } });
      expect(ctx.repo.listCalls[1]?.reconciled).toBe(false);

      await ctx.req("/api/staff/bank-transactions", { headers: { Authorization: `Bearer ${token}` } });
      expect(ctx.repo.listCalls[2]?.reconciled).toBeUndefined();
    });

    it("passes type and search filters through to the repo", async () => {
      const token = await staffToken();
      await ctx.req("/api/staff/bank-transactions?type=debit&search=UPI", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(ctx.repo.listCalls[0]).toMatchObject({ txnType: "debit", search: "UPI" });
    });

    it("response shape includes transactions, total, page, limit", async () => {
      ctx.repo.seed(makeWithLinks({ id: 1 }));
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions", { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json() as Record<string, unknown>;
      expect(body.transactions).toBeDefined();
      expect(body.total).toBeTypeOf("number");
      expect(body.page).toBeTypeOf("number");
      expect(body.limit).toBeTypeOf("number");
    });
  });

  describe("DETAIL — GET /:id", () => {
    it("returns 404 for a non-numeric id", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/not-a-number", { headers: { Authorization: `Bearer ${token}` } });
      expect(res.status).toBe(404);
    });

    it("returns 404 when the transaction does not exist", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/99999", { headers: { Authorization: `Bearer ${token}` } });
      expect(res.status).toBe(404);
    });

    it("returns 200 with { transaction } when found", async () => {
      ctx.repo.seed(makeWithLinks({ id: 42, description: "Detail Test" }));
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/42", { headers: { Authorization: `Bearer ${token}` } });
      expect(res.status).toBe(200);
      const body = await res.json() as { transaction: { id: number; description: string } };
      expect(body.transaction.id).toBe(42);
      expect(body.transaction.description).toBe("Detail Test");
    });
  });

  describe("COMMENT — POST /:id/comment", () => {
    beforeEach(() => {
      ctx.repo.seed(makeWithLinks({ id: 1 }));
    });

    it("returns 422 for a malformed JSON body", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/1/comment", {
        method: "POST",
        body: "not-json",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(422);
      const body = await res.json() as { details: { fieldErrors: Record<string, string> } };
      expect(body.details.fieldErrors.comment).toBeDefined();
    });

    it("returns 422 when comment is a number (neither string nor null)", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/1/comment", {
        method: "POST",
        body: JSON.stringify({ comment: 123 }),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(422);
    });

    it("sets a string comment and returns { ok: true }", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/1/comment", {
        method: "POST",
        body: JSON.stringify({ comment: "Matched to reg SMRT123" }),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean };
      expect(body.ok).toBe(true);
      expect(ctx.repo.updateCommentCalls[0]).toEqual({ id: 1, comment: "Matched to reg SMRT123" });
    });

    it("clears a comment when comment is explicitly null", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/1/comment", {
        method: "POST",
        body: JSON.stringify({ comment: null }),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(ctx.repo.updateCommentCalls[0]).toEqual({ id: 1, comment: null });
    });

    it("CONTRACT: returns 404 for a non-existent transaction id (FAILURE BEHAVIOR — '404 returned when a transaction id does not resolve to a row' is a file-level guarantee, not scoped to DETAIL)", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/99999/comment", {
        method: "POST",
        body: JSON.stringify({ comment: "orphan comment" }),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("LINK — POST /:id/link", () => {
    beforeEach(() => {
      ctx.repo.seed(makeWithLinks({ id: 1 }));
    });

    it("returns 422 when paymentIds is missing", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/1/link", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(422);
    });

    it("returns 422 when paymentIds is an empty array", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/1/link", {
        method: "POST",
        body: JSON.stringify({ paymentIds: [] }),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(422);
    });

    it("returns 422 when paymentIds contains a non-number element", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/1/link", {
        method: "POST",
        body: JSON.stringify({ paymentIds: [1, "2"] }),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(422);
    });

    it("GAP: returns 422 when paymentIds contains a non-finite number (Infinity) — CONTRACT says 'not an array of numbers'; Infinity is typeof 'number' in JS, so this is stricter than the literal spec text. Documents the implementation's Number.isFinite() check, not a confirmed spec requirement", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/1/link", {
        method: "POST",
        body: JSON.stringify({ paymentIds: [Infinity] }),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(422);
    });

    it("CONTRACT: returns 404 for a non-existent transaction id (FAILURE BEHAVIOR — file-level guarantee, not scoped to DETAIL)", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/99999/link", {
        method: "POST",
        body: JSON.stringify({ paymentIds: [100] }),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
    });

    it("links each payment id in order and returns { ok: true, linked: N }", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/1/link", {
        method: "POST",
        body: JSON.stringify({ paymentIds: [100, 101, 102] }),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; linked: number };
      expect(body.ok).toBe(true);
      expect(body.linked).toBe(3);
      expect(ctx.repo.linkPaymentCalls).toEqual([
        { bankTransactionId: 1, paymentId: 100 },
        { bankTransactionId: 1, paymentId: 101 },
        { bankTransactionId: 1, paymentId: 102 },
      ]);
    });
  });

  describe("UNLINK — DELETE /:id/link/:paymentId", () => {
    it("returns 404 for a non-numeric transaction id", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/abc/link/100", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for a non-numeric payment id", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/1/link/abc", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
    });

    it("removes the link and returns { ok: true }", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/1/link/100", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean };
      expect(body.ok).toBe(true);
      expect(ctx.repo.unlinkPaymentCalls).toEqual([{ bankTransactionId: 1, paymentId: 100 }]);
    });

    it("CONTRACT: returns 404 for a non-existent transaction id (FAILURE BEHAVIOR — file-level guarantee, not scoped to DETAIL)", async () => {
      const token = await staffToken();
      const res = await ctx.req("/api/staff/bank-transactions/99999/link/100", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
    });
  });
});
