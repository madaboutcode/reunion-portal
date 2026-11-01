/**
 * CONTRACT
 *
 * GUARANTEE: DEDUP_VIA_UNIQUE — importBatch() relies on the txn_hash UNIQUE
 *   constraint for dedup. Each row is inserted with INSERT OR IGNORE; a row
 *   whose hash already exists is silently skipped (no error). Returns
 *   { inserted, skipped } counts derived from each statement's meta.changes.
 *
 * GUARANTEE: BATCH_CHUNKED — importBatch() splits the insert statements into
 *   chunks of BATCH_CHUNK_SIZE before calling db.batch(), to stay well under
 *   D1's per-batch statement limits for large statement imports.
 *
 * GUARANTEE: NO_SQL_INJECTION — all queries use db.prepare().bind(). No
 *   string interpolation of values appears in any SQL statement.
 *
 * GUARANTEE: DOMAIN_TYPES — list()/getById() return BankTransactionWithLinks
 *   (domain type) via toBankTransaction() + linked payment rows, never raw
 *   BankTransactionRow objects.
 *
 * GUARANTEE: NO_N_PLUS_ONE — list() fetches the paginated page of transaction
 *   ids first (WHERE + ORDER BY + LIMIT/OFFSET, no JOIN), then fetches all
 *   linked payments for that page's ids in a single second query. Never
 *   queries per-row in a loop.
 *
 * GUARANTEE: RECONCILED_FILTER — filters.reconciled uses an EXISTS / NOT
 *   EXISTS subquery against bank_transaction_payments, not a LEFT JOIN. A
 *   LEFT JOIN would multiply transaction rows for multi-payment matches and
 *   corrupt pagination counts.
 *
 * GUARANTEE: LIST_ORDER — list() returns transactions ordered by
 *   txn_date_iso DESC, id ASC (newest dates first; within each date,
 *   bank's original chronological order preserved via insertion order).
 *
 * GUARANTEE: PAGE_DEFAULTS — list() defaults to page=1, limit=50 when not
 *   provided.
 *
 * GUARANTEE: IDEMPOTENT_LINK — linkPayment() uses INSERT OR IGNORE against
 *   the UNIQUE(bank_transaction_id, payment_id) constraint. Linking an
 *   already-linked pair is a no-op, not an error.
 *
 * FAILURE BEHAVIOR: All D1 errors propagate as thrown errors. Methods do not
 *   swallow failures. getById() returns null when the transaction id does
 *   not exist.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { IBankTransactionRepository } from './interfaces.js';
import type {
  BankTransactionRow,
  BankTransactionWithLinks,
  BankTransactionFilters,
  NewBankTransaction,
  LinkedPayment,
} from '../domain/bank-transaction-types.js';
import { toBankTransaction } from '../domain/bank-transaction-types.js';

interface LinkedPaymentRow {
  link_id: number;
  bank_transaction_id: number;
  payment_id: number;
  registration_id: number;
  reg_code: string;
  full_name: string;
  amount: number;
  status: LinkedPayment['status'];
}

export class D1BankTransactionRepository implements IBankTransactionRepository {
  private readonly db: D1Database;
  private static readonly BATCH_CHUNK_SIZE = 100;

  constructor(db: D1Database) {
    this.db = db;
  }

  async importBatch(
    transactions: NewBankTransaction[],
    importBatchId: string,
  ): Promise<{ inserted: number; skipped: number }> {
    if (transactions.length === 0) return { inserted: 0, skipped: 0 };

    let inserted = 0;

    for (let i = 0; i < transactions.length; i += D1BankTransactionRepository.BATCH_CHUNK_SIZE) {
      const chunk = transactions.slice(i, i + D1BankTransactionRepository.BATCH_CHUNK_SIZE);

      const stmts = chunk.map((t) =>
        this.db
          .prepare(
            `INSERT OR IGNORE INTO bank_transactions
             (txn_hash, txn_date, txn_date_iso, value_date, description, ref_no, branch_code, debit_paise, credit_paise, balance_paise, txn_type, import_batch)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            t.txn_hash,
            t.txn_date,
            t.txn_date_iso,
            t.value_date,
            t.description,
            t.ref_no,
            t.branch_code,
            t.debit_paise,
            t.credit_paise,
            t.balance_paise,
            t.txn_type,
            importBatchId,
          ),
      );

      const results = await this.db.batch(stmts);
      for (const r of results) {
        if ((r.meta.rows_written ?? r.meta.changes ?? 0) > 0) inserted++;
      }
    }

    return { inserted, skipped: transactions.length - inserted };
  }

  async list(
    filters?: BankTransactionFilters,
  ): Promise<{ transactions: BankTransactionWithLinks[]; total: number }> {
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (filters?.txnType !== undefined) {
      conditions.push('bt.txn_type = ?');
      bindings.push(filters.txnType);
    }

    if (filters?.reconciled !== undefined) {
      const existsClause = `EXISTS (SELECT 1 FROM bank_transaction_payments btp WHERE btp.bank_transaction_id = bt.id)`;
      conditions.push(filters.reconciled ? existsClause : `NOT ${existsClause}`);
    }

    if (filters?.search !== undefined && filters.search.trim() !== '') {
      const escaped = filters.search.replace(/[%_\\]/g, '\\$&');
      conditions.push(`LOWER(bt.description) LIKE ? ESCAPE '\\'`);
      bindings.push(`%${escaped.toLowerCase()}%`);
    }

    if (filters?.fromDate !== undefined) {
      conditions.push('bt.txn_date_iso >= ?');
      bindings.push(filters.fromDate);
    }

    if (filters?.toDate !== undefined) {
      conditions.push('bt.txn_date_iso <= ?');
      bindings.push(filters.toDate);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const countRow = await this.db
      .prepare(`SELECT COUNT(*) as count FROM bank_transactions bt${where}`)
      .bind(...bindings)
      .first<{ count: number }>();
    const total = countRow?.count ?? 0;

    const page = filters?.page && filters.page > 0 ? filters.page : 1;
    const limit = filters?.limit && filters.limit > 0 ? filters.limit : 50;
    const offset = (page - 1) * limit;

    const { results } = await this.db
      .prepare(
        `SELECT bt.* FROM bank_transactions bt${where} ORDER BY bt.txn_date_iso DESC, bt.id ASC LIMIT ? OFFSET ?`,
      )
      .bind(...bindings, limit, offset)
      .all<BankTransactionRow>();

    const linksByTxnId = await this.fetchLinksForIds(results.map((r) => r.id));

    const transactions = results.map((row) => ({
      ...toBankTransaction(row),
      linkedPayments: linksByTxnId.get(row.id) ?? [],
    }));

    return { transactions, total };
  }

  async getById(id: number): Promise<BankTransactionWithLinks | null> {
    const row = await this.db
      .prepare(`SELECT * FROM bank_transactions WHERE id = ?`)
      .bind(id)
      .first<BankTransactionRow>();

    if (!row) return null;

    const linksByTxnId = await this.fetchLinksForIds([id]);

    return {
      ...toBankTransaction(row),
      linkedPayments: linksByTxnId.get(id) ?? [],
    };
  }

  async updateComment(id: number, comment: string | null): Promise<void> {
    await this.db
      .prepare(`UPDATE bank_transactions SET comment = ? WHERE id = ?`)
      .bind(comment, id)
      .run();
  }

  async linkPayment(bankTransactionId: number, paymentId: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO bank_transaction_payments (bank_transaction_id, payment_id) VALUES (?, ?)`,
      )
      .bind(bankTransactionId, paymentId)
      .run();
  }

  async unlinkPayment(bankTransactionId: number, paymentId: number): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM bank_transaction_payments WHERE bank_transaction_id = ? AND payment_id = ?`,
      )
      .bind(bankTransactionId, paymentId)
      .run();
  }

  /** Fetches all linked payments for the given transaction ids in a single query, grouped by transaction id. */
  private async fetchLinksForIds(ids: number[]): Promise<Map<number, LinkedPayment[]>> {
    const map = new Map<number, LinkedPayment[]>();
    if (ids.length === 0) return map;

    const placeholders = ids.map(() => '?').join(', ');
    const { results } = await this.db
      .prepare(
        `SELECT
           btp.id as link_id,
           btp.bank_transaction_id as bank_transaction_id,
           p.id as payment_id,
           p.registration_id as registration_id,
           r.reg_code as reg_code,
           r.full_name as full_name,
           p.amount as amount,
           p.status as status
         FROM bank_transaction_payments btp
         JOIN payments p ON btp.payment_id = p.id
         JOIN registrations r ON p.registration_id = r.id
         WHERE btp.bank_transaction_id IN (${placeholders})
         ORDER BY btp.created_at ASC`,
      )
      .bind(...ids)
      .all<LinkedPaymentRow>();

    for (const row of results) {
      const entry: LinkedPayment = {
        paymentId: row.payment_id,
        registrationId: row.registration_id,
        regCode: row.reg_code,
        fullName: row.full_name,
        amount: row.amount,
        status: row.status,
        linkId: row.link_id,
      };

      const existing = map.get(row.bank_transaction_id);
      if (existing) {
        existing.push(entry);
      } else {
        map.set(row.bank_transaction_id, [entry]);
      }
    }

    return map;
  }

  async summary(filters?: { fromDate?: string; toDate?: string }): Promise<{
    totalCreditPaise: number;
    totalDebitPaise: number;
    latestBalancePaise: number;
    transactionCount: number;
  }> {
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (filters?.fromDate !== undefined) {
      conditions.push('txn_date_iso >= ?');
      bindings.push(filters.fromDate);
    }
    if (filters?.toDate !== undefined) {
      conditions.push('txn_date_iso <= ?');
      bindings.push(filters.toDate);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const agg = await this.db
      .prepare(
        `SELECT COALESCE(SUM(credit_paise), 0) as total_credit, COALESCE(SUM(debit_paise), 0) as total_debit, COUNT(*) as count FROM bank_transactions${where}`,
      )
      .bind(...bindings)
      .first<{ total_credit: number; total_debit: number; count: number }>();

    const latestRow = await this.db
      .prepare(
        `SELECT balance_paise FROM bank_transactions${where} ORDER BY txn_date_iso DESC, id DESC LIMIT 1`,
      )
      .bind(...bindings)
      .first<{ balance_paise: number }>();

    return {
      totalCreditPaise: agg?.total_credit ?? 0,
      totalDebitPaise: agg?.total_debit ?? 0,
      latestBalancePaise: latestRow?.balance_paise ?? 0,
      transactionCount: agg?.count ?? 0,
    };
  }
}
