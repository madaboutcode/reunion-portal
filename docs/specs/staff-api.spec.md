# Specification: Staff & Admin API

## Purpose

The HTTP API that the staff dashboard and admin pages call. Covers authentication endpoints (magic link), staff operations (registrations, payments, files, export), and admin operations (user management).

## Contents

- [Scope](#scope)
- [Authentication](#authentication)
- [Error Contract](#error-contract)
- [Auth Endpoints](#auth-endpoints)
- [Staff Endpoints](#staff-endpoints)
- [Allocation Endpoints](#allocation-endpoints)
- [Scope Middleware Contract](#scope-middleware-contract)
- [Admin Endpoints](#admin-endpoints)
- [Dependencies](#dependencies)

## Scope

**Covers:** All API endpoints consumed by the staff dashboard and admin UI. Request/response shapes, error codes, auth requirements. Mirrors `submission-api.spec.md` for the attendee API.

**Does not cover:** Attendee-facing endpoints (see `submission-api.spec.md`). Business logic and status transitions (see `payment-flow.spec.md`). Auth model and JWT details (see `authentication.spec.md`).

---

## Authentication

R1 — Staff and admin endpoints use JWT Bearer tokens with role-based access.

R1.1 — Staff endpoints (`/api/staff/*`) require `role: "staff"` or `role: "admin"`.

R1.2 — Admin endpoints (`/api/admin/*`) require `role: "admin"`.

R1.3 — Insufficient role returns `403` with `{ "error": "Insufficient permissions" }`.

R1.4 — Missing or invalid token returns `401` per `submission-api.spec.md` R1.1–R1.2.

---

## Error Contract

R2 — Same error shapes as `submission-api.spec.md` R2. Additionally:

R2.1 — `403` for valid token but wrong role: `{ "error": "Insufficient permissions" }`.

R2.2 — `409` for duplicate email on user creation: `{ "error": "User with this email already exists" }`.

R2.3 — `422` for missing required fields on verify (`referenceId`) or reject (`comment`):
```json
{ "error": "Validation failed", "details": { "fieldErrors": { "referenceId": "Required" } } }
```
or
```json
{ "error": "Validation failed", "details": { "fieldErrors": { "comment": "Required" } } }
```

R2.4 — `404` when a resource does not exist (registration, payment, user):
```json
{ "error": "Not found" }
```

---

## Auth Endpoints

### POST /api/auth/magic-link

**Auth:** None required.

R3 — Requests a magic link for any role (staff, admin, or attendee).

R3.1 — Request body: `{ "email": "user@example.com" }`

R3.2 — Identity resolution is transparent to the requester — no role field is required. The server determines role from the email address. See `authentication.spec.md` R8.

R3.3 — Always returns `200` with `{ "ok": true, "message": "If an account exists, a login link has been sent." }` — regardless of whether the email was found. Prevents enumeration.

R3.4 — Side effects: generates token, stores hash in `magic_links`, sends email via Mailgun. Audit: `login_requested`.

### GET /api/auth/verify

**Auth:** None required.

R4 — Verifies a magic link token and issues a JWT.

R4.1 — Query parameter: `token` (the raw token from the email link).

R4.2 — On success, returns `200` with:
```json
{
  "token": "<JWT>",
  "role": "staff",
  "redirectTo": "/staff/dashboard"
}
```

R4.3 — `redirectTo` values:
- `staff` or `admin` → `/staff/dashboard`
- `attendee` → `/confirmation/<registrationId>` (numeric registration ID)

R4.4 — On failure (expired, used, invalid), returns `401` with `{ "error": "Invalid or expired link" }`.

R4.5 — Side effects: marks magic link as used. Audit: `login_succeeded` or `login_failed`.

---

## Staff Endpoints

All require `staff` or `admin` role.

R26 — Staff routes are additionally gated by scope on five route prefixes (see `authentication.spec.md` R14–R15.3):
- `GET /api/staff/dashboard` and all `/api/staff/registrations/*` endpoints (R6, R7, R18–R20) → `requireScope("dashboard")`
- `GET /api/staff/resources` (see `staff-operations.spec.md`) → `requireScope("resources")`
- `GET /api/staff/reports` (see `staff-operations.spec.md`) → `requireScope("reports")`
- `/api/staff/desk/*` (see `interfaces/registration-desk-api.ispec.md`) → `requireScope("registration_desk")`
- Allocation endpoints (see [Allocation Endpoints](#allocation-endpoints)) → `requireScope("allocation")`

R26.1 — Payments (R8–R10, R22–R23), files (R12), export (R13), and refunds (R24–R25) are part of the `dashboard` scope — they require `requireScope("dashboard")` alongside the role check. `/api/staff/my-registration` (R11) has no scope check — it is available to all staff regardless of scopes (a staff member can always view their own registration).

See [Scope Middleware Contract](#scope-middleware-contract) for the full `requireScope` behavior.

### GET /api/staff/dashboard

R5 — Returns aggregate stats for all registrations.

R5.1 — Response:
```json
{
  "stats": {
    "total": 142,
    "pending": 45,
    "pendingVerification": 23,
    "confirmed": 74,
    "moneyCollected": 352000
  }
}
```

R5.2 — Field semantics:
- `total` — count of all registrations
- `pending` — count with status `pending` (awaiting payment proof upload)
- `pendingVerification` — count with status `pending_verification` (proof uploaded, awaiting staff review). This is the "Needs Verification" count — the primary action queue for staff.
- `confirmed` — count with status `confirmed` (payment verified)
- `moneyCollected` — sum of `amount` from all payment records with `status = 'verified'`. Same unit as payment amounts throughout the API (see `pricing-engine.spec.md` for currency unit).

### GET /api/staff/registrations

R6 — Returns a filterable, paginated list of registrations.

R6.1 — Query parameters:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | — | View filter: `attendee` (attending — full_celebration or campus_only) or `donor` (donation_only) |
| `status` | string | — | Filter: `pending`, `pending_verification`, `confirmed` |
| `branch` | string | — | Filter by branch code (e.g., `CS`, `EC`) |
| `search` | string | — | Searches name, email, regCode, whatsapp |
| `page` | number | 1 | Page number (1-indexed) |
| `limit` | number | 50 | Items per page (max 100) |

R6.2 — Response:
```json
{
  "registrations": [
    {
      "id": 1001,
      "regCode": "SM26-XXXX",
      "fullName": "Ravi Kumar",
      "email": "ravi@example.com",
      "whatsapp": "+919876543210",
      "branch": "CS",
      "status": "pending_verification",
      "attendanceIntent": "attending",
      "participationType": "full_celebration",
      "totalAmount": 4000,
      "createdAt": 1716019200000
    }
  ],
  "total": 142,
  "page": 1,
  "limit": 50
}
```

R6.3 — [REMOVED] `hasProof` removed — registration status already conveys proof state; eliminated N+1 payment queries from list endpoint.

R6.4 — `whatsapp` is included in list items to support in-page searching (search covers whatsapp numbers).

R6.5 — Ordered by `created_at DESC`. No client-controlled sort in V1.

R6.6 — Audit: `registration_viewed` is NOT logged for list view (too noisy). Only logged on detail view (see R7.4).

R6.7 — `type=attendee` includes registrations with `participation_type` of `full_celebration` or `campus_only` (i.e., `attendance_intent` of `attending`). `type=donor` includes only `donation_only`. Omitting `type` returns all. Both `attendanceIntent` and `participationType` fields are present in list items.

R6.8 — `GET /api/staff/dashboard` accepts the same `type` query param. Stats (total, pending, pendingVerification, confirmed, moneyCollected) reflect only the filtered subset when `type` is provided.

### GET /api/staff/registrations/:id

R7 — Returns full registration detail. `:id` is the internal numeric registration ID.

R7.1 — Response:
```json
{
  "registration": {
    "id": 1001,
    "regCode": "SM26-XXXX",
    "status": "pending_verification",
    "fullName": "Ravi Kumar",
    "email": "ravi@example.com",
    "whatsapp": "+919876543210",
    "branch": "CS",
    "city": "Bangalore",
    "country": "India",
    "attendance": {
      "intent": "attending",
      "mealPreference": "veg",
      "tshirtSize": "M"
    },
    "accommodation": {
      "type": "hotel",
      "checkIn": "2026-12-25",
      "checkOut": "2026-12-26"
    },
    "donation": 500,
    "pricingBreakup": {
      "base": 2000,
      "lines": [
        { "label": "Alumni registration", "fee": 2000, "free": false }
      ],
      "donation": 500,
      "total": 4000
    },
    "totalAmount": 4000,
    "createdAt": 1716019200000
  },
  "attendees": [
    {
      "id": 1,
      "type": "spouse",
      "name": "Priya Kumar",
      "mealPreference": "veg",
      "tshirtSize": "S"
    }
  ],
  "payments": [
    {
      "id": 1,
      "amount": 4000,
      "status": "pending_verification",
      "proofFileKey": "payment-proofs/SM26-XXXX/1/receipt.jpg",
      "gatewayRef": null,
      "verifiedBy": null,
      "verifiedAt": null,
      "createdAt": 1716019200000
    }
  ],
  "documents": [
    {
      "id": 1,
      "fileName": "id-card.jpg",
      "mimeType": "image/jpeg",
      "sizeBytes": 245000,
      "r2Key": "id-docs/SM26-XXXX/id-card.jpg"
    }
  ],
  "audit": [
    {
      "action": "created",
      "actor": "ravi@example.com",
      "changes": null,
      "createdAt": 1716019200000
    }
  ]
}
```

R7.2 — Field notes:
- `attendees` — zero or more dependent attendees (spouse, children, guests). Empty array if none.
- `payments` — all payment records, ordered by `created_at DESC`. Most recent first.
- `documents` — ID document(s) associated with the registration. The `r2Key` is used to construct a staff file proxy URL (see R12).
- `audit` — all audit events for this registration, ordered by `created_at ASC` (chronological).
- `proofFileKey` in payments — use to construct a staff file proxy URL (see R12). `null` if no proof uploaded yet.

R7.3 — `404` if no registration exists with the given `:id`.

R7.4 — Audit: `registration_viewed` logged with registrationId and staff email.

R7.5 — Response includes `tshirts` array — all rows from the `tshirts` table for this registration:
```json
"tshirts": [
  { "id": 1, "gender": "male", "size": "L", "isIncluded": true, "createdAt": 1716019200000 },
  { "id": 2, "gender": "female", "size": "M", "isIncluded": false, "createdAt": 1716019200000 }
]
```
The included shirt (`isIncluded: true`) is the free one; extras (`isIncluded: false`) are ₹500 each.

R7.6 — Response includes `additionalCharges` array — all rows from the `additional_charges` table:
```json
"additionalCharges": [
  { "id": 1, "description": "Branch sponsorship - 5 rooms", "amount": 25000, "createdBy": 3, "createdAt": 1716019200000 }
]
```

### T-Shirt Sub-Resource Endpoints

All require `requireScope("dashboard")`.

#### GET /api/staff/registrations/:id/tshirts

R34 — Returns all t-shirt rows for the registration. Response: `{ "tshirts": TshirtRow[] }`.

R34.1 — `404` if registration not found.

#### POST /api/staff/registrations/:id/tshirts

R35 — Adds a t-shirt row. Request body: `{ "gender": "male"|"female"|null, "size": TshirtSize, "isIncluded": boolean }`.

R35.1 — `400` if registration is `donation_only` (R22: "T-shirts are not available for donation-only registrations").

R35.2 — `409` if any payment is `pending_verification` and this is a cost-affecting operation (adding a non-included shirt). Size/gender on an included shirt is cosmetic (R23).

R35.3 — After insert: recalculates pricing via `calculateTotal()` with all tshirts and charges as extras. Updates `total_amount` and `pricing_snapshot`. If total increased, creates `payment_pending` record for the delta.

R35.4 — If `isIncluded: true` and an included row already exists, returns `409` ("Only one included shirt per registration").

R35.5 — Response: `{ "tshirt": TshirtRow, "totalAmount": number, "pricingBreakup": PricingBreakup }`.

#### PUT /api/staff/registrations/:id/tshirts/:tid

R36 — Updates a t-shirt row's gender and/or size. Request body: `{ "gender"?: "male"|"female"|null, "size"?: TshirtSize }`.

R36.1 — Always allowed (cosmetic change — R23). No `pending_verification` check.

R36.2 — If the updated row is `is_included = 1`, also updates `registrations.tshirt_size` to the new size (mirror sync).

R36.3 — `404` if row not found.

#### DELETE /api/staff/registrations/:id/tshirts/:tid

R37 — Removes a t-shirt row.

R37.1 — `409` if any payment is `pending_verification` (R23 — cost-affecting).

R37.2 — After delete: recalculates pricing. If total decreased below verified payments, existing refund path handles it.

R37.3 — `404` if row not found. `400` if attempting to delete the included shirt.

### Additional Charge Sub-Resource Endpoints

All require `requireScope("dashboard")`.

#### GET /api/staff/registrations/:id/charges

R38 — Returns all additional charge rows. Response: `{ "charges": AdditionalChargeRow[] }`.

#### POST /api/staff/registrations/:id/charges

R39 — Adds a charge. Request body: `{ "description": string, "amount": number }`.

R39.1 — `400` if `amount <= 0` (R9 — positive-only; DB `CHECK(amount > 0)` also enforces).

R39.2 — `409` if any payment is `pending_verification` (R23).

R39.3 — `created_by` set to the authenticated staff user's ID.

R39.4 — After insert: recalculates pricing. Same total/payment logic as R35.3.

R39.5 — Response: `{ "charge": AdditionalChargeRow, "totalAmount": number, "pricingBreakup": PricingBreakup }`.

#### DELETE /api/staff/registrations/:id/charges/:cid

R40 — Removes a charge.

R40.1 — `409` if any payment is `pending_verification` (R23).

R40.2 — After delete: recalculates pricing.

R40.3 — `404` if row not found.

### POST /api/staff/payments/:id/verify

R8 — Verifies a payment. `:id` is the payment ID (not registration ID).

R8.1 — Request body:
```json
{ "referenceId": "UTR123456789", "actualAmount": 11190 }
```
`referenceId` is mandatory — the bank transaction reference / UTR / UPI ref read from the uploaded proof. `actualAmount` is optional (number, `> 0`) — the amount staff actually confirms received, which may be less than or greater than the payment's expected amount. Omitting it defaults to the payment's expected amount (backward-compatible with the pre-partial-verification behavior). See `staff-operations.spec.md` R1.8.

R8.2 — Guard: payment must have `status = 'pending_verification'`. Any other status returns `409` with `{ "error": "Payment is not pending verification" }`.

R8.2.1 — Guard: coverage check. Returns `409` with `{ "error": "Uncovered shortfall — create a balance payment first" }` when `sumVerified(registrationId) + actualAmount + sumPending(registrationId) < registration.total_amount`. Staff must call `POST /api/staff/registrations/:id/balance-payment` first, then retry verification. See `staff-operations.spec.md` R1.1.1.

R8.3 — `404` if no payment exists with the given `:id`.

R8.4 — On success, returns `200` with:
```json
{
  "paymentStatus": "verified",
  "registrationStatus": "confirmed"
}
```
`registrationStatus` is conditional on the outcome: `"confirmed"` when the verified sum now covers `total_amount`; otherwise `"pending"` (an outstanding `payment_pending` record covers the remaining gap) — or `"pending_verification"` if another payment on the registration is still awaiting review. See `staff-operations.spec.md` R1.5.

R8.4.1 — When the verify is an overpayment (`actualAmount` greater than the payment's expected amount), the response includes `refundCreated: { "amount": number }` — the excess automatically recorded as a pending refund. Omitted when there is no overpayment. See `staff-operations.spec.md` R1.16–R1.17.

R8.5 — Side effects: see `staff-operations.spec.md` R1.1–R1.21 (status transitions, `gateway_ref`, `verified_by`, `verified_at`, audit entry `payment_verified` with `expectedAmount`/`actualAmount`, confirmation email to attendee sent only when the registration confirms, refund record on overpayment).

R8.6 — `422` if `actualAmount` is provided and is `<= 0`:
```json
{ "error": "Validation failed", "details": { "fieldErrors": { "actualAmount": "Must be greater than 0" } } }
```

### POST /api/staff/payments/:id/reject

R9 — Rejects a payment proof and rewinds status. `:id` is the payment ID.

R9.1 — Request body:
```json
{ "comment": "Screenshot is blurry, please re-upload a clearer image" }
```
`comment` is mandatory — sent to the attendee in the rejection email.

R9.2 — Guard: payment must have `status = 'pending_verification'`. Any other status returns `409` with `{ "error": "Payment is not pending verification" }`.

R9.3 — `404` if no payment exists with the given `:id`.

R9.4 — On success, returns `200` with:
```json
{
  "paymentStatus": "payment_pending",
  "registrationStatus": "pending"
}
```

R9.5 — Side effects: see `payment-flow.spec.md` R6.4–R6.7 (status rewind, audit entry `proof_rejected`, rejection email to attendee with the comment text).

### POST /api/staff/registrations/:id/upload-proof

R10 — Uploads payment proof on behalf of an attendee. `:id` is the registration ID.

R10.1 — Request: multipart form data with a single file field, same file types and size constraints as `submission-api.spec.md` R6.2–R6.3 (JPG, JPEG, PNG, PDF; max 5 MB).

R10.2 — `404` if no registration exists with the given `:id`.

R10.3 — `409` if no payment record with `status = 'payment_pending'` exists for this registration (same as `submission-api.spec.md` R6.11).

R10.4 — On success, returns `200` with:
```json
{
  "status": "pending_verification",
  "message": "Proof submitted."
}
```

R10.5 — Failure modes for invalid file type or size: same error shapes as `submission-api.spec.md` R6.12–R6.13.

R10.6 — Audit entry uses action `proof_uploaded_by_staff` (not `proof_uploaded`), actor = staff email. See `staff-operations.spec.md` R3.2.

### POST /api/staff/registrations/:id/balance-payment

R22 — Creates a `payment_pending` record for an outstanding shortfall on a registration. `:id` is the registration ID. See `staff-operations.spec.md` R1.11–R1.15.

R22.1 — Request body:
```json
{ "amount": 2620 }
```
`amount` is required, `> 0`.

R22.2 — `404` if no registration exists with the given `:id`.

R22.3 — Guard: `409` if a `payment_pending` record already exists for this registration — at most one may exist at a time (`staff-operations.spec.md` R1.12).

R22.4 — On success, returns `200` with:
```json
{ "paymentId": 12, "amount": 2620, "status": "payment_pending" }
```

R22.5 — Side effects: sends the payment-link notification to the attendee (fire-and-forget); audit entry `payment_created` with `{ amount, reason: 'partial_verification_shortfall', sourcePaymentId }`. See `staff-operations.spec.md` R1.14–R1.15.

### POST /api/staff/payments/:id/verify-partial

R23 — Convenience compound endpoint that composes `createBalancePayment` then `verifyPayment` in sequence. `:id` is the payment ID being verified. Optional — staff can call `POST /api/staff/registrations/:id/balance-payment` (R22) and `POST /api/staff/payments/:id/verify` (R8) separately instead. See `staff-operations.spec.md` R1.11.

R23.1 — Request body:
```json
{ "referenceId": "UTR123456789", "actualAmount": 11190, "shortfallAmount": 2620 }
```
All three fields are required.

R23.2 — Behavior: first creates a balance payment for `shortfallAmount` (as R22), then verifies the payment for `actualAmount` (as R8), using the newly created balance payment as the covering `payment_pending` record for R8.2.1's coverage guard.

R23.3 — Response combines both operation results:
```json
{
  "balancePayment": { "paymentId": 12, "amount": 2620, "status": "payment_pending" },
  "verify": { "paymentStatus": "verified", "registrationStatus": "pending" }
}
```

R23.4 — Error contract: same guards and status codes as R22 (balance payment step) and R8 (verify step) — whichever step fails first returns that step's error, and the other step does not execute.

### PUT /api/staff/registrations/:id

R18 — Edits a registration. `:id` is the registration ID.

R18.1 — Request body: partial update — only provided fields are changed. Includes `updatedAt` for optimistic locking. Optionally includes `tshirts[]` and `additionalCharges[]` for single-save editing of sub-resources.
```json
{
  "updatedAt": 1716019200000,
  "fields": { "fullName": "Ravi Kumar", "participationType": "full_celebration" },
  "attendees": [ ... ],
  "tshirts": [
    { "id": 1, "gender": "male", "size": "L", "isIncluded": true },
    { "gender": "female", "size": "M", "isIncluded": false }
  ],
  "additionalCharges": [
    { "id": 1, "description": "Branch sponsorship", "amount": 25000 },
    { "description": "New charge", "amount": 5000 }
  ]
}
```
When `tshirts` or `additionalCharges` are provided, the backend diffs by ID: rows with `id` = update (size/gender for shirts; charges are immutable), rows without `id` = create, existing rows whose `id` is absent = delete. Pricing is recalculated after all diffs are applied.

R18.2 — `updatedAt` is required. If it doesn't match the current registration `updated_at`, returns `409` with `{ "error": "Registration was modified by another user. Please refresh and try again." }`.

R18.3 — Guard: archived registrations cannot be edited. Returns `409` with `{ "error": "Cannot edit archived registration" }`.

R18.4 — Guard: cost-affecting edits blocked when any payment is `pending_verification`. Returns `409` with `{ "error": "Verify or reject pending payment before making cost changes" }`. This applies atomically to the entire save — if registration field changes, tshirt adds/removes, OR charge adds/removes are cost-affecting AND a payment is `pending_verification`, the whole request is rejected. Shirt size/gender updates (cosmetic) alone do not trigger the block. See `staff-operations.spec.md` R10.4.

R18.5 — Guard: cost decrease below verified payments blocked. Returns `422` with `{ "error": "Cannot reduce total below verified payments (₹X)" }`. See `staff-operations.spec.md` R10.5.

R18.6 — On success, returns `200` with:
```json
{
  "registration": { "...updated registration..." },
  "pricingBreakup": { "...new breakup..." },
  "paymentDelta": {
    "action": "created" | "updated" | "deleted" | "none",
    "amount": 4500,
    "previousAmount": 0
  },
  "tshirts": [ { "id": 1, "gender": "male", "size": "L", "isIncluded": true, "createdAt": 1716019200000 } ],
  "additionalCharges": [ { "id": 1, "description": "Branch sponsorship", "amount": 25000, "createdBy": 3, "createdAt": 1716019200000 } ]
}
```
`tshirts` and `additionalCharges` are always returned (full list after sync), regardless of whether they were included in the request.

R18.7 — Side effects: see `staff-operations.spec.md` R10.7 (validation, repricing, payment action, audit, email).

R18.8 — `404` if no registration exists with the given `:id`.

### POST /api/staff/registrations/:id/archive

R19 — Archives a registration. Snapshots the full record, then deletes it from `registrations`. `:id` is the registration ID.

R19.1 — Optional request body: `{ "force": true }` to bypass the payment guard. When omitted or `false`, the guard blocks archives with non-`payment_pending` payments. Force mode is API-only (no UI exposure) and intended for staff-override scenarios where a registration must be archived despite pending or verified payments.

R19.2 — Guard: registration must have only `payment_pending` (or zero) payment records. Returns `409` with `{ "error": "Cannot archive a registration with active payment records (pending_verification or verified)." }`. Bypassed when `force: true`.

R19.3 — On success, returns `200` with:
```json
{ "ok": true, "archivedId": 1 }
```
`archivedId` is the ID in the `archived_registrations` table.

R19.4 — Side effects: see `staff-operations.spec.md` R8 (snapshot, delete, system audit, no email). When `force: true`, the system audit log includes `"force": true` and the snapshot includes `"forceArchived": true`.

R19.5 — `404` if no registration exists with the given `:id`.

R19.6 — This is destructive. The frontend must show a confirmation dialog before calling this endpoint.

### GET /api/staff/archived

R20 — Lists archived registrations from the `archived_registrations` table.

R20.1 — Query parameters: `search` (matches full_name, email, reg_code), `page`, `limit`.

R20.2 — Response:
```json
{
  "archived": [
    {
      "id": 1,
      "originalId": 1001,
      "regCode": "SM26-XXXX",
      "email": "ravi@example.com",
      "fullName": "Ravi Kumar",
      "archivedBy": "staff@example.com",
      "archivedAt": 1718438400000
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 50
}
```

R20.3 — Staff can fetch the full snapshot of a single archived record via `GET /api/staff/archived/:id` which returns the parsed JSON snapshot.

### No Changes to Existing Query Endpoints

R21 — Archived records are physically deleted from `registrations`. No changes needed to:
- `GET /api/staff/dashboard` (counts)
- `GET /api/staff/registrations` (list)
- `GET /api/staff/resources` (aggregates)
- `GET /api/staff/reports` (analytics)
- `GET /api/staff/export` (CSV)

### GET /api/staff/my-registration

R11 — Returns the staff member's own registration (if they are also a registered alumnus).

R11.1 — The server uses the email from the authenticated staff JWT to find a matching registration. No additional parameters are needed.

R11.2 — If found, returns `200` with the same shape as `GET /api/registrations/me` (see `submission-api.spec.md` R4.1).

R11.3 — If not found, returns `404` with `{ "error": "No registration found for your email" }`.

### GET /api/staff/files/*key

R12 — Proxies a private file from R2 storage to the authenticated staff client.

R12.1 — `*key` is the full R2 object key (e.g., `payment-proofs/SM26-XXXX/1/receipt.jpg` or `id-docs/SM26-XXXX/id-card.jpg`). Construct this URL from `proofFileKey` in payment records (R7.1) or `r2Key` in document records (R7.1).

R12.2 — Returns the file contents with the correct `Content-Type` from R2 metadata. Staff clients can display or open the file directly.

R12.3 — `404` if the file does not exist in R2.

R12.4 — No signed URLs are used. Auth is enforced by the JWT middleware — only staff or admin can access this endpoint (see `authentication.spec.md` R2 permission matrix).

R12.5 — Audit: `file_viewed` logged with the file key and staff email.

### GET /api/staff/export

R13 — Exports registration data as CSV.

R13.1 — Query parameters: same filters as `GET /api/staff/registrations` R6.1 (`status`, `branch`, `search`). Pagination parameters are ignored — export returns all matching records.

R13.2 — CSV columns (in order): `regCode`, `fullName`, `branch`, `email`, `whatsapp`, `status`, `totalAmount`, `accommodation`, `createdAt`.

R13.3 — `createdAt` in the CSV is formatted as ISO 8601 (`YYYY-MM-DD HH:mm:ss UTC`).

R13.4 — Response headers:
- `Content-Type: text/csv`
- `Content-Disposition: attachment; filename="registrations-YYYY-MM-DD.csv"` (date is the server date at request time)

R13.5 — Audit: `export_downloaded` logged with the filter params used.

### GET /api/staff/refunds

R24 — Lists refund records from the `refunds` table. See `staff-operations.spec.md` R1.17.

R24.1 — Query parameters: `status` (`pending` or `completed`, optional — omitting returns all).

R24.2 — Response:
```json
{
  "refunds": [
    {
      "id": 1,
      "registrationId": 1002,
      "sourcePaymentId": 78,
      "amount": 1190,
      "status": "pending",
      "resolvedBy": null,
      "resolvedAt": null,
      "createdAt": 1716019200000
    }
  ]
}
```

### POST /api/staff/refunds/:id/complete

R25 — Marks a refund as completed. `:id` is the refund ID. See `staff-operations.spec.md` R1.19–R1.20.

R25.1 — Request body:
```json
{ "bankReference": "UTR998877665" }
```
`bankReference` is required.

R25.2 — Guard: refund must have `status = 'pending'`. Any other status returns `409` with `{ "error": "Refund is not pending" }`.

R25.3 — `404` if no refund exists with the given `:id`.

R25.4 — On success, returns `200` with the updated refund record (same shape as one item in R24.2), with `status: "completed"`, `resolvedBy` set to staff email, `resolvedAt` set to the completion timestamp.

R25.5 — Side effects: audit entry `refund_completed`, actor = staff email, changes = `{ refundAmount, bankReference }`.

---

## Allocation Endpoints

All require `staff` or `admin` role and `requireScope("allocation")` (see [Scope Middleware Contract](#scope-middleware-contract), `authentication.spec.md` R13–R17, `roommate-preferences.spec.md`).

### GET /api/staff/allocation/registrations

R27 — Returns registrations eligible for the allocation page — those with overnight accommodation.

R27.1 — Includes registrations with `accommodation` type `shared_double`, `shared_triple`, or `private`. Excludes `none` accommodation and `campus_only`/`donation_only` registrations, which never carry an overnight accommodation value (see `roommate-preferences.spec.md` R3, Edge Cases). Private-room registrations are list-visible only — they remain ineligible for roommate preferences (R29.3) and for accommodation conversion (R41.3); clients may hide them behind a display toggle.
  Scenario: Given registrations with accommodation `private`, `shared_triple`, and `none`, when the list is fetched, then the `private` and `shared_triple` registrations appear and the `none` registration does not.

R27.2 — Response:
```json
{
  "registrations": [
    {
      "id": 1042,
      "regCode": "SM26-XXXX",
      "fullName": "Ravi Kumar",
      "branch": "CS",
      "gender": "male",
      "email": "ravi@example.com",
      "whatsapp": "+919876543210",
      "photoThumbUrl": "<public-cdn-base>/<photo_thumb_key>",
      "accommodationType": "shared_double",
      "checkIn": "2026-08-15",
      "checkOut": "2026-08-16",
      "status": "pending",
      "pendingAmount": 3540,
      "updatedAt": 1721628000000,
      "preferenceCount": 3,
      "incomingPreferenceCount": 1
    }
  ],
  "total": 48
}
```

R27.3 — `preferenceCount` is the number of this registration's own outgoing `roommate_preferences` rows (0–5). `incomingPreferenceCount` is the number of `roommate_preferences` rows where `preferred_registration_id` equals this registration's `id`.

R27.7 — `status` is the registration status: `pending`, `pending_verification`, or `confirmed` (see `access-control.spec.md` R2.6 for what this scope may expose).
  Scenario: Given a registration whose verified payments cover its total, when the list is fetched, then its `status` is `"confirmed"`.

R27.8 — `pendingAmount` is the outstanding balance in rupees: the registration's current total minus the sum of its verified payment amounts. It is `null` when `status` is `confirmed`. It is a single number — no breakdown, no total, no donation-identifiable component is exposed (decision `docs/decisions/20260803-allocation-scope-upgrade-carveout.md`).
  Scenario: Given a registration with total 10000 and verified payments summing 6460, when the list is fetched, then `pendingAmount` is `3540` and `status` is `"pending"`.

R27.9 — `updatedAt` is `registrations.updated_at` (integer, Unix epoch milliseconds) — the concurrency token for accommodation conversion (R41.4). It is distinct from the preferences `version` token (R28.6), which tracks preference rows only.
  Scenario: Given a registration whose `updated_at` is `1721628000000`, when the list is fetched, then its `updatedAt` field is `1721628000000`.

R27.4 — The response is a flat, ungrouped list — the server does not nest by accommodation type or gender. Clients group by `accommodationType` + `gender` for display (see `roommate-preferences.spec.md` R3.2).

R27.5 — No pagination — all shared-accommodation registrations are returned in one response (see `roommate-preferences.spec.md` R3.1 — visibility is not scoped by branch or batch).

R27.6 — Ordered by `accommodationType`, then `gender`, then `fullName` ascending.

### GET /api/staff/allocation/registrations/:id/preferences

R28 — Returns the roommate preferences for a specific registration. `:id` is the internal numeric registration ID.

R28.1 — Response:
```json
{
  "preferences": [
    {
      "preferredRegistrationId": 1050,
      "regCode": "SM26-YYYY",
      "fullName": "Suresh Nair",
      "branch": "EC",
      "gender": "male",
      "preferenceOrder": 1,
      "isMutual": true
    }
  ],
  "version": 1721628000000
}
```

R28.2 — Ordered by `preferenceOrder` ascending. Zero to five entries.

R28.3 — `isMutual` is `true` when the preferred registration also has a preference row pointing back to `:id` (see `roommate-preferences.spec.md` R5).

R28.4 — `404` if no registration exists with the given `:id`.

R28.5 — Returns an empty `preferences` array (not `404`) when the registration exists but has no preferences entered yet. `version` is `null` in this case.

R28.6 — `version` is `MAX(updated_at)` across this registration's `roommate_preferences` rows (integer, Unix epoch milliseconds). This is the per-registration concurrency token — scoped to preference rows only, not the `registrations.updated_at` column (which tracks registration edits, not preference edits). Clients must store this value and send it back on PUT (R29) and DELETE (R30) to enable optimistic locking (see R29.8, R30.5).

### PUT /api/staff/allocation/registrations/:id/preferences

R29 — Replaces all roommate preferences for a registration. `:id` is the internal numeric registration ID. Full replacement — not a partial update.

R29.1 — Request body:
```json
{
  "preferences": [
    { "preferredRegistrationId": 1050, "preferenceOrder": 1 },
    { "preferredRegistrationId": 1077, "preferenceOrder": 2 }
  ],
  "version": 1721628000000
}
```

R29.2 — Behavior: deletes all existing `roommate_preferences` rows where `registration_id = :id`, then inserts the provided list. An empty `preferences` array clears all preferences (equivalent to `DELETE`, R30).

R29.3 — Validation (see `roommate-preferences.spec.md` R2):
- At most 5 entries.
- `:id` and every `preferredRegistrationId` must have accommodation type `shared_double` or `shared_triple`.
- `:id` and every `preferredRegistrationId` must share the same accommodation type.
- `:id` and every `preferredRegistrationId` must share the same gender.
- No entry's `preferredRegistrationId` may equal `:id` (no self-preference).
- Every `preferredRegistrationId` must reference an existing registration.
- `preferenceOrder` must be an integer 1–5, unique within the request.

R29.4 — `422` on any validation failure, with the specific constraint(s) that failed:
```json
{
  "error": "Preference validation failed",
  "details": {
    "invalid": [
      { "preferredRegistrationId": 1077, "reason": "Different accommodation type" }
    ]
  }
}
```
`reason` values: `"Different accommodation type"`, `"Different gender"`, `"Cannot prefer self"`, `"Registration not found"`, `"Not a shared-accommodation registration"`, `"Maximum 5 preferences allowed"`, `"Duplicate preferenceOrder"`.

R29.5 — `404` if no registration exists with the given `:id`.

R29.6 — On success, returns `200` with the saved preferences and the new version token, same shape as `GET` (R28.1):
```json
{
  "preferences": [
    {
      "preferredRegistrationId": 1050,
      "regCode": "SM26-YYYY",
      "fullName": "Suresh Nair",
      "branch": "EC",
      "gender": "male",
      "preferenceOrder": 1,
      "isMutual": true
    }
  ],
  "version": 1721628500000
}
```
The returned `version` is the new `MAX(updated_at)` after the write. Clients must replace their stored version with this value for the next write — this is what prevents a page instance from conflicting with its own prior saves.

R29.7 — Side effects: `created_by` on each inserted row is set to the authenticated staff user's `userId` (see `roommate-preferences.spec.md` R1.3). Audit entry `preferences_updated`, actor = staff email, records `registrationId` and the new `preferredRegistrationId`/`preferenceOrder` list.

R29.8 — Optimistic locking: `version` is required in the request body. Before any write, the server computes `MAX(updated_at)` from the current `roommate_preferences` rows for `:id` and compares it to the provided `version`:
- If the registration has no existing preferences and `version` is `null` → proceed (first write).
- If the registration has existing preferences and `version` matches `MAX(updated_at)` → proceed.
- Otherwise → `409` with `{ "error": "Preferences were modified by another user. Please reload." }`.

This mirrors the R18.2 optimistic locking pattern for registration edits. The version is scoped per-registration: two staff members editing different registrations never conflict. `version` missing from the request body → `422` with `{ "error": "version is required" }`.

### DELETE /api/staff/allocation/registrations/:id/preferences

R30 — Clears all outgoing roommate preferences for a registration. `:id` is the internal numeric registration ID.

R30.1 — Request body:
```json
{
  "version": 1721628000000
}
```

R30.2 — Deletes all `roommate_preferences` rows where `registration_id = :id`. Does not affect incoming preferences (rows where `:id` is the `preferred_registration_id`) — clearing a registration's own list does not remove other registrations' preferences for it.

R30.3 — `404` if no registration exists with the given `:id`.

R30.4 — On success, returns `204` with no body.

R30.5 — Optimistic locking: `version` is required in the request body. Same check as R29.8 — server computes `MAX(updated_at)` for `:id` and compares to the provided `version`. Mismatch → `409` with `{ "error": "Preferences were modified by another user. Please reload." }`. `version` missing → `422` with `{ "error": "version is required" }`. If the registration has no existing preferences (`version: null`), the DELETE is a no-op and returns `204`.

R30.6 — Side effects: audit entry `preferences_deleted`, actor = staff email, records `registrationId` and count deleted. Distinct from the automatic `preferences_cleaned` audit action triggered by accommodation/gender changes (see `roommate-preferences.spec.md` R6.4) — this is a manual staff-initiated clear.

### PUT /api/staff/allocation/registrations/:id/accommodation

R41 — Converts a registration's accommodation type from `shared_triple` to `shared_double`. This is the only conversion this endpoint performs — one-way, by decision (`docs/decisions/20260803-allocation-scope-upgrade-carveout.md`). `:id` is the internal numeric registration ID.
  Scenario: Given a confirmed `shared_triple` registration, when staff with the `allocation` scope converts it, then its accommodation type is `shared_double` and its status is `pending`.

R41.1 — Request body:
```json
{
  "accommodationType": "shared_double",
  "updatedAt": 1721628000000
}
```
`updatedAt` is the registration concurrency token from the list payload (R27.9). Both fields required; missing or malformed → `422`.

R41.2 — `404` if no registration exists with the given `:id`.

R41.3 — `422` unless the registration's current accommodation type is `shared_triple` and the requested type is `shared_double`. Error: `{ "error": "Only shared_triple to shared_double conversion is allowed" }`. This also covers the race where another staff member already converted the registration.
  Scenario: Given a `shared_double` registration, when a conversion is requested, then the server responds `422` and nothing changes.

R41.4 — Optimistic locking: `409` if `updatedAt` does not equal the registration's current `updated_at`. Error: `{ "error": "Registration was modified by another request. Please reload and try again." }` — the edit path's own error, passed through verbatim. Same token semantics as the staff edit endpoint (see `### PUT /api/staff/registrations/:id`), not the preferences `version` token.
  Scenario: Given a registration edited after the list was fetched, when a conversion is sent with the stale token, then the server responds `409` and nothing changes.

R41.5 — `409` if any of the registration's payments has status `pending_verification` — a conversion is a cost-affecting change and is blocked until the pending payment is verified or rejected (same guard as the staff edit endpoint). Error: `{ "error": "Cannot make cost-affecting changes while a payment is awaiting verification. Verify or reject the pending payment first." }` — the edit path's own error, passed through verbatim.
  Scenario: Given a registration with a `pending_verification` payment, when a conversion is requested, then the server responds `409` and nothing changes.

R41.5.1 — `409` if shared-double room inventory is at capacity: converting triple→double ranks as an accommodation upgrade, and the edit path's capacity guard applies to conversions exactly as to any staff edit (R41.6). Error: `{ "error": "Cannot upgrade accommodation — rooms at capacity" }` — the edit path's own error, passed through verbatim. Operational consequence: shared-double inventory must be provisioned (Rooms page) ahead of a conversion campaign, or conversions are blocked. (Builder finding 2026-08-03; guard inherited via R41.6, documented here — no behavior change.)
  Scenario: Given shared-double inventory fully booked for the registration's dates, when a conversion is requested, then the server responds `409` and nothing changes.

R41.6 — Conversion semantics are identical to a staff edit of the accommodation field (single shared implementation path — no duplicate pricing or status logic):
- The registration total is recomputed by the shared pricing engine (accommodation fee `shared_triple` → `shared_double` per night, plus accommodation GST), and the pricing snapshot is updated.
- The positive difference creates a `payment_pending` payment row (or updates the existing one — at most one exists, see `staff-operations.spec.md` R1.12).
- Registration status is re-derived: a previously `confirmed` registration becomes `pending` until the difference is verified.
- Audit entry recorded with the acting staff email and the field change.
- The payment notification email with a fresh payment link is sent to the attendee (fire-and-forget).
  Scenario: Given a confirmed `shared_triple` registration with 1 night booked, when it is converted, then a `payment_pending` row for the per-night fee difference plus GST exists and the registration status is `pending`.

R41.7 — Roommate preferences involving the converted registration are retained, not deleted — the shared→shared exception to `roommate-preferences.spec.md` R6.1, decided at `docs/decisions/20260803-allocation-scope-upgrade-carveout.md` #5. Preference pairs that become type-mismatched are surfaced by the client as incompatible until staff adjust them.
  Scenario: Given a `shared_triple` registration with 2 preferences, when it is converted, then both preference rows still exist.

R41.8 — Response `200`:
```json
{
  "accommodationType": "shared_double",
  "status": "pending",
  "pendingAmount": 1770,
  "updatedAt": 1721629000000
}
```
The response deliberately excludes the registration total, price breakdown, and donation fields (`access-control.spec.md` R2.6). `updatedAt` is the new concurrency token.

### POST /api/staff/allocation/registrations/:id/payment-link

R42 — Generates a payment link for a listed registration, so branch reps can send it over WhatsApp. Available under the `allocation` scope for any registration in the allocation list (see R27.1) that is not `confirmed` — not only converted ones (decision `20260803-allocation-scope-upgrade-carveout.md`).
  Scenario: Given a `pending` registration in the allocation list, when staff with only the `allocation` scope requests a payment link, then a link is returned.

R42.1 — Response `200`: `{ "link": "<base>/pay/<regCode>?code=<token>" }`. Same link mechanism as the dashboard payment-link endpoints: single-use token row, 24-hour validity, pointing at the attendee payment page.

R42.2 — `404` if no registration exists with the given `:id`. `409` if the registration status is `confirmed`: `{ "error": "Registration is already confirmed" }` (nothing to pay — covers the race where a payment was verified after the list was fetched).
  Scenario: Given a registration that became `confirmed` after the list was fetched, when a link is requested, then the server responds `409`.

R42.3 — Side effects: audit entry `payment_link_generated`, actor = staff email. No email is sent — link delivery is the rep's job (WhatsApp).

R42.4 — The response contains only the link. No amounts, totals, payment history, or donation data (`access-control.spec.md` R2.6).

---

## Scope Middleware Contract

R31 — `requireScope(scope: string)` is the middleware enforcing scoped access on the five route prefixes named in R26 and on the Allocation Endpoints above. Full definition and route mounting: `authentication.spec.md` R15–R16.

R31.1 — Execution order: `authMiddleware` → `requireRole("staff", "admin")` → `requireScope(scope)`. Scope is evaluated only after the role check passes.

R31.2 — Resolution logic, in order:
1. `role === "admin"` → pass. Admins bypass all scope checks.
2. Look up `permissions` for the authenticated `userId` (via the cache, R31.3; falls through to `users` table in D1 on a cache miss).
3. `permissions === null` → pass (full access).
4. `scope` is present in `permissions.scopes` → pass.
5. Otherwise → `403`.

R31.3 — Cache: an in-memory `Map` keyed by `userId`, storing the parsed `scopes` array (or `null` for full access). TTL 5 minutes. On worker isolate cold start the cache is empty; the first lookup for a given `userId` after cold start falls through to a D1 query.

R31.4 — Cache invalidation is TTL-based only — there is no explicit invalidation when an admin changes a user's `permissions`. A permission change can take up to 5 minutes to take effect for that user's in-flight requests (see `authentication.spec.md` R16.3).

R31.5 — Error response on scope failure: `403` with `{ "error": "Insufficient permissions" }` — identical shape to the role-check failure (R1.3).

---

## Admin Endpoints

All require `admin` role.

### POST /api/admin/users

R14 — Creates a staff account. Admin only.

R14.1 — Request body:
```json
{
  "email": "name@example.com",
  "name": "Ravi Kumar",
  "role": "staff",
  "permissions": { "scopes": ["allocation"] }
}
```

R14.1.1 — `permissions` is optional. Omitted or `null` → the account has full access to all staff features (default). When provided, it must be an object with a `scopes` array containing valid scope strings: `"dashboard"`, `"resources"`, `"reports"`, `"allocation"`, `"admin-tools"`, `"bank_txns"`, `"registration_desk"`. Invalid scope strings return `422`. See `user-management.spec.md` R1.1.1.

R14.2 — `role` must be `"staff"`. Creating admin accounts via the API is not permitted — admins are seeded via bootstrap migration only (see `user-management.spec.md` R4).

R14.3 — If the email is already registered as a staff or admin account, returns `409` with `{ "error": "User with this email already exists" }`.

R14.4 — On success, returns `201` with:
```json
{
  "id": 2,
  "email": "name@example.com",
  "name": "Ravi Kumar",
  "role": "staff",
  "isActive": true,
  "permissions": { "scopes": ["allocation"] },
  "createdAt": 1716019200000
}
```

R14.4.1 — `permissions` in the response is `null` when the account has full access, or the `{"scopes": [...]}` object when scopes are configured. See `user-management.spec.md` R1.4.1.

R14.5 — Side effects: a magic link email is sent to the new staff member so they can log in immediately. Audit: `staff_created`.

### GET /api/admin/users

R15 — Lists all staff and admin accounts. Admin only.

R15.1 — Response:
```json
{
  "users": [
    {
      "id": 1,
      "email": "admin@example.com",
      "name": "Admin",
      "role": "admin",
      "isActive": true,
      "permissions": null,
      "createdBy": null,
      "createdAt": 1716019200000
    },
    {
      "id": 2,
      "email": "staff@example.com",
      "name": "Ravi Kumar",
      "role": "staff",
      "isActive": true,
      "permissions": { "scopes": ["allocation"] },
      "createdBy": 1,
      "createdAt": 1716019200000
    }
  ]
}
```

R15.2 — Includes both active and deactivated accounts. `isActive: false` indicates a deactivated account.

R15.3 — `createdBy` is the `id` of the admin who created the account, or `null` for the bootstrap admin.

R15.4 — Ordered: admin accounts first, then staff accounts alphabetically by name.

R15.5 — `permissions` is `null` for full-access accounts, or the `{"scopes": [...]}` object for scoped accounts. See `user-management.spec.md` R2.1.

### PATCH /api/admin/users/:id

R16 — Updates a staff account. Admin only.

R16.1 — Request body (partial update — only provided fields are changed):
```json
{ "name": "New Name" }
```
or
```json
{ "isActive": false }
```
or
```json
{ "permissions": { "scopes": ["allocation", "reports"] } }
```
or any combination together:
```json
{ "name": "New Name", "isActive": true, "permissions": null }
```

R16.2 — Allowed fields: `name`, `isActive`, `permissions`. Attempting to change `role` or `email` is silently ignored (those fields are not updated).

R16.3 — Setting `isActive: false` deactivates the account — the user can no longer request or verify magic links. Any existing JWT remains valid until it expires naturally (see `authentication.spec.md` R11).

R16.4 — Setting `isActive: true` reactivates a deactivated account.

R16.5 — An admin cannot deactivate their own account. If `:id` matches the authenticated admin's `userId`, returns `409` with `{ "error": "Cannot deactivate your own account" }`.

R16.6 — `404` if no user exists with the given `:id`.

R16.7 — On success, returns `200` with the full updated user object (same shape as one item in R15.1).

R16.8 — Audit: `staff_updated` logged with user id and the fields that changed. When `permissions` changes, the audit entry records both the old and new `permissions` values. See `user-management.spec.md` R3.6.

R16.9 — `permissions` can be updated to change a user's access scopes. Setting `permissions: null` restores full access. Setting `permissions: {"scopes": [...]}` restricts access to the listed scopes. Same validation as R14.1.1 (valid scope strings, `422` on invalid). See `user-management.spec.md` R3.1.1.

### POST /api/admin/users/:id/resend-invite

R17 — Resends a magic link login email to an existing staff member. Admin only.

R17.1 — `:id` is the user ID of the staff member.

R17.2 — Generates a new magic link for the user and sends it via email. Any previous unused magic links for this user remain valid (they are not invalidated).

R17.3 — User must be active. If the user has `isActive: false`, returns `409` with `{ "error": "Cannot resend invite to a deactivated account" }`.

R17.4 — `404` if no user exists with the given `:id`.

R17.5 — On success, returns `200` with `{ "ok": true }`.

### POST /api/admin/users/:id/generate-login-link

R43 — Generates a copyable staff login URL. Admin only.

R43.1 — `:id` is the user ID of the target staff member.

R43.2 — Returns `404` with `{ "error": "Not found" }` when no user exists with
the given `:id`.

R43.3 — The target must have role `staff`. Admin targets return `409` with
`{ "error": "Can only generate login links for staff accounts" }`.

R43.4 — The target must be active. Deactivated targets return `409` with
`{ "error": "Cannot generate login link for a deactivated account" }`.

R43.5 — Generates a new single-use magic link that expires in 10 minutes. The
link uses the standard `/auth/verify?token=...` flow. Existing unused links are
not invalidated.

R43.6 — On success, returns `200` with:
```json
{
  "link": "https://beta.example.com/auth/verify?token=...",
  "expiresIn": 10
}
```

R43.7 — The new action does not send email. The raw token is not stored in the
database or audit record.

R43.8 — Audit: `login_link_generated` records the admin email as actor, the
target user ID, target type `user`, target email, role, and expiry duration.

---

## Dependencies

- Auth model: `authentication.spec.md` (roles, JWT, magic links, middleware, scoped permissions R13–R17)
- Payment lifecycle: `payment-flow.spec.md` (verify/reject transitions)
- Attendee API: `submission-api.spec.md` (shared error contract, proof upload format)
- Service logic: `staff-operations.spec.md` (audit requirements)
- User management: `user-management.spec.md` (business rules)
- Roommate preferences: `roommate-preferences.spec.md` (data model, constraints, mutual detection, data integrity)
