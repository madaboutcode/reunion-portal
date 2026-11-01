# Specification: Accommodation (Wizard Step 4)

## Purpose

Captures accommodation preference for attending registrants. When the registrant's participation type is `donation_only`, this step is skipped (Steps 3 and 4 are both skipped). When participation type is `campus_only`, this step is also skipped — campus-only attendees do not have accommodation.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [Donation-Only Path](accommodation.spec.md#skipped-paths)
  - [Accommodation Selection](#accommodation-selection)
  - [Room Availability Gating](#room-availability-gating)
  - [Shared Room Eligibility](#shared-room-eligibility)
  - [Conditional Fields](#conditional-fields)
  - [Validation](#validation)
  - [Navigation](#navigation)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Accommodation type selection, shared room eligibility rules, room availability gating, conditional date and extra-bed fields, donation-only bypass.

**Does not cover:** Room inventory management or occupancy computation (see `room-availability.spec.md`), pricing display (see `estimate-sidebar.spec.md`), contribution/donation fields (see `giving-back.spec.md`).

## Requirements

### Skipped Paths

R1 — When participation type is `donation_only`, this step is skipped entirely. The user does not visit this step — the flow goes directly from Step 2 (About You) to Step 5 (Giving Back).

R1.1 — When participation type is `campus_only`, this step is also skipped entirely — campus-only attendees attend the college day only and do not have overnight accommodation. The flow goes from Step 3 (Your Group) to Step 5 (Giving Back).

R1.2 — Any previously entered accommodation data (from a prior session where participation type was different) is retained silently — it is ignored by the pricing engine and does not appear in the review summary.

### Accommodation Selection

R2 — Accommodation type is presented as 4 card-style options:

| Value | Label | Subtitle |
|-------|-------|----------|
| `none` | "Not Needed" | "I have my own arrangements" |
| `private` | "Private Room" | "A room to yourself or your family" |
| `shared_double` | "Shared Room (2 persons)" | "Share with one other batchmate" |
| `shared_triple` | "Shared Room (3 persons)" | "Share with two other batchmates" |

R2.1 — Exactly one option must be selected before the user can continue.

R2.2 — The default selection is `none` on first visit.

R2.3 — Selecting `none` is a valid completion of this step. The user sees the three options, selects "Not Needed", and clicks Continue — this is a quick step with no additional fields to fill.

### Room Availability Gating

R2.4 — When the accommodation step loads, the frontend fetches current room availability from `GET /api/accommodation/availability` (see `room-availability.spec.md` R5).

R2.5 — Each room type card shows its remaining availability count (e.g., "3 available"). When a room type is unavailable, the card is shown disabled with a "Sold Out" indicator — not hidden. The user sees what's sold out.

R2.6 — A room type card is enabled if that type is available for at least one check-in date (see `room-availability.spec.md` R4).

R2.7 — If the user selects a room type and a check-in date where that type is not available, the Continue button is disabled and a message explains why the combination is unavailable. The user must change their selection to proceed.

R2.8 — When all room types are sold out for all dates, the accommodation step still shows (not skipped). All room type cards are disabled with "Sold Out." A message explains that rooms are fully booked. "Not Needed" remains the only enabled option.

R2.9 — When room inventory has not been configured by staff, availability gating is inactive — all room types are available as today (see `room-availability.spec.md` R1.3).

### Shared Room Eligibility

R3 — The shared room options (`shared_double` and `shared_triple`) are unavailable (disabled and visually distinct) when the registrant's group includes a spouse, one or more children, or one or more guests.

R3.1 — When shared rooms are disabled, a note is shown explaining that shared rooms are only available for solo attendees: "With a spouse, children, or guests, please pick a Private Room."

R3.2 — If the user previously selected a shared room and then returns to Step 3 to add a spouse, child, or guest, the accommodation selection resets to `none` on re-entry to this step.

### Conditional Fields

R4 — When accommodation is `private`, `shared_double`, or `shared_triple`, the following additional fields appear below the card selection:

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| Check-in date | date | No | Aug 15, 2026 | Pre-filled with event start date |
| Check-out date | date | No | empty | |
| Extra bed | checkbox | No | unchecked | "I need an extra bed" |

R4.1 — When accommodation is `none`, all conditional fields are hidden.

R4.2 — Check-in defaults to Aug 15, 2026 when accommodation fields first become visible (on initial selection of any non-`none` option).

R4.3 — If the user switches to `none` and back to any room type, the fields reappear with the last-entered values (dates and extra-bed selection are not cleared).

R4.4 — Extra bed is only available for `private` rooms. For shared rooms, the extra bed checkbox is hidden.

### Validation

R5 — Validation rules for `accommodationSchema` are defined in (see `validation.spec.md` R6). The schema validates accommodation fields only — donation fields are not part of this schema (they have moved to the GivingBack step).

R5.1 — The only required field is the accommodation type selection. All conditional fields (dates, extra bed) are optional.

R5.2 — No cross-field date validation is enforced at the client (e.g., check-out before check-in). The committee reviews dates manually.

### Navigation

R6 — Back transitions to Step 3 (Your Group). Continue validates, transitions to Step 5 (Giving Back), and scrolls to top (see `registration-page.spec.md` R6).

R6.1 — For `donation_only` registrants, this step is never rendered. Navigation skips directly from Step 2 (About You) to Step 5 (Giving Back) (see R1).

R6.2 — For `campus_only` registrants, this step is never rendered. Navigation skips from Step 3 (Your Group) to Step 5 (Giving Back) (see R1.1).

## States

| State | Description |
|-------|-------------|
| Donation-only | Step not visited — skipped entirely |
| Campus-only | Step not visited — skipped entirely |
| Default — no accommodation | `none` selected, no conditional fields shown; user clicks Continue to proceed |
| Accommodation selected | `shared` or `single` selected, date and extra-bed fields visible |
| Shared room disabled | User has spouse, children, or guests; "Shared Room" card is disabled with explanatory note |
| Populated | Dates and/or extra-bed entered; values persist if user switches away from `shared`/`single` and back |
| Room type sold out | One or more room types at capacity — cards disabled with "Sold Out" badge and remaining count of 0 |
| Invalid combination | Selected room type + check-in date is unavailable — Continue disabled with message |
| All rooms sold out | All room types at capacity for all dates — all cards disabled, message shown, only "Not Needed" enabled |
| No inventory configured | Staff has not entered room numbers — all room types available, no counts shown (behaves as today) |

## Data Flow

**Reads:** Participation type (from step 1, to decide skip path), spouse/children/guests presence (from step 3, to determine shared room eligibility), previously entered accommodation choice, check-in/check-out dates, extra-bed preference, room availability (from `GET /api/accommodation/availability`).

**Writes:** Accommodation type selection, check-in date, check-out date, extra-bed preference.

## Edge Cases

- If the user returns to Step 3 and adds a spouse or guest after having selected a shared room, the shared room cards are disabled on re-entry to this step and selection resets to `none` (see R3.2).
- Switching from any room type to `none` hides conditional fields but the entered values are not cleared (see R4.3). Selecting a room type again restores the previously entered dates and extra-bed value.
- Check-in date defaults to Aug 15, 2026 only on first appearance. If the user clears it and re-selects a room type, the field is empty (not re-defaulted).
- Extra-bed checkbox is only shown for `private` rooms (see R4.4). Its value is retained if switching between room types but has no effect on pricing unless `private` is selected.
- Participation type change to `donation_only` or `campus_only` (via back-navigation to Step 1) causes this step to be skipped on re-entry. Previously entered accommodation data is retained silently but ignored (see R1.2).
- If availability data fails to load (network error), the step should still render with all room types enabled — graceful degradation. The backend validates on submission anyway (see `room-availability.spec.md` R6).
- If a user selects a room type that is available for Aug 15 but not Aug 14, the Aug 14 check-in button should be disabled for that type. Switching check-in date may re-enable or disable room types.

## Dependencies

- Parent: (see `registration-page.spec.md`)
- Validation: (see `validation.spec.md` R6 — `accommodationSchema`)
- Reads: (see `step1-participation.spec.md`) — participation type (for skip logic)
- Reads: (see `attendees-meals.spec.md`) — spouse, children, guests (for shared room eligibility)
- Reads: (see `room-availability.spec.md` R5) — room availability (for gating)
- Pricing impact: (see `pricing-engine.spec.md` R7) — accommodation charges
- Submission gate: (see `room-availability.spec.md` R6) — backend re-validates on submit
