# Specification: Bank Transaction Matching

## Purpose

Allow staff to optionally link a bank transaction to a payment during verification, replacing manual UTR entry with a searchable picker and enabling automatic reconciliation linking on verify.

## Scope

**Covers:** Bank transaction picker modal in VerifyRejectBar, auto-fill of reference/amount/verification type from selected transaction, automatic linking after verification, `bank_txns` scope for permission gating, `txnRef` extraction in `parseBankDescription`.

**Does not cover:** Batch reconciliation workflow (stays CLI-driven), bank statement import (unchanged), bank transactions list page changes (already works), refund linking.

---

## Requirements

### Permission: `bank_txns` scope

R1 — A new scope `bank_txns` is added to `StaffScope`.

R1.1 — Bank transaction API routes (`/api/staff/bank-transactions/*`) require `requireScope('bank_txns')` instead of `requireScope('dashboard')`.

R1.2 — The "Match bank transaction" button in VerifyRejectBar is only rendered when the current user has the `bank_txns` scope (or is admin).

R1.3 — The SiteNav "Bank Transactions" link is gated on `bank_txns` scope.

R1.4 — The TeamManagementPage scope editor includes a "Bank Transactions" checkbox for `bank_txns`.

R1.5 — `VALID_SCOPES` in admin routes includes `bank_txns`.

### Shared: `parseBankDescription` extension

R2 — `ParsedBankDescription` gains a `txnRef: string | null` field — the embedded transaction reference extracted from the bank description.

R2.1 — UPI: the numeric ID after `CR/` (e.g. `100000000001` from `BY TRANSFER-UPI/CR/100000000001/...`).

R2.2 — IMPS: the numeric ID after `BY TRANSFER-IMPS/` (e.g. `100000000002` from `BY TRANSFER-IMPS/100000000002/...`).

R2.3 — NEFT: the ref segment from `BY TRANSFER-NEFT*{ifsc}*{ref}*{name}*...` (second `*`-delimited field).

R2.4 — SBI: the ref after `BY TRANSFER-SBIY` (e.g. `000001` from `BY TRANSFER-SBIY000001/...`).

R2.5 — OTHER: `txnRef` is `null`.

R2.6 — Existing fields (`type`, `name`, `remark`, `raw`) are unchanged.

### Client: API functions

R3 — `staff-api.ts` exposes `fetchBankCredits(showAll?: boolean): Promise<BankTransaction[]>`.

R3.1 — Calls `GET /api/staff/bank-transactions` with appropriate query params. Returns the full list for client-side search/sort.

R3.2 — `staff-api.ts` exposes `linkBankTransaction(txnId: number, paymentIds: number[]): Promise<void>`.

R3.3 — Calls `POST /api/staff/bank-transactions/:id/link` with `{ paymentIds }`.

### UI: VerifyRejectBar changes

R4 — A "Match bank transaction" button appears between the proof image and the reference field, visible only to users with `bank_txns` scope.

R4.1 — Clicking opens a modal dialog.

R4.2 — The modal fetches bank credits on open (not on VerifyRejectBar mount).

R4.3 — The modal shows a toggle: "Unreconciled" (default) / "All". "All" includes already-reconciled transactions for joint payment cases where one bank transfer covers multiple registrations.

R4.4 — The modal has a search input that filters by sender name, amount, date, or description text.

R4.5 — Results are sorted by `|credit amount - expected payment amount|` ascending — closest amount match first.

R4.6 — Each row shows: date, sender name (via `parseBankDescription`), amount (formatted as ₹), type badge (UPI/NEFT/IMPS/SBI), and a reconciled indicator if already linked.

R4.7 — Clicking a row selects it and closes the modal.

### UI: Auto-fill on selection

R5 — When a bank transaction is selected, the reference field is auto-filled with the `txnRef` extracted by `parseBankDescription`. Falls back to `refNo` if `txnRef` is null.

R5.1 — The reference field remains editable after auto-fill.

R5.2 — Verification type is auto-selected: if bank credit equals expected amount → Full; if less → Short; if more → Over.

R5.3 — If Short or Over, the "amount received" field is auto-filled with the bank credit amount (converted from paise to rupees).

R5.4 — A summary line appears below the reference field: "Linked to bank txn #509 · ELI FIXTURE · ₹8,850 [✕]". The ✕ clears the selection and reverts to manual entry.

