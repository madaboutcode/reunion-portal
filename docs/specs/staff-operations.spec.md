# Specification: Staff Operations (Service Logic)

## Purpose

Defines the backend service logic for staff operations: what happens when staff verify payments, reject proofs, view files, upload on behalf, and export data. This is the business logic layer — not the API contract (see `staff-api.spec.md`) or the UI (see `staff-dashboard.spec.md`).

## Contents

- [Scope](#scope)
- [Payment Verification](#payment-verification)
- [Create Balance Payment](#create-balance-payment)
- [Refund Operations](#refund-operations)
- [Payment Rejection](#payment-rejection)
- [Proof Upload on Behalf](#proof-upload-on-behalf)
- [File Proxy](#file-proxy)
- [My Registration](#my-registration)
- [Export](#export)
- [Audit Trail](#audit-trail)
- [Dependencies](#dependencies)

## Scope

**Covers:** Service-layer logic for staff operations. State transitions, side effects, audit requirements, email triggers.

**Does not cover:** API endpoints and shapes (see `staff-api.spec.md`). UI interactions (see `staff-dashboard.spec.md`). User management (see `user-management.spec.md`).

---

## Payment Verification

R1 — When staff verifies a payment, the following happens atomically:

R1.1 — Guard: payment `status` must be `pending_verification`. Otherwise reject with conflict (`409`).

R1.1.1 — Guard: coverage check. Let `actualAmount` be the amount staff confirms (R1.8) and `pendingAmount` be the registration's single outstanding `payment_pending` record's amount, from `findPendingByRegistration()` (0 if none). Verification is rejected with `409` unless:

```
sumVerifiedByRegistration(registrationId) + actualAmount + pendingAmount >= registration.total_amount
```

If rejected, staff must call [Create Balance Payment](#create-balance-payment) first, then retry verification. This prevents a registration from being left with an uncovered shortfall and no pending record to close it. Verification never creates payment records or sends attendee notifications by itself — only the guarded outcomes below (R1.7, R1.14) do.

R1.2 — Payment status → `verified`.

R1.3 — `gateway_ref` set to the provided `referenceId`.

R1.4 — `verified_by` set to staff email. `verified_at` set to `Date.now()`.

R1.5 — Registration status → `confirmed`, but only when the sum of verified payments >= `total_amount` after this verification. If the sum falls short and an outstanding `payment_pending` record covers the remaining gap, the registration status becomes `pending` (derived from payment state per `payment-flow.spec.md` R1.1: when any payment is `payment_pending`, registration is `pending`).

R1.6 — Audit: `payment_verified`, actor = staff email, changes = `{ referenceId, paymentId, expectedAmount, actualAmount, from: 'pending_verification', to: 'verified' }`. `expectedAmount` is the payment's amount before this verification; `actualAmount` is the amount staff confirmed (equal to `expectedAmount` on a full, backward-compatible verify).

R1.7 — Email: "Payment confirmed" template sent to attendee **only** when R1.5's confirm condition is met on this verification. A partial verify that does not bring the registration to `confirmed` sends no email from this operation.

R1.8 — Staff may supply `actualAmount` when verifying — the amount actually confirmed received, which may be less than or greater than the payment's expected `amount`. `actualAmount` must be `> 0` — if no money was received, staff should reject the payment (see [Payment Rejection](#payment-rejection)), not verify it for zero. Omitting `actualAmount` defaults to the payment's expected amount (backward-compatible with the original verify behavior).

R1.9 — When `actualAmount` is less than the payment's expected amount (short payment), the payment's `amount` column is overwritten to `actualAmount` — not the original expected amount — so that `sumVerifiedByRegistration()` reflects real money received. The original expected amount is preserved only in the audit entry (R1.6), not on the payment record.

R1.10 — When `actualAmount` is greater than the payment's expected amount (overpayment), the payment is verified for the expected amount only — R1.9 does not apply, `amount` stays at the original expected value. The excess is handled per [Refund Operations](#refund-operations).

---

## Create Balance Payment

R1.11 — `createBalancePayment(registrationId, amount, staffEmail)` is a service operation separate from `verifyPayment()` — not fused into one method. A compound endpoint (see `staff-api.spec.md`) composes the two in sequence: create balance payment, then verify.

R1.12 — Guard: at most one `payment_pending` record may exist per registration at any time (existing invariant, see R11.3). If a `payment_pending` record already exists for this registration, `createBalancePayment` is rejected with `409`.

R1.13 — On success: creates a new `payment_pending` record for `amount`, linked to the registration — the same pattern already used by `edit.service.ts` when a registration's total changes (see R11).

R1.14 — Side effect: sends the payment-link notification to the attendee (fire-and-forget, async after DB commit), reusing the existing payment-link mechanism (`staff.routes.ts:560` / `staff.routes.ts:594`). The staff dashboard UI gates this call with a confirmation step ("This will create a ₹X balance payment and notify the registrant. Proceed?") before it fires.

R1.15 — Audit: `payment_created`, actor = staff email, changes = `{ amount, reason: 'partial_verification_shortfall', sourcePaymentId }`. `sourcePaymentId` is the ID of the payment being partially verified that produced this shortfall.

---

## Refund Operations

R1.16 — When a payment is verified with `actualAmount` greater than its expected amount (R1.10), a refund record is created automatically — no separate staff action. Entering `actualAmount` greater than expected is itself the acknowledgment; the staff dashboard UI provides its own confirmation step before the verify submits.

R1.17 — The refund record is a new row in a dedicated `refunds` table: `id, registration_id (FK), source_payment_id (FK), amount, status ('pending'|'completed'), resolved_by, resolved_at, created_at`. `amount` is the excess (`actualAmount` minus the expected amount). This is deliberately not a `type` column on `payments` — `sumVerifiedByRegistration`, `sumVerified`, and `sumVerifiedByBranch` have no type filter today, so a `status='verified'` refund row would silently count as revenue unless every current and future query remembered to exclude it.

R1.18 — Refund handling is manual only — no payment-gateway or bank API integration.

R1.19 — Staff mark a refund `completed` by hand, recording a bank transfer reference/UTR, once the money has actually been wired back. This sets `status = 'completed'`, `resolved_by` = staff email, `resolved_at` = `Date.now()`.

R1.20 — Audit: `refund_completed`, actor = staff email, changes = `{ refundAmount, bankReference }`.

R1.21 — A refund closes only by handing the money back — there is no "apply as credit to another registration" resolution path. Money that could instead fund another registration is handled entirely by ordinary partial verification (R1.1–R1.15) against that registration, not a refund.

---

## Payment Rejection

R2 — When staff rejects a proof, rewind occurs:

R2.1 — Guard: payment `status` must be `pending_verification`.

R2.2 — Payment status → `payment_pending` (rewind).

R2.3 — Registration status → `pending` (rewind).

R2.4 — Audit: `proof_rejected`, actor = staff email, changes = `{ comment, paymentId, from: 'pending_verification', to: 'payment_pending' }`.

R2.5 — Email: "Payment proof rejected" template sent to attendee, includes the staff comment.

R2.6 — The proof file remains in R2 — not deleted on rejection. Preserved for audit purposes.

---

## Proof Upload on Behalf

R3 — Staff can upload payment proof for any registration.

R3.1 — Same logic as attendee proof upload (see `payment-flow.spec.md` R5).

R3.2 — Audit: `proof_uploaded_by_staff` (not `proof_uploaded`), actor = staff email.

R3.3 — Use case: attendee WhatsApps proof to committee member, who uploads it from the dashboard.

---

## File Proxy

R4 — Staff view files (ID docs, payment proofs) through an authenticated API proxy.

R4.1 — Server reads from R2, streams to client with correct `Content-Type`.

R4.2 — No signed URLs. Auth is enforced by JWT middleware.

R4.3 — Audit: `file_viewed`, actor = staff email, records file key.

---

## My Registration

R5 — Staff who are also registered alumni can view their own registration.

R5.1 — Match: `users.email` (from JWT) → `registrations.email`.

R5.2 — Returns same data shape as attendee's `GET /registrations/me`.

R5.3 — If no match found, return not-found (staff member isn't a registered alumnus).

---

## Export

R6 — CSV export of registration data.

R6.1 — Same filters as registration list (status, branch, search).

R6.2 — Columns: regCode, fullName, branch, email, whatsapp, status, totalAmount, accommodation, createdAt.

R6.3 — Audit: `export_downloaded`, actor = staff email, records filter params.

---

## Audit Trail

R7 — Every staff action is audited. No exceptions.

R7.1 — Actor is always the staff member's email (from JWT).

R7.2 — Full action list:

| Action | Trigger | Registration context | What's recorded |
|--------|---------|:-------------------:|-----------------|
| `payment_verified` | Verify payment | Yes | referenceId, paymentId, expectedAmount, actualAmount, status transition |
| `proof_rejected` | Reject proof | Yes | comment, paymentId, status transition |
| `proof_uploaded_by_staff` | Upload on behalf | Yes | paymentId, file key |
| `registration_viewed` | Open detail view | Yes | registrationId |
| `file_viewed` | View file | Yes | file key |
| `export_downloaded` | CSV export | No | filter params |
| `login_requested` | Magic link request | No | email, resolved role |
| `login_succeeded` | Magic link verified | No | email, role, IP |
| `login_failed` | Verification failed | No | token hash prefix, reason |
| `payment_created` (shortfall) | Create balance payment | Yes | amount, reason='partial_verification_shortfall', sourcePaymentId |
| `refund_completed` | Mark refund completed | Yes | refundAmount, bankReference |

R7.3 — `audit_log.registration_id` is nullable for actions without registration context.

---

## Archive Registration

R8 — Staff can archive registrations. Archiving snapshots the full record to a separate `archived_registrations` table and deletes the original. This frees the email for re-registration and removes the record from all active views with zero changes to existing queries.

R8.1 — Guard: registration must have zero payment records beyond `payment_pending` stubs. Registrations with `pending_verification` or `verified` payments cannot be archived. Returns `409`. This guard can be bypassed via the `force: true` request body parameter (API-only, no UI exposure), intended for staff-override scenarios where a registration must be archived despite pending or verified payments. When forced, all payments are deleted unconditionally and the snapshot records `forceArchived: true`.

R8.2 — Archive is a destructive operation (delete from `registrations`). Staff sees a confirmation dialog before proceeding.

### Archive Flow

R8.3 — On archive, the server:
1. Snapshot the full registration, attendees, audit_log, id_documents, and payments as JSON
2. INSERT into `archived_registrations` with the snapshot, staff email as `archived_by`
3. DELETE from `payments` WHERE `registration_id = ?` (all payments; in normal mode these are all `payment_pending` stubs per the guard)
4. DELETE from `magic_links` WHERE `registration_id = ?` (no CASCADE — must delete explicitly)
5. DELETE from `registrations` WHERE `id = ?` (CASCADE handles attendees, audit_log, id_documents)
6. INSERT into `system_audit_log`: action = `registration_archived`, actor = staff email, details = `{ archivedId, force?: true }`

R8.4 — All operations in R8.3 run in a single transaction. If any step fails, the entire operation rolls back.

R8.5 — No email is sent to the attendee. Archive is internal housekeeping.

R8.6 — The email UNIQUE constraint on `registrations` is naturally released by the DELETE — the person can re-register with a fresh registration. No schema changes to the email constraint needed.

R8.7 — R2 files (photos, ID documents) are left in place after archive. They become orphaned but are small and can be batch-cleaned later. The `r2Key` values are preserved in the JSON snapshot for future cleanup.

R8.8 — There is no unarchive operation. Archived records are deleted from `registrations`. If a person needs to register again, they submit a fresh registration. The archived snapshot is retained for audit/reference purposes only.

### Archived Records View

R8.9 — Staff can view archived records in a separate "Archived" section. This queries the `archived_registrations` table directly — it does not touch `registrations`.

R8.10 — The archived view shows: reg_code, full_name, email, archived_by, archived_at. Staff can expand to view the full JSON snapshot.

### Schema Migration

R8.11 — Migration creates a new table only. No changes to `registrations`:

```sql
CREATE TABLE archived_registrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  original_id   INTEGER NOT NULL,
  reg_code      TEXT NOT NULL,
  email         TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  snapshot      TEXT NOT NULL,
  archived_by   TEXT NOT NULL,
  archived_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_archived_email ON archived_registrations(email);
CREATE INDEX idx_archived_reg_code ON archived_registrations(reg_code);
```

R8.12 — No changes to existing queries, indexes, or filters. Archived records are physically absent from `registrations`, so all existing queries naturally exclude them.

---

## Edit Registration

R10 — Staff can edit registration fields. Edits are classified as cosmetic or cost-affecting, with different rules for each.

### Field Classification

R10.1 — Cosmetic fields (always editable): `fullName`, `whatsapp`, `mobileAlternate`, `branch`, `city`, `country`, `gender`, `tshirtSize`, `alumniMeal`, `photo`, `publicAck`, `ackDisplayName`, `felicitation`, non-chargeable attendee changes (names, meals on free attendees).

R10.2 — Cost-affecting fields: `attendanceIntent`, `participationType`, `accommodation.type`, `accommodation.checkIn`, `accommodation.checkOut`, `accommodation.extraBed`, attendees (add/remove spouse/children/guests, changes to chargeable attendees), `contributionSplits`, `donation.amount`. Note: changing `participationType` away from `donation_only` MUST also update `attendanceIntent` to `attending` (and vice versa) — these are coupled fields. The server enforces consistency.

R10.2.1 — `email` is a gated field — neither cosmetic nor cost-affecting. Editing email requires: (a) duplicate check against existing non-archived registrations (`findByEmail` with `is_archived = 0`), (b) invalidation of any outstanding magic links for the old email, (c) a fresh payment link email to the new address if any payment is pending. Email changes are always allowed regardless of payment state but have their own validation gate.

### Edit Guards

R10.3 — Archived registrations cannot be edited. Returns `409`.

R10.4 — Cost-affecting edits are blocked when any payment has `status = 'pending_verification'`. Returns `409` with `{ "error": "Verify or reject pending payment before making cost changes" }`.

R10.5 — Cost-affecting edits that would reduce `new_total` below `sum_of_verified_payments` are blocked. Returns `422` with `{ "error": "Cannot reduce total below verified payments (₹X)" }`.

R10.6 — Optimistic locking: the edit request includes the registration's `updatedAt` timestamp. If it doesn't match the current value, the edit is rejected with `409` — another staff member modified the record.

### Edit Flow

R10.7 — On edit:
1. Validate field changes against guards (R10.3–R10.6)
2. If cost-affecting: recompute pricing via `calculateTotal()` from the shared lib (`src/shared/src/pricing.ts`) — same function used at initial registration, no duplicate logic
3. Determine payment action (see `payment-flow.spec.md` R7.7–R7.12)
4. Persist all changes atomically: registration fields, attendees, pricing snapshot, payment record, registration status
5. If payment created/updated: generate payment link, send email (async)
6. Audit: `amended` with field diff and full snapshot

R10.8 — The edit response includes: updated registration, new pricing breakup, payment status, and payment delta (if any).

R10.9 — The edit request body uses the same shared types (`Registration` from `src/shared/src/types.ts`) that `calculateTotal()` consumes. The server maps the edit request to a `Registration` shape, calls `calculateTotal()`, and compares. No separate pricing model for edits — reuse the existing shared lib end-to-end.

---

## Payment Management on Edit

R11 — Payment record lifecycle during staff edits follows `payment-flow.spec.md` R7.7–R7.21. Summary:

R11.1 — `payment_pending` records are mutable — amount can be updated.

R11.2 — `pending_verification` and `verified` records are frozen — never modified.

R11.3 — At most one `payment_pending` record exists per registration at any time.

R11.4 — When an edit creates or updates a payment record, a payment email is sent to the attendee with the amount, pricing breakup, and a fresh payment link (24h expiry).

R11.5 — Payment links resolve to the current pending payment dynamically. The payment page shows the latest `payment_pending` record's amount, not a baked-in value from link creation time.

---

## Audit Trail (Updated)

R12 — Every staff action is audited. No exceptions.

R12.1 — Actor is always the staff member's email (from JWT).

R12.2 — Full action list:

| Action | Trigger | Registration context | What's recorded |
|--------|---------|:-------------------:|-----------------|
| `payment_verified` | Verify payment | Yes | referenceId, paymentId, expectedAmount, actualAmount, status transition |
| `proof_rejected` | Reject proof | Yes | comment, paymentId, status transition |
| `proof_uploaded_by_staff` | Upload on behalf | Yes | paymentId, file key |
| `registration_viewed` | Open detail view | Yes | registrationId |
| `file_viewed` | View file | Yes | file key |
| `export_downloaded` | CSV export | No | filter params |
| `login_requested` | Magic link request | No | email, resolved role |
| `login_succeeded` | Magic link verified | No | email, role, IP |
| `login_failed` | Verification failed | No | token hash prefix, reason |
| `amended` | Staff edits registration | Yes | field diff (old → new), full snapshot |
| `payment_created` | New payment from edit | Yes | amount, reason='staff_amendment' |
| `payment_created` (shortfall) | Create balance payment | Yes | amount, reason='partial_verification_shortfall', sourcePaymentId |
| `payment_amended` | Payment amount updated | Yes | old amount, new amount, reason='staff_amendment' |
| `desk_payment_collected` | Registration desk settles a balance in person | Yes | amount, method (cash/upi/bank_transfer), note (when given) |
| `registration_archived` | Staff archives registration | No (system_audit_log) | regCode, email, fullName |
| `refund_completed` | Mark refund completed | Yes | refundAmount, bankReference |
| `statuses_reconciled` | Reconcile registration statuses | No (system_audit_log) | totalChecked, fixesCount, fixes, dryRun (fires on dry-run and live) |
| `room_inventory_updated` | Set room quotas per night | No (system_audit_log) | newInventory, overCommitted |
| `bank_txn_imported` | Import bank statement batch | No (system_audit_log) | batchId, imported, skipped, total |
| `bank_txn_commented` | Set/clear bank txn comment | No (system_audit_log) | targetId=bank txn id, comment |
| `bank_txn_linked` | Link payments to a bank txn | No (system_audit_log) | targetId=bank txn id, paymentIds |
| `bank_txn_unlinked` | Unlink a payment from a bank txn | No (system_audit_log) | targetId=bank txn id, paymentId |
| `attendee_checked_in` | Mark an attendee present at the registration desk | No (system_audit_log) | registrationId, checkedInAt |
| `spot_registration_created` | Create a registration at the registration desk | No (system_audit_log) | registrationId, participationType |
| `room_created` | Create a physical room | No (system_audit_log) | roomNumber, notes |
| `room_updated` | Update a physical room | No (system_audit_log) | before snapshot, updates |
| `room_assignment_created` | Assign or reassign a registration to a room for a night | No (system_audit_log), targetId=registrationId | roomId, roomNumber, nightDate |

R12.3 — `audit_log.registration_id` is nullable for actions without registration context.

---

## T-Shirt Management

R17 — Staff can manage t-shirt rows for a registration via dedicated sub-resource endpoints (see `staff-api.spec.md` R34–R37). Service logic:

R17.1 — Adding a shirt: validate registration exists, check donation_only exclusion (R22), check pending_verification block for cost-affecting adds (R23), insert row, recalculate total via `calculateTotal()` with all tshirts + charges as extras, update `total_amount` and `pricing_snapshot`, handle payment delta.

R17.2 — Updating a shirt (size/gender): always allowed (cosmetic). If the row is the included shirt (`is_included = 1`), mirror-sync `registrations.tshirt_size` to the new size.

R17.3 — Removing a shirt: check pending_verification block (R23, cost-affecting), delete row, recalculate total, handle payment delta. Cannot delete the included shirt (400).

R17.6 — Every non-donation-only registration is guaranteed to have exactly one included shirt (`is_included = 1`). This invariant is maintained by three mechanisms: (a) `RegistrationService.submit()` creates the included tshirts row (gender + size from the wizard) immediately after `createWithRelations()` for non-donation-only registrations with a tshirt_size; (b) migration 0019 backfills an included row for every existing registration with a `tshirt_size`; (c) deletion of the included shirt is rejected with 400 (R17.3 / `staff-api.spec.md` R37.3). Therefore, there is no code path through which a non-donation-only registration can have zero included rows, and no UI affordance to create one is needed. (Closes R13 from the cycle register.)

R17.4 — The t-shirt charge is derived from rows on every recalculation — never stored. `calculateTotal()` receives shirts as `extras.tshirts` and computes `count(non-included) × tshirtExtraRate`.

R17.5 — Audit: `tshirt_added`, `tshirt_updated`, `tshirt_removed` logged with registration ID and staff email.

## Additional Charge Management

R18 — Staff can manage additional charges via dedicated sub-resource endpoints (see `staff-api.spec.md` R38–R40). Service logic:

R18.1 — Adding a charge: validate amount > 0 (R9, also DB-enforced via CHECK), check pending_verification block (R23), insert row with `created_by` = staff user ID, recalculate total, handle payment delta.

R18.2 — Removing a charge: check pending_verification block (R23), delete row, recalculate total, handle payment delta.

R18.3 — Charge amounts are exact — no GST markup, no percentage adjustment (R18-register). Charges are category "event" and never enter the accommodation bucket in `splitPricingBreakup()`.

R18.4 — Charge description is visible to the registrant (shown in their pricing breakdown).

R18.5 — Audit: `charge_added`, `charge_removed` logged with registration ID, charge description, and staff email.

## Dependencies

- Status transitions: `payment-flow.spec.md` (verify/reject rules, amendment rules R7)
- Auth: `authentication.spec.md` (role context, JWT claims)
- Email: Mailgun integration for confirmation/rejection/amendment emails
- File storage: R2 for file proxy
- Pricing: `pricing-engine.spec.md` (recalculation on edit)
