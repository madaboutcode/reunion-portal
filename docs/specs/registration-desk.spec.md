# Specification: Registration Desk Workflow

## Purpose

Provides external registration staff with a privacy-minimized workflow for looking up attendees, recording arrival, and creating basic spot registrations.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)
- Child interface: [`interfaces/registration-desk-api.ispec.md`](interfaces/registration-desk-api.ispec.md)
- Child interface: [`interfaces/attendance-feed.ispec.md`](interfaces/attendance-feed.ispec.md)

## Scope

**Covers:** Desk authentication scope, QR and name lookup, minimal attendee overview, check-in, spot registration, payment-state visibility, and photo capture.

**Does not cover:** Full registration administration, online payment-proof review (approving or rejecting an uploaded proof), payment gateway processing, refunds, accommodation allocation, t-shirt collection or fulfilment, or public attendee presentation. Those remain in the existing staff and public specs. The desk now collects and settles the full outstanding balance in person and can add an ad-hoc charge — see [Payment Collection](#payment-collection) (R6) and [Additional Charge](#additional-charge) (R7). It still does not review uploaded proofs, touch a payment gateway, or process refunds. (The overview does show existing t-shirt rows read-only — see R3.4.) The separate staff-dashboard donation-only registration endpoint (`POST /api/staff/registrations`, `dashboard` scope) is a different feature and out of scope for this spec — it is unaffected by this spec's email requirement (R5.7).

## Requirements

### Access and Data Minimization

R1 — Desk users authenticate as `staff` users with the dedicated `registration_desk` scope. The existing `dashboard` scope is not required.

  Scenario: Given a staff user with `registration_desk` but not `dashboard`, when they open the desk workflow, then the desk API is available and the full staff registration API returns `403`.

R1.1 — Desk API responses use explicit allowlists. They MUST NOT return donation details, payment history, payment proofs, bank references, email, city, country, ID documents, audit entries, raw pricing snapshots, or internal notes.

  Scenario: Given a desk lookup response, when its fields are inspected, then none of the prohibited private fields appears.

R1.2 — The attendee overview returns the primary registrant's WhatsApp number as a helpdesk contact channel (see R3.6). This is a deliberate, narrowly-scoped exception to data minimization, added so desk staff can reach an arriving attendee. No other contact field is exposed — email, postal address, city, and country remain prohibited, and companions (spouse, children, guests) carry no contact field.

  Scenario: Given a desk lookup response, when its fields are inspected, then the primary WhatsApp number appears and no email, address, city, or country appears.

### Lookup

R2 — Desk users can enter an attendee through either a QR payload or a name search.

  Scenario: Given a valid pass QR payload, when the desk scans it, then the attendee overview opens for that registration.

R2.1 — QR lookup accepts the existing registration pass code. It requires desk authentication even though pass retrieval is available to attendees.

  Scenario: Given a valid pass code and no desk JWT, when the lookup request is sent, then the API returns `401` and no attendee data.

R2.2 — Name search accepts a free-text query and returns a short result list containing only the attendee ID, registration code, full name, branch, participation type, and check-in state.

  Scenario: Given two registrations matching `Ravi`, when the search is submitted, then both results contain only the documented short-list fields.

R2.3 — Search results are limited to 20 items and ordered by closest name match, then full name. Empty or whitespace-only queries return `422`.

  Scenario: Given a whitespace-only query, when search is requested, then the API returns `422` with a validation error and performs no broad listing.

R2.4 — Unknown QR payloads return `404 { "error": "Attendee not found" }`. Name searches with no match return an empty result list.

  Scenario: Given an unknown pass code, when lookup is requested, then the API returns `404` without revealing whether a related registration once existed.

R2.5 — Each search result carries a photo-availability flag, and the search response carries the public thumbnail base URL and photo version. The desk shows each result's photo from the public attendee thumbnail (the same public CDN thumbnail used by the public Who's Coming page), not the authenticated desk photo endpoint. This avoids one authenticated blob fetch per result. A result without a photo shows a neutral placeholder and exposes no private storage key.

  Scenario: Given a search returning three attendees where two have photos, when the results render, then the two show a photo from the public thumbnail URL and the third shows a placeholder, and no private storage key appears.

