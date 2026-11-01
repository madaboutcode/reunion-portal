/**
 * Snapshot data loaders shared by ArchiveService and CancellationService.
 *
 * Both services assemble a JSON snapshot of a registration and its child
 * records before deleting the active row. Roommate preferences and bank
 * transaction links are not exposed through any repository interface, so the
 * services read them directly through the D1 binding.
 *
 * GUARANTEE: NO_SQL_INJECTION — all queries use db.prepare().bind(). Dynamic
 *   IN lists are built from placeholder strings, never from values.
 *
 * GUARANTEE: EMPTY_WITHOUT_LINKS — loadBankLinkSnapshot() returns empty arrays
 *   when paymentIds is empty, and loadRoommatePreferences() returns [] when
 *   the registration has no preferences.
 */

import type { D1Database } from '@cloudflare/workers-types';

/** Raw roommate_preferences row shape (both FK directions). */
export interface RoommatePreferenceSnapshotRow {
  id: number;
  registration_id: number;
  preferred_registration_id: number;
  preference_order: number;
  created_by: number;
  created_at: number;
  updated_at: number;
}

/** Payment-to-transaction association from bank_transaction_payments. */
export interface BankTransactionLinkSnapshot {
  linkId: number;
  bankTransactionId: number;
  paymentId: number;
  createdAt: number;
}

/** Linked bank_transactions row (identity + amounts for later reconciliation). */
export interface BankTransactionSnapshot {
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
  created_at: number;
}

export interface BankLinkSnapshot {
  bankTransactionLinks: BankTransactionLinkSnapshot[];
  bankTransactions: BankTransactionSnapshot[];
}

/** Loads every roommate-preference row touching the registration from either
 *  side of the relation (outgoing registration_id or incoming
 *  preferred_registration_id). */
export async function loadRoommatePreferences(
  db: D1Database,
  registrationId: number,
): Promise<RoommatePreferenceSnapshotRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, registration_id, preferred_registration_id, preference_order,
              created_by, created_at, updated_at
       FROM roommate_preferences
       WHERE registration_id = ? OR preferred_registration_id = ?
       ORDER BY id ASC`,
    )
    .bind(registrationId, registrationId)
    .all<RoommatePreferenceSnapshotRow>();

  // D1 `.all()` always resolves `results` to an array (empty when no rows
  // match) — no null guard needed (D1Result<T>.results: T[]).
  return results;
}

/** Loads the payment→transaction links and the linked transactions for a set
 *  of payment ids. */
export async function loadBankLinkSnapshot(
  db: D1Database,
  paymentIds: number[],
): Promise<BankLinkSnapshot> {
  if (paymentIds.length === 0) return { bankTransactionLinks: [], bankTransactions: [] };

  const linkPlaceholders = paymentIds.map(() => '?').join(', ');
  const { results: linkResults } = await db
    .prepare(
      `SELECT id as link_id, bank_transaction_id, payment_id, created_at
       FROM bank_transaction_payments
       WHERE payment_id IN (${linkPlaceholders})
       ORDER BY id ASC`,
    )
    .bind(...paymentIds)
    .all<{ link_id: number; bank_transaction_id: number; payment_id: number; created_at: number }>();

  const bankTransactionLinks = linkResults.map((r) => ({
    linkId: r.link_id,
    bankTransactionId: r.bank_transaction_id,
    paymentId: r.payment_id,
    createdAt: r.created_at,
  }));

  const txnIds = [...new Set(bankTransactionLinks.map((l) => l.bankTransactionId))];
  if (txnIds.length === 0) return { bankTransactionLinks, bankTransactions: [] };

  const txnPlaceholders = txnIds.map(() => '?').join(', ');
  const { results: txnResults } = await db
    .prepare(
      `SELECT id, txn_hash, txn_date, txn_date_iso, value_date, description,
              ref_no, branch_code, debit_paise, credit_paise, balance_paise,
              txn_type, created_at
       FROM bank_transactions
       WHERE id IN (${txnPlaceholders})
       ORDER BY id ASC`,
    )
    .bind(...txnIds)
    .all<BankTransactionSnapshot>();

  return { bankTransactionLinks, bankTransactions: txnResults };
}
