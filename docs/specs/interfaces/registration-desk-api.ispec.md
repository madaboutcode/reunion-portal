# Interface Specification: Registration Desk API

## Purpose

Defines the authenticated, privacy-minimized HTTP API used by external registration desk staff.

## Contents

- [Scope](#scope)
- [Authentication](#authentication)
- [Endpoints](#endpoints)
- [Shared Error Contract](#shared-error-contract)
- [Dependencies](#dependencies)

## Scope

**Covers:** Authentication, narrow lookup responses, check-in mutation, in-person payment collection, additional-charge creation, spot-registration creation, photo references, and errors.

**Does not cover:** Full staff dashboard responses, online payment-proof review/upload, payment gateway processing, refunds, or public Who's Coming data.

## Authentication

R1 — Every endpoint requires a valid staff or admin JWT and the `registration_desk` scope. Missing or invalid JWT returns `401`. A staff user without the scope returns `403 { "error": "Insufficient permissions" }`. Admins pass through the existing admin scope bypass.

  Scenario: Given a valid staff JWT without `registration_desk`, when `GET /api/staff/desk/search` is requested, then the API returns `403` and no registration query runs.

R1.1 — The API does not accept attendee JWTs.

  Scenario: Given a valid attendee JWT, when the desk lookup endpoint is requested, then the API returns `403`.

## Endpoints

### `GET /api/staff/desk/search?q=<text>`

R2 — Returns at most 20 eligible attendee matches. The query is trimmed, must contain at least one non-whitespace character, and searches full name and registration code. Results contain:

```json
{
  "results": [
    {
      "id": 1001,
      "fullName": "Ravi Kumar",
      "branch": "CS",
      "regCode": "SMRT...",
      "participationType": "full_celebration",
      "hasPhoto": true,
      "checkIn": { "present": false, "checkedInAt": null }
    }
  ],
  "thumbsBaseUrl": "/api/public/photos",
  "photosVersion": 1780000000000
}
```

`hasPhoto` is true when the registration has a stored profile thumbnail. `thumbsBaseUrl` and `photosVersion` mirror the public Who's Coming contract: the client builds each result's public thumbnail as `${thumbsBaseUrl}/${id}.jpg?v=${photosVersion}` (see `publicPhotoUrl`). `thumbsBaseUrl` comes from `PUBLIC_THUMBS_URL` (default `/api/public/photos`); `photosVersion` is the maximum `updated_at` across the returned registrations. These use the public thumbnail, not the authenticated desk photo endpoint, so the search list needs no per-result authenticated fetch. No private storage key is ever returned.

  Scenario: Given a matching attendee, when the name query is requested, then the result includes only the documented search fields (including `hasPhoto`) and the response includes `thumbsBaseUrl` and `photosVersion`.

R2.1 — Empty query returns `422 { "error": "Search query is required" }`.

  Scenario: Given `q=`, when search is requested, then the API returns `422`.

R2.3 — Search returns at most 20 results, ordered by closest full-name match, then full name alphabetically. Registration-code matches are included in the same limit.

  Scenario: Given 21 matching registrations, when search is requested, then the response contains 20 results with the closest full-name matches first.

R2.2 — No match returns `200 { "results": [] }`. This differs from QR lookup, which returns `404` for an unknown code.

  Scenario: Given no matching name, when search is requested, then the API returns an empty result list.

### `GET /api/staff/desk/lookup?code=<regCode>`

R3 — Resolves the existing pass registration code and returns the narrow attendee overview. A registration with status `pending_verification` is returned with `payment.state: "payment_pending"` until its payment is verified.

```json
{
  "attendee": {
    "id": 1001,
    "fullName": "Ravi Kumar",
    "regCode": "SMRT...",
    "branch": "CS",
    "participationType": "full_celebration",
    "photo": { "available": true, "url": "/api/staff/desk/registrations/1001/photo" },
    "whatsapp": "+919876543210",
    "mealPreference": "veg",
    "accommodation": {
      "type": "shared_double",
      "checkIn": "2026-08-14",
      "checkOut": "2026-08-16"
    },
    "rooms": ["12"],
    "additionalAttendees": {
      "spouse": [{ "name": "Priya Kumar", "mealPreference": "veg" }],
      "children": [{ "name": "Asha Kumar", "age": 8, "mealPreference": "veg" }],
      "guests": [{ "name": "Maya Nair", "mealPreference": "non_veg" }]
    },
    "payment": { "state": "confirmed" },
    "checkIn": { "present": false, "checkedInAt": null },
    "tshirts": [
      { "size": "L", "gender": "male", "isIncluded": true },
      { "size": "M", "gender": "female", "isIncluded": false }
    ]
  }
}
```

For pending payment, `payment` is `{ "state": "payment_pending", "amountDue": 2500 }`. No other payment fields are allowed.

  Scenario: Given a pending-verification attendee, when lookup succeeds, then the response contains `payment.state: "payment_pending"` and the amount due.

R3.5 — `tshirts` lists every row from the `tshirts` table for the registration (the included shirt and any additional shirts), ordered included-first (`isIncluded: true` before `false`) then by row id. Each entry carries only `size`, `gender` (nullable), and `isIncluded`. This is display-only — it never includes a field from `additional_charges` (no amount, price, or charge), and it does not make t-shirts a spot-registration input (see R5.1). An empty array is returned when the registration has no t-shirt rows.

  Scenario: Given a registration with one included shirt and one additional shirt, when lookup succeeds, then `tshirts` lists the included shirt first and neither entry carries an amount or charge field.

  Scenario: Given a registration with no t-shirt rows, when lookup succeeds, then `tshirts` is `[]`.

R3.6 — `whatsapp` is the primary registrant's stored WhatsApp number, returned as a string. It is the only contact field exposed — `email` is never returned in the overview. The value is passed through unmodified (no validation or reformatting). Companions carry no contact field.

  Scenario: Given a registration with WhatsApp `+919876543210`, when lookup succeeds, then `whatsapp` equals that string and no `email` field appears.

R3.7 — `rooms` is an array of the distinct physical room numbers assigned to the registration across its overnight nights, sorted ascending (string sort). It is `[]` when no room is assigned. It never includes room ids, notes, occupancy, or per-night structure — only the display room numbers. The desk is read-only over rooms; allocation happens in the separate allocation API.

  Scenario: Given a registration assigned room `12` on two nights, when lookup succeeds, then `rooms` is `["12"]`.

  Scenario: Given a registration with rooms `14` and `12` across nights, when lookup succeeds, then `rooms` is `["12","14"]`.

  Scenario: Given a registration with no assignment, when lookup succeeds, then `rooms` is `[]`.

R3.1 — Donation-only registrations return `404 { "error": "Attendee not found" }`.

  Scenario: Given a donation-only registration code, when lookup is requested, then the record is treated as ineligible.

R3.2 — An unknown or malformed code returns `404 { "error": "Attendee not found" }`.

  Scenario: Given a malformed code, when lookup is requested, then the API returns `404` without a database or file-storage existence leak.

### `GET /api/staff/desk/registrations/:id/photo`

R3.3 — Returns the attendee's profile photo as image data for a desk user with `registration_desk`. The endpoint never returns the underlying private storage key and never returns the original photo bytes. If no photo is available, the overview uses `{ "available": false, "url": null }` and the photo endpoint returns `404 { "error": "Photo not found" }`.

The optional `size` query is allowlisted to `200`, `560`, or `960`; any other value (including an empty value) returns `422 { "error": "Invalid photo size" }` before any storage access — an invalid size never selects arbitrary storage. `size=200` (and omitting `size` entirely) serves the existing 200×200 private thumbnail with its stored content type. `size=560` and `size=960` read the private original only inside the server, resize it through the Images binding to a square face-cropped JPEG (quality 80), and return those JPEG bytes — neither the original key nor the original bytes leave the server. Every photo response uses `Cache-Control: private, max-age=86400`.

  Scenario: Given an attendee with a stored photo, when the desk requests the photo endpoint without a `size`, then it receives the 200×200 thumbnail with its image content type and no storage key.

  Scenario: Given an attendee with a stored photo, when the desk requests the photo endpoint with `size=960`, then it receives the resized JPEG with `Cache-Control: private, max-age=86400` and no storage key or original photo bytes.

  Scenario: Given an attendee with a stored photo, when the desk requests the photo endpoint with `size=999`, then it receives `422` and no storage access occurs.

### `POST /api/staff/desk/registrations/:id/present`

R4 — Marks an eligible registration present and returns:

```json
{
  "checkIn": {
    "present": true,
    "checkedInAt": 1780000000000
  }
}
```

  Scenario: Given an eligible attendee who is not present, when the endpoint is called, then it returns `200` with `present: true`.

R4.1 — The operation is idempotent. Existing check-in timestamp and actor are retained on repeat calls.

  Scenario: Given an attendee already checked in, when the endpoint is called again, then it returns the original check-in timestamp.

R4.2 — Donation-only or missing registrations return `404 { "error": "Attendee not found" }`; no check-in row is written.

  Scenario: Given a donation-only registration ID, when present is requested, then the API returns `404` and leaves attendance unchanged.

R4.3 — A successful mutation writes `attendee_checked_in` to the system audit log with the actor email and registration ID.

  Scenario: Given a successful check-in, when the request completes, then the corresponding audit action exists.

R4.4 — When the optional attendance feed is enabled, a successful check-in publishes one `checkin.created` event using the event contract (see `attendance-feed.ispec.md` R2.1). The event is not required for the check-in mutation to succeed.

  Scenario: Given the attendance feed is enabled and a check-in succeeds, when the feed receives the notification, then it receives one `checkin.created` event for that registration.

### `POST /api/staff/desk/registrations/:id/absent`

R4.5 — Reverses a check-in by clearing `checked_in_at` and `checked_in_by` for an eligible registration. Returns:

```json
{
  "checkIn": {
    "present": false,
    "checkedInAt": null
  }
}
```

  Scenario: Given an attendee checked in at 10:05, when the endpoint is called, then it returns `200` with `present: false` and the database columns are NULL.

R4.6 — The undo is idempotent in both directions. A repeat undo on a registration that is already not present returns `200` with the cleared state and writes no second audit row; an undo on a never-checked-in registration does the same.

  Scenario: Given an attendee who is already not present, when the endpoint is called, then it returns `200` and no audit row is added.

R4.7 — Donation-only or missing registrations return `404 { "error": "Attendee not found" }`; no audit row is written.

R4.8 — A successful undo writes `attendee_check_in_undone` to the system audit log with the actor email and registration ID. The action code is distinct from `attendee_checked_in` so the timeline can distinguish a check-in from its reversal.

  Scenario: Given a successful undo, when the request completes, then the corresponding audit action exists and no `attendee_checked_in` row was written.

### `POST /api/staff/desk/registrations`

R5 — Creates a spot registration from this request shape. The client sends an `Idempotency-Key` header for retry-safe creation:

```json
{
  "fullName": "Ravi Kumar",
  "whatsapp": "+919876543210",
  "email": "ravi@example.com",
  "branch": "CS",
  "participationType": "full_celebration",
  "alumniMeal": "veg",
  "photoFileKey": "photos/pending/...",
  "donationAmount": 1000,
  "spouse": { "name": "Priya Kumar", "mealPreference": "veg" },
  "children": [],
  "guests": []
}
```

`email` is required and must be a valid address (see R5.7). `donationAmount`, `spouse`, `children`, and `guests` are optional. Accommodation and t-shirt fields are invalid request fields.

R5.0.1 — `Idempotency-Key` is required. A missing key returns `422 { "error": "Idempotency-Key is required" }` and creates no registration.

  Scenario: Given a spot-registration request without an `Idempotency-Key`, when creation is requested, then the API returns `422` and creates no registration.

  Scenario: Given `fullName: "Ravi Kumar"`, `whatsapp: "+919876543210"`, `email: "ravi@example.com"`, `branch: "CS"`, `participationType: "full_celebration"`, `alumniMeal: "veg"`, and `photoFileKey: "photos/pending/ravi.jpg"`, when creation is requested, then the API creates the registration and returns its desk-safe result.

R5.1 — Required-field, enum, positive-donation, and photo-reference failures return `422` with field-specific errors. Accommodation, t-shirt, ID-document, donation-cause, public-acknowledgement, felicitation, and internal-note fields are invalid request fields.

  Scenario: Given a missing photo file reference, when creation is requested, then the API returns `422` for `photoFileKey` and creates no registration.

R5.2 — The server computes the total and creates a payment record. The request cannot set `totalAmount`, `paymentStatus`, pricing lines, or payment records.

  Scenario: Given a request containing a forged `totalAmount`, when creation is requested, then server pricing ignores or rejects that field.

R5.3 — Successful creation returns:

```json
{
  "registration": {
    "id": 1001,
    "regCode": "SMRT...",
    "participationType": "full_celebration",
    "payment": { "state": "payment_pending", "amountDue": 9500 },
    "checkIn": { "present": false, "checkedInAt": null },
    "passUrl": "/pass#SMRT..."
  }
}
```

Donation amount is not present in the response.

  Scenario: Given a new unpaid spot registration, when creation succeeds, then the response contains the generated code, pending amount, and pass URL only.

R5.4 — Successful creation writes a system audit action `spot_registration_created` with the actor and registration ID. The photo upload and registration creation remain separate operations, as in the existing photo flow.

  Scenario: Given a successful spot registration, when creation completes, then the audit entry identifies the creating staff user.

R5.5 — A repeated submission with the same `Idempotency-Key` and the same request body returns the original successful creation response verbatim. It does not create a second registration.

  Scenario: Given a spot-registration request retried after a client timeout, when the server receives the same request identity again, then only one registration exists.

R5.6 — Reusing an `Idempotency-Key` with a different request body returns `409 { "error": "Idempotency key already used" }` and does not create or modify a registration.

  Scenario: Given key `desk-123` was used for Ravi Kumar, when the same key is sent for Priya Nair, then the API returns `409` and no second registration is created.

R5.7 — `email` is required and validated as a syntactically valid address. A missing, blank, or malformed `email` returns `422 { "error": "Validation failed", "details": { "fieldErrors": { "email": "..." } } }` and creates no registration. There is no server-generated fallback address for desk spot registration — this reverses the earlier `donor-<regcode>@smriti.internal` placeholder behavior (see `../registration-desk.spec.md` R5.7).

  Scenario: Given a spot-registration request with `email` omitted, when creation is requested, then the API returns `422` for `email` and creates no registration.

### `POST /api/staff/desk/registrations/:id/payment`

R7 — Settles the full outstanding balance for an eligible registration in person:

```json
{
  "method": "cash",
  "note": "collected at desk"
}
```

`method` is required, one of `cash`, `upi`, `bank_transfer`. `note` is optional, trimmed, ≤500 characters. Unknown fields are rejected. Returns the same desk-overview shape `GET /api/staff/desk/lookup` returns:

```json
{ "attendee": { "...": "...", "payment": { "state": "confirmed" } } }
```

  Scenario: Given an attendee owing ₹2,500, when `{ "method": "cash" }` is posted, then the response's `attendee.payment.state` is `"confirmed"` and no `amountDue` field is present.

R7.1 — Settlement handles a registration whose pending payment is `payment_pending` or `pending_verification`. It marks that payment `verified`, sets its `method` and `note`, and clears its `proof_file_key`, `gateway_ref`, and `gateway_response` columns so the row never reads as both an in-person collection and an online bank transfer.

  Scenario: Given a `pending_verification` payment with an uploaded proof, when settlement succeeds, then the payment's proof and gateway columns are `null` and its `method`/`note` reflect the desk collection.

R7.2 — A missing or invalid `method`, or a `note` over 500 characters, returns `422` with field-specific errors. No payment or registration data changes.

  Scenario: Given `{ "method": "cheque" }`, when posted, then the API returns `422` for `method` and settles nothing.

R7.3 — A registration with no outstanding balance (already fully paid) returns `409 { "error": "Payment is already settled" }`. No payment row is modified.

  Scenario: Given an already-confirmed registration, when settlement is posted again, then the API returns `409` and the payment table is unchanged.

R7.4 — Donation-only or missing registrations return `404 { "error": "Attendee not found" }`; no payment or registration data changes.

R7.5 — A successful settlement sends the same payment-confirmed email `POST /api/staff/payments/:id/verify` sends on confirmation (`staff-api.spec.md` R8), substituting the collection method for the gateway reference in the payment list. Email failure is logged and never fails or reverses the settlement.

  Scenario: Given a successful settlement, when it completes, then the attendee's payment-confirmed email is sent; a delivery failure does not undo the settlement.

R7.6 — A successful settlement writes a `desk_payment_collected` entry to the registration's `audit_log` — the same table `POST /api/staff/payments/:id/verify` writes to, not the desk's `system_audit_log` used by present/absent/spot-create — recording `amount`, `method`, and `note` when given, with the settling staff email as actor.

  Scenario: Given a successful settlement, when the request completes, then `audit_log` gains one `desk_payment_collected` row for that registration.

### `POST /api/staff/desk/registrations/:id/charge`

R8 — Adds an ad-hoc charge to an eligible registration and raises its total:

```json
{
  "description": "Extra meal",
  "amount": 500
}
```

`description` is a required non-blank string. `amount` is a required positive whole-rupee integer. Unknown fields are rejected. Returns the same desk-overview shape as `GET /api/staff/desk/lookup`, with the raised total reflected in `payment.amountDue`.

  Scenario: Given an attendee with no outstanding balance, when `{ "description": "Extra meal", "amount": 500 }` is posted, then the response's `attendee.payment.state` is `"payment_pending"` with `amountDue: 500`.

R8.1 — Reuses the same charge pipeline `PUT /api/staff/registrations/:id` uses when a save raises the total (`staff-api.spec.md` R18): recomputes `total_amount` and creates or grows the single pending payment for the full delta.

  Scenario: Given a registration already owing ₹1,000, when a ₹500 charge is posted, then the single pending payment becomes ₹1,500 rather than a second payment row being created.

R8.2 — A missing or blank `description`, or a non-positive or non-integer `amount`, returns `422` with field-specific errors. No charge is created.

  Scenario: Given `{ "description": "", "amount": 500 }`, when posted, then the API returns `422` for `description` and creates no charge.

R8.3 — A charge on a registration whose pending payment is `pending_verification` returns `409 { "error": "Payment is under verification", "code": "payment_under_verification" }`. No charge is created.

  Scenario: Given a registration with a payment mid-proof-review, when a charge is posted, then the API returns `409` with `code: "payment_under_verification"` and creates no charge.

R8.4 — Donation-only or missing registrations return `404 { "error": "Attendee not found" }`; no charge is created.

  Scenario: Given a donation-only registration ID, when a charge is posted, then the API returns `404` and creates no charge.

R8.5 — A successful charge sends the same additional-payment or revised-payment email the staff edit page sends for a cost-affecting save (`staff-api.spec.md` R18): additional-payment when the charge creates a fresh pending payment, revised-payment when it grows an existing one. Email failure is logged and never fails the charge.

  Scenario: Given a charge that grows an existing pending payment, when it completes, then the attendee receives the revised-payment email.

R8.6 — A successful charge is recorded under the existing `charge_added` audit action shared with the dashboard charge flow (`staff-operations.spec.md` R12.2) — there is no separate desk-specific audit action for charges, unlike payment collection's `desk_payment_collected` (R7.6).

## Shared Error Contract

R6 — Error responses use `{ "error": string }`, with optional `details.fieldErrors`. They do not include stack traces, SQL text, raw registration data, storage keys, or payment proofs.

  Scenario: Given an internal failure, when the endpoint responds, then the body contains a safe error message only.

R6.1 — `409` is used for duplicate or conflicting spot registrations when the server identifies a likely existing record. The response does not disclose the existing registration's private data.

  Scenario: Given a duplicate WhatsApp match, when creation is requested, then the API returns `409` with a safe duplicate message and no existing record payload.

R6.2 — A fresh `Idempotency-Key` that matches an existing WhatsApp or email returns the safe duplicate response; it does not return the existing registration.

  Scenario: Given Ravi's WhatsApp already belongs to a registration, when a new key is used with Ravi's WhatsApp, then the API returns `409` without returning Ravi's registration data.

## Dependencies

- (see `../registration-desk.spec.md` R1) — consumer behavior and field policy
- (see `../registration-desk.spec.md` R6) — payment collection consumer behavior
- (see `../registration-desk.spec.md` R7) — additional charge consumer behavior
- (see `../access-control.spec.md` R2) — authorization matrix
- (see `../photo-id.spec.md` R3) — existing photo upload contract
- (see `../authentication.spec.md` R4) — JWT behavior
- (see `../staff-api.spec.md` R8) — online verify flow and payment-confirmed email
- (see `../staff-api.spec.md` R18) — dashboard edit-page charge pipeline
- (see `../staff-operations.spec.md` R12) — audit action registry