### Attendee Overview

R3 — Selecting a search result or scanning a QR code opens a streamlined overview containing:

- Full name
- Registration code
- Branch
- Participation type (`full_celebration` or `campus_only`)
- Prominent profile photo
- Primary registrant WhatsApp number (helpdesk contact — see R3.6)
- Meal preference
- Accommodation type, or `null` when none is recorded
- Check-in/check-out dates, or `null` when none is recorded
- Assigned physical room number(s), or empty when none is allocated (see R3.7)
- Spouse, child, and guest counts
- Names of spouse, children, and guests
- T-shirt rows (size, gender, included flag) — display only, see R3.4
- Payment state; amount due is shown only when payment is still pending
- Current check-in state

  Scenario: Given a registered full-celebration attendee with a photo, spouse, and pending balance, when the overview loads, then the desk sees the photo, event type, group details, and balance due but no payment history or donation information.

R3.1 — `payment.state` is either `payment_pending` or `confirmed`. Registrations in `pending_verification` are presented as `payment_pending` until staff verification completes. `amountDue` is returned only for `payment_pending` and is calculated server-side.

  Scenario: Given a pending-verification registration, when the overview loads, then the desk sees `payment_pending` and the amount due, not payment-proof details.

R3.2 — Donation-only registrations do not appear in desk attendee lookup and cannot be checked in.

  Scenario: Given a donation-only registration with a matching name, when desk search is requested, then the result is not returned.

R3.3 — A missing profile photo shows a neutral placeholder and does not expose the private storage key.

  Scenario: Given an attendee whose photo upload has not completed, when the overview loads, then it shows a placeholder photo state and no private storage key.

R3.4 — The overview shows every t-shirt row recorded for the registration (the free included shirt and any additional shirts), each with size, gender, and whether it is the included shirt. Included shirts are listed first. This is read-only display — it does not add t-shirt collection, sizing, or fulfilment to the desk workflow, and it never exposes an amount, price, or charge from `additional_charges`. Spot registration continues to reject t-shirt input entirely (R5.1).

  Scenario: Given a registration with an included size-L shirt and one additional size-M shirt, when the overview loads, then the desk sees both rows, included shirt first, with no amount or charge field.

  Scenario: Given a registration with no t-shirt rows, when the overview loads, then the desk sees an empty t-shirt list.

R3.6 — The overview returns the primary registrant's WhatsApp number as a plain string. The desk UI presents it as a tappable WhatsApp contact link so staff can message an arriving attendee. No email is returned. The number is not validated or reformatted by the desk API; it is the stored registration value.

  Scenario: Given a registration whose stored WhatsApp is `+919876543210`, when the overview loads, then the desk sees that number rendered as a WhatsApp contact link and no email.

R3.7 — The overview returns the distinct physical room numbers assigned to the registration across its nights, sorted ascending, as a list. Rooms are allocated ahead of the event by the separate allocation workflow; the desk displays them read-only and never allocates or edits rooms. When no room is assigned the list is empty. When different rooms are assigned on different nights, all distinct room numbers are listed (no per-night breakdown at the desk).

  Scenario: Given a registration assigned room `12` on all nights, when the overview loads, then the desk sees room `12`.

  Scenario: Given a registration with no room assignment, when the overview loads, then the desk sees no room (empty list).

  Scenario: Given a registration assigned room `12` one night and room `14` the next, when the overview loads, then the desk sees both `12` and `14`.

### Check-In

R4 — The desk user can mark an attendee as present with one explicit action.

  Scenario: Given an attendee who is not present, when the desk user taps `Mark Present`, then the API records the check-in and the overview changes to `Present`.

R4.1 — Check-in is idempotent. A repeated scan or repeated submission for an already-present attendee returns the existing check-in state and does not create a second check-in.

  Scenario: Given an attendee already checked in at 10:05, when the desk submits `Mark Present` again, then the response still reports 10:05 and the recorded check-in count remains one.

R4.2 — A successful check-in records the registration ID, timestamp, and authenticated staff actor. It also writes a system audit action `attendee_checked_in`.

  Scenario: Given staff user A checks in registration 1001, when the request succeeds, then the check-in record identifies registration 1001, user A, and the server timestamp.

