# Specification: Payment Advice Page

## Purpose

Provide a registrant with a print-ready Payment Advice showing the complete final registration charge, money already verified as paid, the amount still payable, and the association's international bank-transfer details.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [R1–R4: Access and identity](#r1r4-access-and-identity)
  - [R5–R6: Registration status](#r5r6-registration-status)
  - [R7–R13: Document content](#r7r13-document-content)
  - [R14–R17: Printing](#r14r17-printing)
  - [R18–R19: Page layout and controls](#r18r19-page-layout-and-controls)
  - [R20–R21: Accessibility](#r20r21-accessibility)
- [States](#states)
- [Data Flow](#data-flow)
  - [Access contracts](#access-contracts)
  - [Registration advice contract](#registration-advice-contract)
  - [Payment bank-details contract](#payment-bank-details-contract)
  - [Page outputs](#page-outputs)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)
- [Decisions](#decisions)

## Scope

**Covered:** `/pay/:regCode/advice`; access by secure payment link or signed-in session; canonical registration identity; final pricing and payment reconciliation; international bank details; generation date; entry from the payment page; browser printing; loading, access, data, and service-error states; accessibility.

**Out of scope:** A tax invoice; a post-payment receipt; individual payment transaction rows or reference IDs; server-generated or emailed PDFs; editing registration or payment data; changes to the payment page beyond its Payment Advice entry action.

## Requirements

### R1–R4: Access and identity

R1 — A registrant can access the page with either a valid signed-in session or a valid, unused secure payment-link code. A valid code establishes the same signed-in access as the payment page and becomes unusable after its first successful exchange.

**Scenario:** Given no signed-in session and an unused valid code, when the registrant opens `/pay/SMR-100/advice?code=valid`, then the code is accepted, the registration is loaded, and reopening that code in a sessionless browser does not grant access.

R2 — A bad, expired, or already-used `code` query parameter does not override a valid signed-in session. The page removes the unusable code from the visible URL and continues with the session. It does not show the expired-link state in this case.

**Scenario:** Given a valid session and `?code=expired`, when the page resolves access, then it loads the session's registration at the code-free advice URL.

R3 — When neither access method is valid, the page shows an expired-link explanation and an action to request a fresh payment link for the `:regCode` in the current route. The registrant does not enter an email address; the resend service resolves the registration's stored address. While the request is pending the action is disabled; success is confirmed without exposing whether the code exists or any email address; failure shows a retryable error. No registration or financial data is shown.

**Scenario:** Given no valid session and an expired code, when requesting a fresh link fails, then the page shows a retry action and no Payment Advice content.

R4 — The `:regCode` path value identifies the requested page but does not authorize access. After the authenticated registration loads, its `regCode` must match the path exactly; otherwise the browser replaces the URL with `/pay/{authenticated regCode}/advice` before rendering financial data. No advice content or print attempt occurs while access, identity, or the redirect is unresolved.

**Scenario:** Given the authenticated registration is `SMR-200` and the path is `/pay/SMR-100/advice`, when identity resolves, then the browser replaces the path with `/pay/SMR-200/advice` without rendering `SMR-200` data on the mismatched URL.

### R5–R6: Registration status

R5 — Advice content is shown only when the authenticated registration status is `pending`. A `pending_verification` or `confirmed` registration is redirected, using history replacement, to `/confirmation/{registration id}` without rendering or printing advice (see `confirmation.spec.md` R1.1–R1.3 for what the registrant sees there).

**Scenario:** Given a registration in `pending_verification`, when it loads on the advice route, then the registrant is redirected to its confirmation page and no print dialog is requested.

R6 — The payment page (see `review-pay.spec.md` R4, "Bank Transfer Flow") shows an action labelled “Print Payment Advice” only for a loaded `pending` registration. It opens the canonical advice route in a new browser tab without discarding any payment-page form state.

**Scenario:** Given a pending registrant has selected a proof-of-payment file, when they activate “Print Payment Advice”, then the advice opens in a new tab and the selected file remains on the original page.

### R7–R13: Document content

R7 — The document heading and browser title are “Payment Advice”. No title, section heading, amount label, or action labels the document as an invoice or tax invoice; the association-approved disclaimer remains governed by R13.

**Scenario:** Given a ready advice, when its browser title, screen heading, print heading, labels, and actions are inspected, then the document is named only “Payment Advice”.

R8 — The issuer section identifies “TKMCE 2006 Alumni Association” and the event “Smriti 2026”.

**Scenario:** Given a ready advice, when the issuer section is read, then it names both the association and Smriti 2026.

R9 — The payer section shows `contact.fullName` and labels the authenticated registration's `regCode` as “Payment reference”.

**Scenario:** Given Anu Nair's registration code is `SMR-100`, when the advice is ready, then it shows “Anu Nair” and “Payment reference: SMR-100”.

R10 — The amount section presents the complete final registration itemization in this order: base registration fee; college contribution; each final pricing line in the order supplied by the registration service; donation when greater than zero. Base fee and college contribution remain visible when zero; zero-value final pricing lines and a zero donation are omitted. Each description is paired with its amount. It then shows, in order, “Registration total” from `pricingBreakup.total`, “Already paid” from the explicit numeric `verifiedPaymentAmount`, and “Amount payable now” from `pendingPaymentAmount` — the same partial-verification/shortfall reconciliation specified in `payment-flow.spec.md` R6.2–R6.3.1. All amounts are INR, formatted with the `en-IN` grouping pattern, the `₹` symbol, and two decimal places. The page renders and prints only if every supplied amount is present and non-negative, itemized amounts sum to the registration total, and `Registration total = Already paid + Amount payable now`; otherwise it shows the data-error state.

**Scenario:** Given a final itemization totals ₹14,000, `verifiedPaymentAmount` is ₹5,000, and `pendingPaymentAmount` is ₹9,000, when the advice is ready, then it shows the complete final itemization followed by “Registration total ₹14,000.00”, “Already paid ₹5,000.00”, and “Amount payable now ₹9,000.00”.

R11 — The bank section shows these labelled values from the payment-bank-details contract: beneficiary bank name, account holder name, account number, IFSC code, SWIFT/BIC code, branch, country, currency, purpose-of-payment code, and purpose-of-payment description. No required value may be blank; a missing value produces the data-error state.

**Scenario:** Given a bank fixture supplies `bank: "Example Bank"`, `accountName: "TKMCE 2006 Alumni Association"`, `accountNumber: "0001"`, `ifscCode: "EXAM0000001"`, `swiftCode: "EXAMPLE1"`, `branch: "Main Branch"`, `country: "India"`, `currency: "INR"`, `purposeOfPaymentCode: "S1107"`, and `purposeOfPayment: "Event registration"`, when the advice is ready, then each value appears beside its R11 label.

R12 — “Generated on” shows the instant at which the ready document was produced, formatted in English for India using timezone `Asia/Kolkata`, as `D Month YYYY, h:mm am/pm IST`.

**Scenario:** Given the document becomes ready at 2026-07-15 16:30 in Asia/Kolkata, when it renders, then it shows “Generated on 15 July 2026, 4:30 pm IST”.

R13 — The document shows this disclaimer verbatim: “This is a payment advice for Smriti 2026 registration fees, collected by TKMCE 2006 Alumni Association from its members. Not a tax invoice; no GST applies.”

**Scenario:** Given a ready advice, when its disclaimer is read on screen or in print, then it exactly matches the R13 sentence.

### R14–R17: Printing

R14 — After access, canonical identity, `pending` status, every field in the Registration advice and Payment bank-details contracts, the approved disclaimer, and amount reconciliation have all succeeded, the full accessible document is rendered before the browser is asked to open its print dialog automatically.

**Scenario:** Given a pending registration with valid reconciled data, when the document becomes ready, then its content is present before the automatic print request occurs.

R15 — The automatic print request occurs at most once per page load, including when the page's startup work is repeated. Redirect, expired-link, loading, and error states never request printing.

**Scenario:** Given startup processing is repeated twice for one ready page load, when processing settles, then the browser receives exactly one automatic print request.

R16 — A visible on-screen “Print” button remains available after the automatic request whether the browser opens, blocks, or dismisses its print dialog. Activating it makes a new print request and does not reload the page.

**Scenario:** Given the browser blocks automatic printing, when the registrant activates “Print”, then the browser receives a manual print request and the advice remains visible.

R17 — Printed and saved-PDF output targets A4 portrait with 12 mm margins. Item rows, summary rows, and individual bank label/value pairs do not split across pages; headings are not orphaned from their following content; all content may continue onto additional pages without clipping or overlap. Screen-only controls and any test-environment banner are absent from output.

**Scenario:** Given an itemization that requires two A4 pages, when saved as PDF, then every item, total, and bank value is present, grouped legibly, and no Print, Back, or test-environment control appears.

### R18–R19: Page layout and controls

R18 — The route has no application shell, navigation bar, sidebar, or action other than the two controls in R19. In the document region, sections appear in this order: heading and issuer; payer and reference; itemization and summary; bank details; generated date; approved disclaimer.

**Scenario:** Given the advice is ready, when read from top to bottom, then all six document sections appear in the specified order with no application shell.

R19 — Outside the document region, screen-only controls contain “Print” and “Back to payment page”. Back navigates to `/pay/{authenticated regCode}`. Both controls are keyboard operable, have visible focus, and are excluded from print.

**Scenario:** Given the advice for `SMR-100` is ready, when “Back to payment page” is activated, then the browser navigates to `/pay/SMR-100`.

### R20–R21: Accessibility

R20 — The page has one level-one heading, “Payment Advice”; every named document section uses a level-two heading with no skipped heading level; itemization uses a table with programmatically identified “Description” and “Amount” headers; bank labels are programmatically associated with their values; status and error changes are announced to assistive technology.

**Scenario:** Given a screen reader is on the ready page, when navigating by headings and tables, then the reader identifies “Payment Advice”, every section, and the description and amount for each item.

R21 — Screen text and controls meet WCAG 2.2 AA contrast requirements, including 4.5:1 for normal text and 3:1 for large text and focus indicators. Printed financial and bank content uses dark text on a white background and remains distinguishable without color.

**Scenario:** Given output is printed in grayscale, when the document is inspected, then every amount, label, bank value, and section boundary remains legible without relying on color.

## States

| State | Trigger | Observable behavior |
|---|---|---|
| Resolving access | Link/session decision pending | Neutral loading status; no financial data or print |
| Expired link | No valid access | Explanation and resend action (R3) |
| Resending link | Resend in progress | Action disabled; progress announced |
| Resend success | Request accepted | Generic confirmation; no email address disclosed |
| Resend error | Request failed | Error and enabled retry action |
| Loading registration | Access valid; registration pending | Loading status; no advice or print |
| Canonicalizing | Path code differs from registration | Replace navigation; no advice or print (R4) |
| Redirecting | Status is `pending_verification` or `confirmed` | Confirmation navigation; no advice or print (R5) |
| Ready | Pending registration and valid reconciled data | Full advice and controls; one automatic print attempt |
| Access error | Registration request returns 401 or 403 | Session is treated as invalid and expired-link behavior is shown |
| Not found | Registration request returns 404 | “Registration not found” with a link back to the payment page; no print |
| Service error | Registration request fails otherwise | “We couldn't load your payment advice” with Retry and Back actions; no print |
| Data error | Required money/bank field missing, invalid, or unreconciled | “Payment details need review. Please contact the association.”; Back action; no financial document or print |

## Data Flow

### Access contracts

| Interface | Input | Observable result used by this page |
|---|---|---|
| `GET /api/auth/verify?token={code}` | The route's `code` query value is sent as `token` | A successful response establishes the attendee session; an invalid or expired token returns 401 |
| `GET /api/registrations/me` | The attendee session | The authenticated registration advice contract below, or 401/403/404/service error |
| `POST /api/auth/payment-link` | JSON `{ "regCode": "<current route regCode>" }` | A generic accepted message that does not reveal whether the registration exists or its stored email |

### Registration advice contract

The authenticated registration response consumed by this page provides:

| Field | Consumer meaning |
|---|---|
| `id` | Confirmation-route identity |
| `regCode` | Canonical payment reference and route identity |
| `status` | One of `pending`, `pending_verification`, `confirmed` |
| `contact.fullName` | Payer name |
| `pricingBreakup.base` | Final base registration fee and label |
| `pricingBreakup.collegeContribution` | Final college contribution and label |
| `pricingBreakup.lines[]` | Ordered final item descriptions and amounts |
| `pricingBreakup.donation` | Final donation amount |
| `pricingBreakup.total` | Complete final registration total |
| `verifiedPaymentAmount` | Explicit numeric total of payments verified and applied to this registration |
| `pendingPaymentAmount` | Explicit numeric amount currently payable |

`verifiedPaymentAmount` is a required new response field. A boolean such as `hasVerifiedPayments` cannot satisfy R10, and consumers must not calculate it as `pricingBreakup.total - pendingPaymentAmount` because that equality is not otherwise enforced.

### Payment bank-details contract

The association-maintained payment bank-details configuration provides these values. The identifiers are stable; their values are not frozen by this spec.

| Field identifier | Document label |
|---|---|
| `bank` | Beneficiary bank name |
| `accountName` | Account holder name |
| `accountNumber` | Account number |
| `ifscCode` | IFSC code |
| `swiftCode` | SWIFT/BIC code |
| `branch` | Branch |
| `country` | Country |
| `currency` | Currency |
| `purposeOfPaymentCode` | Purpose-of-payment code |
| `purposeOfPayment` | Purpose-of-payment description |

### Page outputs

- A canonical advice URL or a confirmation redirect.
- A print request only from the ready state.
- A resend-link request from the expired-link state.
- Navigation back to the canonical payment page.

## Edge Cases

- An invalid query code with a valid session follows R2; without a valid session it follows R3.
- A stale tab after proof submission follows R5 as soon as the refreshed registration becomes `pending_verification` or `confirmed`.
- A fresh registration displays “Already paid ₹0.00”; a partial verified payment displays the explicit applied amount.
- A negative, non-numeric, absent, or unreconciled payment amount follows the data-error state; it is never repaired or inferred in the page.
- A browser may suppress automatic printing; R16 provides the user-initiated fallback.
- A long itemization paginates according to R17 and never reduces or omits financial data to fit one page.
- If the route uses different letter case from the canonical `regCode`, R4 treats it as a mismatch and replaces it with the canonical value.

## Dependencies

- Authenticated registration advice response with all fields in the Registration advice contract, including the new numeric `verifiedPaymentAmount`. `verifiedPaymentAmount` and `pendingPaymentAmount` reconcile a possible partial-verification shortfall — the same mechanism specified in `payment-flow.spec.md` R6.2–R6.3.1 (Partial Verification / Short Payment) and surfaced on the confirmation page per `confirmation.spec.md` R1.3.1–R1.3.2. This page is a second, print-oriented consumer of that same reconciliation state, not a new mechanism.
- Session/access (R1–R3) is the same mechanism specified in `authentication.spec.md`: `GET /api/auth/verify` (R7.6–R7.9), JWT-in-`localStorage` (R4.1–R4.3), and the `Attendee+` access level for the registration read (R9.2). This page does not introduce a new auth mechanism — R1–R3 restate, in page-observable terms, the access level the payment page itself requires (see `review-pay.spec.md` R4, "Bank Transfer Flow").
- `POST /api/auth/payment-link` (R3's resend action) is **not currently documented in any existing spec** — it's the self-service "email me a fresh link" endpoint distinct from the staff-triggered resend in `staff-operations.spec.md` R1.14. This spec restates its expected behavior directly (R3) since there is nothing to cross-reference; documenting it properly belongs to whichever spec owns the payment page's own expired-link state, not this one.
- Association-maintained payment bank-details configuration containing every R11 field identifier — the same configuration `review-pay.spec.md` R4.3 displays on the payment page.
- Confirmation route `/confirmation/:registrationId` (see `confirmation.spec.md`) and payment route `/pay/:regCode` (see `review-pay.spec.md` R4).
- Association approval of the exact R13 disclaimer is a release gate. Until it is approved, this feature must not be released; product and engineering must not substitute different tax wording.

## Decisions

- The document is always called “Payment Advice”, never “Invoice”. It shows the full final charge while separately reconciling verified payments and the current payable amount.
- “Already paid” means money verified and applied to this registration. It comes only from `verifiedPaymentAmount`; it is never inferred from other totals.
- `pending_verification` and `confirmed` registrations go to confirmation. Only `pending` registrations receive advice.
- A valid signed-in session takes precedence over an unusable query code, preventing a stale link parameter from blocking an authenticated registrant.
- The authenticated registration is authoritative for identity. A mismatched route is canonicalized before any financial data is exposed.
- The no-GST wording is not an engineering assumption. Exact wording remains an association-approval decision and blocks release until resolved.
