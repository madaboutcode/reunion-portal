# Specification: Team Management UI

## Purpose

The admin-only page for creating, viewing, and deactivating staff accounts. Accessible via the "Team" link in the staff navbar (visible only to admin role). See `staff-console.spec.md` for shell and navigation.

## Contents

- [Scope](#scope)
- [Layout](#layout)
- [User Cards](#user-cards)
- [Add Staff Form](#add-staff-form)
- [Actions](#actions)
- [States](#states)
- [Dependencies](#dependencies)

## Scope

**Covers:** Team management page layout, user card display, add staff form, deactivate/reactivate, resend invite, and admin-generated staff login links.

**Does not cover:** API contract (see `staff-api.spec.md` R15–R17, R43). Business rules for user management (see `user-management.spec.md`). Auth (see `authentication.spec.md`).

**Wireframe:** `tmp/staff-console-wireframes.html` (Team)

---

## Layout

R1 — The Team link is in the staff navbar (staff mode), visible only to admin role. See `staff-console.spec.md` R5.

R1.1 — Header: "Team Management" title (left) + [+ Add Staff Member] button (right, terracotta).

R1.2 — Below header: card list of all staff and admin accounts.

---

## User Cards

R2 — Each user is displayed as a card (not a table row — more personal for a small team).

R2.1 — Card contents:
- **Avatar circle** with initials, colored by role (terracotta for admin, cyan for staff)
- **Name** (large text)
- **Email**
- **Role badge**: "Admin" (terracotta) or "Staff" (cyan)
- **Status**: "Active" (green dot) or "Deactivated" (gray dot, name/email struck through, card dimmed)
- **Attribution**: "Added by {name} on {date}" in small gray text. Bootstrap admin shows "System bootstrap".

R2.2 — Cards are ordered: admins first, then staff alphabetically.

---

## Add Staff Form

R3 — Clicking [+ Add Staff Member] reveals an inline form at the top of the card list (no modal).

R3.1 — Fields:
- Name input (required)
- Email input (required)
- Role: read-only "Staff" (admins cannot create other admins via UI)

R3.2 — Hint text below form: "A magic link will be sent to their email so they can log in."

R3.3 — Buttons: [Send Invite] (terracotta) + [Cancel] (text link).

R3.4 — On success → form closes, new card appears in list, success toast: "Invite sent to {email}."

R3.5 — On duplicate email → error inline: "A user with this email already exists."

R3.6 — Form auto-focuses the name input when opened.

---

## Actions

R4 — Per-card actions.

R4.1 — **Deactivate**: button on active staff cards. Not shown on the admin's own card — shows "Cannot deactivate yourself" in italic gray instead.

R4.2 — **Reactivate**: button on deactivated cards. Replaces the Deactivate button.

R4.3 — **Resend magic link**: small secondary link on active cards. For when someone can't find their login email. Shows brief "Sent!" confirmation inline.

R4.4 — **Generate login link**: active staff cards show a separate secondary
action. It calls the admin-only generate endpoint and displays the returned URL
in the card with a [Copy link] button. The URL is held in page memory only and
shows its 10-minute expiry.

R4.5 — The generated-link panel warns: "Anyone with this link can sign in as
this staff user." Admin cards do not show this action.

R4.6 — Deactivate shows a confirmation: "Deactivate {name}? They won't be able to log in." [Confirm] / [Cancel].

---

## States

| State | What admin sees |
|-------|-----------------|
| Fresh page load | All user cards, sorted admins-first |
| After adding staff | New card at top of staff section, form closes |
| After deactivating | Card dims, status changes to "Deactivated", Reactivate button appears |
| After reactivating | Card restores to normal, Active status, Deactivate button appears |
| After resending invite | Brief "Sent!" text next to the resend link |
| After generating a link | URL shown inline with [Copy link] action and expiry text |

---

## Dependencies

- API: `staff-api.spec.md` R15–R17, R43 (CRUD, resend invite, and generated login link)
- Business rules: `user-management.spec.md` (who can create whom, deactivation rules)
- Auth: `authentication.spec.md` (admin role check, magic link email)
- Wireframe: `tmp/staff-dashboard-wireframe.html` (Team tab)