R4.3 — Check-in is allowed only for `full_celebration` and `campus_only` registrations. On the absent→present transition, check-in is rejected with `409`, code `payment_required`, when the registration has an outstanding balance (`total_amount` minus the sum of verified payments) greater than zero — this reverses the earlier rule that a pending-payment attendee could still be checked in. The gate runs only on that transition: a repeat check-in on an already-present registration always replays the idempotent success, and a charge added after check-in (see R7) neither re-triggers the gate nor undoes the check-in. Outside the gate, check-in itself never verifies, rejects, or modifies a payment — it only reads the verified-payment sum.

  Scenario: Given a pending-payment attendee owing ₹2,500, when the desk checks them in, then the API returns `409` with code `payment_required` and the attendee remains not present. Given the desk then settles the ₹2,500 (see R6) and checks in again, then check-in succeeds.

R4.4 — The desk UI shows a warning for pending payment before check-in and provides the amount due, with an action to settle the balance in person (R6) or add a charge (R7) directly from the overview. It still does not expose uploaded payment proofs or the online proof review/reject workflow — those remain staff-dashboard-only.

  Scenario: Given a pending-payment attendee owing ₹2,500, when the overview loads, then the UI shows the pending-payment warning, ₹2,500 due, and a settle-payment action; no proof file or gateway reference is shown.

R4.5 — The desk user can undo a check-in with one explicit action. The undo clears `checked_in_at` and `checked_in_by`, and writes a separate `attendee_check_in_undone` audit row (distinct from `attendee_checked_in`). The undo is idempotent in both directions: a repeat undo, or an undo on a never-checked-in registration, returns the cleared state and writes no second audit row.

  Scenario: Given an attendee checked in at 10:05, when the desk taps `Undo attendance`, then the response returns `present: false`, the attendee record's check-in fields are cleared, and the audit log gains exactly one `attendee_check_in_undone` row.

  Scenario: Given an attendee who is already not present, when the desk taps `Undo attendance`, then the response returns `present: false` and no audit row is written.

### Spot Registration

R5 — Desk users can create a new attendee registration with only the following fields:

**Required:**

- `fullName`
- `whatsapp`
- `email`, a syntactically valid address (see R5.7)
- `branch`
- `participationType` (`full_celebration` or `campus_only`)
- `alumniMeal` (`veg` or `non_veg`)
- `photoFileKey`, produced by the existing photo upload flow

**Optional:**

- `donationAmount`
- `spouse` with name and meal preference
- `children` with name, age, and meal preference
- `guests` with name and meal preference

  Scenario: Given the required fields, including a valid email, and a successful photo upload, when the desk submits a spot registration, then a new attendee registration and pending payment are created.

R5.1 — Spot registration does not accept or capture accommodation, check-in dates, check-out dates, t-shirt sizes, ID documents, donation causes, public acknowledgement, felicitation, or free-form internal notes.

  Scenario: Given a spot-registration request containing accommodation or t-shirt fields, when the request is submitted, then those fields are rejected rather than silently stored.

R5.2 — `donationAmount`, when present, is a positive amount and is stored server-side. It is not returned in desk lookup or overview responses.

  Scenario: Given a spot registration with a ₹1,000 donation, when creation succeeds, then the donation is stored but the desk response contains no donation field.

R5.3 — The server computes pricing and payment state. The client cannot set `totalAmount`, `paymentStatus`, pricing lines, or payment records.

  Scenario: Given a client request attempting to set `totalAmount`, when creation is submitted, then the request is rejected or the field is ignored and pricing is calculated from the allowed fields.

R5.4 — Spot registration uses the existing photo upload approach: JPG or PNG, maximum 5 MB, immediate upload, server-returned file reference, and server-side thumbnail generation/linking.

  Scenario: Given a valid JPG selected on a mobile device, when the upload completes, then its returned file reference can be used to create the spot registration.

R5.5 — On successful creation, the response contains the new registration ID, registration code, payment state, amount due when pending, check-in state, and a pass/QR reference. It does not contain the full registration response.

  Scenario: Given a successful spot registration with unpaid fees, when creation returns, then the desk receives the code, pass reference, `payment_pending`, and server-calculated amount due.

