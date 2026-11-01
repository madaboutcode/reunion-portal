# Specification: Pass Retrieval

## Purpose

Allows an alumni to view their entry pass by scanning the QR code on their (or someone else's) confirmation page. The QR encodes a URL that opens a lightweight pass display page.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [QR Code](#qr-code)
  - [Lookup Endpoint](#lookup-endpoint)
  - [Pass Page](#pass-page)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** QR code generation on the entry pass, public lookup endpoint, pass display page at `/pass`.

**Does not cover:** Authentication (no JWT or session involved — see `authentication.spec.md`), full confirmation page rendering, pass download/PDF generation, magic link authentication (V2).

---

## Requirements

### QR Code

R1 — The entry pass on the confirmation page contains a scannable QR code.

R1.1 — The QR code encodes `{window.location.origin}/pass#{rawRegCode}` where `rawRegCode` is the 16-character registration code without dashes (e.g., `SMRTAAAAAAAABBBB`).

R1.2 — The URL domain is determined at render time from `window.location.origin` — never hardcoded. This ensures the QR works correctly in all environments (local dev, staging, production).

R1.3 — The QR is rendered as an inline SVG via the `qrcode` npm package. No canvas element, no image download.

R1.4 — The QR shows a skeleton placeholder while the SVG is being generated asynchronously.

### Lookup Endpoint

R2 — `POST /api/registrations/lookup` is a public endpoint (no authentication required).

R2.1 — Request body: `{ "regCode": "<string>" }`.

R2.2 — The endpoint normalizes the input: strips dashes, trims whitespace, uppercases.

R2.3 — The endpoint validates that the normalized code starts with `SMRT` and is exactly 16 characters. Codes that fail this check receive `400 { "error": "Invalid pass code format" }`.

R2.4 — If the code is valid but no matching registration exists, the response is `404 { "error": "Registration not found" }`.

R2.5 — On success, the response is:

```json
{
  "name": "Full Name",
  "regCode": "SMRTAAAAAAAABBBB",
  "attendanceIntent": "attending",
  "attendeeCount": 3,
  "accommodation": "shared"
}
```

R2.6 — The response contains only pass display data. No internal IDs, no email, no phone, no payment details, no JWT token.

R2.7 — Sequential numeric IDs must never be accepted as input. The SMRT prefix + 16-char length validation (R2.3) prevents this.

R2.8 — No rate limiting in V1. The reg code is the credential — anyone with it can view the pass. [REVIEW: add rate limiting before public launch?]

### Pass Page

R3 — The pass page is a client-side route at `/pass`.

R3.1 — The page reads the registration code from the URL hash fragment (`window.location.hash`). Hash fragments are not sent to the server — the code stays client-side until the explicit API call.

R3.2 — If no hash fragment is present, the page shows a "Pass Not Recognized" message.

R3.3 — The page calls `POST /api/registrations/lookup` with the hash value as `regCode`.

R3.4 — On success with `attendanceIntent` other than `"donation_only"`, the page renders the entry pass graphic directly. No redirect, no authentication, no navigation to another page.

R3.5 — On success with `attendanceIntent === "donation_only"`, the page renders a thank-you message with the donor's name. No entry pass is shown — donation-only registrants do not attend the event.

R3.6 — On 404, the page shows "Pass Not Recognized" with guidance to check the code.

R3.7 — On other errors, the page shows a generic error message with a "Try Again" button that reloads the page.

R3.8 — The page does not store any data in localStorage. It is stateless — each visit makes a fresh API call.

---

## States

| State | Trigger | Display |
|-------|---------|---------|
| Loading | Page opened with hash fragment | Spinner with "Recognizing your pass..." |
| Pass displayed | Lookup succeeded, attending intent | Entry pass graphic (name, formatted code, QR, date) |
| Thank you | Lookup succeeded, donation_only intent | Thank-you message with donor name |
| Not found | No hash, or 404 from lookup | "Pass Not Recognized" message |
| Error | Network error, 429, 5xx | Error message with retry button |

---

## Data Flow

```
QR scanned or URL opened
  ↓
Browser: /pass#SMRTAAAAAAAABBBB
  ↓ reads hash fragment (client-side only)
PassPage
  ↓ POST /api/registrations/lookup { regCode }
Server: validates format → findByRegCode → count attendees
  ↓
Returns { name, regCode, attendanceIntent, attendeeCount, accommodation }
  ↓
PassPage renders EntryPassCard (or thank-you for donation_only)
```

---

## Edge Cases

- Dashes in the hash fragment (e.g., `#SMRT-AAAA-AAAA-BBBB`) are stripped by the server. Both formats work.
- Lowercase codes are uppercased by the server. Case-insensitive.
- The pass page works on any device — it renders `EntryPassCard` at mobile size regardless of viewport, since it's a focused view.
- If the same QR is scanned by someone other than the registrant, they see the pass. The reg code is the only credential for viewing. This is intentional — the pass is not sensitive information.
- Browser back button from the pass page returns to wherever the user came from (camera app, another tab, etc.). No history manipulation.

---

## Dependencies

- QR rendered by: `confirmation.spec.md` R2.3 (entry pass on confirmation page)
- Endpoint auth: `authentication.spec.md` R3.7 (listed as public)
- Registration data: `submission-api.spec.md` (registration creation)
