# Specification: Estimate Sidebar

## Purpose

Displays a live pricing breakdown alongside the form during steps 2–6. Updates reactively as the user adds attendees, selects accommodation, or enters a donation amount. Not displayed on step 1 (Participation) as pricing is shown on the participation cards themselves.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [Display](#display)
  - [Line Items](#line-items)
  - [Attendee Badge](#attendee-badge)
  - [Responsive Behavior](#responsive-behavior)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Pricing breakdown display, line item formatting, attendee count badge, responsive visibility.

**Does not cover:** Price calculation logic (see `pricing-engine.spec.md`), payment initiation (see `review-pay.spec.md`).

## Requirements

### Display

R1 — The sidebar shows a card with the heading "Estimate" and a line-item breakup of the current registration cost.

R1.1 — The sidebar is sticky — it remains visible as the user scrolls through the form on desktop.

R1.2 — The sidebar is visible on steps 2–6 on desktop. It is not shown on step 1 (Participation) or on the confirmation screen.

### Line Items

R2 — The sidebar displays the pricing breakup produced by the pricing engine:

R2.1 — Base fee line: "Alumni registration" with the base fee amount (if > 0).

R2.2 — Person line items: spouse, each child, each guest — label and fee from the engine. Free items (children under the free-age threshold — see registration-page.spec.md Domain — Pricing Configuration) are marked with a "FREE" badge instead of a fee amount.

R2.3 — Accommodation line item (if present in the breakup): label includes room count, fee amount.

R2.4 — Platform fee line item (if present): "Platform fee" with calculated amount.

R2.5 — Donation line item (if donation > 0): "Donation" with the amount.

R2.6 — **Total line**: bold, accent-colored, displayed at the bottom. Equals the pricing engine total.

### Attendee Badge

R3 — Below the pricing breakup, an attendee count badge is displayed.

R3.1 — Format: "{total} attendee(s) · {veg} Veg · {non-veg} Non-veg".

R3.2 — The badge is only shown when total attendee count > 0.

### Responsive Behavior

R4 — On desktop (viewport >= 768px): the sidebar renders as a sticky column beside the form.

R4.1 — On mobile (viewport < 768px): the sidebar is not displayed as a persistent element. Pricing information is accessible through the sticky bottom bar or step 5 review. [REVIEW: is the sidebar actually hidden on mobile, or is it collapsed/moved? Need to verify exact mobile behavior.]

## States

| State | Description |
|-------|-------------|
| Base only | Just alumni base fee, no additional items |
| With attendees | Spouse, children, and/or guests adding line items |
| With donation | Donation line item visible |
| Donation-only | Base is 0, only donation line shows, no attendee badge |
| Free children | Some line items marked "FREE" |

## Data Flow

**Reads from context:** All registration data fields (passed to pricing engine).

**Computes:** Calls the pricing engine with current data and config to produce the breakup.

**Writes:** Nothing — display only.

## Edge Cases

- When the user is on step 2 and hasn't entered any additional data yet, the sidebar shows the base fee (determined by the participation type chosen in step 1).
- Rapidly changing values (typing donation amount) should update the sidebar reactively without lag.
- Donation-only intent: base fee is 0, no attendee line items, badge hidden or shows 0.

## Dependencies

- Pricing: `pricing-engine.spec.md` (produces the breakup this component displays)
- Parent: `registration-page.spec.md` R26
