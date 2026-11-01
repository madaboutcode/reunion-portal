# Specification: Submission API

## Purpose

The HTTP API that the registration SPA calls to submit a registration, upload payment proof, retrieve bank details, and check registration status.

## Contents

- [Scope](#scope)
- [Authentication](#authentication)
- [Error Contract](#error-contract)
- [Endpoints](#endpoints)
  - [POST /api/registrations](#post-apiregistrations)
  - [GET /api/registrations/me](#get-apiregistrationsme)
  - [GET /api/registrations/:regCode](#get-apiregistrationsid)
  - [POST /api/registrations/:regCode/pay/upload-proof](#post-apiregistrationsregcodepayupload-proof)
- [Request and Response Shapes](#request-and-response-shapes)
- [States](#states)
- [Dependencies](#dependencies)

## Scope

**Covers:** All V1 API endpoints consumed by the registration SPA — submission, payment proof upload, and registration retrieval. Authentication contract (JWT Bearer). Error response shapes. The mapping between client-side `Registration` (canonical domain model) and server-side storage.

**Does not cover:** Staff/admin endpoints (see `staff-operations.spec.md`, `user-management.spec.md`). Magic link auth flow (see `authentication.spec.md`). Amendment endpoints, real payment gateway integration, email delivery internals.

---

## Authentication

R1 — The API uses JWT Bearer tokens for authentication.

R1.1 — Authenticated endpoints require an `Authorization: Bearer <token>` header. Requests without this header receive `401` with `{ "error": "Missing authorization header" }`.

R1.2 — Requests with a malformed or expired token receive `401` with `{ "error": "Invalid or expired token" }`.

R1.3 — The JWT payload shape is:

```json
{
  "sub": "<internal registration id (number, stringified, starts at 1001)>",
  "reg": "<16-char registration code (SMRT + 12 Crockford base32 chars)>",
  "role": "attendee",
  "iat": 1234567890,
  "exp": 1237159890
}
```

R1.4 — Tokens are signed with HS256 using a server-side secret. The signing algorithm and secret are not exposed to the client.

R1.5 — Token expiry is 90 days from issuance.

R1.6 — The token is issued in the `POST /api/registrations` response body. The client stores it in `localStorage` and sends it on all subsequent API calls.

R1.7 — On authenticated endpoints, the server extracts `sub` (internal registration ID), `reg` (public regCode), and `role` from the verified token and makes them available to the endpoint handler.

R1.8 — When a protected endpoint receives a valid token but the referenced registration does not exist, the response is `404` with `{ "error": "Registration not found" }`.

---

## Error Contract

R2 — All error responses use the `ApiError` shape:

```json
{
  "error": "<human-readable message>",
  "details": "<optional, structure varies by error type>"
}
```

R2.1 — Validation errors (400) include field-level details:

```json
{
  "error": "Validation failed",
  "details": {
    "fieldErrors": {
      "fullName": "Required",
      "email": "Invalid email"
    }
  }
}
```

R2.2 — `details.fieldErrors` is a flat object mapping field paths to error messages. Nested fields use dot notation (e.g., `"children.0.name"`).

R2.3 — Authentication errors (401) never include `details` — only `error`.

R2.4 — Authorization errors (when the token is valid but doesn't match the requested resource) return `403` with `{ "error": "Not authorized" }`.

R2.5 — Server errors (500) return `{ "error": "Internal server error" }` with no `details`.

R2.6 — Not found errors (404) return `{ "error": "Registration not found" }`.

R2.7 — Conflict errors (409) occur when the requested action is not possible in the current state (e.g., uploading proof when no pending payment exists).

---

## Endpoints

### POST /api/registrations

**Auth:** None required — this is the first interaction.

R3 — Accepts a `SubmitRegistrationRequest` body (JSON) and creates a new registration.

R3.1 — The request body is a canonical `Registration` shape (see `src/shared/src/types.ts`). The server validates via `registrationSchema`.

R3.2 — The server validates the request body against the canonical `registrationSchema` (see `registration-schema.ts`). If validation fails, the response is `400` with field errors per R2.1.

R3.2.1 — `contributionSplits` (optional) is a cause-keyed map of college contribution amounts. Keys must be known cause values (`green_energy`, `scholarship`); each amount must be a positive integer. Unknown keys or non-positive amounts are rejected with `400`. The map is persisted with the registration and surfaced in per-cause reporting.

R3.3 — The server computes pricing server-side using the shared pricing engine (see `pricing-engine.spec.md`). The client's pricing is decorative — the server recomputes from the submitted data and the current `PricingConfig`.

R3.4 — On success, the response is `201` with:

```json
{
  "regId": "1001",
  "regCode": "SMRTABC123DEF456",
  "token": "<JWT>",
  "status": "pending",
  "pricingBreakup": {
    "base": 2000,
    "lines": [
      { "label": "Alumni registration", "fee": 2000, "free": false },
      { "label": "Spouse", "fee": 1500, "free": false }
    ],
    "donation": 500,
    "total": 4000
  },
  "paymentUrl": "/payment/1001"
}
```

R3.5 — `regId` is the internal numeric autoincrement ID (stringified, starting at 1001). `regCode` is the public-facing 16-character registration code (SMRT prefix + 12 chars from Crockford base32).

R3.6 — `status` is always `"pending"` on creation. Payment proof upload transitions it to `"pending_verification"`. Committee verification transitions it to `"confirmed"` only when `sum(verified payments) >= total_amount`. Otherwise the registration returns to `"pending"` and a separate `payment_pending` record is created for the shortfall amount (see `payment-flow.spec.md` R7.20–R7.21).

R3.7 — `paymentUrl` is the URL to the bank details page, using the numeric registration ID (e.g. `/payment/1001`). `paymentUrl` is always non-empty — the server rejects any submission where the computed total is ≤ 0 (see R3.15.1 below), so a zero-total response can never reach the client.

R3.8 — `token` is the JWT described in R1.3. The client stores it in `localStorage` before navigating to the payment page.

#### Side Effects

R3.9 — Registration and attendees are created in a two-phase insert: the registration row is created first, then attendees are inserted with the correct foreign key.

R3.10 — The pricing snapshot is frozen at submission time.

R3.11 — ID document upload is independent of registration creation. If the file fails to store, the registration still succeeds.

R3.12 — A payment record is always created with `status: "payment_pending"`. No external gateway is called — the user pays via bank transfer. There is no conditional on the total: because the server rejects zero-total submissions (R3.16), every successful response has a positive total and requires payment.

R3.13 — A confirmation email is triggered but does not affect the response.

#### Failure Modes

R3.14 — If the atomic write fails, the response is `500`.

R3.15 — Email must be unique across registrations. If a registration with the same email already exists, the response is `409` with `{ "error": "A registration with this email already exists" }`.

R3.15.1 — The server rejects any submission where the server-computed total is ≤ 0. Every registration requires payment. If the pricing engine returns a total of ≤ 0, the response is `400` with `{ "error": "Registration total must be greater than zero" }`. This check occurs after pricing computation (step 3) and before any writes. This gate is a server-side business rule enforcement — it is not a pricing engine concern — but it depends on the pricing result.

---

### GET /api/registrations/check-email

**Auth:** None required — public endpoint.

R3.16 — Accepts a query parameter `email` and returns whether a registration exists for that email.

R3.16.1 — Request: `GET /api/registrations/check-email?email=<email>`

R3.16.2 — Response is `200` with `{ "registered": boolean }`.

R3.16.3 — If `email` query param is missing or empty, the response is `400` with `{ "error": "Missing email parameter" }`.

R3.16.4 — The email is normalized to lowercase before lookup.

R3.16.5 — Rate limited: 10 requests per minute per IP.

---

### GET /api/registrations/me

**Auth:** Required (R1).

R4 — Returns the registration for the authenticated user. The JWT `sub` claim contains the internal registration ID.

R4.1 — Response is `200` with:

```json
{
  "registration": {
    "regId": "A1B2C3D4E5F6",
    "regCode": "SMRTABC123DEF456",
    "status": "pending_verification",
    "contact": { ... },
    "attendance": { ... },
    "attendees": { ... },
    "accommodation": { ... },
    "donation": { ... },
    "idDocument": { ... },
    "pricingBreakup": { ... },
    "createdAt": 1716019200000
  }
}
```

R4.2 — `status` can be: `"pending"` (awaiting payment — either no payment yet, or a shortfall remains after a partial committee verification), `"pending_verification"` (proof uploaded, under review), or `"confirmed"` (sum of verified payments meets `total_amount`).

R4.3 — If the registration referenced by the JWT does not exist, the response is `404` per R2.6.

---

### GET /api/registrations/:id

**Auth:** Required (R1).

R5 — Returns the same response as `/me` (R4.1), but identified by the numeric registration ID.

R5.1 — The JWT's `sub` claim must match the `:id` parameter. If they don't match, the response is `403` per R2.4.

R5.2 — If the registration with the given `:id` does not exist, the response is `404` per R2.6.

---

### POST /api/registrations/:regCode/pay/upload-proof

**Auth:** Required (R1).

R6 — Uploads payment proof (screenshot or receipt) for the pending payment.

R6.1 — The JWT's `regCode` claim must match the `:regCode` parameter. If they don't match, the response is `403` per R2.4.

R6.2 — Request is multipart form data with a single file field (the proof image or PDF).

R6.3 — Accepted file types: JPG, JPEG, PNG, PDF. Maximum file size: 5 MB (5,242,880 bytes).

R6.4 — The server finds the most recent payment record with `status: "payment_pending"` for this registration and attaches the proof to it.

R6.5 — On success, the response is `200` with:

```json
{
  "status": "pending_verification",
  "message": "Payment proof uploaded, awaiting verification"
}
```

#### Side Effects

R6.6 — The proof file is stored in R2 at key: `payment-proofs/{regCode}-{paymentId}-{slugifiedFileName}` (flat key, hyphen-separated; fileName is slugified: lowercase, non-alphanumeric characters replaced with hyphens, max 30 chars + extension).

R6.7 — The payment record's `proof_file_key` is set to the R2 key.

R6.8 — The payment status transitions to `pending_verification`.

R6.9 — The registration status transitions to `pending_verification`.

R6.10 — An audit entry is logged with `action: "proof_uploaded"`.

#### Failure Modes

R6.11 — If no eligible payment record exists (no record with status `payment_pending`), the response is `409` with `{ "error": "No pending payment found for proof upload" }`.

R6.12 — If the file type is not accepted, the response is `400` with `{ "error": "Invalid file type", "details": { "allowedTypes": ["image/jpeg", "image/png", "application/pdf"] } }`.

R6.13 — If the file exceeds the size limit, the response is `400` with `{ "error": "File too large", "details": { "maxSizeMB": 5 } }`.

---

## Request and Response Shapes

R7 — The API accepts and returns data in the canonical `Registration` shape defined in `@smriti/shared`.

R7.1 — The submission request body is a canonical `Registration`. The client converts from its `WizardDraft` to `Registration` via `toRegistration()` before submission.

R7.2 — The response from `GET /registrations/me` and `GET /registrations/:regCode` returns data in the canonical `Registration` shape, augmented with server-generated fields (`regId`, `regCode`, `status`, `pricingBreakup`, `createdAt`).

R7.3 — The `status` field in registration responses is one of: `"pending"`, `"pending_verification"`, `"confirmed"`.

---

## States

The registration lifecycle as seen by the API consumer:

```
(nothing) ──POST /registrations──▶ pending
                                       │
                         upload proof ─┘
                                       │
                                       ▼
                              pending_verification
                                       │
                            committee verification
                                       │
                         ┌─────────────┴─────────────┐
                sum(verified) >= total_amount   sum(verified) < total_amount
                         │                             │
                         ▼                             ▼
                     confirmed                  pending (shortfall)
                                          payment_pending record created
                                          for the remainder; client uploads
                                          proof again to re-enter
                                          pending_verification
```

| State | Meaning | What the client can do |
|-------|---------|----------------------|
| No registration | User hasn't submitted yet | Submit via POST /registrations |
| `pending` | Registration created, awaiting payment proof (either no payment yet, or a shortfall remains after a partial verification) | View via /me, upload proof via /pay/upload-proof |
| `pending_verification` | Proof uploaded, under committee review | View via /me, check status |
| `confirmed` | Sum of verified payments meets or exceeds `total_amount` | View via /me |

Note: `pending_verification` does not always advance to `confirmed`. Committee verification may be partial (see `payment-flow.spec.md` R7.20), leaving an uncovered shortfall — in that case the registration returns to `pending` with a new `payment_pending` record rather than reaching `confirmed`.

---

## Edge Cases

- If the client submits with `attendance: { intent: "donation_only" }`, at least one of a positive donation or a non-empty `contributionSplits` map is required (enforced by `registrationSchema`). The pricing engine returns the donation plus the sum of contribution splits (see `pricing-engine.spec.md` R9).
- The `country` field defaults to `"India"` if not provided. This determines whether UPI details are shown on the payment page.
- A user can upload proof multiple times for the same payment. Each upload replaces the previous proof file.

---

## Rate Limits

All public endpoints are rate limited per IP using a sliding window.

| Endpoint | Limit |
|----------|-------|
| `POST /api/registrations` | 5 requests / minute |
| `POST /api/registrations/lookup` | 20 requests / minute |
| `GET /api/registrations/check-email` | 10 requests / minute |
| `POST /auth/magic-link` | 5 requests / minute |
| `GET /auth/verify` | 10 requests / minute |

R8 — When the rate limit is exceeded, the response is `429` with `{ "error": "Too many requests. Try again later." }`.

---

## Dependencies

- Parent flow: `submission-flow.spec.md`
- Payment lifecycle: `payment-flow.spec.md` (status transitions, verification)
- Pricing: `pricing-engine.spec.md`
- Validation: `validation.spec.md`
- Confirmation UI: `confirmation.spec.md`
- Step 5 UI: `step5-review-pay.spec.md`
