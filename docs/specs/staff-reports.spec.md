# Specification: Staff Reports Page

## Purpose

Committee analytics: revenue progress, per-branch participation, and registration momentum over time.

## Contents

- [Scope](#scope)
- [Layout](#layout)
- [Revenue Summary](#revenue-summary)
- [Budget Progress](#budget-progress)
- [Branch Participation](#branch-participation)
- [Registration Timeline](#registration-timeline)
- [States](#states)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Reports page layout and all analytics panels.

**Does not cover:** Shell/nav (see `staff-console.spec.md`). API contract (see `staff-api.spec.md`).

**Wireframe:** `tmp/staff-console-wireframes.html` (Reports tab)

---

## Layout

R1 — Page title: **Reports**.

R1.1 — No toolbar or filters on this page.

R1.2 — Section order: Revenue summary (3 cards) → Budget progress (2 cards) → Branch participation table → Registration timeline.

---

## Revenue Summary

R2 — Three stat cards in a row.

| Card | Content |
|------|---------|
| Collected | ₹ amount + "% of expected" subtitle |
| Expected | ₹ total expected revenue |
| Pending | ₹ outstanding (warning accent) |

R2.1 — Values in this section (Collected/Expected/Pending) are combined across all attendee registrations — no category split. Category-level breakdown is covered by Budget Progress below.

---

## Budget Progress

R5 — Two independent cards, side by side, below the Revenue Summary row. Each shows an "actual" amount tracked against a category-specific target, with a progress bar.

Scenario: Given event-fee revenue of ₹14,80,000 across all attendee registrations and a fixed target of ₹23,00,000, when the Reports page loads, then the Event Fees card shows "₹14,80,000", "of ₹23,00,000", and a progress bar/label reading 64%.

R5.1 — Card 1: **Event Fees**.
- Actual = sum, across all attendee registrations, of each registration's total minus its accommodation portion (R5.3).
- Target = fixed committee-set budget, ₹23,00,000. Configured once in shared constants (`EVENT_GOALS.eventBudgetTarget`), not derived from registration data.

R5.2 — Card 2: **Accommodation**.
- Actual = sum, across all attendee registrations, of each registration's accommodation portion (R5.3).
- Target = a top-down room-block cost estimate, NOT a sum of individual bookings: `(rooms configured for the Aug 14 check-in night + rooms configured for the Aug 15 check-in night) × ₹12,000 × 1.18`. The two per-night room counts come from the staff-entered room inventory (`room-availability.spec.md` R1–R3, `GET /api/staff/room-inventory`) — a room booked for both nights (14th check-in, since checkout is fixed at the 16th) contributes to both nights' counts and so is counted twice in the sum. The ₹12,000 rate is the private-room nightly rate; the formula deliberately ignores shared_double/shared_triple bookings and per-registration room type, because the app has no reliable record of which registrations share a physical room (see `room-availability.spec.md` — room pairing is committee-managed, not tracked) — this is an estimate of what the venue bill will be for the full room block, not of what attendees are individually charged.

R5.3 — Per registration, the accommodation portion is the sum of that registration's stored pricing line items belonging to the accommodation category: room fee, per-night child-accommodation charges, extra bed, and GST computed on the accommodation subtotal. The event portion is the registration's total MINUS the accommodation portion (derived by subtraction, not by summing "event" lines) — this guarantees the two portions always add back to the registration's total exactly, including the base fee and any line type not explicitly categorized.

R5.4 — Each card displays: the actual ₹ amount, a "of ₹{target}" subtitle, a horizontal progress bar, and a percentage label (`round(actual / target × 100)`). The bar's fill is visually clamped at 100% width; the percentage label is NOT clamped — an actual exceeding target shows e.g. "134%" as text even though the bar itself stops at full width.

R5.5 — The two cards are visually independent (`grid-cols-2` at ≥768px viewport width, single column below that breakpoint) — not one wide card containing two meters. Same card shell (border, radius, shadow) as the rest of the page. Event card uses the terracotta accent; Accommodation card uses a distinct aqua accent, so the two are visually distinguishable at a glance.

R5.6 — Neither actual figure splits *collected* (verified/paid) revenue by category. Both are sums of registration totals regardless of payment status — the same semantic basis as the existing Expected figure in Revenue Summary (R2), not Collected. No per-payment proportional allocation is performed anywhere in this feature.

---

## Branch Participation

R3 — Full-width table with totals footer row.

R3.1 — Columns: Branch · Registered · Confirmed · Verification · Pending · Collected · Expected.

R3.2 — Rows sorted by registered count DESC (API order).

R3.3 — Footer sums all numeric columns.

---

## Registration Timeline

R4 — Full-width chart panel with view toggle.

R4.1 — Header shows total registration count.

R4.2 — View options: **Trend** (cumulative line chart) · **Weekly** (bar chart) · **Calendar** (May–Aug 2026 daily heatmap).

R4.3 — Trend chart includes a "Today" dashed marker.

R4.4 — Default view: Trend.

---

## States

| State | What staff sees |
|-------|-----------------|
| Loading | Skeleton placeholders |
| Loaded | All three sections populated |
| Error | "Failed to load reports data." |

---

## Edge Cases

E1 — No room inventory configured (staff hasn't entered Aug 14/15 room counts yet): both per-night room counts are treated as 0, so the Accommodation card's target is ₹0. The card renders with 0% and does not divide by zero or crash.

E2 — No attendee registrations at all (empty event, or filtered to nothing): both cards' actual amounts are ₹0. Event card still shows its fixed ₹23,00,000 target and 0%.

E3 — Registrations submitted before the accommodation/event category tagging existed: their stored pricing line items don't carry an explicit category. The accommodation portion for these is computed by matching the existing line-label text (e.g. lines beginning "Accommodation —", ending "— accommodation", or beginning "Extra bed") rather than an explicit tag. This produces the same result as tagged registrations for every line shape `calculateTotal()` has ever produced — the fallback is a compatibility path, not an approximation.

E4 — A category's actual exceeds its target (e.g. accommodation revenue outpaces the room-block estimate because more people booked private rooms than the room count implies, or the event budget was exceeded): the progress bar fills to 100% visually, but the percentage label shows the true value uncapped (e.g. "134%").

---

## Dependencies

- Shell: `staff-console.spec.md`
- API: `staff-api.spec.md` — `GET /api/staff/reports`
- Room inventory: `room-availability.spec.md` R1–R3 (per-night room counts feeding the Accommodation target), `GET /api/staff/room-inventory`
- Pricing category split: `@smriti/shared` `splitPricingBreakup()` / `isAccommodationLine()` (`src/shared/src/pricing.ts`) — single source of truth for the accommodation/event line classification used by R5.3
- Wireframe: `tmp/staff-console-wireframes.html`