import type { PaymentStatus } from './status.js';

// ---------------------------------------------------------------------------
// Bank Transaction
// ---------------------------------------------------------------------------

/** Mirrors the `bank_transactions` D1 table exactly. */
export interface BankTransactionRow {
  id: number;
  txn_hash: string;
  txn_date: string;
  txn_date_iso: string;
  value_date: string;
  description: string;
  ref_no: string | null;
  branch_code: string | null;
  debit_paise: number;
  credit_paise: number;
  balance_paise: number;
  txn_type: 'credit' | 'debit';
  comment: string | null;
  import_batch: string;
  created_at: number;
}

/** Parsed domain type. No 0/1 coercion needed — no boolean columns. */
export interface BankTransaction {
  id: number;
  txnHash: string;
  txnDate: string;
  txnDateIso: string;
  valueDate: string;
  description: string;
  refNo: string | null;
  branchCode: string | null;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
  txnType: 'credit' | 'debit';
  comment: string | null;
  importBatch: string;
  createdAt: number;
}

/** Insert shape for importBatch(). txn_hash dedup is enforced by the DB UNIQUE constraint. */
export interface NewBankTransaction {
  txn_hash: string;
  txn_date: string;
  txn_date_iso: string;
  value_date: string;
  description: string;
  ref_no: string | null;
  branch_code: string | null;
  debit_paise: number;
  credit_paise: number;
  balance_paise: number;
  txn_type: 'credit' | 'debit';
}

/** Optional filters for list(). */
export interface BankTransactionFilters {
  txnType?: 'credit' | 'debit';
  /** true = has at least one linked payment, false = has none. */
  reconciled?: boolean;
  /** Case-insensitive substring match against description. */
  search?: string;
  /** ISO YYYY-MM-DD, inclusive. */
  fromDate?: string;
  /** ISO YYYY-MM-DD, inclusive. */
  toDate?: string;
  /** 1-indexed. Defaults to 1. */
  page?: number;
  /** Defaults to 50. */
  limit?: number;
}

/** A payment linked to a bank transaction, joined with registration display fields. */
export interface LinkedPayment {
  paymentId: number;
  registrationId: number;
  regCode: string;
  fullName: string;
  amount: number;
  status: PaymentStatus;
  linkId: number;
}

export interface BankTransactionWithLinks extends BankTransaction {
  linkedPayments: LinkedPayment[];
}

export function toBankTransaction(row: BankTransactionRow): BankTransaction {
  return {
    id: row.id,
    txnHash: row.txn_hash,
    txnDate: row.txn_date,
    txnDateIso: row.txn_date_iso,
    valueDate: row.value_date,
    description: row.description,
    refNo: row.ref_no,
    branchCode: row.branch_code,
    debitPaise: row.debit_paise,
    creditPaise: row.credit_paise,
    balancePaise: row.balance_paise,
    txnType: row.txn_type,
    comment: row.comment,
    importBatch: row.import_batch,
    createdAt: row.created_at,
  };
}