R5.5 — All auto-filled values can be manually overridden without clearing the bank txn selection.

### Linking on verify

R6 — When the verify action succeeds AND a bank transaction is selected, the client fires `linkBankTransaction(selectedTxnId, [paymentId])`.

R6.1 — Link failure does not affect the verification — it is already committed. A console warning is logged. The verification success UI is shown regardless.

R6.2 — Link success is silent — no additional toast or notification.

---

## States

| State | Description |
|-------|-------------|
| No `bank_txns` scope | "Match bank transaction" button not rendered. Flow unchanged. |
| Button visible, no selection | Reference field is empty, manual entry expected. |
| Modal open, loading | Spinner while fetching bank credits. |
| Modal open, results | Sorted list with search. Toggle for unreconciled/all. |
| Modal open, no results | "No matching transactions" message after search filter. |
| Transaction selected | Reference auto-filled, type auto-selected, summary line visible. |
| Selection cleared | Back to manual entry state. |
| Verify with selection | Verify fires, then link fires. Both succeed silently. |
| Verify succeeds, link fails | Verification committed, link error logged, user sees success. |

## Data Flow

```
VerifyRejectBar
  ├── payment (prop) — expected amount, payment ID
  ├── user scopes (context) — controls button visibility
  │
  ├── [Match bank transaction] → Modal
  │     ├── GET /api/staff/bank-transactions → BankTransaction[]
  │     ├── parseBankDescription(tx.description) → name, type, txnRef
  │     ├── sort by |creditPaise/100 - expectedAmount|
  │     └── on select → { txnId, txnRef, creditAmount, senderName }
  │
  ├── referenceId field ← txnRef (auto-fill) or manual
  ├── verificationType ← amount comparison (auto) or manual
  ├── actualAmount ← creditAmount (auto) or manual
  │
  └── on verify success
        ├── POST /api/staff/payments/:id/verify (existing)
        └── POST /api/staff/bank-transactions/:txnId/link (new, fire-and-forget)
```

## Edge Cases

- **Multiple registrations, same bank txn (couples):** Staff verifies first registration, selects the bank txn, it gets linked. For the second registration, they toggle "All" in the modal to find the now-reconciled txn and select it again. The link API supports multiple payment IDs per transaction.
- **Bank txn amount doesn't match any verification type exactly:** Auto-selection picks Short or Over. Staff can override.
- **No bank statement imported yet:** Modal shows empty list. Staff proceeds with manual reference entry.
- **`txnRef` is null (OTHER type):** Falls back to `refNo` for auto-fill. If that's also null, reference field stays empty for manual entry.
- **Staff clears selection mid-way:** All auto-filled values revert. Manual entry resumes.
- **User loses `bank_txns` scope between page load and verify:** Link call returns 403. Verification already succeeded. Logged as warning.

## Dependencies

- `payment-flow.spec.md` — verification lifecycle (R6 extends the verify action)
- `team-management.spec.md` — scope editor (R1.4 adds a checkbox)
- `@smriti/shared` `bank-description-parser.ts` — `parseBankDescription` extension (R2)
- Bank transaction routes — scope change (R1.1)

## Files to Change

| File | Change |
|------|--------|
| `src/shared/src/bank-description-parser.ts` | Add `txnRef` field to `ParsedBankDescription`, extract from each pattern |
| `src/web/src/lib/staff-types.ts` | Add `"bank_txns"` to `StaffScope` |
| `src/server/src/domain/types.ts` | Add `"bank_txns"` to `StaffScope` |
| `src/server/src/routes/admin.routes.ts` | Add `"bank_txns"` to `VALID_SCOPES` |
| `src/server/src/routes/bank-transaction.routes.ts` | Change `requireScope('dashboard')` → `requireScope('bank_txns')` |
| `src/web/src/lib/staff-api.ts` | Add `fetchBankCredits()` and `linkBankTransaction()` |
| `src/web/src/pages/TeamManagementPage.tsx` | Add `bank_txns` to `SCOPE_OPTIONS` |
| `src/web/src/components/SiteNav.tsx` | Gate bank transactions link on `bank_txns` scope |
| `src/web/src/pages/RegistrationDetailPage.tsx` | Add modal trigger + `BankTxnMatchModal` + auto-fill + post-verify link |
