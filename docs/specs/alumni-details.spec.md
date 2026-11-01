# Specification: Alumni Details (Wizard Step 2)

## Purpose

Captures the registrant's identity and contact information. Participation type was already chosen in Step 1 and determines which subsequent steps appear. This step no longer contains the participation/intent selection.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [Fields](#fields)
  - [Attendance Intent](alumni-details.spec.md)
  - [Validation](#validation)
  - [Navigation](#navigation)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Form fields for alumni identity and contact, step-level validation and navigation.

**Does not cover:** Participation type selection (moved to Step 1 — see `step1-participation.spec.md`), form field presentation (see component specs for input, select, form-field), hero layout (see `registration-page.spec.md` R4).

## Requirements

### Fields

R1 — The step collects 8 fields in a single form:

| # | Field | Type | Required | Placeholder / Default | Notes |
|---|-------|------|----------|----------------------|-------|
| R1.1 | Full name | text | Yes | Warm placeholder, e.g. "What should we call you?" | No reference to ID documents in placeholder |
| R1.2 | Branch | dropdown | Yes | — | Options: Architecture, Chemical Engineering, Civil Engineering, CSE, EEE, ECE, Mechanical Engineering, Production Engineering |
| R1.2a | Gender | dropdown | Yes | — | Values: Male, Female, Prefer not to say |
| R1.3 | Email | email | Yes | — | Used as auth identity and for resume/confirmation emails |
| R1.4 | WhatsApp number | tel | Yes | Country code picker (not hardcoded +91) | Primary contact — most alumni communicate via WhatsApp |
| R1.5 | Mobile (alternate) | tel | No | Country code picker | Alternate/backup number |
| R1.6 | City | text | Yes | "Your current city" | |
| R1.7 | Country | text | Yes | Defaults to "India" | Required |

R1.8 — Attendance intent / participation type is NOT collected on this step. It was chosen in Step 1 (see `step1-participation.spec.md`).

R1.9 — Batch/year is NOT collected. All registrants are batch of 2006 by definition.

R1.10 — Phone fields support full international country codes via a country code picker (see registration-page.spec.md Domain — Phone Fields).

### Validation

R3 — Validation rules for `alumniDetailsSchema` (see `validation.spec.md` R4). Summary:
- Full name, branch, city: required (min 1 character)
- Gender: required; must be one of: Male, Female, Prefer not to say
- Email: required, valid email format
- WhatsApp: required, minimum 7 digits, must include a `+` prefix (e.g. `+91 98765 43210`)
- Country: required (defaults to "India", but must be explicitly present)
- Mobile: optional

R3.1 — Validation runs on "Continue" click. Errors display inline next to the relevant field.

### Email Duplicate Check

R4 — When the user clicks "Continue" and form validation passes, the system checks whether the email is already registered.

R4.1 — During the check, the Continue button shows a loading/spinner state. The user cannot double-click to bypass.

R4.2 — If the email is already registered, the form does NOT proceed. A modal dialog appears with:
- A message: "This email is already registered."
- The registered email displayed for clarity.
- **"Send me a login link"** — the system sends a login link to the email address and shows a confirmation ("Login link sent! Check your inbox and spam folder.")
- **"Use a different email"** — dismisses the modal so the user can edit the email field and try again.

R4.3 — If the email is not registered, or the check-email API call fails, the wizard proceeds to the next step. API failure is not a blocker — the user is let through.

R4.4 — The modal can be dismissed by clicking the backdrop (except while sending), "Use a different email", or "Close" (after link sent). Dismissing returns the user to the form to change their email.

### Navigation

R5 — Step 2 has a back button that returns the user to Step 1 (Participation).

R5.1 — "Continue" validates the form, then runs the email duplicate check (R4). On success, transitions to step 3 (Your Group) and scrolls to top (see `registration-page.spec.md` R6). For donation-only participation, step 3 is skipped and the user transitions to step 5 (Giving Back).

## States

| State | Description |
|-------|-------------|
| Empty | First visit, all fields blank except country ("India") |
| Partially filled | Some fields populated (draft restored from persistence) |
| Validation errors | One or more fields show inline error messages |
| Checking email | Continue clicked, validation passed, email check in progress (spinner on button) |
| Email registered | Duplicate detected, modal shown with retrieval and change-email options |
| Link sent | Magic link requested, confirmation message shown in modal |
| Complete | All required fields valid, email not registered, ready to proceed |

## Data Flow

**Reads:** Previously entered alumni identity and contact fields (to populate form on load or draft restore). Participation type from Step 1 (to determine which next step to navigate to).

**Writes:** Full name, branch, gender, email, phone numbers, city, country — on "Continue" success.

## Edge Cases

- Phone fields store the full number with country code. The country code picker is part of the input, not a separate display-only element.
- Country defaults to "India" on initial load but can be cleared by the user.
- Restoring a draft with a branch value that no longer exists in the dropdown options should still display the saved value. [REVIEW: does the code handle this, or does it silently reset?]

## Dependencies

- Parent: `registration-page.spec.md`
- Reads: `step1-participation.spec.md` (participation type, for navigation logic)
- Validation: `validation.spec.md` R2
- Downstream: data written here is read by `attendees-meals.spec.md`, `accommodation.spec.md`, `giving-back.spec.md`, `photo-id.spec.md`, `review-pay.spec.md`, `pricing-engine.spec.md`
