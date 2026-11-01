# Specification: Registration Page

## Purpose

The registration page is a multi-step wizard that guides a TKMCE 2006 batch alumni through confirming attendance (or making a donation), capturing their group and accommodation preferences, collecting a photo and ID, and completing payment. It is the primary entry point for event registration and the source of truth for all downstream planning data.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [R1–R3: Wizard Structure](#r1r3-wizard-structure)
  - [R4: Page Layout](#r4-page-layout)
  - [R5–R6: Step Transitions](#r5r6-step-transitions)
  - [R7–R8: Responsive Behavior](#r7r8-responsive-behavior)
  - [R9–R14: Step Skip Rules](#r9r14-step-skip-rules)
  - [R15–R20: Navigation Guards](#r15r20-navigation-guards)
  - [R21–R25: Payment Flow](#r21r25-payment-flow)
  - [R26: Estimate Sidebar](#r26-estimate-sidebar)
  - [R27: Resume Flow](#r27-resume-flow)
  - [R28–R31: Confirmation Screen](#r28r31-confirmation-screen)
  - [R32–R36: Email Notifications](#r32r36-email-notifications)
  - [R37–R42: Admin](#r37r42-admin)
  - [R43: Draft Persistence](#r43-draft-persistence)
  - [R44–R46: Non-Functional](#r44r46-non-functional)
- [Domain](#domain)
  - [Participation Type](#participation-type)
  - [Attendance Intent](#attendance-intent)
  - [Meal Preference](#meal-preference)
  - [Accommodation Type](#accommodation-type)
  - [Pricing Configuration](#pricing-configuration)
  - [Phone Fields](#phone-fields)
  - [File Upload Constraints](#file-upload-constraints)
  - [Gender](#gender)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)
- [Child Specs](#child-specs)

---

## Scope

**Covers:** Alumni registration wizard (7 steps), donation-only abbreviated flow, estimate sidebar, draft persistence, payment initiation, resume flow, confirmation screen, admin registration management.

**Does not cover:** QR/badge check-in at venue, event-day vendor tools, hotel/accommodation provider portal, WhatsApp/SMS reminders, public donor recognition page, attendee networking directory, analytics dashboard, bulk email campaigns, actual accommodation booking (V1 captures interest only).

---

## Requirements

### R1–R3: Wizard Structure

R1 — The wizard presents 7 named steps in this order:

| Step | Name |
|------|------|
| 1 | Participation |
| 2 | About You |
| 3 | Your Group |
| 4 | Your Stay |
| 5 | Giving Back |
| 6 | Photo & ID |
| 7 | Review & Pay |

R2 — Step progression is linear. The user cannot jump ahead by clicking a future step in the stepper; they can navigate back to any previously completed step.

R3 — The active step and completed steps are visually distinct in the stepper. The stepper is visible at all times during the flow.

### R4: Page Layout

R4 — The registration page has three visual regions:

1. **Hero section** — full-width banner at the top with event branding (name, date, tagline, hero image). Visible only on step 1. Hidden from step 2 onward to maximize form space.
2. **Form area** — the active step form, centered with max-width constraint. Contains the stepper above the form.
3. **Estimate sidebar** — a cost summary panel to the right of the form area on desktop (≥1024px), below the form on mobile.

R4.1 — On mobile (<1024px), the estimate sidebar collapses into an expandable panel shown below the form content, above the navigation buttons.

### R5–R6: Step Transitions

R5 — Step transitions use a horizontal slide animation: incoming step slides in from the right, outgoing step slides out to the left. Back navigation reverses the direction.

R6 — On every step transition (forward or back), the page scrolls to the top of the form area. This happens after the transition animation completes.

### R7–R8: Responsive Behavior

R7 — All interactive elements meet a minimum touch target of 44×44px on mobile.

R8 — The layout is tested and functional at 375px, 768px, and 1280px viewport widths.

### R9–R14: Step Skip Rules

R9 — When participation type is `donation_only`, steps 3 (Your Group) and 4 (Your Stay) are skipped. The flow goes: Step 1 → Step 2 → Step 5 → Step 6 → Step 7.

R10 — When participation type is `campus_only`, step 4 (Your Stay) is skipped. The flow goes: Step 1 → Step 2 → Step 3 → Step 5 → Step 6 → Step 7.

R10.1 — When participation type is `full_celebration`, all 7 steps are shown in order.

R11 — The stepper reflects skip rules: skipped steps are visually marked as not applicable (not shown as incomplete or errored).

R12 — If the user returns to Step 1 and changes participation type such that previously completed steps are now skipped, any data entered in those steps is retained in the draft but not submitted or priced.

R13 — If the user returns to Step 1 and changes participation type such that previously skipped steps are now required, those steps reappear as required.

R14 — Step 6 (Photo & ID) is required for all users regardless of participation type.

### R15–R20: Navigation Guards

R15 — The "Continue" button on each step runs step-level validation before transitioning. If validation fails, the transition does not occur and errors are shown inline.

R16 — The "Back" button never validates — it always transitions immediately.

R17 — A browser back/forward gesture is intercepted and treated as wizard back/forward navigation (not a page reload).

R18 — Navigating away from the wizard (closing tab, entering a new URL) does not prompt the user — the draft is saved automatically (see R43).

R19 — The wizard URL does not encode step state in the path. The current step is held in client-side state only. Refreshing the page restores the draft from localStorage and returns the user to the last completed step.

R20 — The "Continue" button on the final step (Step 7 — Review & Pay) initiates payment (see R21), not a step transition.

### R21–R25: Payment Flow

R21 — When the user confirms on Review & Pay, the client sends the full registration payload to the server. The server calculates the final price, creates a registration record, generates a secure resume token, sends a resume email, and returns a payment gateway URL. The client then redirects to that URL.

R22 — The resume token has ≥128-bit entropy and is stored as a hash server-side. The token is never reused after a confirmed payment.

R23 — Payment statuses tracked: `pending`, `successful`, `failed`, `manual_review`.

R24 — Pricing is calculated server-side at payment initiation. The pricing snapshot is stored on the registration record. Config changes after payment initiation do not affect that record.

R25 — The payment gateway is accessed via an abstraction layer. The dev environment uses a stub. The real provider is configured via environment variable.

### R26: Estimate Sidebar

R26 — The estimate sidebar shows a live cost breakdown that updates as the user fills in each step. It is visible throughout the wizard from step 2 onward (the sidebar is not displayed on step 1, the Participation step, as the prices are already shown on the participation cards). The sidebar is the parent of the estimate sidebar component (see `components/estimate-sidebar.spec.md`).

### R27: Resume Flow

R27 — A user who returns via a resume link is routed based on their registration state:

| State | Landing destination |
|-------|-------------------|
| Draft (no payment attempted) | Last incomplete step |
| Payment pending | Review & Pay step |
| Payment failed | Review & Pay step with retry prompt |
| Payment confirmed | Confirmation screen |

### R28–R31: Confirmation Screen

R28 — After successful payment, the user lands on a confirmation screen (not a wizard step).

R29 — The confirmation screen shows: registration reference number, payment status, attendee summary (names, meal preferences), accommodation interest summary, and donation amount if applicable.

R30 — The confirmation screen shows a "Download receipt" action and a "Share" action.

R31 — The confirmation screen is also accessible via a resume link after payment is confirmed.

### R32–R36: Email Notifications

R32 — A resume email is sent immediately when the payment request is initiated (before the gateway response).

R33 — A confirmation email is sent when payment status transitions to `successful`.

R34 — A manual review notification email is sent when payment status is set to `manual_review`.

R35 — All emails are sent to the registrant's email address captured in Step 2 (About You).

R36 — The admin can resend the resume email or confirmation email for any registration.

### R37–R42: Admin

R37 — The admin list shows all registrations with search (by name, email, reference) and filters (by status, intent, payment state).

R38 — Admin can view full registration detail: attendees, pricing snapshot, payment attempts, uploaded files (signed URLs).

R39 — Admin can manually set payment status to `successful`, `failed`, or `manual_review`.

R40 — Admin can resend resume and confirmation emails.

R41 — Admin can export registrations as CSV or Excel. Available exports: registrations, meals (with headcount by type), payments, donations, accommodation interest.

R42 — Export includes: headcount totals, meal counts by type, children age groups.

### R43: Draft Persistence

R43 — The wizard saves all form data to `localStorage` as a draft. Persistence occurs on every successful step transition and on every field change (debounced). The draft is restored on page load if present. The draft is cleared after confirmed payment.

R43.1 — The localStorage key is `smriti_reg_v5`. The value is a JSON object containing all wizard fields keyed by step.

R43.2 — If the stored draft fails to parse (malformed JSON), it is discarded silently and the wizard starts fresh.

### R44–R46: Non-Functional

R44 — ID and photo files are stored privately. Admin access uses signed URLs. Files are never publicly accessible by URL.

R45 — All communication is over HTTPS. Resume token endpoints are rate-limited to prevent enumeration.

R46 — Color is not the only status indicator. All statuses have a text label in addition to color coding.

---

## Domain

### Participation Type

The participation type is chosen in Step 1 and determines the headline price and which steps are shown.

Valid values, labels, headline prices, and flow effects:

| Value | Title | Headline Price | Description | Flow |
|-------|-------|---------------|-------------|------|
| `full_celebration` | "Full Celebration" | ₹8,500 | Attend the full two-day reunion including the campus visit and Raviz dinner | All 7 steps |
| `campus_only` | "Campus Only" | ₹5,500 | Attend the TKMCE campus day only | Steps 1 → 2 → 3 → 5 → 6 → 7 (skips Step 4 — Your Stay) |
| `donation_only` | "Sending Love" | — | Can't attend in person, but wants to contribute | Steps 1 → 2 → 5 → 6 → 7 (skips Steps 3 and 4) |

### Attendance Intent

`attendanceIntent` is a derived field that travels alongside `participationType` to the database and downstream systems (it is not removed from the data model).

Valid values:

| Value | Derived from |
|-------|-------------|
| `attending` | `participationType` is `full_celebration` or `campus_only` |
| `donation_only` | `participationType` is `donation_only` |

### Meal Preference

Valid values and labels:

| Value | Label |
|-------|-------|
| `veg` | "Veg" |
| `non_veg` | "Non-Veg" |

Meal preference is collected per person: alumni, spouse, each child, each guest. Default is `veg`.

### Accommodation Type

Valid values, labels, and subtitles:

| Value | Label | Subtitle |
|-------|-------|----------|
| `none` | "Not Needed" | "I have my own arrangements" |
| `shared_double` | "Shared Room (2)" | "Share a room with one other attendee" |
| `shared_triple` | "Shared Room (3)" | "Share a room with two other attendees" |
| `private` | "Private Room" | "A room to yourself" |

Default on first visit: `none`. Shared room is unavailable for registrants whose group includes a spouse, children, or guests.

### Pricing Configuration

Default values (committee may update before build freeze):

| Item | Value |
|------|-------|
| Base registration fee (full celebration) | ₹8,500 (includes ₹1,000 college contribution) |
| Base registration fee (campus only) | ₹5,500 (includes ₹1,000 college contribution) |
| Additional person fee (spouse, guest) | ₹2,910 |
| Child food fee (age 6–12) | ₹1,455 (50% of adult rate) |
| Child food fee (age 12+) | ₹2,910 (same as adult rate) |
| Child free-age threshold | Under 6 years old (age < 6 → ₹0) |
| College contribution minimum (attending only) | ₹0 (₹1,000 already baked into the headline price; Giving Back step lets alumni add more optionally) |
| College contribution (donation-only) | Not applicable |
| College contribution breakout in cost summary | Not shown as a separate line item |
| Accommodation — shared room rate | TBD (committee) |
| Accommodation — private room rate | TBD (committee) |
| Felicitation threshold | ₹50,000 |
| GST on accommodation | 18% |

Felicitation: when a reunion donation is ≥ ₹50,000, the registrant is shown a consent prompt for on-stage felicitation at the event.

Pricing is server-calculated at payment time. Client-side estimate in the sidebar is for display only and may differ from server total if config has changed.

### Phone Fields

- Phone number fields (WhatsApp and alternate mobile) use a country code picker component.
- The stored value always includes the `+` prefix and country code (e.g., `+91 98765 43210`).
- Minimum 7 digits after the country code.
- The country code picker is not hardcoded to `+91` — it supports full international codes.
- The picker is part of the input control, not a separate display element.

### File Upload Constraints

| Upload | Accepted Types | Max Size |
|--------|---------------|----------|
| ID document | JPG, PNG, PDF | 5 MB |
| Photo | JPG, PNG | 5 MB |

- MIME type and file extension must both match the accepted list.
- 0-byte files are rejected ("File is empty").
- Only single-file uploads (no multi-file).

### Gender

Valid values:

| Value | Label |
|-------|-------|
| `male` | "Male" |
| `female` | "Female" |
| `prefer_not_to_say` | "Prefer not to say" |

---

## States

| Wizard State | Description |
|-------------|-------------|
| Fresh | No draft in localStorage; Step 1 (Participation) shown with no selection |
| Draft in progress | localStorage draft present; step restored to last completed step |
| Payment initiated | Registration record created; user redirected to gateway |
| Payment pending | Gateway callback not yet received |
| Payment successful | Confirmed; confirmation screen shown |
| Payment failed | Gateway returned failure; Review & Pay shown with retry prompt |
| Manual review | Admin has flagged; user shown a "payment under review" message |
| Resumed | User returned via resume link; routed per R27 |

---

## Data Flow

**Wizard reads from:** `localStorage` (draft restore on page load), query string (resume token for returning users).

**Wizard writes to:** `localStorage` (draft, on every field change and step transition), server (registration payload on payment initiation via `POST /api/registrations`).

**Step data flows through a shared wizard context.** Each step reads from and writes to the same context object. The context shape mirrors the localStorage draft schema.

**Pricing estimate:** Derived client-side from context on every change. Not stored. Server recalculates authoritatively at payment time.

---

## Edge Cases

- **Browser refresh mid-wizard:** Draft is restored from localStorage; user returns to their last completed step (not step 1).
- **Duplicate email on Step 2:** Step does not proceed; a modal offers "Send me a login link" or "Use a different email" (see `alumni-details.spec.md` R4).
- **Participation type change to donation_only after filling steps 3–4:** Data retained in draft, steps 3–4 skipped; data not submitted.
- **Participation type change to campus_only after filling step 4:** Data retained in draft, step 4 skipped; data not submitted.
- **Participation type change back to full_celebration:** All steps reappear; previously entered data is restored.
- **Malformed draft in localStorage:** Discarded silently; wizard starts fresh (see R43.2).
- **Resume token used after confirmed payment:** Routes to confirmation screen, does not allow re-editing or re-payment.
- **Payment gateway timeout:** User is returned to Review & Pay with a "Payment could not be completed" message and a retry option.

---

## Dependencies

**Blocked by (external decisions needed before build):**
- Payment gateway: provider selection, callback format, test credentials (committee)
- Final pricing: alumni fee, guest fee, child age bands and amounts (committee)
- Accommodation pricing: charged in portal or capture-only (committee)
- Email sender: domain, from-address, SMTP service (committee)
- ID retention policy: delete after event or retain (committee)
- Platform fee handling: passed to user or absorbed (committee)

**Blocks:** Overall Smriti event launch.

---

## Child Specs

| Spec | Covers |
|------|--------|
| `step1-participation.spec.md` | Step 1 participation type selection (Full Celebration / Campus Only / Donation Only) |
| `alumni-details.spec.md` | Step 2 fields, email duplicate check |
| `attendees-meals.spec.md` | Step 3 spouse, children, guests, meal preferences |
| `accommodation.spec.md` | Step 4 accommodation selection, skip rules |
| `giving-back.spec.md` | Step 5 college contribution, reunion donation, felicitation |
| `photo-id.spec.md` | Step 6 photo and ID uploads |
| `review-pay.spec.md` | Step 7 review summary, payment initiation |
| `confirmation.spec.md` | Post-payment confirmation screen |
| `estimate-sidebar.spec.md` | Live cost estimate panel |
| `components/wizard-shell.spec.md` | Stepper, layout, transitions |
| `components/stepper.spec.md` | Stepper component |
| `components/file-upload.spec.md` | File upload drop zone component |
| `components/meal-toggle.spec.md` | Meal preference toggle component |
| `validation.spec.md` | Field-level validation rules for all steps |
| `pricing-engine.spec.md` | Pricing calculation rules |
