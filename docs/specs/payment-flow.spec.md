# Specification: Payment Flow

## Purpose

Defines the bank-transfer payment lifecycle: what the alumni sees on the payment page (bank details, UPI), how they submit proof of payment, how the committee verifies payments, and how amendments to a registration trigger additional payment collection.

## Contents

- [Scope](#scope)
- [Payment Lifecycle](#payment-lifecycle)
- [Status Model](#status-model)
- [Bank Details Display](#bank-details-display)
- [Payment Proof Upload](#payment-proof-upload)
- [Manual Verification](#manual-verification)
- [Amendment & Recalculation](#amendment--recalculation)
- [Audit Trail](#audit-trail)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Bank transfer flow (bank account details and UPI ID — always shown for all users), payment proof upload (screenshot/file), manual verification workflow (including partial verification of short payments and overpayment refunds), registration and payment status transitions, amendment-triggered additional payments, cost breakdown display, multi-day payment page persistence.

**Does not cover:** Payment gateway integration, admin verification UI (backend data model and manual DB update only in V1), amendment UI (data model supports it, UI deferred), email notifications for verification.

---

## Payment Lifecycle

```
POST /api/registrations (submission)
  ↓  Registration created, status: "pending"
  ↓  Payment record created (status: "payment_pending")
  ↓  regCode + JWT returned
  ↓
Client navigates to bank details page
  ↓  Shows bank account details, UPI ID (always, regardless of country), total amount
  ↓  Cost breakdown popup available
  ↓
Alumni sends bank transfer / UPI payment manually
  ↓  (may take hours or days — page persists across sessions)
  ↓
Alumni uploads payment proof (screenshot / receipt)
  ↓  POST /api/registrations/:regCode/pay/upload-proof
  ↓  Payment status → "pending_verification"
  ↓  Registration status → "pending_verification"
  ↓
Committee member reviews proof manually
  ↓  Approves or rejects
  ↓
  └── Approved → Payment verified for actualAmount (defaults to expected amount)
                  Payment status: "verified"
                  Audit: payment_verified
                  ↓
                  ├── sum(verified payments) >= total_amount
                  │     → Registration status: "confirmed"
                  │     → Confirmation email sent
                  │
                  ├── sum(verified payments) < total_amount, and a
                  │   payment_pending record covers the gap
                  │     → Registration stays in its payment-due state
                  │       ("pending" or "pending_verification" — not confirmed)
                  │     → No email fires from verify itself (the balance
                  │       payment's own creation already sent the
                  │       payment-link notification)
                  │
                  └── actualAmount > expected (overpayment)
                        → Payment verified for the expected amount only
                        → Refund record created (refunds table, status: "pending")
                        → Registration confirms + confirmation email sent,
                          since the expected amount completes total_amount
```

(Requirements: R13, R13.1, R13.2, R13.5, R2 (partial), R7–R9 (overpayment) — see `tasks/2026-07-01-payment-partial-refund.requirements.md`)

---

## Status Model

### Registration Statuses

The registration status mirrors the current payment state — it reflects where the user is in the payment lifecycle.

| Status | Meaning | Triggered by |
|--------|---------|-------------|
| `pending` | Registration created, awaiting payment proof | Registration submission |
| `pending_verification` | Payment proof uploaded, awaiting manual review | Proof upload |
| `confirmed` | Sum of `verified` payments has reached `total_amount` | Manual verification that completes the full amount owed |

R1 — The registration transitions: `pending` → `pending_verification` → `confirmed`. `confirmed` → `pending` is supported when staff amendments increase the cost (see [Amendment & Recalculation](#amendment--recalculation)). The `pending_verification` → `confirmed` transition is conditional (see R1.1) — it only fires when the verification being approved completes the full amount owed; a partial verification instead falls back to whatever state the outstanding balance payment record puts the registration in (see [Manual Verification § Partial Verification](#manual-verification)).

R1.1 — Registration status is **derived state**, computed by `deriveRegistrationStatus()` (`domain/status.ts`) after every payment mutation. The derivation rules, evaluated in priority order:
1. If sum of `verified` payment amounts >= `totalAmount` → `confirmed`
2. If any payment has status `pending_verification` → `pending_verification`
3. Otherwise → `pending`

Expected registration status after each operation:

| Operation | Payment state after | Registration status | Why |
|-----------|-------------------|-------------------|-----|
| Registration submitted | One `payment_pending` | `pending` | Rule 3: no verified, no pending_verification |
| Proof uploaded | One `pending_verification` | `pending_verification` | Rule 2: a payment awaits review |
| Full verify (covers total) | One `verified` (sum >= total) | `confirmed` | Rule 1: verified sum covers total |
| Partial verify + shortfall | One `verified` + one `payment_pending` | `pending` | Rule 3: verified sum < total, no pending_verification |
| Shortfall proof uploaded | One `verified` + one `pending_verification` | `pending_verification` | Rule 2: a payment awaits review |
| Shortfall verified (covers total) | Two `verified` (sum >= total) | `confirmed` | Rule 1: verified sum covers total |
| Proof rejected | One `payment_pending` | `pending` | Rule 3: back to initial state |
| Staff edit increases cost | Verified + new `payment_pending` | `pending` | Rule 3: new obligation, no pending_verification |
| Staff edit decreases cost (delta=0) | All `verified`, no pending | `confirmed` | Rule 1: fully covered |

### Payment Statuses

Payment records are append-only — each payment attempt, proof upload, and amendment-triggered additional payment creates a new record. The payment table tracks each payment event independently.

| Status | Meaning | Transitions to |
|--------|---------|---------------|
| `payment_pending` | Payment record created, no proof uploaded yet | `pending_verification` |
| `pending_verification` | Proof uploaded, awaiting manual review | `verified` |
| `verified` | Committee approved the payment proof | (terminal) |

R2 — Each payment event creates a record with `status: "payment_pending"`. Proof upload transitions it to `pending_verification`. Committee approval transitions to `verified`.

R2.1 — A registration can have multiple payment records. Only the most recent record's status drives the registration status display. Historical records are preserved for audit.

R2.2 — The first payment record is always created on registration submission. There is no conditional on the total: the server rejects any submission where the computed total is ≤ 0 (see `submission-api.spec.md` R3.15.1), so every successful submission has a positive total and a corresponding payment record. Subsequent records are created on amendments when the recalculated total exceeds previously verified payments.

---

## Bank Details Display

R3 — When the user reaches the payment step (after submission), the bank details page displays the bank account information and the total amount due.

R3.1 — The page always shows:
- Bank name, account holder name, account number, IFSC code, account type
- Total amount due (formatted as INR)
- A "Cost Breakdown" toggle/button that opens a popup showing how the main attendee registration fee is utilized

R3.2 — A UPI section is always displayed for all users, regardless of country:
- UPI ID
- Brief note: "You can also pay via any UPI app (GPay, PhonePe, Paytm)"

R3.3 — A bank transfer section is always displayed for all users. No country-specific filtering — both UPI and bank details are shown to everyone.

R3.4 — Bank details are embedded in the client bundle using a simple encoding (e.g., base64) — not for security, but to make details less trivially scrapable by bots. The committee redeploys the client to update bank details.

R3.5 — The page displays a clear instruction: "After completing the transfer, upload a screenshot or receipt below."

### Cost Breakdown Popup

R4 — Tapping the cost breakdown trigger opens a modal/popup showing how the main attendee registration fee is utilized.

R4.1 — The breakdown shows the base alumni registration fee broken down into utilization categories:

| Utilization Category | Description |
|---------------------|-------------|
| Event venue & logistics | "Venue rental, seating, stage setup, and event logistics" |
| Food & catering | "Meals, beverages, and catering services for the main attendee" |
| Activities & entertainment | "Games, performances, DJ, and event activities" |
| Event materials & kits | "Welcome kits, badges, event merchandise, and printed materials" |
| Contingency & misc | "Buffer for unforeseen expenses and event coordination" |

R4.2 — The breakdown shows only the main attendee's registration fee — not additional attendees, accommodation, or donations. The title of the popup clarifies this: "How your registration fee is used".

R4.3 — The utilization categories are hardcoded text in the client. No server endpoint is needed.

R4.4 — The total at the bottom of the breakdown matches the base alumni registration fee amount (not the overall total).

R4.5 — The popup has a close button and closes on backdrop click / Escape key.

---

## Payment Proof Upload

R5 — After the bank transfer is initiated, the user selects a proof file, reviews the preview, and explicitly confirms before the upload is triggered. File selection alone does not submit the proof.

R5.1 — The proof upload accepts the same file types as ID upload: JPG, JPEG, PNG, PDF. Maximum size: 5 MB.

R5.2 — The user can upload a single proof file per payment attempt. Uploading a new proof for the same payment replaces the previous proof.

R5.3 — On upload, the file is sent to `POST /api/registrations/:regCode/pay/upload-proof` with multipart form data. The server stores the proof file securely and associates it with the pending payment record.

R5.4 — A successful upload transitions the payment status to `pending_verification` and the registration status to `pending_verification`. The response includes the updated statuses.

R5.5 — If the user navigates away before uploading, the payment remains `payment_pending`. When they return (via JWT in localStorage or magic link later), the page shows the bank details again with the upload section ready.

R5.6 — After uploading proof, the page redirects to the confirmation page (`/confirmation/:regId`). The confirmation page then shows the appropriate status based on the registration state: for a newly uploaded proof, it renders the `pending_verification` state ("Verification in progress") with reassurance that the committee is reviewing the payment. The alumni sees their journey as complete from their perspective — proof submitted, nothing left to do but wait.

R5.7 — Each payment record can reference a single proof file. Uploading a new proof for the same payment replaces the previous one.

---

## Manual Verification

R6 — Staff or admin reviews payment proofs via the staff dashboard and approves or rejects them. The observable outcome for the alumni is a status change and, depending on the outcome, an email notification.

### Verify Payment

R6.1 — `POST /api/staff/payments/:id/verify` with body `{ referenceId: string, actualAmount?: number, withShortfallPayment?: boolean }`. `referenceId` (mandatory) is the bank transaction reference / UTR / UPI ref that the staff member reads from the proof. `actualAmount` (optional) is the amount actually confirmed received; if omitted, it defaults to the payment's expected `amount` (backward-compatible with a full verify). When provided, `actualAmount` must be > 0 — if no money was received, staff should reject the payment (see Reject Payment), not verify it for zero. `withShortfallPayment` (optional, default false) — when true and actualAmount creates an uncovered shortfall, the server auto-creates a balance `payment_pending` record for the remainder in the same call (see Partial Verification below). (Requirements: R1, R2)

R6.2 — Before verifying, the server checks coverage: `sumVerifiedByRegistration(regId) + actualAmount + sumPendingByRegistration(regId) >= registration.total_amount`. If this does not hold — an uncovered shortfall with no `payment_pending` record to absorb it — the behavior depends on `withShortfallPayment`: if false (default), the verify is **rejected (409 Conflict)**; if true, the server auto-creates a balance `payment_pending` record for the shortfall before proceeding with verification (see Partial Verification below). (Requirements: R2, R13.2, R13.3)

R6.2.1 — When the coverage guard (R6.2) passes, verify proceeds:
- Payment status transitions from `pending_verification` to `verified`
- The payment's `amount` column is overwritten to `actualAmount`, so `sumVerifiedByRegistration()` reflects real money received (Requirements: R2.1, R13.6)
- `gateway_ref` is set to the provided `referenceId`
- `verified_by` is set to the staff member's email
- `verified_at` is set to current timestamp
- Audit entry: `action: "payment_verified"`, actor = staff email, changes includes `{ referenceId, expectedAmount, actualAmount }` (Requirement: R14.1)
- Registration status is derived after every payment mutation via `deriveRegistrationStatus()`: if sum of verified amounts >= totalAmount → `confirmed`; if any payment is `pending_verification` → `pending_verification`; otherwise → `pending` (see R1.1). After a partial verify with an outstanding `payment_pending` shortfall, the registration status is `pending` (not `pending_verification` — no payment is awaiting verification).
- **Email sent** to attendee: "Payment confirmed" template — **only when this verify brings the registration to `confirmed`** (see `authentication.spec.md` for email service). Verifying a payment never sends any other email by itself (Requirement: R2.2); a shortfall notification, if any, was already sent when the balance payment record was created (see Partial Verification, below).

R6.3 — The confirmation page for a `pending_verification` registration shows a "Verification in progress" state instead of "PAID". The user sees their proof was received and is being reviewed.

### Partial Verification (Short Payment)

R6.3.1 — When `actualAmount` is less than the payment's expected amount, the client has two options:

**Option A: Compound verify** (single call) — pass `withShortfallPayment: true` in the verify request. The server creates the balance `payment_pending` record for the shortfall, sends the payment-link notification to the registrant, then verifies the original payment — all in one call. The staff dashboard gates this with an explicit prompt: "This will create a ₹X balance payment and notify the registrant. Proceed?" (Requirement: R3.1). The client explicitly opts into shortfall creation via the flag; the server never creates payment records without being asked.

**Option B: Two-step** — call `POST /staff/registrations/:id/balance-payment` to create the shortfall record first, then retry `POST /staff/payments/:id/verify`. Same outcome, two calls.

In both cases:
- **Balance payment** — a new `payment_pending` record is created for the shortfall (`totalAmount - sumVerified - actualAmount - otherOutstanding`), linked to the same registration (Requirement: R3).
- **Notification** — creating the balance payment sends the existing payment-link notification to the registrant, informing them a remaining balance is due (Requirement: R4).
- **Registration status after verify** — `pending`. The derivation rule (R1.1) produces `pending` because: verified sum < totalAmount, no payment is `pending_verification`, and the shortfall is `payment_pending`. Not `pending_verification` — nothing is awaiting verification. Not `confirmed` — the total is not covered.
- **No confirmation email** — the registration is not confirmed, so no confirmation email is sent.
- Staff can re-trigger the balance notification at any time via the existing resend endpoints: `POST /staff/registrations/:id/send-payment-link` (emails the link) or `POST /staff/registrations/:id/generate-payment-link` (returns the link for staff to share). No new endpoint is introduced (Requirement: R5).
- Two payments belonging to different registrations may share the same `gateway_ref` (e.g. a couple's split bank transfer, each verified independently against their own registration) — no structural link between the payments is required or created (Requirement: R6.1 of the requirements doc).

(Requirements: R1–R6.1 in `tasks/2026-07-01-payment-partial-refund.requirements.md`)

### Overpayment (Refund)

R6.3.2 — When `actualAmount` is greater than the payment's expected amount, the payment verifies for the **expected amount only** — the registration proceeds toward confirmation normally per R6.2.1's coverage check. The excess is automatically recorded as a refund owed: a new row is created in a dedicated `refunds` table — `id, registration_id` (FK), `source_payment_id` (FK), `amount, status ('pending'|'completed'), resolved_by, resolved_at, created_at`. No separate staff action creates this record — entering `actualAmount` greater than expected is itself the acknowledgment; the staff UI provides its own confirmation step before the verify call is submitted. (Requirements: R7, R8, R9)

R6.3.3 — Refund resolution is manual only — no payment-gateway or bank API integration. Staff mark a refund `completed` by hand once the money has actually been wired back, recording a bank transfer reference (UTR). Marking a refund completed generates an audit entry: `action: "refund_completed"`, actor = staff email, changes includes the refund amount and bank reference. (Requirements: R10, R10.1)

R6.3.4 — A refund closes only by handing the money back — there is no "apply as credit to another registration" resolution path. If the excess could instead fund another registration, that's ordinary partial verification (see above) against that registration, not a refund. (Requirement: R11)

### Reject Payment

R6.4 — `POST /api/staff/payments/:id/reject` with body `{ comment: string }` (mandatory). The comment explains why the proof was rejected.

R6.5 — On reject (rewind):
- Payment status transitions from `pending_verification` back to `payment_pending`
- Registration status transitions from `pending_verification` back to `pending`
- Audit entry: `action: "proof_rejected"`, actor = staff email, changes includes `comment`
- **Email sent** to attendee: "Payment proof rejected" template with the staff comment and a CTA to re-upload

R6.6 — After rejection, the attendee sees the payment page again with the upload section ready. They can upload a new proof, which restarts the verification cycle.

R6.7 — The reject comment is stored in the audit log only — not in a dedicated column. The rejection email includes the comment text.

---

## Amendment & Recalculation

R7 — When staff amends a registration, the system recalculates pricing and manages payment records. The amendment flow is gated by payment state.

### Amendment Guards

R7.1 — Cost-affecting edits are blocked when any payment record for the registration has `status = 'pending_verification'`. Staff must verify or reject the pending proof first. Rationale: proof uploaded = money moved; don't mutate the financial obligation under an unresolved payment.

R7.2 — Cost-affecting fields: `participationType`, `accommodation.type`, `accommodation.checkIn`, `accommodation.checkOut`, `accommodation.extraBed`, attendees (add/remove/change chargeable attendees), `contributionSplits`, `donation.amount`.

R7.3 — Cosmetic fields (name, email, whatsapp, branch, city, country, gender, tshirtSize, alumniMeal, photo, publicAck, ackDisplayName, felicitation, non-chargeable attendee changes) are always editable regardless of payment state.

### Delta Calculation

R7.4 — On amendment, the server computes the new pricing breakup using `calculateTotal()` from `src/shared/src/pricing.ts` — the same pure function used at initial registration. No duplicate pricing logic. The delta is: `new_total - sum_of_verified_payment_amounts`.

R7.5 — Cost decrease guard: if `new_total < sum_of_verified_payment_amounts`, the edit is rejected with an error. The system cannot reduce the total below money already received. This guard is unaffected by the refund mechanism (see [Manual Verification § Overpayment](#manual-verification)) — refunds resolve genuine overpayment during verification, with no other registration to absorb the excess; they are not triggered by, and do not substitute for, an amendment that would reduce the total below money already received.

R7.6 — Cost decrease when no money has moved (all payments are `payment_pending`) is allowed. The pending payment record's amount is updated to the new total.

### Payment Record Actions

R7.7 — Payment record immutability: records with `status = 'pending_verification'` or `status = 'verified'` are never modified. Only `payment_pending` records can have their `amount` updated.

R7.8 — Invariant: at most one payment record per registration may have `status = 'payment_pending'` at any time.

R7.9 — When delta > 0 and a `payment_pending` record exists: update its `amount` to `delta`.

R7.10 — When delta > 0 and no `payment_pending` record exists (all prior payments verified): create a new payment record with `amount = delta`, `status = 'payment_pending'`.

R7.11 — When delta == 0 and a `payment_pending` record exists: delete the pending record (fully paid, no outstanding obligation).

R7.12 — When delta == 0 and no `payment_pending` record exists: no payment action needed.

### Registration Status After Amendment

R7.13 — Registration status is derived from payment state after amendment:
- If any `payment_pending` record exists → status = `pending`
- If a `pending_verification` record exists → status = `pending_verification`
- If all payments are `verified` and delta == 0 → status = `confirmed`

R7.14 — New status transitions required by amendment flow:
- `confirmed` → `pending` (new payment obligation created by staff edit)
- `pending` → `confirmed` (payment obligation removed — delta becomes 0 after edit deletes pending payment)

Both must be added to `isValidTransition()` in `status.ts`. The `confirmed: []` entry becomes `confirmed: ['pending']`. The `pending` entry adds `'confirmed'`.

R7.15 — Pricing recomputation uses the CURRENT `PRICING_DEFAULTS` config, not the snapshot saved at original registration time. This means: if the committee changes fees between registration and staff edit, the recomputed total reflects current fees. This is intentional — staff edits apply current pricing. The original `pricing_snapshot` is preserved in the audit trail for the `amended` action.

### Email Triggers

R7.16 — When a `payment_pending` record is created (R7.10): send "Additional payment required" email to the attendee with the delta amount, updated pricing breakup, and a payment link.

R7.17 — When a `payment_pending` record's amount is updated (R7.9): send "Revised payment" email to the attendee with the updated amount, pricing breakup, and a payment link.

R7.18 — When a `payment_pending` record is deleted (R7.11): no email. The attendee's obligation is fully settled.

R7.19 — Emails are fire-and-forget (async after DB commit). Failures are logged but do not block the amendment response.

### Attendee-Side Display After Amendment

R7.20 — The BankTransferPage (`/pay/:regCode`) must show the PENDING PAYMENT amount (the delta owed), not `pricingBreakup.total` (the full registration total). For supplementary payments, the attendee owes the delta, not the full amount again. The page must fetch the current `payment_pending` record's amount and display that.

R7.21 — The ConfirmationPage must handle a registration that was `confirmed` and is now `pending` (cycled back due to staff edit). It must show "Additional payment required" instead of "You're confirmed!" when status is `pending` and verified payments exist.

### Audit

R7.22 — Amendment audit entry: `action = 'amended'`, actor = staff email, changes = JSON diff of old vs new field values, snapshot = full registration state after amendment.

R7.23 — If a payment record is created: additional audit entry `action = 'payment_created'` with amount, reason = 'staff_amendment'.

R7.24 — If a payment record amount is updated: additional audit entry `action = 'payment_amended'` with old amount, new amount, reason = 'staff_amendment'.

---

## Audit Trail

R8 — Payment events generate audit log entries.

R8.1 — `action: "payment_created"` — logged when a payment record is created. Includes the amount and payment reason (initial, amendment).

R8.2 — `action: "proof_uploaded"` — logged when payment proof is uploaded. Includes the payment ID and file reference.

R8.3 — `action: "payment_verified"` — logged when committee approves a payment. Includes the verifier identifier.

R8.4 — The `actor` field on payment_verified entries is the committee member's identifier. On payment_created, the actor is "system" for initial creation or the user's email for amendment-triggered payments.

R8.5 — The `payment_verified` audit entry's `changes` field includes `expectedAmount` and `actualAmount` (in addition to `referenceId`) — the delta between the two is the audit trail for a partial or overpaid verification (see R6.2.1, R14.1).

R8.6 — `payment_created` entries for a shortfall balance payment (see [Manual Verification § Partial Verification](#manual-verification)) include `sourcePaymentId` (the payment being partially verified) and `reason: "partial_verification_shortfall"` — distinct from the amendment reason (`"staff_amendment"`, R7.23). This links the shortfall record back to the payment that produced it without a schema-level FK (R14.2).

R8.7 — `action: "refund_completed"` — logged when staff marks a refund as completed. Actor = staff email, changes includes the refund amount and bank transfer reference (see R6.3.3, R10.1).

---

## Payment Journey Progress

R9 — The payment page displays a horizontal progress indicator showing the payment lifecycle stages.

R9.1 — Stages displayed: "Registered" → "Payment" → "We're Verifying" → "You're In!"

R9.2 — Stage visual states:
- **Complete**: checkmark icon, muted styling
- **Active**: highlighted with accent color, bold label
- **Future**: dimmed, circle outline

R9.3 — Active stage is derived from registration and payment status:
- `pending` (payment_pending) → "Payment" is active
- `pending_verification` → "We're Verifying" is active
- `confirmed` → "You're In!" is active

R9.4 — The progress indicator appears at the top of the payment page, above bank details and the proof upload section.

R9.5 — On mobile (< 640px), stages stack vertically with a connecting line. On desktop, stages are horizontal with connecting arrows.

---

## Edge Cases

- **User closes browser before uploading proof:** Payment stays `payment_pending`. When they return (JWT in localStorage), the payment page shows bank details and upload section. No re-creation of the registration occurs (see `submission-api.spec.md` R4).
- **User loses JWT:** In V1, the server sends an email with a link to continue (mock service). Magic link authentication for returning users is planned for V2 (see `authentication.spec.md`).
- **Proof file exceeds size limit:** Server rejects with 400 and field error message. User must resize or use a different file.
- **Multiple proof uploads for same payment:** Only the latest upload is stored. Previous proof file is replaced. All upload events are preserved in audit log.
- **Concurrent verification:** If two committee members verify the same payment simultaneously, the first update wins. The second attempt finds a non-`pending_verification` status and is rejected with a conflict indication.
- **UPI display:** UPI section is shown to all users regardless of country. No country-based filtering applies.
- **Proof rejected by committee:** Payment rewinds to `payment_pending`, registration rewinds to `pending`. Rejection email sent to attendee with staff comment. Attendee re-uploads proof to restart the cycle. All rejection events preserved in audit log.
- **Staff edits while payment_pending:** Pending payment amount is updated. If attendee was on the payment page, the page shows the current pending payment amount dynamically — no stale amount displayed.
- **Staff edits confirmed registration:** If new total > verified total, a supplementary payment record is created and registration cycles back to `pending`. Attendee receives "Additional payment required" email.
- **Staff edits but total unchanged:** No payment action. Cosmetic changes only.
- **Staff attempts cost decrease below verified total:** Server rejects with error. Cannot owe less than money already received.
- **Confirmed registration cycles back to pending:** The attendee's pass/confirmation page must handle this — show "Additional payment required" instead of "You're In!" when registration status is `pending` despite having verified payments.
- **Payment link after amendment:** Payment links generate fresh magic links. The payment page resolves the CURRENT pending payment dynamically, not a baked-in amount.
- **Concurrent staff edits:** Two staff members editing the same registration simultaneously — optimistic locking via `updated_at` check on save. Second save rejected with conflict.
- **Partial verification (short payment):** Staff enters `actualAmount` less than the expected amount. With `withShortfallPayment: true`, the server creates a balance `payment_pending` record and verifies the payment in one call. Without the flag, verify is rejected (409) until the shortfall record is created separately. After verification, registration status is `pending` (not `pending_verification`, not `confirmed`) — awaiting the shortfall payment's own upload-proof → verify cycle.
- **Overpayment:** Staff enters `actualAmount` greater than the expected amount. The payment verifies for the expected amount only; a `refunds` record is created automatically for the excess (status `pending`). The registration confirms normally if this brings sum(verified) to `total_amount`.
- **Second payment cycle after partial verification:** Once a balance payment record exists, the attendee receives the same payment-link notification used for amendment-triggered payments, uploads proof against it, and goes through the full proof-upload → verify cycle again for the remainder.
- **Same `gateway_ref` across registrations:** Two payments belonging to different registrations may share the same bank reference (e.g. one bank transfer split across a couple's separate registrations). Each is verified independently; no schema-level link between them is created or required.

---

## Dependencies

- Parent flow: `submission-flow.spec.md` (submission creates initial payment record)
- API contract: `submission-api.spec.md` (endpoints for upload-proof, bank-details)
- Auth: `authentication.spec.md` (JWT required for proof upload)
- Step 5 UI: `step5-review-pay.spec.md` (bank details display + cost breakdown + proof upload UI)
- Confirmation UI: `confirmation.spec.md` (handles confirmed AND pending_verification states)
- Pricing: `pricing-engine.spec.md` (payment amount comes from pricing calculation)
