# Specification: Attendees & Meals (Wizard Step 3)

## Purpose

Captures who is attending with the registrant (spouse, children, guests) and their meal preferences. When the registrant's participation type is donation-only, this step is skipped entirely.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [Donation-Only Path](#donation-only-path)
  - [Alumni Meal](#alumni-meal)
  - [T-Shirt Size](#t-shirt-size)
  - [Spouse / Partner](#spouse--partner)
  - [Children](#children)
  - [Guests](#guests)
  - [Validation](#validation)
  - [Navigation](#navigation)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Attendee collection for all person types, meal preference per person, t-shirt size selection, dynamic add/remove of children and guests, donation-only bypass.

**Does not cover:** Meal toggle presentation (see `meal-toggle.spec.md`), attendee row presentation (see component specs), pricing impact (see `pricing-engine.spec.md`).

## Requirements

### Donation-Only Path

R1 — When participation type is `donation_only`, this step is skipped entirely. The user does not visit this step at all — the flow goes directly from step 2 (About You) to step 5 (Giving Back).

R1.1 — Any previously entered attendee data (from a prior session where participation type was different) is preserved in state but ignored by the pricing engine and not displayed in the summary.

### Alumni Meal

R2 — The primary attendee section shows the registrant's name (from step 2) as the heading — not a generic "Primary alumni" label.

R2.1 — Meal preference is a two-option toggle (see registration-page.spec.md Domain — Meal Preference).

R2.2 — Default value is "veg".

### T-Shirt Size

R2.3 — The registrant selects their t-shirt size from a gender-segmented list. Male: XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL, 6XL (10 values). Female: 2XS, XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL (10 values). The full union of valid sizes is: 2XS, XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL, 6XL (11 values). See `src/web/src/lib/tshirt-options.ts` for the canonical constants (`MENS_TSHIRT_SIZES`, `WOMENS_TSHIRT_SIZES`).

R2.4 — T-shirt size is required for non-donation-only registrations.

R2.5 — Default: no selection (user must explicitly choose).

### Spouse / Partner

R3 — A toggle switch controls whether the registrant is bringing a spouse or partner. Default is OFF.

R3.1 — When toggled on, two fields appear: spouse name (text, required) and spouse meal preference (see registration-page.spec.md Domain — Meal Preference).

R3.2 — When toggled off, the spouse fields are hidden. Spouse name is cleared and meal preference resets to "veg".

R3.3 — Cross-field validation: when the toggle is on, spouse name (after trimming whitespace) must have length > 0 (see `validation.spec.md` R3.2).

### Children

R4 — Children are a dynamic list. A single "Add child" button is shown.

R4.1 — When one or more children already exist, the button text changes to "Add another" (not "Add child").

R4.2 — "Add child" / "Add another" creates a new entry with defaults: empty name, age 0, meal defaults to "veg" (see registration-page.spec.md Domain — Meal Preference).

R4.3 — Each child entry has:
- Name (text, optional) — placeholder "Name (optional)"
- Age (number, 0–99) — required
- Meal preference (see registration-page.spec.md Domain — Meal Preference)
- Remove button

R4.4 — A prominently displayed note in larger font: "Children under 6 attend free. Above 6 are chargeable." (free-age threshold: see registration-page.spec.md Domain — Pricing Configuration)

R4.5 — Each child entry has an auto-generated unique ID that does not change after creation.

### Guests

R5 — Guests are a dynamic list, same add/remove pattern as children (button text changes to "Add another" after first guest).

R5.1 — "Add guest" / "Add another" creates a new entry with defaults: empty name, empty relationship, meal "veg".

R5.2 — Each guest entry has:
- Name (text, optional) — placeholder "Guest name"
- Relationship (text, optional) — placeholder "e.g. Brother"
- Meal preference (see registration-page.spec.md Domain — Meal Preference)
- Remove button

R5.3 — Each guest entry has an auto-generated unique ID that does not change after creation.

### Validation

R6 — Validation rules for `attendeesMealsSchema` are defined in `validation.spec.md` R5.

R6.1 — The only validation that can fail for the typical user is the spouse name cross-field rule. Children and guests have no required fields beyond the always-present defaults.

### Navigation

R7 — Back transitions to step 2 (About You). Continue validates, transitions to step 4 ("My Stay"), and scrolls to top (see `registration-page.spec.md` R6).

## States

| State | Description |
|-------|-------------|
| Donation-only | Step not visited — user never sees this step |
| Attending — empty | Alumni name + meal toggle shown, spouse off, no children/guests |
| Attending — populated | Spouse on with fields, one or more children/guests added |
| Validation error | Spouse name missing while toggle is on |

## Data Flow

**Reads:** Participation type (from step 1, to decide donation-only skip), registrant's full name (from step 2, for primary attendee heading), previously entered meal preference, spouse details, children list, guests list, t-shirt size.

**Writes:** Alumni meal preference, t-shirt size, spouse details (toggle, name, meal), children list (name, age, meal per child), guests list (name, relationship, meal per guest).

## Edge Cases

- Toggling spouse off clears the name and resets meal. Toggling back on starts fresh.
- Removing all children from the list leaves an empty list (valid).
- A child with age 0 is valid — the form accepts it.
- If the user changes participation type to "donation_only" by going back to step 1 and changing it, step 3 is skipped on re-entry. Previously entered attendee data remains in state but is ignored by the pricing engine (see `pricing-engine.spec.md` R9).

## Dependencies

- Parent: `registration-page.spec.md`
- Validation: `validation.spec.md` R5 (`attendeesMealsSchema`)
- Reads: `step1-participation.spec.md` (participation type, for skip logic); `alumni-details.spec.md` (full name, for primary attendee heading)
- Downstream: step 3 data (spouse/children/guests) affects `accommodation.spec.md` (shared room eligibility)
- Pricing impact: `pricing-engine.spec.md` R4, R5, R6 (spouse, children, guests)
