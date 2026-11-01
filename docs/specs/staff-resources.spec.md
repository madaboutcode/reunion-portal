# Specification: Staff Resources Page

## Purpose

Event planning aggregates for the reunion committee: headcount, catering, accommodation, and t-shirt sizes — filtered by registration status and branch.

## Contents

- [Scope](#scope)
- [Layout](#layout)
- [Toolbar](#toolbar)
- [Headcount](#headcount)
- [Catering](#catering)
- [Accommodation](#accommodation)
- [T-Shirt Matrix](#t-shirt-matrix)
- [States](#states)
- [Dependencies](#dependencies)

## Scope

**Covers:** Resources page layout and all aggregate panels.

**Does not cover:** Shell/nav (see `staff-console.spec.md`). API contract (see `staff-api.spec.md`).

**Wireframe:** `tmp/staff-console-wireframes.html` (Resources tab)

---

## Layout

R1 — Page title: **Resources**.

R1.1 — Section order (top to bottom): Toolbar → Headcount bar → Catering + Accommodation (two columns) → T-shirt matrix (full width).

R1.2 — No in-page type toggle. Resources always reflects attendee registrations (API scope).

---

## Toolbar

R2 — Toolbar row under page title.

R2.1 — **Include** multi-select toggles: Confirmed, Needs Verification, Pending. Default: all three selected.

R2.2 — Deselecting all statuses is treated as all selected.

R2.3 — **Branch** dropdown: All branches + individual branch options.

R2.4 — Filter changes update URL search params and refetch aggregates.

---

## Headcount

R3 — Full-width summary bar at top of content.

R3.1 — Shows counts for: Alumni, Spouses, Children, Guests — only segments with count > 0.

R3.2 — Prominent **Total headcount** number.

---

## Catering

R4 — Left column panel (paired with Accommodation).

R4.1 — Vegetarian and Non-vegetarian counts with proportional progress bars.

R4.2 — **Total covers** footer row (veg + non-veg).

---

## Accommodation

R5 — Right column panel (paired with Catering).

R5.1 — Count per booked accommodation type (private, shared double, shared triple, etc.).

R5.2 — "Not needed" count shown separately.

R5.3 — Hide accommodation types with zero count (except "none").

R5.4 — **Rooms needed** footer: sum of all types except "none".

R5.5 — When room inventory is configured (see `room-availability.spec.md`), the panel shows occupancy vs capacity per check-in date: "X / Y rooms used — Aug 14" and "X / Y rooms used — Aug 15". Displayed alongside the existing per-type breakdown.

R5.6 — **Edit Room Availability** button below the accommodation panel. Navigates to the room inventory edit page (see `room-availability.spec.md` R8).

---

## T-Shirt Matrix

R6 — Full-width table below the two-column row.

R6.1 — Rows: Men, Women, Other (mapped from male, female, unspecified).

R6.2 — Columns: S, M, L, XL, XXL, XXXL — hide columns where all counts are zero.

R6.3 — Row totals, column totals, and grand total (terracotta emphasis on grand total).

R6.4 — Empty state: "No t-shirt sizes recorded yet."

---

## States

| State | What staff sees |
|-------|-----------------|
| Loading | Skeleton placeholders matching section layout |
| Loaded | All panels populated from API |
| Error | "Failed to load resource data." |

---

## Dependencies

- Shell: `staff-console.spec.md`
- API: `staff-api.spec.md` — `GET /api/staff/resources`
- Room inventory: `room-availability.spec.md` — occupancy display and edit page
- Wireframe: `tmp/staff-console-wireframes.html`