# Specification: Staff Console Shell

## Purpose

The shared layout, navigation, and page chrome for all staff-facing pages (`/staff/*`). Defines what staff see around the page content — not the content of individual pages.

## Contents

- [Scope](#scope)
- [Shell Layout](#shell-layout)
- [Navigation](#navigation)
- [Page Chrome](#page-chrome)
- [Footer](#footer)
- [Dependencies](#dependencies)

## Scope

**Covers:** Content width, two-mode navbar, staff section links, page title row, minimal footer, mobile nav behavior.

**Does not cover:** Registration list/detail (see `staff-dashboard.spec.md`). Resources aggregates (see `staff-resources.spec.md`). Reports analytics (see `staff-reports.spec.md`). Team management (see `team-management.spec.md`). API contract (see `staff-api.spec.md`).

**Wireframe:** `tmp/staff-console-wireframes.html`

---

## Shell Layout

R1 — Staff pages use a capped content width, not full-bleed edge-to-edge layout.

R1.1 — Max content width is **1320px**. Navbar, main content, and footer align to the same width.

R1.2 — `StaffLayout` owns horizontal padding and width. Child pages must not add nested `max-w-*` wrappers (notably registration detail).

R1.3 — Panel chrome is unified across staff pages: consistent border, radius, shadow, padding, and section header typography. Each page uses the widget appropriate to its data (table, cards, chart, etc.) — see per-page specs.

---

## Navigation

R2 — A single navbar component (`SiteNav`) operates in two modes based on route.

R2.1 — **Public mode** — all routes except `/staff/*`.

R2.2 — **Staff mode** — when `pathname.startsWith('/staff')`.

R3 — Logo treatment matches the public portal nav in both modes (circular logo sticker). Logo links to `/` in both modes.

### Public mode

R4 — Public mode shows standard site links: Home, Connect, Login (when unauthenticated), Register CTA.

R4.1 — When the user is staff or admin, a single **Dashboard** link appears → `/staff/dashboard?type=attendee` (default attendees view).

R4.2 — Staff section links (Attendees, Resources, etc.) do **not** appear on public pages. Staff mode activates only after entering `/staff/*`.

R4.3 — Public nav scroll-hide behavior is unchanged.

### Staff mode

R5 — Staff mode nav links (center of bar):

| Link | Route | Visible to |
|------|-------|------------|
| Attendees | `/staff/dashboard?type=attendee` | staff, admin |
| Resources | `/staff/resources` | staff, admin |
| Reports | `/staff/reports` | staff, admin |
| Team | `/staff/team` | admin only |
| Registration Desk | `/staff/check-in` | staff with `registration_desk`, admin |

R5.1 — No separate tab row below the navbar. Section navigation lives in the bar itself.

R5.2 — Public links (Home, Connect, Register) and the Register CTA are hidden in staff mode.

R5.3 — Right side of bar: email, role badge, Logout.

R5.4 — Scroll-hide is **disabled** in staff mode — the bar stays visible while scrolling long tables.

R5.5 — No "Dashboard" pill or duplicate link next to the logo — the Attendees nav link replaces it.

R5.6 — The Donors view (`/staff/dashboard?type=donor`) is reached from the **Donor Only** stat card on the Attendees dashboard (see `staff-dashboard.spec.md` R3). It is not a separate nav item.

### Active states

R6 — **Attendees** nav item is active when:
- pathname is `/staff/dashboard` (any `type` value, since Donors is a filter on the same page), or
- pathname is `/staff/registrations/:id` (any `type` value, for the same reason).

R7 — *(removed — Donors is no longer a separate nav item; see R5.6.)*

R8 — Resources, Reports, and Team nav items are active when their respective paths match.

### Mobile

R9 — On mobile, staff mode uses a single hamburger menu that lists all visible section links plus Logout.

R9.1 — The page title row shows the current section name (e.g. "Attendees", "Resources").

---

## Page Chrome

R10 — Every staff page shows a **page title** (`h1`) directly below the navbar.

R10.1 — No subtitle under page titles.

R10.2 — Registration detail is the exception: back link + reg code + full name + status badge + participation pill replace the standard page title row.

R11 — Pages with filters show a **toolbar row** directly under the page title.

R11.1 — Toolbar layout: primary controls left, secondary actions (e.g. Export CSV) right. Wraps on narrow viewports.

R11.2 — Reports has no filters — page title only, no toolbar row.

---

## Footer

R12 — Staff routes use a **minimal footer**: copyright line and git hash only.

R12.1 — The public marketing footer (tagline, Comskys terminal) does not render on `/staff/*`.

---

## Dependencies

- `staff-dashboard.spec.md` — Attendees list page (with Donors as a filter view) and registration detail
- `staff-resources.spec.md` — Resources page content
- `staff-reports.spec.md` — Reports page content
- `team-management.spec.md` — Team page content
- `authentication.spec.md` — JWT, role checks, login redirect
- Wireframe: `tmp/staff-console-wireframes.html`
