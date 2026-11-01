# Specification: Review & Pay (Wizard Step 7)

## Purpose

Displays a read-only summary of all registration data with section-level edit buttons and a payment call-to-action. For bank transfer payments, shows account details with a proof upload flow. Includes a cost breakdown popup explaining how fees are utilized.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [Summary Sections](#summary-sections)
  - [Review Validation](#review-validation)
  - [Payment Panel](#payment-panel)
  - [Cost Breakdown Popup](#cost-breakdown-popup)
  - [Bank Transfer Flow](#bank-transfer-flow)
  - [Edit Navigation](#edit-navigation)
  - [Donation-Only Path](#donation-only-path)
  - [Navigation](#navigation)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Summary display rules per section, pricing panel with line items, cost breakdown popup, bank transfer CTA, proof upload flow, edit-back navigation.

**Does not cover:** Payment gateway integration, resume flow after payment, amendment UI (deferred).

## Requirements

### Summary Sections

R1 — The step displays summary sections for each part of the registration. Sections skipped per participation type are not displayed. Each section has an "Edit" button.

**R1.0 — Participation section** (edit navigates to step 1):
- Participation type label (Full Celebration / Campus Only / Donation Only) with headline price

**R1.1 — About You section** (edit navigates to step 2):
- Full name
- Branch
- Email
- Mobile (displayed with country code — see registration-page.spec.md Domain — Phone Fields)
- City and country (joined with ", ")

**R1.1a — T-Shirt Size section** (shown for `full_celebration` and `campus_only` registrations; edit navigates to step 3):
- Displays the selected t-shirt size for the primary registrant
- Hidden entirely for donation-only registrations

**R1.2 — Attendees & Meals section** (shown for `full_celebration` and `campus_only`; edit navigates to step 3):
- Title includes total attendee count: "Attendees & Meals · N people"
- Each attendee listed with name and meal badge (veg/non-veg)
- Summary line: "{veg count} Veg · {non-veg count} Non-veg"

**R1.2a — College Contribution section** (shown for ALL participation types; edit navigates to step 5):
- When the additional contribution is > 0: shows the amount and the selected cause's display name (from `CONTRIBUTION_CAUSE_LABELS`)
- When the additional contribution is ₹0: shows "None" (neutral — ₹0 is valid; no warning)
- A contribution > 0 with no cause selected surfaces the cause-required issue via the section's inline warning (see R1.8), routed from `validateForPayment`

**R1.3 — Stay section** (shown for `full_celebration` only; edit navigates to step 4):
- Shows accommodation choice (type and number of rooms, or "No accommodation")
- See `accommodation.spec.md` for accommodation display rules
- Hidden for `campus_only` and `donation_only` (step was skipped)

**R1.3a — Giving Back section** (edit navigates to step 5):
- Shows donation amount (or "None" if no donation)

**R1.4 — Photo & ID Document section** (edit navigates to step 6):
- Shows photo filename for ALL users (including donation-only)
- Shows ID document filename for `full_celebration` and `campus_only` registrations only
- For donation-only: only photo is shown, ID section is hidden

### Review Validation

R1.5 — Before enabling payment submission, the system validates that all required fields across all steps are complete and valid.

R1.6 — The same validation rules are enforced both when the user attempts to submit (to gate the submit button) and by the server on submission.

R1.7 — Validation rules are participation-type-dependent:

| Participation Type | Required fields |
|-------------------|----------------|
| `full_celebration` | All step 2–6 fields, photo uploaded (step 6), ID document uploaded (step 6) |
| `campus_only` | All step 2–3 and 5–6 fields (step 4 skipped), photo uploaded (step 6), ID document uploaded (step 6) |
| `donation_only` | All step 2 fields, at least one of (donation amount, college contribution) > 0, cause selected when contribution > 0, photo uploaded (step 6) |

R1.8 — When validation fails, each summary section that has issues displays an inline amber warning below the section header listing the specific missing or invalid fields.

R1.9 — The Submit button is disabled (not hidden) when `validateForPayment()` returns errors. A brief explanatory message is shown adjacent to the button: "Please resolve the issues above before submitting."

### Payment Panel

R2 — A pricing panel displays the full breakup from the pricing engine.

R2.1 — Line items displayed:
- Alumni registration fee (if base > 0) — ₹8,500 for Full Celebration, ₹5,500 for Campus Only; college contribution is NOT broken out as a separate line item
- Each additional person line item from the pricing engine (spouse, children, guests)
- Accommodation charge (if applicable — full_celebration only)
- Platform fee (if applicable)
- Additional college contribution (if > 0) — one line item per cause, labeled "Batch Contribution to College — [Cause Label]" (see `pricing-engine.spec.md` R2.2)
- Donation amount (if > 0)
- Free items (e.g., children under the free-age threshold) are marked accordingly
- **Total** in bold, accent color, serif font

R2.2 — Attendee count badge below the total: "{total} attendee(s) · {veg} Veg · {non-veg} Non-veg" (only if total > 0).

R2.3 — Below the total, an info icon with "Cost Breakdown" link opens the cost breakdown popup (see [Cost Breakdown Popup](#cost-breakdown-popup)).

R2.4 — A clear, simple message about persistence: "We'll email you a link to come back to this page. You can complete the payment even if you close the browser."

R2.5 — Submit button label: "Proceed to Payment". On click:
1. Button enters processing state (disabled, "Processing..." label)
2. The system submits the registration.
3. On success, the user is redirected to the payment page showing bank transfer instructions.

R2.6 — The payment panel is sticky on desktop.

### Cost Breakdown Popup

R3 — A modal/popup triggered from the payment panel explains how the main attendee's registration fee is utilized.

R3.1 — The popup title: "How your registration fee is used"

R3.2 — The breakdown shows only the base alumni registration fee for Full Celebration (not additional attendees, accommodation, or donations). The categories reflect the official event flyer cost allocation:

| Utilization Category | Amount | Description |
|---------------------|--------|-------------|
| Welcome Kit & Teachers Recognition | ₹1,500 | Welcome kit for all & special recognition for beloved teachers |
| Food Arrangements | ₹3,185 | Buffet lunch at TKMCE & buffet dinner at Raviz |
| Event Arrangements at College | ₹500 | Hall setup, décor, logistics at TKMCE |
| Musical Concert & DJ Party | ₹1,250 | Live music, DJ night & entertainment |
| Event Arrangements at Raviz Hotel | ₹3,250 | Venue arrangements, ambience, stage, décor |
| Management, Logistics & Contingency | ₹750 | Coordination, operations, hospitality support & contingency reserve |
| College Contribution (included in fee) | ₹1,000 | Batch contribution to the college |
| Sponsorship Adjustment | −₹2,500 | To reduce the overall cost per person |

Subtotal before sponsorship: ₹11,435. After sponsorship: ₹8,935. Net registration fee charged: ₹8,500 (difference of ₹435 absorbed by batch savings).

Note: The ₹1,000 college contribution is baked into the base fee and is NOT a separate line item in the pricing panel or this popup.

R3.3 — The total at the bottom of the popup shows the base alumni registration fee (₹8,500 for Full Celebration, sourced from `pricingBreakup.base`). Additional attendees, accommodation, and donation amounts are not broken down here — they are shown as separate line items in the pricing panel. This popup is shown for `full_celebration` participants only; campus-only and donation-only participants do not see this popup.

R3.4 — The utilization categories are hardcoded text in the client. No API call is needed.

R3.5 — The popup closes on: close button, backdrop click, or Escape key.

R3.6 — The popup is accessible: focus trap, ARIA dialog role, labeled close button.

### Bank Transfer Flow

R4 — After submission, the user is redirected to a payment page (`/payment/:regCode`) showing bank transfer details, instead of an external payment gateway.

R4.1 — The payment page fetches the registration data from the server (including status, pricing, and country).

R4.2 — The page displays the total amount prominently at the top. When the user is returning for a second payment cycle — a balance due after a partial committee verification left a shortfall — the amount shown is the outstanding balance (the `payment_pending` record's amount), not the full registration `total_amount`. This mechanism already exists for staff-amendment-triggered balance payments (see `payment-flow.spec.md` R7.20); partial verification is simply another trigger for the same behavior.

R4.3 — Bank details are displayed: bank name, account holder, account number, IFSC, account type. Account number and IFSC have copy-to-clipboard buttons.

R4.4 — A "Cost Breakdown" button opens the breakdown popup (same component as step 6), showing how the main attendee registration fee is used.

R4.5 — A UPI section is always displayed for all users regardless of country:
- UPI ID with copy button
- Note: "You can also pay via any UPI app (GPay, PhonePe, Paytm)"
- Inline QR code encoding the full UPI URI

R4.6 — Bank transfer details are also always displayed for all users regardless of country. There is no country-based filtering — both UPI and bank details are shown to everyone. No "international transfers" note is shown.

R4.7 — Below the bank details, the proof upload section is displayed. Same component as photo/ID upload (see `photo-id.spec.md`) with these differences:
- Label: "Upload payment proof"
- Accepted guidance: "Upload a screenshot or PDF of your bank transfer receipt"

R4.7.1 — File selection does NOT trigger the upload. A separate "Submit Proof" button appears below the file preview after a file is selected. The user can remove and re-pick the file before submitting.

R4.7.2 — The file upload uses the shared FileUpload component (see `components/file-upload.spec.md`) with `preview: true`, displaying image thumbnails for JPG/PNG and a PDF icon for PDF files.

R4.7.3 — "Submit Proof" button submits the proof to the server. Button shows "Uploading..." state during upload.

R4.8 — After successful proof upload, the page immediately navigates to `/confirmation/:regId` with `replace: true`. There is no intermediate "Verification in progress" state on the payment page — the confirmation page handles that state based on the registration's `pending_verification` status. This still holds for a balance payment's proof upload; if the committee's subsequent verification leaves a further shortfall, the confirmation page shows "additional payment required" rather than the confirmed state (see `confirmation.spec.md` R1.3.1–R1.3.2).

R4.9 — The payment page must persist across sessions. If the user returns to the payment page in the same browser:
- The page fetches the latest registration and payment status from the server
- If status is still `payment_pending`, the bank details and upload section are shown
- If status is `pending_verification` or `confirmed`, the page immediately redirects to `/confirmation/:regId` — the confirmation page handles both states

R4.10 — If the user reloads the page after submission but before proof upload, the page state is recovered from the server (not localStorage for the payment state — the server is authoritative).

R4.11 — The bank transfer page includes a payment journey progress indicator at the top, above bank details (see `payment-flow.spec.md` R9).

### Edit Navigation

R5 — Each summary section has an "Edit" button that navigates directly to the corresponding step.

R5.1 — If direct step navigation is available (go-to-step callback from the shell), edit buttons jump to the specific step number:
- Participation → step 1
- About You → step 2
- T-Shirt Size → step 3
- Attendees & Meals → step 3
- Stay → step 4
- Additional College Contribution → step 5
- Giving Back → step 5
- Photo & ID Document → step 6

R5.2 — If direct navigation is not available, the edit button falls back to the "back" action.

### Donation-Only Path

R6 — When participation type is `donation_only`:

R6.1 — The Attendees & Meals section (R1.2) is not displayed.

R6.2 — The Stay section (R1.3) is not displayed.

R6.3 — The College Contribution section (R1.2a) IS displayed (donation-only users can contribute to college causes).

R6.4 — The Photo & ID Document section (R1.4) IS displayed (photo is required for all users).

R6.5 — The pricing panel shows the per-cause college contribution line items (when present) and the donation amount; the total is their sum (see `pricing-engine.spec.md` R9).

R6.6 — At least one of (donation amount, college contribution) > 0 is required.

### Navigation

R7 — Back transitions to step 6 (Photo & ID).

R7.1 — "Proceed to Payment" submits to the API and navigates to the bank details page.

## States

| State | Description |
|-------|-------------|
| Review (valid) | All sections displayed, submit button enabled |
| Review (invalid) | Amber warnings on affected sections, submit button disabled |
| Donation-only review | Attendees and Stay sections hidden; College Contribution and photo shown; pricing shows contribution lines + donation |
| Submitting | Submit button disabled, "Processing..." label |
| Bank details page (awaiting payment) | Bank details and UPI shown (always, regardless of country), proof upload ready |
| Proof uploaded | Immediately redirects to /confirmation/:regId; no intermediate state on payment page |
| Submit error | Error message displayed, submit button re-enabled |

## Data Flow

**Reads:** All registration data collected in steps 1–6 (to display summary), participation type (to conditionally hide sections), pricing engine output (to display breakup).

**Writes:** On submit, the full registration is sent to the server. On success, the user is redirected to the payment page.

**Payment page reads:** Registration data (including status, pricing, and country) from the server. Bank details are not fetched from the server.

**Payment page writes:** Payment proof file is submitted to the server on "Submit Proof".

## Edge Cases

- If all children and guests were removed after being added, the attendees section shows only the primary registrant (and spouse if toggled on).
- Donation amount of "0" or empty shows "None" in the summary.
- If the user edits step 1 and changes participation type to "donation_only", returning to step 7 hides the attendees, stay, and college contribution sections and recalculates pricing.
- UPI and bank details are always shown to all users — there is no country-based filtering on the payment page.

## Dependencies

- Parent: `registration-page.spec.md`
- Pricing: `pricing-engine.spec.md`
- Payment: `payment-flow.spec.md`
- API: `submission-api.spec.md`
- Photo & ID upload component: `photo-id.spec.md` (reused for payment proof upload)
- Navigates to: `step1-participation.spec.md` through `photo-id.spec.md` (edit buttons)
- Transitions to: `confirmation.spec.md`
