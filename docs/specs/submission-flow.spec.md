# Spec: Registration Submission & Payment Flow

## Overview

One user action (submission) creates the registration and an initial pending payment record for non-zero totals. The user then sees bank details, completes a manual transfer, and uploads proof. Payment verification is manual — a committee member reviews and approves proof uploads. The confirmation page fetches data via `/me` using the stored JWT.

## Flow

```
Client (Step 6: Review & Pay)
  │
  ├─ POST /api/registrations (all wizard data)
  │    Server: validate → compute pricing → atomic insert (registration +
  │            attendees + ID doc record + payment record) → generate JWT
  │            → audit log (action: 'created') → email (async)
  │    Returns: { regId, regCode, token, status: 'pending', pricingBreakup, paymentUrl }
  │
  ├─ Client stores JWT + regCode in localStorage
  │
  ├─ Client navigates to bank details page (or redirects to next step at /payment/:id)
  │    Shows: bank account details, UPI (if country is India), total amount
  │           Cost breakdown popup available
  │
  ├─ User completes bank transfer manually (may take hours/days)
  │
  ├─ User uploads payment proof (screenshot/receipt)
  │    POST /api/registrations/:regCode/pay/upload-proof (multipart)
  │    Server: store proof in R2 → payment: pending_verification
  │            → registration: pending_verification
  │            → audit (action: 'proof_uploaded')
  │    Returns: { status: 'pending_verification' }
  │
  ├─ Committee reviews proof (manual, post-V1 admin UI; V1: direct DB update)
  │    └── Approved (full) → payment: verified, registration: confirmed
  │                          (only when sum(verified payments) >= total_amount)
  │                          Audit: payment_verified → email (async)
  │    └── Approved (partial/shortfall) → payment: verified for actual amount
  │                          received; registration returns to pending; staff
  │                          separately creates a payment_pending record for
  │                          the remainder (see payment-flow.spec.md R7.20–R7.21)
  │
  └─ User returns to confirmation to check status
       GET /api/registrations/me (Authorization: Bearer <token>)
       Shows: "Verification in progress" when pending_verification
              Full confirmation when confirmed
```

## Endpoints

### POST /api/registrations (public)

Creates a new registration. No auth required — this is the first interaction.

**Request:** `SubmitRegistrationRequest` (= `RegistrationData` minus `registrationRef`)

**Server does (in order):**
1. Validate with shared Zod schemas (all steps)
2. Compute pricing server-side using shared engine
2a. **Enforce total > 0 gate:** if the computed total is ≤ 0, return `400` with `{ "error": "Registration total must be greater than zero" }`. No writes occur. (Every registration requires payment — see `submission-api.spec.md` R3.15.1.)
3. Generate 16-char registration code (SMRT + 12 Crockford base32)
4. Atomic insert via `createWithRelations()`: registration row, attendees, ID document record (if provided — file must already be in R2 before submission), and payment record (`status: "payment_pending"`) in one operation. Payment creation is unconditional — the total > 0 gate (step 2a) ensures every submission that reaches this point has a positive total.
5. Sign JWT with `{ sub: id, reg: regCode, role: 'attendee' }` (see submission-api.spec.md R1.3)
6. Audit entry (action: 'created', full snapshot). Failure is logged, not thrown.
7. Send confirmation email (async, non-blocking)

**Note:** Payment is NOT sent to any external gateway. The user pays via bank transfer and uploads proof. The server just creates the pending payment record.

**Response:**
```typescript
{
  regId: string;            // internal numeric ID (e.g. "1001")
  regCode: string;          // public 16-char code (e.g. "SMRTABC123DEF456")
  token: string;            // JWT for subsequent calls
  status: 'pending';        // pending until payment verified
  pricingBreakup: PricingBreakup;
  paymentUrl: string;       // URL to bank details page using numeric id (e.g. "/payment/1001"), always non-empty (zero-total submissions are rejected)
}
```

**Failure modes:**
- Zod schema validation fails → 400 with field errors
- Computed total ≤ 0 → 400 with `{ "error": "Registration total must be greater than zero" }` (see step 2a)
- D1 write fails → 500, client retries
- Email fails → silent, non-blocking

### POST /api/registrations/:regCode/pay/upload-proof (auth required)

Uploads payment proof (screenshot/receipt) for the pending payment.

**Request:** Multipart form data with the proof file.

**Server does:**
1. Look up registration by regCode
2. Verify JWT regCode claim matches
3. Find the most recent payment record with `status: "payment_pending"`
4. Store proof file in R2 at `payment-proofs/{regCode}-{paymentId}-{slugifiedFileName}`
5. Update payment record: status → `pending_verification`, proof file key set
6. Update registration status → `pending_verification`
7. Audit entry (action: 'proof_uploaded')
8. Return `{ status: 'pending_verification' }`

**Failure modes:**
- File exceeds 5MB → 400
- Invalid file type → 400
- No pending payment found → 409
- Registration not found → 404

### GET /api/registrations/me (auth required)

Returns the registration for the authenticated user. Same as current implementation, but `status` can now be `"pending"`, `"pending_verification"`, or `"confirmed"`.

**Response:** `RegistrationResponse` — full registration details including status, pricing breakup, attendees.

### GET /api/registrations/:id (auth required)

Same as `/me` but by explicit numeric registration ID. JWT `sub` claim must match the requested `:id`.

## Authentication

(V1 same as current — JWT issued on submission, stored in localStorage, 90-day expiry)

## R2 File Storage

ID documents and payment proofs are stored in Cloudflare R2:

- ID docs: `id-docs/:regCode/:originalFileName`
- Payment proofs: `payment-proofs/{regCode}-{paymentId}-{slugifiedFileName}` (flat key, filename slugified: lowercase, non-alphanumeric → hyphen, max 30 chars + extension)

## Payment Proof Page

A page at `/payment/:id` (numeric registration ID, replaces the old `/payment-mock`) that:
- Reads regCode from URL and registration data from the server via `/me`
- Displays bank details from client-side constants (encoded to reduce scraping)
- Shows UPI section when country is "India" (case-insensitive)
- Shows cost breakdown popup (main attendee registration fee utilization)
- Provides upload section for payment proof (drag-and-drop or file picker)
- Redirects to `/confirmation/:id` after successful proof upload
- Handles error states (upload failure, file too large, etc.)
- Persists across sessions — user can leave and return to same page

## Current State

| Component | Status |
|-----------|--------|
| D1 schema (6 tables) | Built (needs: payment proof columns) |
| Domain types + coercion | Built (needs: new payment statuses) |
| Registration code generation | Built |
| Audit diff/snapshot | Built |
| Repository interfaces + implementations | Built (needs: proof upload support) |
| R2 file storage adapter | Built |
| RegistrationService | Built (needs: remove gateway initiation) |
| PaymentService | Needs significant update |
| PricingService | Built |
| JWT sign/verify | Built |
| Auth middleware | Built |
| Error middleware | Built |
| POST /api/registrations | Built (needs: remove gateway initiation) |
| GET /api/registrations/me | Built (needs: return new statuses) |
| GET /api/registrations/:regCode | Built (needs: return new statuses) |
| POST /api/registrations/:regCode/pay/upload-proof | Not built |
| GET /api/bank-details | Not built (removed — bank details hardcoded in client) |
| Bank details page (replaces MockPaymentPage) | Not built |
| Cost breakdown popup | Not built |
| Confirmation page (pending_verification state) | Needs update |
