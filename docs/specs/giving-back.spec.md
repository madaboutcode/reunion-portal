# Specification: Giving Back (Wizard Step 5)

## Purpose

Captures optional additional college contribution routed to a chosen cause (all users; ₹1,000 is already baked into the headline price for attending users) and optional reunion donation (all users). Donation-only users must give at least one positive amount — college contribution, reunion donation, or both — to proceed.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [Donation-Only Path](#donation-only-path)
  - [Section A: Support Your College](#section-a-support-your-college)
  - [Section B: Reunion Donation](#section-b-reunion-donation)
  - [Felicitation](#felicitation)
  - [Validation](#validation)
  - [Navigation](#navigation)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Optional additional college contribution with cause selection for all users (₹1,000 already included in the headline price for attending users; this step lets alumni add more and pick which cause it funds), optional reunion donation for all users, public acknowledgement consent, felicitation note and consent for high-value donations.

**Does not cover:** Actual donation processing or payment (stub in V1), accommodation (Step 4), ID upload (Step 6).

## Requirements

### Donation-Only Path

R1 — When participation type is `donation_only`:
- R1.1 — The step title changes to "Donation" (not "Giving Back").
- R1.2 — Both Section A (Support Your College) and Section B (Reunion Donation) are shown.
- R1.3 — The introductory note in Section A omits the "₹1,000 from your registration" sentence (no registration fee exists for this path).
- R1.4 — At least one positive amount — college contribution or reunion donation — is required to proceed. With both zero/empty, validation fails with "Add a donation or a college contribution to continue." on the donation amount field.

### Section A: Support Your College

R2 — Section A is displayed for all participation types.

R2.1 — For attending users (`full_celebration`, `campus_only`), an introductory note explains the college contribution: "₹1,000 from your registration is already going to the college. Want to add more? Every bit helps."

R2.2 — Cause picker. Section A presents one selectable card per contribution cause, sourced from `CONTRIBUTION_CAUSES` in shared constants (currently Green Energy Project and Scholarship Fund — names, taglines, descriptions, and detail bullets live ONLY in that constant; the committee may rename causes without touching components).
- R2.2.1 — Each cause card shows: emoji, cause name, a short handwritten-style tagline, a 1–2 line description, and a radio-style selection indicator.
- R2.2.2 — Each card has a "Know more" toggle that expands a bullet list of cause details (e.g. solar phase status, savings, scholarship usage). Expanding does not select the card; selection and expansion are independent.
- R2.2.3 — Selecting a card sets the contribution cause. Exactly one cause may be selected. No cause is pre-selected on first render.
- R2.2.4 — When the contribution amount is greater than ₹0, a cause is required. Validation error on the cause field: "Select a cause for your contribution." When the amount is ₹0, no cause is required.
- R2.2.5 — Selecting a cause clears a previously shown cause-required error.

R2.3 — The minimum additional college contribution is ₹0. ₹1,000 is already baked into the headline price for attending users and is not displayed here as a separate line item. The user can optionally add more using the amount input or quick-select chips.

R2.4 — No chip is pre-selected on first render. The user may choose to add nothing (₹0 additional contribution is valid for attending users).

R2.5 — An amount input (₹ prefix, numeric) is always visible, alongside quick-select chips:

| Chip label | Value |
|------------|-------|
| ₹500 | 500 |
| ₹1,000 | 1000 |
| ₹2,000 | 2000 |
| ₹5,000 | 5000 |

R2.6 — Selecting a chip sets the additional college contribution to that value. A chip renders active only while the amount equals its value; typing a custom amount deactivates all chips.

R2.7 — Clearing the amount input sets the contribution to ₹0 (no additional contribution is valid; the cause requirement lapses per R2.2.4).

### Section B: Reunion Donation

R3 — Section B is shown for all users regardless of attendance intent.

R3.1 — A warm, friendly introductory note explains that contributions beyond the registration fee help make the event better for everyone — more activities, better food, freebies, and a more memorable experience. The tone is like a message from a friend, not a corporate fundraising pitch. No flowery language.

R3.2 — The following fields are always shown:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Donation amount | number | Conditional | Displays "₹" prefix; accepts numeric input |
| Quick-select chips | buttons | No | 6 presets: ₹5,000 / ₹10,000 / ₹20,000 / ₹25,000 / ₹50,000 / ₹1,00,000 |
| Public acknowledgement | checkbox | No | "I consent to my name being listed as a contributor on the event programme" |
| Display name | text | No | Shown only when public acknowledgement is checked; placeholder is the registrant's full name |

R3.3 — Clicking a quick-select chip sets the donation amount to that value. The user can also type a custom amount. Clicking a chip again does not toggle it off — the only way to clear is to type a different amount.

R3.4 — The display name field only appears when public acknowledgement is checked. The default placeholder is the registrant's full name from Step 2 (Alumni Details).

R3.5 — For `full_celebration` and `campus_only` users, the donation is optional. They may proceed with a zero or empty donation amount.

R3.6 — For `donation_only` users (see R1.4), the donation is individually optional — but at least one of (reunion donation, college contribution) must be greater than zero to proceed.

### Felicitation

R4 — When the reunion donation amount is at or above the felicitation threshold (see `registration-page.spec.md` Domain — Pricing Configuration), a note appears below the amount field: contributions of this level are eligible for on-stage felicitation at the reunion.

R4.1 — Below the note, a consent checkbox is shown: "I consent to being felicitated on stage at the event."

R4.2 — The felicitation note and checkbox are hidden when the amount drops below the felicitation threshold.

R4.3 — The flow is: user enters amount → sees felicitation note → opts in (or not). Not the reverse.

R4.4 — If the user later reduces the donation below the threshold, the felicitation checkbox is hidden. The previously recorded `felicitationConsent` value is retained in state but has no effect when hidden.

### Validation

R5 — Validation is handled by `givingBackSchema` (see `validation.spec.md` R7). The schema uses `superRefine` to branch on `participationType`:

R5.1 — For `full_celebration` and `campus_only` users: `collegeContribution` (the additional amount beyond the baked-in ₹1,000) must be ≥ 0. `donationAmount` may be zero or empty. `givingBackSchema` enforces the minimum college contribution for these paths.

R5.2 — For `donation_only` users: at least one of `donationAmount` (parsed) and `collegeContribution` must be > 0 (see R1.4).

R5.3 — For ALL participation types: when `collegeContribution` > 0, `collegeContributionCause` must be one of the known cause values. Error on the cause field: "Select a cause for your contribution." (see R2.2.4).

R5.4 — Donation amount (Section B), when provided, must be a valid positive integer.

R5.5 — The manual `setDonationError` pattern previously used for conditional validation is replaced by `givingBackSchema`'s `superRefine`. College contribution, cause, and reunion donation validation are unified in the Zod schema.

### Navigation

R6 — Back transitions depend on participation type:
- `full_celebration`: back transitions to Step 4 (My Stay).
- `campus_only`: back transitions to Step 3 (Your Group), since Step 4 (My Stay) is skipped.
- `donation_only`: back transitions to Step 2 (About You), since Steps 3 and 4 are skipped.

R6.1 — Continue validates, then transitions to Step 6 (Photo & ID) and scrolls to top (see `registration-page.spec.md` R6).

## States

| State | Description |
|-------|-------------|
| Donation-only | Both sections shown; at least one positive amount required; title is "Donation" |
| Attending — default | Section A shown, no chip and no cause pre-selected (₹0 additional); Section B shown with empty donation |
| College contribution — chip selected | One chip active, additional amount set to chip value |
| College contribution — custom | No chip active, custom amount in the input |
| Cause — selected | One cause card highlighted with active radio indicator |
| Cause — details expanded | A cause card's "Know more" bullet list is visible (independent of selection) |
| Cause — required error | Amount > 0 with no cause selected; error shown under the picker |
| Reunion donation — empty | No chip selected, amount empty, no acknowledgement |
| Reunion donation — amount entered | Amount field populated; felicitation note shown if at or above threshold |
| High-value donation | Donation at or above felicitation threshold — note and consent checkbox visible |
| Public acknowledgement on | Display name field visible, pre-filled with registrant's full name |

## Data Flow

**Reads:** Participation type (from step 1, to adjust Section A copy and the at-least-one rule), registrant's full name (from step 2, for the display name placeholder), previously entered college contribution, contribution cause, donation amount, public acknowledgement consent, display name, and felicitation consent. Cause copy is read from `CONTRIBUTION_CAUSES` in shared constants.

**Writes:** College contribution amount (additional amount only; the baked-in ₹1,000 is in the base fee), contribution cause, donation amount, public acknowledgement consent, display name for the programme, felicitation consent. On submit these map to `contributionSplits` — a cause-keyed amount map on the canonical registration (currently a single entry; the shape supports multi-cause splits).

## Edge Cases

- College contribution input cleared: value reverts to ₹0 (no additional contribution is valid). The user may leave Section A with zero additional contribution; any selected cause is retained in state but has no effect at ₹0.
- A pre-change saved draft may carry a contribution amount with no cause. The user is blocked at this step (or routed back from Review) with the cause-required error until a cause is picked.
- Quick-select chips for reunion donation do not toggle off — clicking an active chip does not zero the amount. The user must clear the text input manually.
- `felicitationConsent` persists in state when the donation drops below the threshold. It has no effect while hidden and is not submitted unless the amount is at or above the threshold at form submission time.
- Donation-only users who arrive at this step from a back-navigation from Step 6 see their previously entered donation amount pre-filled.
- Switching participation type (via back-navigation to Step 1) should re-evaluate Section A visibility on mount.
- The baked-in ₹1,000 college contribution is part of the base registration price. The `collegeContribution` field in this step captures only the optional additional amount. The pricing engine must not double-count.

## Dependencies

- Parent: `registration-page.spec.md`
- Reads: `step1-participation.spec.md` (participation type, to show/hide Section A)
- Reads: `alumni-details.spec.md` (full name, for display name placeholder)
- Pricing impact: `pricing-engine.spec.md` (college contribution, reunion donation)
- Validation: `validation.spec.md` R7 (`givingBackSchema` with `superRefine`)
