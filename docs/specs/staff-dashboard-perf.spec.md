# Specification: Staff Dashboard Performance

## Purpose

Eliminate redundant API calls on the staff dashboard and ensure all data operations happen server-side. Affects three staff API endpoints and the dashboard frontend behavior.

## Contents

- [Scope](#scope)
- [Paged Response Shape](#paged-response-shape)
- [Registrations List Endpoint](#registrations-list-endpoint)
- [Dashboard Stats Endpoint](#dashboard-stats-endpoint)
- [Resources Endpoint](#resources-endpoint)
- [Reports Endpoint](#reports-endpoint)
- [Frontend Load Behavior](#frontend-load-behavior)
- [States](#states)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Response shape changes for `/api/staff/registrations`, server-side filtering/pagination behavior for all staff list endpoints, SQL aggregation for stats/resources/reports, frontend cascade removal.

**Does not cover:** Registration detail endpoint. CSV export. Client-side caching. New UI features.

**Amends:** `staff-api.spec.md` R5 (dashboard stats), R6 (registrations list). `staff-dashboard.spec.md` R3 (attendees page load behavior).

---

## Paged Response Shape

R1 — Paginated endpoints return a standard shape:

```json
{
  "data": [...],
  "page": 1,
  "pageSize": 50,
  "totalItems": 87,
  "totalPages": 2
}
```

R1.1 — `page` is 1-indexed. `totalPages` = ceil(`totalItems` / `pageSize`), minimum 1.

R1.2 — `data` contains at most `pageSize` items. May be empty (0 items match).

R1.3 — Replaces the current `{ registrations, total, page, limit }` shape on `GET /api/staff/registrations`.

---

## Registrations List Endpoint

R2 — `GET /api/staff/registrations` filtering, sorting, and pagination happen entirely server-side.

R2.1 — `type` filter: `type=attendee` returns registrations where participation is attending (full celebration or campus only). `type=donor` returns donation-only registrations. Omitting returns all.

R2.2 — `search` filter: case-insensitive substring match against name, email, registration code (with and without formatting hyphens), and WhatsApp number. A search for `"ravi"` matches a registration with name `"Ravi Kumar"` or email `"ravi@example.com"`.

R2.3 — `status` and `branch` filters: unchanged from `staff-api.spec.md` R6.1.

R2.4 — Results ordered by registration date descending.

R2.5 — Pagination: server returns only the requested page of results. Requesting page 2 with pageSize 50 returns items 51-100 (or fewer if fewer exist).

R2.6 — `totalItems` reflects the count of all rows matching the active filters, not just the current page.

R2.7 — Response shape follows R1 (paged response) with items matching the existing `StaffRegistrationListItem` field set (id, regCode, fullName, email, whatsapp, branch, status, attendanceIntent, participationType, totalAmount, createdAt).

---

## Dashboard Stats Endpoint

R3 — `GET /api/staff/dashboard` returns stats computed server-side via aggregation.

R3.1 — Response shape unchanged: `{ stats: { total, pending, pendingVerification, confirmed, moneyCollected } }`.

R3.2 — Status counts and money collected are computed by the database, not by loading all rows and counting in application code. With N registrations, the endpoint issues a constant number of queries regardless of N.

R3.3 — `type` filter behavior unchanged from `staff-api.spec.md` R6.8.

---

## Resources Endpoint

R4 — `GET /api/staff/resources` computes attendee headcounts via server-side aggregation.

R4.1 — Attendee counts (spouse/child/guest headcount, meal preferences) are computed by the database via a single aggregation query, not by loading attendees per-registration in a loop.

R4.2 — Registration-level aggregates (alumni meal, accommodation, t-shirt sizes) are computed from the registration records themselves — no per-registration sub-queries.

R4.3 — Response shape unchanged.

---

## Reports Endpoint

R5 — `GET /api/staff/reports` computes revenue and breakdown data via server-side aggregation.

R5.1 — Branch revenue (verified payment totals per branch) is computed by the database in a single aggregation query, not by loading payments per-registration in a loop.

R5.2 — Branch status breakdown and daily registration timeline are computed via database grouping.

R5.3 — Response shape unchanged.

---

## Frontend Load Behavior

R6 — The staff dashboard page makes exactly 2 parallel API calls on initial load. No cascading URL mutations.

R6.1 — The Attendees nav link includes the default filter: it goes to `/staff/dashboard?type=attendee&status=pending_verification`. The Donor Only stat card on the dashboard links to `/staff/dashboard?type=donor` (no default status filter).

R6.2 — The dashboard page reads URL parameters and fetches. It does not mutate URL parameters based on API responses. No auto-filter logic.

R6.3 — If someone navigates to `/staff/dashboard` with no parameters, they see all registrations with no filter applied. This is correct — the smart default lives in the navigation link, not the page.

R6.4 — Filter changes (status, branch, search) trigger one API call (list only). Stats are not re-fetched on filter changes — they depend only on `type`.

R6.5 — Pagination triggers one API call (list only).

R6.6 — Type switch (attendee ↔ donor via the Donor Only stat card) triggers two API calls (stats + list).

R6.7 — The frontend pagination component reads `totalItems` and `totalPages` from the new paged response shape.

---

## States

| State | What the user sees |
|-------|-------------------|
| Nav click to Attendees | Stats load + list pre-filtered to pending_verification. Both appear within one round-trip. |
| No pending_verification items | Empty list with "No registrations match your filters." Stats show 0 for Needs Verification. |
| Filter change | List updates, stats unchanged. |
| Type switch (Donor Only stat card) | Both stats and list refresh. |
| Page 2 | List updates, stats unchanged. |

---

## Edge Cases

R7.1 — Search with special characters (%, _, single quotes): handled safely by parameterized queries. No SQL injection.

R7.2 — Search for a reg code with or without hyphens: `SM26ABCD` and `SM26-ABCD` both match the same registration.

R7.3 — Page number beyond total pages: returns empty `data` array with correct `totalItems` and `totalPages`.

R7.4 — Concurrent verification (staff verifies a payment while another staff views the list): next list fetch reflects the updated status. No stale cache.

---

## Dependencies

- Amends: `staff-api.spec.md` R5, R6, R6.8
- Amends: `staff-dashboard.spec.md` R3.1 (auto-filter behavior)
- References: `staff-console.spec.md` (nav link targets)
- References: `pricing-engine.spec.md` (currency unit for moneyCollected)