R5.6 — Spot registration does not verify payment or mark the attendee present automatically. Check-in is a separate explicit action.

  Scenario: Given a new spot registration, when creation succeeds, then its check-in state is `not_present` until the desk submits the check-in action.

R5.7 — `email` is required and must be a syntactically valid address. A request omitting `email`, or sending a blank or malformed one, is rejected with `422` rather than stored under a placeholder address. Spot registration does not generate or apply a fallback email address when none is given.

  Scenario: Given a spot-registration request with no `email` field, when creation is requested, then the API returns `422` for `email` and creates no registration.

### Payment Collection

R6 — From the attendee overview, the desk user can settle the full outstanding balance in person with one explicit action, choosing a collection method of `cash`, `upi`, or `bank_transfer`, and an optional note (≤500 characters).

  Scenario: Given an attendee owing ₹2,500, when the desk submits payment collection with method `cash`, then the outstanding balance becomes ₹0 and the overview shows `payment.state: "confirmed"`.

R6.1 — Settlement is full-balance only: outstanding is `total_amount` minus the sum of verified payments. There is no partial-amount field — the desk cannot collect less than the full balance in one action.

  Scenario: Given an attendee owing ₹2,500, when the desk submits payment collection, then the entire ₹2,500 is settled in one action; the request has no amount field to specify a lesser sum.

R6.2 — Settlement applies whether the registration's pending payment is `payment_pending` or `pending_verification` (an online proof already uploaded and awaiting review). The desk settlement supersedes the online proof: the pending payment is marked `verified`, and its online-only columns (proof file reference, gateway reference, gateway response) are cleared, so the row never looks like both an in-person collection and an online bank transfer.

  Scenario: Given a registration with a `pending_verification` payment carrying an uploaded proof, when the desk settles it in person, then the payment becomes `verified` with the desk's method and note recorded, and its proof/gateway fields are cleared.

R6.3 — On settlement, the registration status is re-derived from its payments — the same derivation the online verify flow uses — and becomes `confirmed`. The desk overview immediately reflects `payment.state: "confirmed"` with no amount due.

  Scenario: Given a freshly settled attendee, when the overview reloads, then `payment.state` is `confirmed` and no `amountDue` field is present.

R6.4 — On settlement, the same payment-confirmed email the online verify flow sends is sent to the attendee. Where the online flow shows the gateway reference for the verified payment, the desk email shows the collection method (`cash`, `upi`, or `bank_transfer`) in its place. Email failure is logged and never fails or undoes the settlement.

  Scenario: Given a desk settlement, when it completes, then the attendee receives the standard payment-confirmed email; a delivery failure does not reverse the settlement.

R6.5 — Settlement writes a `desk_payment_collected` row to the registration's audit log — the same audit log dashboard payment actions use, distinct from the desk's separate operator-action audit log (present/absent/spot-create) — recording the amount, method, and note when given.

  Scenario: Given a desk settlement, when it completes, then the registration's audit log gains one `desk_payment_collected` entry with the amount and method.

R6.6 — A settlement request on a registration with no outstanding balance (already fully paid) is rejected with `409`. No payment row is modified.

  Scenario: Given an attendee whose balance is already fully paid, when the desk submits payment collection again, then the API returns `409` and no payment record changes.

### Additional Charge

R7 — From the attendee overview, the desk user can add an ad-hoc charge — a free-text description and a positive whole-rupee amount — to a registration.

  Scenario: Given an attendee with a confirmed registration, when the desk adds a ₹500 charge described as "extra meal", then the registration's total rises by ₹500 and a new pending payment for ₹500 is created.

R7.1 — Additional charge reuses the same charge pipeline as the staff dashboard's edit-page charge flow: it recomputes `total_amount` and creates or grows the single pending payment for the full delta, matching the dashboard behavior exactly.

  Scenario: Given an attendee already owing ₹1,000, when the desk adds a ₹500 charge, then the single pending payment becomes ₹1,500 rather than a second payment row being created.

R7.2 — A missing or blank description, or a non-positive or non-integer amount, returns `422` with field-specific errors. No charge is created.

  Scenario: Given a charge request with a negative amount, when submitted, then the API returns `422` and the registration total is unchanged.

