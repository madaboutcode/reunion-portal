# Specification: Staff Dashboard UI

## Purpose

The staff registration workflow: attendee and donor list pages with stats, registration detail with verify/reject, and the staff login page.

## Contents

- [Scope](#scope)
- [Navigation](#navigation)
- [Login Page](#login-page)
- [Attendees Page](#attendees-page)
- [Donors Page](#donors-page)
- [Registration Detail](#registration-detail)
- [Verify / Reject Flow](#verify--reject-flow)
- [Refund Management](#refund-management)
- [States](#states)
- [Dependencies](#dependencies)

## Scope

**Covers:** Attendees and Donors list pages (stats + table), registration detail view, payment verification/rejection UI, file viewing, login page.

**Does not cover:** Console shell and navbar (see `staff-console.spec.md`). Resources (see `staff-resources.spec.md`). Reports (see `staff-reports.spec.md`). Team management (see `team-management.spec.md`). API contract (see `staff-api.spec.md`). Auth model (see `authentication.spec.md`).

**Wireframe:** `tmp/staff-console-wireframes.html`

---

## Navigation

R1 — Attendees is the only **navbar link** to the dashboard in staff mode (see `staff-console.spec.md` R5). The Donors view is reached from the Donor Only stat card on the Attendees dashboard, not a separate nav item. There is no in-page Attendee/Donor toggle.

R1.1 — The Attendees nav link goes to `/staff/dashboard?type=attendee`. The Donor Only stat card goes to `/staff/dashboard?type=donor`.

R1.2 — Registration detail (`/staff/registrations/:id`) keeps the navbar visible. The Attendees nav item is active for any `type` value (see `staff-console.spec.md` R6).

R1.3 — "← Back to list" returns to the dashboard preserving the list type (attendee or donor).

R1.4 — A "Login" item in the public site nav leads to the login page. A single "Dashboard" link on public pages enters the Attendees view.

---

## Login Page

R2 — Single-field login for all roles.

R2.1 — One email input + "Send Login Link" button.

R2.2 — On submit, calls `POST /api/auth/magic-link`. Shows success message: "If an account exists, a login link has been sent to your email." regardless of whether the email was found.

R2.3 — After clicking the link in the email, `GET /api/auth/verify` issues a JWT. The client stores it and redirects based on `redirectTo` in the response.

R2.4 — No role picker. Identity resolution happens server-side (see `authentication.spec.md` R8).

---

## Attendees Page

R3 — Page title: **Attendees**. Route: `/staff/dashboard?type=attendee` (default when `type` omitted).

### Stats

R3.1 — Six stat cards at top, scoped to `type=attendee`:

| Card | Value | Style |
|------|-------|-------|
| Needs Verification | Count of `pending_verification` | **Primary CTA** — terracotta background, white text. Clickable — filters list. Pulsing indicator when count > 0. |
| Pending Payment | Count of `pending` | Amber accent |
| Confirmed | Count of `confirmed` | Green accent |
| Total | Count of all | Neutral |
| Donor Only | Count of `donation_only` registrations | Terracotta accent. **Clickable — opens the Donors view at `/staff/dashboard?type=donor`.** This is the entry point to the Donors page (see `staff-console.spec.md` R5.6). |
| Money Collected | Sum of verified payments (₹) | Green accent |

R3.2 — The "Needs Verification" card is the loudest element. Primary workflow for staff.

R3.3 — Clicking any stat card applies the corresponding status filter to the list below.

R3.4 — [SPIKE] Mobile layout: Needs Verification full-width hero row; remaining four in 2×2 grid.

### Toolbar

R3.5 — Toolbar row under page title:
- **Search input**: placeholder "Search name, email, reg code, phone..."
- **Status filter pills**: All | Needs Verification (count badge) | Pending | Confirmed
- **Branch dropdown**: All branches + individual options
- **Export CSV**: right-aligned, secondary style

### Table

R3.6 — Table columns:

| Column | Content |
|--------|---------|
| Reg Code + `#id` | Monospace terracotta reg code + internal `#id` for debugging |
| Name | Full name |
| Branch | Short code (CS, EC, etc.) |
| Type | Participation pill (full celebration, campus only, etc.) |
| Status | Color-coded badge |
| Amount | ₹ formatted |
| Registered | Relative date |

R3.7 — Status badge colors: confirmed = green, pending_verification = blue, pending = amber.

R3.8 — Rows are clickable → `/staff/registrations/:id`.

R3.9 — Pagination at bottom. Default 50 per page.

---

## Donors Page

R4 — Page title: **Donors**. Route: `/staff/dashboard?type=donor`.

R4.1 — Same 5 stat cards (excluding the Donor Only card, which is attendees-only), toolbar, and interactions as Attendees (R3), scoped to `type=donor`.

R4.2 — Table columns: same as Attendees (R3.6) **except no Type column** — donor context is implicit from the page title and URL (`?type=donor`).

R4.3 — No Proof column on either view — status conveys queue state; multiple proofs per registration make a single indicator misleading.

---

## Registration Detail

R5 — Full registration view at `/staff/registrations/:id`.

R5.1 — Sub-page header (replaces page title): ← Back to list · Reg code chip (mono, terracotta) · Full name · Status badge · Participation pill.

R5.2 — **Verify/Reject action bar** (only when a payment has `pending_verification` status):
- Banner: "Payment proof uploaded — review and verify"
- Inline proof preview (readable bank transfer screenshot)
- Reference ID input: "Bank reference / UTR number" (required for verify)
- Verification type radio group (see `tasks/2026-07-01-payment-partial-refund.requirements.md` R1, R7):
  - **Full payment** (default, pre-selected): "The full ₹{amount} was received" — no additional fields
  - **Short payment**: "Less than ₹{amount} was received" — reveals "Amount actually received (₹)" input. Below input: amber message explaining that a balance payment will be created and the registrant notified.
  - **Overpayment**: "More than ₹{amount} was received" — reveals "Amount actually received (₹)" input. Below input: blue message explaining the payment will be verified for ₹{expected} and a refund recorded for the excess.
- Verify button label changes per selection: "Verify Payment" (full) / "Verify & Create Balance" (short) / "Verify & Record Refund" (overpayment)
- [Reject] (red outline) — always visible
- Reject reveals inline comment textarea (min 10 characters)

R5.3 — **Upload on behalf bar** (only when latest payment is `payment_pending` and no `pending_verification` payment exists):
- File upload for proof received outside the portal (e.g. WhatsApp)
- Mutually exclusive with verify/reject bar

R5.4 — Action bars are full-width above the detail columns. Staff should not hunt for actions inside cards.

R5.5 — Two columns below action bars:

**Left column:**
- Contact: name, branch, email, whatsapp, city, country, registered date
- Attendance: intent, meal preference, t-shirt size
- Attendees: table (name, type, meal) — hidden if none
- Accommodation: type, check-in/out, extra bed — hidden if none

**Right column:**
- Documents: uploaded files + entry pass PDF link when confirmed
- Payments: table of all payment records for this registration (date, amount, status, reference, proof view link) — includes both `verified` amounts and any outstanding `payment_pending` amount (see `tasks/2026-07-01-payment-partial-refund.requirements.md` R13.3)
- Refunds: shown only when refund records exist for this registration — amount, status (pending/completed), source payment reference (see Refund Management R7.2)
- **Create Balance Payment** button: visible when the registration has no `payment_pending` record and `sum(verified payments) < total_amount`. Opens the shortfall-creation flow (requirements R3) — staff confirms the balance amount, a new `payment_pending` record is created and the registrant is notified (requirements R4)
- Payment Breakdown: pricing line items + total
- Audit Trail: action, actor, timestamp

R5.6 — File viewing opens via authenticated file proxy (blob URL). View only, no download requirement.

R5.7 — On mobile (< 900px), columns stack vertically. Action bars stay at top.

---

## Verify / Reject Flow

R6 — Verify and reject interactions.

### Verify
R6.1 — Staff enters UTR/reference ID and selects a verification type via radio group (see R5.2). "Full payment" is pre-selected. Selecting "Short payment" or "Overpayment" reveals an amount input field.
R6.2 — Clicks the verify button → confirmation dialog text and button label depend on the selected verification type:
- **Full payment**: "Verify payment of ₹{amount} with reference {referenceId}?" / Button: "Verify"
- **Short payment**: "Verify ₹{actualAmount} of ₹{amount} expected. This will: verify the payment for ₹{actualAmount}, create a ₹{shortfall} balance payment, notify the registrant via email." / Button: "Verify & Create Balance" — this is the explicit acknowledgment gate for the downstream notification (requirements R3.1).
- **Overpayment**: "₹{actualAmount} received against ₹{amount} expected. This will: verify the payment for ₹{amount}, record a ₹{excess} refund." / Button: "Verify & Record Refund"

R6.3 — On confirm, behavior branches the same way:
- **Exact match**: `POST /api/staff/payments/:id/verify` → if this brings the registration's verified total to `total_amount`, toast "Payment verified. Registration confirmed." (today's behavior).
- **Partial**: composes two service operations per requirements R13.4 — create the shortfall `payment_pending` record (sends the payment-link notification per requirements R4), then verify the original payment for `actualAmount` → toast "Payment verified for ₹{actualAmount}. Balance payment of ₹{shortfall} created — notification sent to registrant."
- **Overpayment**: `POST /api/staff/payments/:id/verify` with `actualAmount` — payment verifies for the expected amount and the excess is recorded as a `refunds` row (see Refund Management, R7) → toast "Payment verified. Refund of ₹{excess} recorded."

In all cases: status updates inline, action bar disappears.

### Reject
R6.4 — Staff clicks "Reject" → comment textarea appears inline.
R6.5 — Staff enters reason (mandatory, min 10 characters) → "Confirm Rejection".
R6.6 — On confirm → `POST /api/staff/payments/:id/reject` → toast "Proof rejected. Alumni notified." → status reverts, action bar disappears.
R6.7 — Re-clicking "Reject" before confirming cancels and hides the textarea.

---

## Refund Management

R7 — Staff can view and resolve refunds created by overpayment verification (see Verify / Reject Flow R6.2, R6.3).

R7.1 — A refunds list view shows all refund records, filterable by status: **Pending** | **Completed** | **All**.

R7.2 — Refund list columns: registrant name, registration code, refund amount (₹), status (color-coded badge — pending = amber, completed = green), source payment reference (the reference ID/UTR of the payment that produced the excess).

R7.3 — Staff mark a refund **Completed** by entering the bank transfer reference/UTR used to send the money back. No amount field — the refund amount is fixed at creation (see `tasks/2026-07-01-payment-partial-refund.requirements.md` R9).

R7.4 — Marking a refund Completed is manual only — no payment-gateway or bank API call is triggered (requirements R10, R16).

R7.5 — Marking a refund Completed writes an audit entry (`action = 'refund_completed'`), visible in the source registration's Audit Trail (see R5.5) (requirements R10.1).

---

## States

| State | What staff sees |
|-------|-----------------|
| Fresh login, pending verifications exist | Stats with "Needs Verification" pulsing, list pre-filtered to `pending_verification` |
| Fresh login, nothing to verify | Stats show 0 pending verification, list shows all |
| After verifying a payment | Return to list, count decrements, row moves to confirmed |
| After rejecting a proof | Return to list, count decrements, row moves to pending |
| Search with no results | "No registrations match your filters." |

---

## Dependencies

- Shell: `staff-console.spec.md`
- API: `staff-api.spec.md`
- Auth: `authentication.spec.md`
- Payment flow: `payment-flow.spec.md`
- Wireframe: `tmp/staff-console-wireframes.html`