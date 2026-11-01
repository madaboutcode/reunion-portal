# Specification: Confirmation

## Purpose

Displays the post-registration status screen. Shows the registration reference, attendee summary, and payment status. When payment is confirmed, shows a full entry pass and next steps. When verification is pending, shows a waiting state with reassurance that the committee is reviewing the payment.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [Payment Status Display](#payment-status-display)
  - [Registration Summary](#registration-summary)
  - [Pending Verification State](#pending-verification-state)
  - [Confirmed State (Entry Pass)](#confirmed-state-entry-pass)
  - [Next Steps](#next-steps)
  - [Actions](#actions)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Confirmation screen content, registration reference display, payment status badge (pending_verification and confirmed), entry pass for confirmed registrations, next-step guidance, register-another action.

**Does not cover:** Email delivery, social sharing, amendment UI.

## Requirements

### Payment Status Display

R1 — The confirmation screen shows a payment status badge prominently at the top of the summary.

R1.1 — When `status === "confirmed"`: Green badge "Paid" (sentence case) with a checkmark icon. Badge color is terracotta/orange (#D76B51).

R1.2 — When `status === "pending_verification"`: Blue badge "VERIFICATION IN PROGRESS" with a clock icon.

R1.3 — When `status === "pending"`: Grey badge "AWAITING PAYMENT" with an exclamation icon and a call-to-action to complete payment (link to `/payment/:regCode`).

R1.3.1 — The `pending` status is reached not only before any payment, but also when a committee partial verification leaves a shortfall: the original payment is verified for less than `total_amount`, a new `payment_pending` record is created for the remainder (see `payment-flow.spec.md` R7.20–R7.21), and the registration returns to `pending`. In this case the badge and CTA are identical to the pre-payment state — "Additional payment required" is conveyed only via the messaging in R1.3.2, not a distinct badge.

R1.3.2 — When `status === "pending"` AND at least one `verified` payment already exists for the registration (i.e. this is a return to `pending` after partial verification, not the initial state), the call-to-action copy reads "Additional payment required" instead of the default first-payment prompt, and the amount shown is the outstanding balance (see `review-pay.spec.md` for the balance-due payment page behavior).

### Registration Summary

R2 — The confirmation screen displays:

| Item | Format | Source |
|------|--------|--------|
| R2.1 — Registration ID | Monospace, letter-spaced | `regCode` from API response |
| R2.2 — Attendee name | Bold | `fullName` from `contact` |
| R2.3 — Attendee count | "You + N Guests" | Computed from attendee counts |
| R2.4 — Meal summary | "X Veg, Y Non-veg" | From attendee counts |
| R2.5 — Accommodation | Type label from selection | Only shown when accommodation is not "none" |
| R2.6 — Payment status | Badge (see R1) | From `status` field |
| R2.7 — Total amount | Bold, accent color, serif font | From `pricingBreakup.total` |

R2.8 — Email confirmation note: "Confirmation sent to {email}" — displayed below the summary.

### Pending Verification State

R3 — When the registration status is `pending_verification`, the page shows a waiting state.

R3.1 — An animated checkmark icon plays on entry. From the user's perspective, they are done — they have submitted their proof and are waiting for committee review. The checkmark conveys completion of their action, not payment confirmation.

R3.2 — A message is displayed: "Your payment proof has been received. The committee is reviewing it — this usually takes 24-48 hours. You'll receive a confirmation email once verified."

R3.3 — The entry pass preview (R4) is NOT shown in the pending verification state — only confirmed registrations get entry passes.

R3.4 — A "Check Status" button is displayed that triggers a full page reload. No targeted API re-fetch — the page reloads and re-fetches all data from scratch.

### Confirmed State (Entry Pass)

R4 — When the registration status is `confirmed`, an entry pass is displayed.

R4.1 — The pass includes: registration code (monospace), attendee name, QR code, and event date "15 August 2026".

R4.2 — The pass has decorative styling (perforated edge, tape effect).

R4.3 — The QR code encodes a URL: `{current origin}/pass#{rawRegCode}` (see `pass-retrieval.spec.md` R1.1).

R4.4 — On mobile, the pass is displayed inline at the top of the confirmation page.

R4.5 — An animated checkmark plays on entry for confirmed registrations.

### Next Steps

R5 — Three guidance cards are displayed for confirmed registrations. For pending verification, different cards are shown.

R5.1 — Confirmed guidance cards:
| # | Icon | Title | Description |
|---|------|-------|-------------|
| R5.1.1 | Email icon | "Confirmation sent" | "Check your email for the full receipt" |
| R5.1.2 | Ticket icon | "Bring your pass" | "Show this at check-in" |
| R5.1.3 | People icon | "Join the community" | "Connect with batchmates" |

R5.2 — Pending verification guidance cards:
| # | Icon | Title | Description |
|---|------|-------|-------------|
| R5.2.1 | Email icon | "Check your email" | "We'll notify you when your payment is verified" |
| R5.2.2 | Clock icon | "Verification in progress" | "The committee reviews payments within 24-48 hours" |
| R5.2.3 | Lock icon | "Your data is secure" | "Your registration details are safely stored" |

### Actions

R6 — Action buttons are displayed based on status.

R6.1 — Confirmed: `ConfirmationActions` renders only "Register another batchmate" (clears data, returns to step 1). "Download Pass" is rendered separately by `ConfirmationLayout` in the entry pass dock — on desktop it is a visible button ("Download Pass"); on mobile it is an icon button with `aria-label="Download entry pass as PDF"`. "Share with Friends" does not exist in the confirmation flow.

R6.2 — Pending verification: "Check Status" (re-fetches), "Register another batchmate" (clears data, returns to step 1).

R6.3 — Pending (awaiting payment): "Complete Payment" (navigates to `/payment/:regCode`).

### Donation-Only Confirmation Path

R7 — When the registration has `attendanceIntent === "donation_only"`, a separate layout is rendered: `DonationConfirmationLayout`.

R7.1 — `DonationConfirmationLayout` renders a `ThankYouCard` with a flip animation on entry. The card conveys gratitude for the contribution.

R7.2 — Below the card, a `WhatsNextPanel` with `variant="donation"` is rendered. This panel shows guidance appropriate for donors (no event attendance steps).

R7.3 — No entry pass is shown for donation-only registrations. No scrapbook or pass-related UI is rendered.

R7.4 — The donation-only confirmation path is distinct from the attending confirmation path — the components and messaging are different, but the underlying registration summary data (name, regCode, amount) is still displayed.

R7.5 — The headline amount on the donation-only confirmation is the pricing total (reunion donation + college contributions), NOT the donation field alone. A donor who gave only a college contribution must see their full amount, never ₹0.

R7.6 — When the registration includes both a reunion donation and college contribution(s), the card shows a row per component: the donation and one row per cause (labeled with the cause's display name).

---

## States

| State | Description |
|-------|-------------|
| Confirmed | Full summary, pass, next steps, and actions displayed |
| Pending verification | Summary with "verification in progress" badge, pulse animation, waiting guidance |
| Pending (awaiting payment) | Summary with "awaiting payment" badge, call-to-action to payment page |

Note: `pending` is reached both from the initial registration (no payment yet) and from a return trip after a partial committee verification (shortfall — see R1.3.1). The page cannot visually distinguish these two paths beyond the CTA copy in R1.3.2 — there is no separate "balance due" state in this model.

## Data Flow

**Reads from API:** `GET /api/registrations/me` — returns full registration including status.

**Determines display:** The `status` field drives which layout and components are rendered (confirmed vs pending_verification vs pending).

## Edge Cases

- The registration ID is always server-generated — it should never be empty on this screen.
- The status field can change between page visits. The page always fetches fresh data from the API.
- If the page is refreshed, the confirmation renders from the JWT-authenticated server record (not localStorage).
- A user in `pending_verification` state who refreshes the page multiple times sees the same waiting state — no change until the committee acts.
- After committee verification, the next refresh (or manual "Check Status" click) transitions from pending_verification to confirmed state — but only when the sum of verified payments meets `total_amount` (see `payment-flow.spec.md` R7.20). If the verification was partial and a shortfall remains, the next refresh instead shows `pending` with the "Additional payment required" messaging (R1.3.1–R1.3.2), not `confirmed`. The page must not assume verification always advances the registration to `confirmed`.

## Dependencies

- Parent: `registration-page.spec.md` R28–R31
- Pricing: `pricing-engine.spec.md`
- Payment: `payment-flow.spec.md`
- Pass retrieval: `pass-retrieval.spec.md`
- API: `submission-api.spec.md`
