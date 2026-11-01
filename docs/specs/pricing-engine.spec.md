# Specification: Pricing Engine

## Purpose

Determines the total registration cost and produces a human-readable price breakdown for any registration. Every price shown in the portal — sidebar estimates, review summaries, confirmation receipts — comes from this engine.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [Configuration](#configuration)
  - [Base Fee](#base-fee)
  - [College Contribution](#college-contribution)
  - [Attendee Charges](#attendee-charges)
  - [Accommodation Charge](#accommodation-charge)
  - [Donation](#donation)
  - [Platform Fee](#platform-fee)
  - [Donation-Only Registrations](#donation-only-registrations)
  - [Total](#total)
  - [Meal & Headcount Summary](#meal--headcount-summary)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** How the registration cost is determined from registration choices and pricing configuration. What appears in the price breakdown. How attendees are counted.

**Does not cover:** Payment processing, currency formatting, pricing configuration management, server-side re-validation.

## Requirements

### Configuration

R1 — Pricing is driven by a configuration that can change without code changes (see registration-page.spec.md Domain — Pricing Configuration for defaults). The configuration determines:

R1.1 — The base registration fee for the alumni. Default: ₹8,500 for `full_celebration`, ₹5,500 for `campus_only`. Both prices include the baked-in ₹1,000 college contribution.

R1.2 — The per-guest food charge for each additional person — spouse, chargeable child, or guest. This charge primarily covers food. Children aged 6-12 are charged 50% of this fee; children aged 12+ are charged the full fee (same as spouse or guest).

R1.3 — The age below which children attend free of charge.

R1.4 — Whether accommodation charges apply, and the per-room rate.

R1.5 — Whether a platform fee applies, with a flat component and a percentage component.

R1.6 — The donation amount above which on-stage felicitation is offered.

R1.7 — The college contribution configuration — ₹1,000 is baked into the headline price for `full_celebration` and `campus_only` and is NOT a separately added line item in the pricing engine. The optional additional contribution (from step 5) arrives as a cause-keyed map and is added as per-cause line items (see R2.2). The minimum for the optional additional contribution is ₹0.

### Base Fee

R2 — Every attending registration includes a base fee equal to the configured alumni base fee.

### College Contribution

R2.1 — The ₹1,000 college contribution is baked into the `alumniBaseFee` for `full_celebration` and `campus_only`. It is NOT added as a separate line item by the pricing engine.

R2.2 — The optional additional college contribution (from step 5) arrives as `contributionSplits` — a cause-keyed amount map on the registration. The engine emits one line item per cause with amount > 0, labeled "Batch Contribution to College — [Cause Label]" (labels from `CONTRIBUTION_CAUSE_LABELS` in shared constants; an unknown/legacy cause key falls back to the raw key). The breakup's `collegeContribution` field equals the sum of all split amounts.

R2.3 — The pricing engine computes whatever additional contribution amount it receives. Validation that the amount is ≥ 0 is the responsibility of the validation layer (see `validation.spec.md`), not the pricing engine.

### Attendee Charges

R3 — When the registrant brings a spouse, one additional person fee is charged. The breakdown shows the spouse's name alongside the charge.

R4 — For each child:
- R4.1 — A child younger than the free-age threshold (see registration-page.spec.md Domain — Pricing Configuration) appears in the breakdown at ₹0, marked as free.
- R4.2 — A child aged 6-12 (at or above the free-age threshold and at or below the accommodation child bed age of 12) is charged 50% of the additional person fee.
- R4.2.1 — A child aged above 12 is charged the full additional person fee (same as spouse).
- R4.3 — The breakdown shows the child's name (or "Child" if unnamed) and their age.

R5 — For each guest, one additional person fee is charged. The breakdown shows the guest's name (or "Guest" if unnamed).

### Accommodation Charge

R6 — When accommodation charges are enabled in the configuration AND the registrant has selected an accommodation option other than "none" (see `accommodation.spec.md` R2):
- R6.1 — The charge equals the number of rooms requested multiplied by the per-room rate.
- R6.2 — The breakdown shows the room count alongside the charge.
- R6.3 — When one or more children under 6 are present in the registration, a free accommodation line item is shown for each such child (fee=0, marked free). This communicates that under-6 children are accommodated at no extra cost.

R6.4 — When the registrant selects no accommodation, or when accommodation charges are disabled, no accommodation charge appears and no free under-6 accommodation line is shown.

### Donation

R7 — The registrant's entered donation amount is included in the total. If no donation is entered or the entered value is not a valid number, the donation is ₹0.

### Platform Fee

R8 — When platform fee is enabled in the configuration:
- R8.1 — The platform fee equals the configured flat amount plus the configured percentage of all charges before the platform fee (base + attendees + accommodation).
- R8.2 — The breakdown shows "Platform fee" with the calculated amount.

R8.3 — When platform fee is disabled, no platform fee appears in the breakdown.

### Donation-Only Registrations

R9 — When the registrant's participation type is `donation_only`:
- R9.1 — No base fee is charged.
- R9.2 — No attendee, accommodation, or platform fee charges appear, regardless of other data in the registration.
- R9.3 — The breakdown shows the per-cause college contribution line items (per R2.2, when present) and the donation amount.
- R9.4 — The total equals the donation amount plus the sum of college contribution splits.
- R9.5 — The baked-in ₹1,000 college contribution is never charged for donation-only registrations (there is no base fee). Cause-routed contributions from `contributionSplits` ARE charged and itemized.

### Campus-Only Registrations

R9.6 — When the registrant's participation type is `campus_only`:
- R9.6.1 — The base fee is ₹5,500 (the campus-only base fee, with ₹1,000 college contribution already included).
- R9.6.2 — No accommodation charge is applied, regardless of accommodation data in the draft.
- R9.6.3 — Attendee charges (spouse, children, guests) still apply. The same two-tier child food pricing applies: a child aged 6-12 is charged 50% of the additional person fee (e.g. ₹275 at the default ₹550 rate), and a child aged 12+ is charged the full additional person fee (e.g. ₹550). Children under 6 remain free.

### T-Shirt Extras

R12 — When a registration has extra t-shirts (shirts beyond the one included in the base fee):
- R12.1 — The charge equals the number of extra shirts multiplied by the configured rate (`tshirtExtraRate`, default ₹500). The included shirt is free.
- R12.2 — The breakdown shows "Extra T-Shirts (N)" with the calculated amount, category "event".
- R12.3 — The t-shirt charge is DERIVED from shirt rows on every pricing calculation — never stored as a hand-maintained number. The pricing engine receives shirts as an optional `extras.tshirts` array; when absent, the charge is ₹0.
- R12.4 — Donation-only registrations cannot have t-shirts (enforced at API level, not pricing level). The pricing engine's early return for donation-only registrations naturally excludes t-shirt charges.

### Additional Charges

R13 — When a registration has additional charges (staff-created arbitrary line items):
- R13.1 — Each charge appears as its own line item in the breakdown, using the charge's description as the label, category "event".
- R13.2 — The charge amount is exact — no GST markup, no percentage adjustment. The amount staff enters is the amount charged.
- R13.3 — Additional charges never enter the accommodation bucket in `splitPricingBreakup()` — they are always category "event", so they cannot distort accommodation totals.
- R13.4 — The pricing engine receives charges as an optional `extras.additionalCharges` array; when absent, no charges apply.

### Total

R10 — The total is the sum of: base fee + college contribution + all attendee charges + accommodation charge + t-shirt extras + additional charges + platform fee + donation.

R10.1 — The pricing engine itself does not enforce a minimum total — it computes whatever the inputs yield. However, the server enforces a downstream constraint: any registration submission where the engine returns a total of ≤ 0 is rejected with a 400 before any writes occur (see `submission-api.spec.md` R3.15.1). This is a server-side business rule, not a pricing engine responsibility.

### Meal & Headcount Summary

R11 — The engine reports the total number of attendees and a breakdown by meal preference (vegetarian vs. non-vegetarian).

R11.1 — The primary registrant is always counted with their meal preference.

R11.2 — The spouse is counted only when the spouse is included (toggled on with a non-empty name).

R11.3 — Every child is counted regardless of age or whether they are free.

R11.4 — Every guest is counted.

R11.5 — For donation-only registrations, the headcount is zero. [REVIEW: verify — does the current implementation zero out counts for donation-only, or still count the primary registrant?]

## Edge Cases

- A child aged exactly 0 (newborn) is below the free-age threshold and therefore free for food. When accommodation is selected, they also receive a free accommodation line item (fee=0, marked free).
- A child aged exactly 6 is at the free-age threshold: they are charged 50% of the additional person fee (R4.2), not free.
- A child aged exactly 12 is at the tier boundary: they are still charged 50% of the additional person fee (R4.2). A child aged 13 or above is charged the full fee (R4.2.1).
- An empty donation string or "0" results in ₹0 donation — not an error.
- Spouse toggled off: no spouse charge, even if a spouse name exists from a previous session.
- Registration with no children, no guests, no spouse, no donation, no accommodation: total equals base fee only.
- `shared_double`, `shared_triple`, and `private` are all charged — the accommodation type only affects the room label in the breakdown, not the price.
- An absent or empty `contributionSplits` map is valid and produces no contribution line items. Each positive split amount produces its own line item. Zero/negative split values are skipped by the engine (validation rejects them upstream).
- The baked-in ₹1,000 college contribution is part of the base fee — the pricing engine never adds it separately.

## Dependencies

- Referenced by: `estimate-sidebar.spec.md`, `review-pay.spec.md`, `confirmation.spec.md`
- References: `registration-page.spec.md` (acceptance criteria on pricing)