R7.3 — A charge on a registration whose pending payment is `pending_verification` (an online proof mid-review) is rejected with `409`, code `payment_under_verification`. The desk cannot add a charge while a proof is awaiting staff review.

  Scenario: Given a registration with a payment under verification, when the desk attempts to add a charge, then the API returns `409` with code `payment_under_verification` and no charge is created.

R7.4 — A successful charge sends the same additional-payment or revised-payment email the staff edit page sends for a cost-affecting save: the additional-payment email when the charge creates a fresh pending payment, the revised-payment email when it grows an existing one. Email failure is logged and never fails the charge.

  Scenario: Given a charge that creates a new pending payment, when it completes, then the attendee receives the additional-payment email; a delivery failure does not undo the charge.

R7.5 — Adding a charge is recorded under the existing dashboard charge audit action (`charge_added`) — there is no separate desk-specific audit action for charges, unlike payment collection's dedicated `desk_payment_collected` (R6.5). Adding a charge does not check the attendee in, and does not by itself change an already-present attendee's check-in state (see R4.3).

  Scenario: Given an already-checked-in attendee, when the desk adds a charge that creates a new outstanding balance, then the attendee remains checked in and the registration's audit log gains a `charge_added` entry.

## States

- Desk unauthenticated
- Desk authenticated without `registration_desk` scope
- Search empty
- Search results
- QR lookup loading
- Attendee found and not present
- Attendee found and already present
- Attendee has pending payment
- Attendee has confirmed payment
- Attendee photo missing
- Spot registration photo uploading
- Spot registration validation error
- Spot registration created
- Network or server error

## Data Flow

- Desk client sends a QR code or search query to the desk API.
- Desk API reads only the fields needed for the desk response.
- Desk API writes check-in state through a dedicated check-in operation.
- Spot registration client uploads a photo through the existing photo upload contract, then sends the returned file reference with the narrow registration request.
- Server pricing, payment creation, registration-code generation, photo linking, and audit records remain server-owned.

## Edge Cases

- A repeated QR scan must not duplicate a check-in.
- A pending-payment attendee is blocked from the absent→present check-in transition until the outstanding balance is settled (R4.3); the desk settles it in person from the overview (R6), then completes the check-in. An already-present attendee is never re-gated by a later charge.
- A desk settlement supersedes an online proof already uploaded for the same payment — the proof and gateway references are cleared, not preserved alongside the desk record (R6.2).
- A donation-only record must never appear in attendee desk lookup.
- A failed photo upload prevents spot-registration submission.
- A duplicate WhatsApp or email match must show a possible existing registration before creating a new one.
- A concurrent spot-registration submission must not create two records from the same confirmed submission.
- Desk API errors must not include SQL errors, storage keys, payment proof details, or full registration payloads.

## Dependencies

- (see `access-control.spec.md` R2) — `registration_desk` scope definition
- (see `access-control.spec.md` R6) — registration-desk route matrix
- (see `authentication.spec.md` R4) — staff JWT behavior
- (see `authentication.spec.md` R7) — magic-link authentication
- (see `photo-id.spec.md` R3) — existing photo upload constraints and file reference behavior
- (see `staff-api.spec.md` R7) — existing full staff API, which this workflow must not reuse for payloads
- (see `interfaces/registration-desk-api.ispec.md` R2) — exact HTTP contract
- (see `interfaces/registration-desk-api.ispec.md` R5) — spot-registration HTTP contract
- (see `interfaces/registration-desk-api.ispec.md` R7) — payment collection HTTP contract
- (see `interfaces/registration-desk-api.ispec.md` R8) — additional charge HTTP contract
- (see `staff-api.spec.md` R8) — online verify flow and its payment-confirmed email, reused by desk settlement (R6.4)
- (see `staff-api.spec.md` R18) — dashboard edit-page charge pipeline, reused by desk additional charge (R7.1)
- (see `staff-operations.spec.md` R12) — audit action registry
- (see `interfaces/attendance-feed.ispec.md` R1) — checked-in status contract
- (see `interfaces/attendance-feed.ispec.md` R2) — live-feed contract
