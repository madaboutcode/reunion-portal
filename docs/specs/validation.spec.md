# Specification: Validation Contract

## Purpose

Defines the validation rules applied to registration data at each step of the wizard, and the pre-payment business logic checks. Two separate validation regimes exist: per-step schemas (UX-level, applied one step at a time) and `validateForPayment` (pre-submission checklist against the full draft).

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [General Rules](#general-rules)
  - [Shared Sub-schemas](#shared-sub-schemas)
  - [Step 1 — Participation](#step-1--participation)
  - [Step 2 — Alumni Details (alumniDetailsSchema)](#step-2--alumni-details)
  - [Step 3 — Attendees & Meals (attendeesMealsSchema)](#step-3--attendees--meals)
  - [Step 4 — Accommodation (accommodationSchema)](#step-4--accommodation)
  - [Step 5 — Giving Back (givingBackSchema)](#step-5--giving-back)
  - [Step 6 — Photo & ID (photoIdSchema)](#step-6--photo--id)
  - [validateForPayment — Pre-Submission Checks](#validateforpayment--pre-submission-checks)
- [Known Gaps](#known-gaps)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

---

## Scope

**Covers:** Per-step Zod schemas (`participationSchema`, `alumniDetailsSchema`, `attendeesMealsSchema`, `accommodationSchema`, `givingBackSchema`, `photoIdSchema`), shared sub-schemas (`childSchema`, `guestSchema`), file-upload constants, and the `validateForPayment` function in `review-validation.ts`.

**Does not cover:** `registrationSchema` (the canonical API-boundary schema in `registration-schema.ts` — that is stricter and enforces the nested `Registration` shape), UI error display timing, server-side re-validation implementation.

---

## Requirements

### General Rules

R1 — Per-step schemas validate only the fields for that step. They are applied when the user taps "Continue" on a step, not on every keystroke.

R1.1 — Per-step schemas are lenient where a field is structurally present but may be unfilled (e.g., spouseName is optional). `registrationSchema` is the authority for completeness at the API boundary.

R1.2 — `validateForPayment` runs against the flat `WizardDraft` shape (from localStorage). It does not re-run Zod schemas — it applies business logic checks only.

R1.3 — Step 7 (Review & Pay) has no dedicated schema. Its validation surface is `validateForPayment`.

### Shared Sub-schemas

R2 — `childSchema` validates one child entry:

| Field | Rule |
|-------|------|
| `id` | string, required |
| `name` | string, optional, defaults to `""` |
| `age` | number, min 0, max 99 |
| `meal` | enum: `"veg"` or `"non_veg"`, required |

R2.1 — Age 0 is valid (newborns). Age 99 is valid (boundary). Age -1 and 100 are rejected.

R3 — `guestSchema` validates one guest entry:

| Field | Rule |
|-------|------|
| `id` | string, required |
| `name` | string, optional, defaults to `""` |
| `relationship` | string, optional, defaults to `""` |
| `meal` | enum: `"veg"` or `"non_veg"`, required |

R3.1 — An invalid meal value (e.g., `"vegan"`) is rejected on both `childSchema` and `guestSchema`.

### Step 1 — Participation

R3.5 — `participationSchema` validates the participation type selection:

| Field | Rule |
|-------|------|
| `participationType` | enum: `"full_celebration"`, `"campus_only"`, `"donation_only"`, required |

R3.5.1 — `attendanceIntent` is derived from `participationType` at mapping time and is NOT validated in `participationSchema`. The field is not collected from the user in this step.

### Step 2 — Alumni Details

R4 — `alumniDetailsSchema` validates the following fields:

| Field | Rule |
|-------|------|
| `fullName` | string, min 1 |
| `branch` | string, min 1 (any non-empty string — no enum restriction) |
| `gender` | enum: `"male"` or `"female"` |
| `email` | string, min 1, valid email format |
| `whatsapp` | string, min 1, then refined (see R4.1) |
| `mobileAlternate` | string, optional |
| `city` | string, min 1 |
| `country` | string, min 1 (required — see Known Gaps G1) |

R4.1 — `alumniDetailsSchema` `whatsapp` cross-field refinement (via `superRefine`):
- Must start with `"+"`. Error: `"Include your country code (e.g. +91)"`.
- After stripping non-digit characters, must have at least 7 digits. Error: `"Enter a valid phone number"`.
- Spaces in the number are allowed — digits are counted after stripping all non-digits.

R4.2 — `mobileAlternate` is optional with no format validation applied.

R4.3 — `gender` is a required enum field. Any value outside the enum is rejected.

R4.4 — `attendanceIntent` is NOT a field on `alumniDetailsSchema`. It is derived from `participationType` at mapping time.

### Step 3 — Attendees & Meals

R5 — `attendeesMealsSchema` validates the following fields:

| Field | Rule |
|-------|------|
| `alumniMeal` | enum: `"veg"` or `"non_veg"`, required |
| `tshirtSize` | enum: `"2XS"`, `"XS"`, `"S"`, `"M"`, `"L"`, `"XL"`, `"2XL"`, `"3XL"`, `"4XL"`, `"5XL"`, `"6XL"`, required |
| `spouseName` | string, optional, defaults to `""` |
| `spouseMeal` | enum: `"veg"` or `"non_veg"`, optional, defaults to `"veg"` |
| `children` | array of `childSchema` |
| `guests` | array of `guestSchema` |

R5.1 — Empty arrays for `children` and `guests` are valid.

R5.2 — `spouseName` is unconditionally optional in `attendeesMealsSchema`. The `hasSpouse` toggle is local component state, not in the draft. No cross-field rule enforces a non-empty name when a spouse is toggled on. (See Known Gaps G2.)

R5.3 — An invalid child or guest entry (e.g., bad age, bad meal value, missing id) causes the step to fail.

### Step 4 — Accommodation

R6 — `accommodationSchema` validates accommodation fields only. Donation fields are not part of this schema (they moved to the GivingBack step):

R6.1 — `accommodationSchema` fields (validates alone — no donation merge):

| Field | Rule |
|-------|------|
| `accommodation` | enum: `"none"`, `"private"`, `"shared_double"`, `"shared_triple"`, required |
| `extraBed` | boolean, optional, defaults to `false` |
| `checkIn` | string, optional, defaults to `""` |
| `checkOut` | string, optional, defaults to `""` |

R6.2 — `accommodationSchema` has no cross-field rules. All date constraints are business logic applied only in `validateForPayment`, not in the per-step schema. Specifically:
- `checkIn` / `checkOut` are not required by `accommodationSchema` even when accommodation is not `"none"`. (See Known Gaps G3.)

R6.3 — `accommodationSchema` is skipped entirely for `campus_only` and `donation_only` participation types (the step is not visited).

### Step 5 — Giving Back

R7 — `givingBackSchema` handles both college contribution and reunion donation validation via `superRefine`, replacing the previous manual `setDonationError` pattern.

R7.0 — `givingBackSchema` college contribution fields:

| Field | Rule |
|-------|------|
| `collegeContribution` | number (not string), min 0 |
| `collegeContributionCause` | string, optional, defaults to `""` |

R7.0.1 — The minimum additional contribution is ₹0 (no floor — user may add nothing). Error on negative values: `"Contribution cannot be negative"`.

R7.0.2 — The `superRefine` in `givingBackSchema` branches on `participationType`:
- For ALL participation types: when `collegeContribution` > 0, `collegeContributionCause` must be one of the known cause values (`CONTRIBUTION_CAUSE_VALUES`). Error on `collegeContributionCause`: `"Select a cause for your contribution."` No cause is required at ₹0.
- When `participationType` is `full_celebration` or `campus_only`: enforces minimum college contribution (≥ 0).
- When `participationType` is `donation_only`: requires at least one of (parsed `donationAmount`, `collegeContribution`) > 0. Error on `donationAmount`: `"Add a donation or a college contribution to continue."`

R7.0.3 — A string `"500"` is rejected (type must be `number`). A float `500.5` passes (schema uses `z.number()`, not `z.int()`). See Known Gaps G5.

R7.1 — `donationSchema` fields (shared sub-schema, merged into `givingBackSchema`):

| Field | Rule |
|-------|------|
| `donationAmount` | string, optional, defaults to `""` |
| `publicAcknowledgement` | boolean, optional, defaults to `false` |
| `acknowledgementDisplayName` | string, optional, defaults to `""` |
| `felicitationConsent` | boolean, optional, defaults to `false` |

R7.2 — `givingBackSchema` conditional rules via `superRefine`:
- For `donation_only`: at least one positive amount is required (see R7.0.2). `donationAmount` alone is not individually required.
- For attending types: no donation requirement — `donationAmount` may be zero or empty.
- `acknowledgementDisplayName` is not required when `publicAcknowledgement` is `true`. (See Known Gaps G4.)
- `donationAmount` as a non-numeric string (e.g., `"abc"`) passes the structural schema. Parsing happens in `superRefine` and downstream in `validateForPayment`.

Note: The previously described `step3Schema` (accommodation merged with donation) no longer exists. `accommodationSchema` validates alone (wizard step 4). `givingBackSchema` handles the giving back step (wizard step 5) independently.

### Step 6 — Photo & ID

R8 — `photoIdSchema` validates photo and optional ID upload fields.

R8.1 — Photo fields:

| Field | Rule |
|-------|------|
| `photoFileName` | string, min 1 — required ("Upload a photo") |
| `photoFileKey` | string, optional |
| `photoFileType` | string, optional |
| `photoFileSizeBytes` | number, optional |

R8.2 — `photoIdSchema` photo cross-field refinements (via `superRefine`):
- When `photoFileName` is non-empty and `photoFileKey` is absent: error on `photoFileKey` — `"Photo upload is incomplete — please wait for the upload to finish"`.
- When `photoFileType` is present: MIME type must be `"image/jpeg"` or `"image/png"`, and `photoFileSizeBytes` must be > 0 and ≤ `MAX_PHOTO_FILE_SIZE` (10 MB). Error on `photoFileType`: `"Photo must be a JPEG or PNG and no larger than 10 MB"`.

R8.3 — ID document fields:

| Field | Rule |
|-------|------|
| `idFileName` | string, optional, defaults to `""` |
| `idFileType` | string, optional |
| `idFileSizeBytes` | number, optional |
| `idNote` | string, optional, defaults to `""` |

R8.4 — ID cross-field refinement: when `idFileType` is present, the type must be `"image/jpeg"`, `"image/png"`, or `"application/pdf"`, and `idFileSizeBytes` must be > 0 and ≤ `MAX_ID_FILE_SIZE` (5 MB). Error on `idFileType`: `"ID file must be JPEG, PNG, or PDF and no larger than 5 MB"`.

R8.5 — ID upload is optional in `photoIdSchema`. Whether an ID is required at the payment stage is determined by `validateForPayment`, not the per-step schema.

R8.6 — File size constants:

| Constant | Value |
|----------|-------|
| `MAX_PHOTO_FILE_SIZE` | 10 MB (10 × 1024 × 1024 bytes) |
| `MAX_ID_FILE_SIZE` | 5 MB (5 × 1024 × 1024 bytes) |

### validateForPayment — Pre-Submission Checks

R9 — `validateForPayment(draft: WizardDraft)` returns `{ ready: boolean, issues: ReviewIssue[] }`. Each `ReviewIssue` carries `{ section, step, field, message }` for routing the user back to the relevant step.

R10 — Step 1 check (all participation types):

| Field | Check | Message |
|-------|-------|---------|
| `participationType` | present, valid enum value | "Select how you're joining" |

R10.1 — Step 2 checks (all participation types):

| Field | Check | Message |
|-------|-------|---------|
| `fullName` | non-empty after trim | "Add your full name" |
| `branch` | non-empty after trim | "Select your branch" |
| `email` | non-empty after trim | "Add your email address" |
| `whatsapp` | stripped digits ≥ 7 | "Add your WhatsApp number" |
| `city` | non-empty after trim | "Add your city" |

R10.2 — `country` is not checked in `validateForPayment`.

R11 — Donation-only short-circuit: when `participationType === "donation_only"`, after Step 2 checks, only the following are checked, then the function returns:

| Field | Check | Message |
|-------|-------|---------|
| `donationAmount` | at least one of parsed `donationAmount` and `collegeContribution` is > 0 | "Add a donation or a college contribution" |
| `collegeContributionCause` | a known cause is selected when `collegeContribution` > 0 | "Select a cause for your contribution." |
| `photoFileKey` | present | "Upload a photo" |

R11.1 — No Step 3 or 4 checks run for `donation_only` (those steps are skipped). The Step 5 checks above (amounts + cause) are the only giving-back checks for this path.

R12 — Step 3 checks (`full_celebration` and `campus_only`):

| Field | Check | Message |
|-------|-------|---------|
| `tshirtSize` | present | "Select your t-shirt size" |
| `alumniMeal` | present | "Pick your meal preference" |

R13 — Step 4 checks (`full_celebration` only — skipped for `campus_only` and `donation_only`):

R13.1 — Shared accommodation solo rule: when `accommodation` is `"shared_double"` or `"shared_triple"` and any of `spouseName.trim().length > 0`, `children.length > 0`, or `guests.length > 0` are true: error on `accommodation` — "Shared room is only available for solo attendees — choose Private Room or No Accommodation".

R13.2 — Dates required when booked: when `accommodation !== "none"`:
- Empty `checkIn` → error on `checkIn`: "Select a check-in date"
- Empty `checkOut` → error on `checkOut`: "Select a check-out date"

R14 — Step 5 checks (`full_celebration` and `campus_only`): `collegeContribution` (the optional additional amount) must be ≥ 0. Negative values: error on `collegeContribution` — `"College contribution cannot be negative"`. A value of 0 or any positive number is valid.

R14.1 — When `collegeContribution` > 0 and `collegeContributionCause` is not a known cause value, an issue is added on `collegeContributionCause` (step 5, section `giving_back`): `"Select a cause for your contribution."` This check applies to attending types here and to `donation_only` in R11.

R15 — Step 6 checks (all non-donation-only participation types):

| Field | Check | Message |
|-------|-------|---------|
| `photoFileKey` | present | "Upload a photo" |
| `idFileKey` | present when ID is required | "Upload an ID document — needed for venue check-in" |

R15.1 — ID is required (`isIdRequired` logic):
- Always required when `participationType === "full_celebration"`.
- Always required when `participationType === "campus_only"`.
- Not required for `donation_only`.

R15.2 — Photo (`photoFileKey`) is required for all participation types, including `donation_only` (enforced in the donation-only branch, R11).

R16 — All issues are accumulated and returned together. The function does not short-circuit after the first issue (except for the `donation_only` early return at R11).

---

## Known Gaps

G1 — `country` is required in `alumniDetailsSchema` (min 1), but `validateForPayment` does not check it. The spec previously marked `country` as optional; the schema and UX treat it as required.

G2 — `attendeesMealsSchema` has no cross-field rule for spouse name. The `hasSpouse` toggle is local component state. An empty or whitespace-only `spouseName` passes `attendeesMealsSchema` even when the user has toggled a spouse on. `registrationSchema` (API boundary) enforces presence.

G3 — `accommodationSchema` does not require `checkIn`/`checkOut` when accommodation is not `"none"`. The date requirement is enforced only in `validateForPayment`. It is possible to pass `accommodationSchema` with an accommodation type selected and no dates.

G4 — `givingBackSchema` does not require `acknowledgementDisplayName` when `publicAcknowledgement` is `true`. No cross-field rule exists. The name field is display-only at the UX level.

G5 — `givingBackSchema` uses `z.number()`, not `z.int()`, for `collegeContribution`. Float values (e.g., ₹500.50) pass the schema. The quick-select UI only produces integers, but the schema does not enforce it.

G6 — `validateForPayment` does not check `felicitationConsent` against the donation amount threshold (`PRICING_DEFAULTS.donationFelicitationThreshold` = ₹50,000). A user who enters ₹50,000+ and does not check the felicitation consent box will pass `validateForPayment`. This is unimplemented; the tests mark this with `[SPEC GAP]`.

G7 — `alumniDetailsSchema` accepts any non-empty string for `branch` — it is not restricted to the values in `BRANCHES` (from `constants.ts`). The UI constrains the input to the list, but the schema does not enforce it.

---

## Edge Cases

- Empty `children` and `guests` arrays pass all schemas and `validateForPayment`.
- Whitespace-only `fullName` fails `validateForPayment` (trim check) but would fail `participationSchema` only at min(1) — a single space passes `participationSchema`.
- WhatsApp with `"+"` prefix and fewer than 7 stripped digits fails `alumniDetailsSchema` with a specific error message. `validateForPayment` uses only digit count (≥ 7).
- `donationAmount` is a string field throughout. `validateForPayment` uses `parseFloat()` for comparison. Non-numeric strings parse to `NaN`, which is `<= 0`, so they fail the donation-only amount check.
- ID upload with `idFileType` set but `idFileSizeBytes` undefined fails `photoIdSchema` (the size check requires `idFileSizeBytes != null && idFileSizeBytes > 0`).
- `felicitationConsent` persists in the draft even when the donation drops below the threshold. The stored `true` value has no effect at submission unless the amount is at or above the threshold — but since `validateForPayment` does not check it (G6), this is inert in V1.
- Date strings (`checkIn`, `checkOut`) are not parsed or compared in any schema. An inverted date range (`checkIn` after `checkOut`) passes `accommodationSchema` and `validateForPayment`. Business logic should validate ordering if needed.

---

## Dependencies

- Referenced by: `giving-back.spec.md` R5, `photo-id.spec.md`
- Source files: `src/shared/src/validation.ts`, `src/shared/src/review-validation.ts`
- Constants: `src/shared/src/constants.ts` (`PRICING_DEFAULTS`, file type constants)
- Types: `src/shared/src/types.ts` (`WizardDraft`)
- Tests: `src/shared/src/__tests__/validation.test.ts`
