# Specification: User Management

## Purpose

Defines how admins create, list, and deactivate staff accounts.

## Contents

- [Scope](#scope)
- [Create Staff Account](#create-staff-account)
- [List Staff Accounts](#list-staff-accounts)
- [Update / Deactivate](#update--deactivate)
- [Bootstrap](#bootstrap)
- [Audit Trail](#audit-trail)
- [API Endpoints](#api-endpoints)
- [Dependencies](#dependencies)

## Scope

**Covers:** Admin CRUD operations on staff accounts. Bootstrap seeding of the first admin. Audit of all user management actions.

**Does not cover:** Staff login flow (see `authentication.spec.md`). What staff can do once logged in (see `staff-operations.spec.md`).

---

## Create Staff Account

R1 — `POST /api/admin/users` creates a new staff account. Admin only.

R1.1 — Request body:
```json
{
  "email": "committee-member@example.com",
  "name": "Ravi Kumar",
  "role": "staff",
  "permissions": { "scopes": ["allocation"] }
}
```

R1.1.1 — `permissions` is optional. When omitted or `null`, the user has full access to all staff features. When provided, it must be an object with a `scopes` array containing valid scope strings. Valid scopes: `"dashboard"`, `"resources"`, `"reports"`, `"allocation"`, `"admin-tools"`, `"bank_txns"`, `"registration_desk"`. Invalid scope strings are rejected with `422`.

R1.2 — `role` must be `"staff"`. Only the bootstrap migration can create admins. An admin cannot promote another user to admin via the API.

R1.3 — If the email already exists in `users`, returns `409` with `{ "error": "User with this email already exists" }`.

R1.4 — On success, returns `201` with the created user (without sensitive fields):
```json
{
  "id": 2,
  "email": "committee-member@example.com",
  "name": "Ravi Kumar",
  "role": "staff",
  "isActive": true,
  "permissions": { "scopes": ["allocation"] },
  "createdAt": 1716019200000
}
```

R1.4.1 — `permissions` in the response is `null` when no scopes are set (full access), or the permissions object when scopes are configured.

R1.5 — A magic link email is sent to the new staff member so they can log in immediately.

R1.6 — Audit entry: `staff_created`, actor = admin email, records new user email and role.

---

## List Staff Accounts

R2 — `GET /api/admin/users` returns all staff and admin accounts. Admin only.

R2.1 — Response:
```json
{
  "users": [
    {
      "id": 1,
      "email": "admin@example.com",
      "name": "Admin",
      "role": "admin",
      "isActive": true,
      "permissions": null,
      "createdBy": null,
      "createdAt": 1716019200000
    }
  ]
}
```

R2.2 — Includes both active and deactivated accounts. `isActive` field indicates status.

---

## Update / Deactivate

R3 — `PATCH /api/admin/users/:id` updates a staff account. Admin only.

R3.1 — Updatable fields: `name`, `is_active`, `permissions`.

R3.1.1 — `permissions` can be updated to change a user's access scopes. Setting `permissions: null` restores full access. Setting `permissions: {"scopes": ["allocation"]}` restricts access. Same validation as R1.1.1. Audit entry records the old and new permissions values.

R3.2 — To deactivate: `{ "isActive": false }`. Deactivated users cannot request or verify magic links. Existing JWTs remain valid until expiry.

R3.3 — To reactivate: `{ "isActive": true }`.

R3.4 — An admin cannot deactivate themselves.

R3.5 — Role cannot be changed via PATCH. No promotion/demotion through the API.

R3.6 — Audit entry: `staff_updated`, actor = admin email, records user id and changes (including permissions modifications).

---

## Scope Checkboxes

R3.7 — The Team management page shows scope checkboxes when creating or editing staff users.

R3.7.1 — Available scopes displayed as checkboxes:
- Dashboard (registrations, payments, files, export)
- Resources (room inventory, accommodation stats)
- Reports (analytics, statistics)
- Allocation (roommate preferences)
- Registration Desk (privacy-minimized attendee lookup, spot registration, and check-in)
- Admin Tools (system maintenance)
- Bank Transactions (statement import and matching)

R3.7.2 — When no checkboxes are checked, `permissions` is set to `null` (full access). This is the default for new staff accounts.

R3.7.3 — When one or more checkboxes are checked, `permissions` is set to `{"scopes": [<checked values>]}`.

R3.7.4 — Scope checkboxes are only shown for staff users (`role: "staff"`). Admin users always have full access — no checkboxes are shown, and a note explains: "Admins have full access to all features."

R3.7.5 — The "full access" default is visually distinct from "no scopes selected." When no scopes are checked, a label reads: "Full access — can use all staff features." This prevents confusion between "forgot to set scopes" and "intentionally full access."

---

## Bootstrap

R4 — The first admin is created via a database migration, not through the API.

R4.1 — Migration seeds:
```sql
INSERT INTO users (email, name, role, created_by)
VALUES ('admin@example.com', 'Admin', 'admin', NULL);
```

R4.2 — `created_by = NULL` indicates a bootstrap record.

R4.3 — The admin logs in via the standard magic link flow — enters email on login page, receives link, clicks to authenticate.

---

## Audit Trail

R5 — All user management actions are audited.

| Action | Actor | What's recorded |
|--------|-------|-----------------|
| `staff_created` | admin email | new user email, name, role, permissions |
| `staff_updated` | admin email | user id, fields changed (name, isActive, permissions) |
| `login_link_generated` | admin email | target staff user id, email, role, expiry duration |

R5.1 — These audit entries have `registration_id = NULL` (no registration context).

---

## API Endpoints

All endpoints require `admin` role (see `authentication.spec.md` R9.4).

```
POST   /api/admin/users       — create staff account
GET    /api/admin/users        — list all accounts
PATCH  /api/admin/users/:id    — update/deactivate account
POST   /api/admin/users/:id/generate-login-link — generate staff login link
```

---

## Dependencies

- Auth: `authentication.spec.md` (admin role check, magic link for new staff)
- Email: magic link email sent on account creation
- Audit: shares `audit_log` table (nullable `registration_id`)
