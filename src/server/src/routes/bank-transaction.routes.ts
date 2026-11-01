/**
 * CONTRACT
 *
 * GUARANTEES:
 *   - AUTH_GUARD — All routes require a valid JWT with role 'staff' or 'admin'.
 *     Missing/invalid token returns 401. Wrong role returns 403.
 *
 *   - IMPORT — POST /import accepts the raw SBI statement text (text/plain
 *     body), parses it via parseSbiStatement(), maps parsed transactions to
 *     NewBankTransaction rows, and imports them via
 *     bankTransactionRepo.importBatch() with batchId = ISO timestamp of the
 *     request. Returns { imported, skipped, total }. 400 if body is empty.
 *
 *   - LIST — GET / supports filtering by type (credit|debit), reconciled
 *     (true|false), search, fromDate/toDate (ISO YYYY-MM-DD, inclusive),
 *     with pagination (page/limit, default 1/50, limit capped at 100).
 *     Returns { transactions, total, page, limit }.
 *
 *   - DETAIL — GET /:id returns the transaction with its linked payments.
 *     404 if not found.
 *
 *   - COMMENT — POST /:id/comment sets or clears (null) the comment on a
 *     transaction. Returns { ok: true }.
 *
 *   - LINK — POST /:id/link links one or more payment ids to the
 *     transaction. 422 if paymentIds is missing/empty/not an array of
 *     numbers. Returns { ok: true, linked }.
 *
 *   - UNLINK — DELETE /:id/link/:paymentId removes a single link. Returns
 *     { ok: true }.
 *
 * EXPECTS:
 *   - c.var.bankTransactionRepo is set by the DI middleware in app.ts.
 *
 * FAILURE BEHAVIOR:
 *   - 404 returned when a transaction id does not resolve to a row.
 *   - 422 returned for missing/invalid required body fields.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { authMiddleware, requireRole, requireScope } from '../middleware/auth.middleware.js';
import { parseSbiStatement } from '../lib/sbi-statement-parser.js';
import type { NewBankTransaction } from '../domain/bank-transaction-types.js';

export const bankTransactionRoutes = new Hono<AppEnv>();

bankTransactionRoutes.use('*', authMiddleware, requireRole('staff', 'admin'), requireScope('bank_txns'));

// ---------------------------------------------------------------------------
// POST /staff/bank-transactions/import
// ---------------------------------------------------------------------------

bankTransactionRoutes.post('/import', async (c) => {
  const text = await c.req.text();
  if (!text.trim()) {
    return c.json({ error: 'Empty statement body' }, 400);
  }

  const parsed = await parseSbiStatement(text);

  const transactions: NewBankTransaction[] = parsed.transactions.map((t) => ({
    txn_hash: t.txnHash,
    txn_date: t.txnDate,
    txn_date_iso: t.txnDateIso,
    value_date: t.valueDate,
    description: t.description,
    ref_no: t.refNo,
    branch_code: t.branchCode,
    debit_paise: t.debitPaise,
    credit_paise: t.creditPaise,
    balance_paise: t.balancePaise,
    txn_type: t.txnType,
  }));

  const batchId = new Date().toISOString();
  const { inserted, skipped } = await c.var.bankTransactionRepo.importBatch(transactions, batchId);

  // Audit bank_txn_imported (spec R6.6).
  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  await c.var.systemAuditRepo.append({
    action: 'bank_txn_imported',
    actor: staffEmail,
    targetType: 'bank_transaction_batch',
    details: JSON.stringify({
      batchId,
      imported: inserted,
      skipped,
      total: transactions.length,
    }),
  });

  return c.json({ imported: inserted, skipped, total: transactions.length });
});

// ---------------------------------------------------------------------------
// GET /staff/bank-transactions
// ---------------------------------------------------------------------------

bankTransactionRoutes.get('/', async (c) => {
  const typeParam = c.req.query('type') as 'credit' | 'debit' | undefined;
  const reconciledParam = c.req.query('reconciled');
  const search = c.req.query('search');
  const fromDate = c.req.query('fromDate');
  const toDate = c.req.query('toDate');
  const page = Math.max(1, Number(c.req.query('page') ?? '1'));
  const rawLimit = Number(c.req.query('limit') ?? '50');
  const limit = Math.min(100, Math.max(1, rawLimit));

  const filters = {
    txnType: typeParam,
    reconciled: reconciledParam === undefined ? undefined : reconciledParam === 'true',
    search: search ?? undefined,
    fromDate: fromDate ?? undefined,
    toDate: toDate ?? undefined,
    page,
    limit,
  };

  const { transactions, total } = await c.var.bankTransactionRepo.list(filters);

  return c.json({ transactions, total, page, limit });
});

// ---------------------------------------------------------------------------
// GET /staff/bank-transactions/summary
// ---------------------------------------------------------------------------

bankTransactionRoutes.get('/summary', async (c) => {
  const fromDate = c.req.query('fromDate');
  const toDate = c.req.query('toDate');

  const summary = await c.var.bankTransactionRepo.summary({
    fromDate: fromDate ?? undefined,
    toDate: toDate ?? undefined,
  });

  return c.json(summary);
});

// ---------------------------------------------------------------------------
// GET /staff/bank-transactions/:id
// ---------------------------------------------------------------------------

bankTransactionRoutes.get('/:id', async (c) => {
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }

  const transaction = await c.var.bankTransactionRepo.getById(Number(idParam));
  if (!transaction) {
    return c.json({ error: 'Not found' }, 404);
  }

  return c.json({ transaction });
});

// ---------------------------------------------------------------------------
// POST /staff/bank-transactions/:id/comment
// ---------------------------------------------------------------------------

bankTransactionRoutes.post('/:id/comment', async (c) => {
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { comment: 'Required' } } },
      422,
    );
  }

  const comment = body['comment'];
  if (comment !== null && typeof comment !== 'string') {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { comment: 'Must be a string or null' } } },
      422,
    );
  }

  const txn = await c.var.bankTransactionRepo.getById(Number(idParam));
  if (!txn) {
    return c.json({ error: 'Not found' }, 404);
  }

  await c.var.bankTransactionRepo.updateComment(Number(idParam), comment);

  // Audit bank_txn_commented (spec R6.6).
  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  await c.var.systemAuditRepo.append({
    action: 'bank_txn_commented',
    actor: staffEmail,
    targetType: 'bank_transaction',
    targetId: Number(idParam),
    details: JSON.stringify({ comment }),
  });

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /staff/bank-transactions/:id/link
// ---------------------------------------------------------------------------

bankTransactionRoutes.post('/:id/link', async (c) => {
  const idParam = c.req.param('id');
  if (!idParam || !/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { paymentIds: 'Required' } } },
      422,
    );
  }

  const paymentIdsRaw = body['paymentIds'];
  if (
    !Array.isArray(paymentIdsRaw) ||
    paymentIdsRaw.length === 0 ||
    !paymentIdsRaw.every((v) => typeof v === 'number' && Number.isFinite(v))
  ) {
    return c.json(
      { error: 'Validation failed', details: { fieldErrors: { paymentIds: 'Must be a non-empty array of numbers' } } },
      422,
    );
  }

  const bankTransactionId = Number(idParam);

  const txn = await c.var.bankTransactionRepo.getById(bankTransactionId);
  if (!txn) {
    return c.json({ error: 'Not found' }, 404);
  }

  const paymentIds = paymentIdsRaw as number[];

  for (const paymentId of paymentIds) {
    await c.var.bankTransactionRepo.linkPayment(bankTransactionId, paymentId);
  }

  // Audit bank_txn_linked (spec R6.6) — one entry covers all linked payment ids.
  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  await c.var.systemAuditRepo.append({
    action: 'bank_txn_linked',
    actor: staffEmail,
    targetType: 'bank_transaction',
    targetId: bankTransactionId,
    details: JSON.stringify({ paymentIds }),
  });

  return c.json({ ok: true, linked: paymentIds.length });
});

// ---------------------------------------------------------------------------
// DELETE /staff/bank-transactions/:id/link/:paymentId
// ---------------------------------------------------------------------------

bankTransactionRoutes.delete('/:id/link/:paymentId', async (c) => {
  const idParam = c.req.param('id');
  const paymentIdParam = c.req.param('paymentId');
  if (!idParam || !/^\d+$/.test(idParam) || !paymentIdParam || !/^\d+$/.test(paymentIdParam)) {
    return c.json({ error: 'Not found' }, 404);
  }

  const txn = await c.var.bankTransactionRepo.getById(Number(idParam));
  if (!txn) {
    return c.json({ error: 'Not found' }, 404);
  }

  await c.var.bankTransactionRepo.unlinkPayment(Number(idParam), Number(paymentIdParam));

  // Audit bank_txn_unlinked (spec R6.6).
  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';
  await c.var.systemAuditRepo.append({
    action: 'bank_txn_unlinked',
    actor: staffEmail,
    targetType: 'bank_transaction',
    targetId: Number(idParam),
    details: JSON.stringify({ paymentId: Number(paymentIdParam) }),
  });

  return c.json({ ok: true });
});
