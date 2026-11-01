# Specification: Authentication & Roles

## Purpose

Defines how the portal identifies users, enforces role-based access, and protects API endpoints. Covers three roles (attendee, staff, admin), magic-link-only authentication, and identity resolution.

## Contents

- [Scope](#scope)
- [Roles](#roles)
- [Users Table](#users-table)
- [Auth Model](#auth-model)
- [JWT Token](#jwt-token)
- [Magic Link Flow](#magic-link-flow)
- [Identity Resolution](#identity-resolution)
- [Protected Endpoints](#protected-endpoints)
- [Middleware](#middleware)
- [Scoped Permissions](#scoped-permissions)
- [Token Lifecycle](#token-lifecycle)
- [States](#states)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Role definitions and permission matrix. JWT token issuance and verification. Magic link authentication for all roles. Identity resolution (users vs registrations). Middleware chain for role-based route protection. Users table schema. Audit of all login events.

**Does not cover:** Staff dashboard UI (see `staff-operations.spec.md`). User management CRUD (see `user-management.spec.md`). Payment verification workflow (see `payment-flow.spec.md`). OAuth, social login, passwords (explicitly rejected — all auth is magic-link).

---

## Roles

R1 — The portal has three roles: `attendee`, `staff`, and `admin`.

R1.1 — **Attendee** — Alumni who register for the event. Identity lives in the `registrations` table. Gets a JWT on registration. Magic link for return visits.

R1.2 — **Staff** — Committee members who verify payments, view registrations, access the dashboard. Identity lives in the `users` table. Created by an admin.

R1.3 — **Admin** — Full system access including staff account management. Identity lives in the `users` table. Seeded via bootstrap migration.

R1.4 — Staff is a strict superset of attendee capabilities. A staff/admin member who is also a registered alumnus uses ONE login (staff JWT) and accesses their own registration from the staff side.

### Permission Matrix

R2 — The permission matrix:

| Action | attendee | staff | admin |
|--------|:--------:|:-----:|:-----:|
| View own registration | yes | yes* | yes* |
| Upload payment proof (own) | yes | yes* | yes* |
| Upload proof on behalf of any registration | — | yes | yes |
| List all registrations | — | yes | yes |
| Inspect any registration | — | yes | yes |
| View uploaded files (ID docs, payment proofs) | — | yes | yes |
| Verify payment (with referenceId) | — | yes | yes |
| Reject payment (with comment) | — | yes | yes |
| Create balance payment (shortfall) | — | yes | yes |
| Create/manage staff accounts | — | — | yes |
| View dashboard/stats | — | yes | yes |
| Export registration data | — | yes | yes |
| Manage roommate preferences | — | scoped | yes |

*\* Staff/admin who are also registered alumni — accessed via `GET /api/staff/my-registration` (email match between `users` and `registrations` tables).*

*"scoped" = requires the `allocation` scope. Staff with null permissions (full access) also have this capability.*

---

## Users Table

R3 — Staff and admin identities are stored in a `users` table, separate from `registrations`.

```sql
CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    UNIQUE NOT NULL,
  name        TEXT    NOT NULL,
  role        TEXT    NOT NULL,  -- 'staff' | 'admin'
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER REFERENCES users(id),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  permissions TEXT DEFAULT NULL  -- JSON: {"scopes": [...]} or NULL (full access)
);
```

R3.1 — No `password_hash` column. All authentication is via magic links.

R3.2 — Attendees do NOT go in this table. They remain in `registrations`. The two tables are linked implicitly by email address when needed.

R3.3 — Bootstrap migration seeds `admin@example.com` as the first admin with `created_by = NULL`.

R3.4 — `is_active` controls login access. Deactivated users (`is_active = 0`) cannot request magic links or verify existing ones.

R3.5 — `permissions` is an optional JSON column storing granular access scopes. When `NULL` (the default), the user has full access to all staff features — backward compatible with all existing accounts. When set, it restricts the user to only the specified scopes.

Shape: `{"scopes": ["allocation", "dashboard", ...]}` or `NULL`.

---

## Auth Model

R4 — The portal uses stateless JWT tokens as the sole authentication mechanism.

R4.1 — There are no passwords or sessions. A JWT is issued when a magic link is verified (staff/admin) or when a registration is created (attendee).

R4.2 — The JWT is a Bearer token sent in the `Authorization` header. No cookies are used for authentication.

R4.3 — The client stores the JWT in `localStorage`. The server is stateless — it does not track which tokens have been issued.

---

## JWT Token

R5 — The JWT payload varies by role:

**Attendee token** (issued on registration):
```json
{ "sub": "1001", "role": "attendee", "reg": "SM26-XXXX", "iat": ..., "exp": ... }
```

**Staff/Admin token** (issued on magic link verification):
```json
{ "sub": "1", "role": "staff", "email": "name@example.com", "iat": ..., "exp": ... }
```

R5.1 — The signing algorithm is HS256 (HMAC-SHA256). The secret is a server-side environment variable (`JWT_SECRET`), never exposed to the client.

R5.2 — Token expiry is 90 days from issuance for attendees. 7 days for staff/admin (higher-privilege tokens have shorter lifetimes).

R5.3 — The `sub` claim is a stringified number. For attendees, it's the internal registration ID (starts at 1001). For staff/admin, it's the `users.id`.

R5.4 — The `role` claim determines which AuthContext shape the middleware produces and which routes are accessible.

### AuthContext

R6 — The middleware produces a typed AuthContext union:

```typescript
type AuthContext =
  | { role: 'attendee'; registrationId: number }
  | { role: 'staff' | 'admin'; userId: number; email: string }
```

R6.1 — Route handlers access the AuthContext via `c.var.auth`. The type narrows based on which role-guard middleware preceded the handler.

---

## Magic Link Flow

R7 — All roles authenticate via magic links. The flow is the same regardless of role.

### Request Magic Link

R7.1 — `POST /api/auth/magic-link` accepts `{ email: string }`.

R7.2 — The server performs identity resolution (see R8) to determine which table the email belongs to.

R7.3 — If a matching identity is found, the server generates a cryptographically random token, stores its SHA-256 hash in the `magic_links` table with the appropriate foreign key, and sends the token via email as a clickable link.

R7.4 — If no matching identity is found, the server returns `200 OK` with the same response shape. No email is sent. This prevents email enumeration.

R7.5 — Magic link tokens expire after 10 minutes and can only be used once.

### Verify Magic Link

R7.6 — `GET /api/auth/verify?token=xxx` verifies the magic link and issues a JWT.

R7.7 — The server hashes the token, looks up the hash in `magic_links`, checks it hasn't expired or been used, marks it as used, and issues a JWT based on the linked identity.

R7.8 — On success, returns `200` with `{ token: "<JWT>", role: "staff"|"admin"|"attendee", redirectTo: "/staff/dashboard"|"/confirmation/${registrationId}" }`. For attendees, `registrationId` is the numeric internal registration ID (e.g. `/confirmation/1001`).

R7.9 — On failure (expired, used, invalid), returns `401` with `{ error: "Invalid or expired link" }`.

### Magic Links Table

R7.10 — The `magic_links` table supports both attendee and staff/admin identities:

```sql
ALTER TABLE magic_links
  ADD COLUMN user_id INTEGER REFERENCES users(id);

-- registration_id becomes nullable
-- Constraint: exactly one of registration_id or user_id must be non-null
```

---

## Identity Resolution

R8 — When a magic link is requested, the server resolves the email to an identity.

R8.1 — Check `users` table first (WHERE email = ? AND is_active = 1). If found → staff/admin identity.

R8.2 — If not in `users`, check `registrations` table (WHERE email = ?). If found → attendee identity.

R8.3 — If in both tables, `users` wins. Staff role is a superset — the staff JWT gives access to everything an attendee JWT would, plus staff capabilities.

R8.4 — If in neither table → no email sent, but same 200 response (R7.4).

---

## Protected Endpoints

R9 — Endpoints require specific role levels.

R9.1 — **Public** (no auth): `POST /api/registrations`, `POST /api/registrations/lookup`, `GET /api/health`, `GET /api/config/pricing`, `POST /api/auth/magic-link`, `GET /api/auth/verify`.

R9.2 — **Attendee+** (any valid JWT): `GET /api/registrations/me`, `GET /api/registrations/:regCode`, `POST /api/registrations/:regCode/pay/upload-proof`.

R9.3 — **Staff+** (staff or admin): All `/api/staff/*` routes (see `staff-operations.spec.md`).

R9.4 — **Admin only**: All `/api/admin/*` routes (see `user-management.spec.md`).

R9.5 — If the auth middleware finds a valid token but the role doesn't match the required level, the response is `403` with `{ "error": "Insufficient permissions" }`.

---

## Middleware

R10 — The middleware chain:

R10.1 — `authMiddleware` — Verifies the JWT, extracts claims, sets `c.var.auth` with the appropriate AuthContext shape. Returns 401 on invalid/missing token.

R10.2 — `requireRole(...roles)` — Checks `c.var.auth.role` against the allowed roles. Returns 403 if the role is not in the list.

R10.3 — Route mounting:
- `/api/staff/*` → `authMiddleware` + `requireRole("staff", "admin")`
- `/api/admin/*` → `authMiddleware` + `requireRole("admin")`
- Existing attendee routes → `authMiddleware` (role checked implicitly by handler logic)

---

## Scoped Permissions

R13 — Staff access can be scoped to specific features via the `permissions` column on the `users` table. This enables branch representatives and other limited-access users without granting full staff capabilities.

R13.1 — When `permissions` is `NULL`, the user has full access to all features their role permits. This is the default for all existing and newly created staff accounts unless explicitly scoped.

R13.2 — When `permissions` contains a `scopes` array, the user can only access features whose scope matches an entry in the array.

### Scope Mapping

R14 — Each staff route group is assigned a scope:

| Route group | Scope | What it grants |
|-------------|-------|----------------|
| `/staff/dashboard`, `/staff/registrations/*`, `/staff/payments/*`, `/staff/files/*`, `/staff/export/*`, `/staff/refunds/*` | `dashboard` | List/inspect registrations, view files, verify/reject payments, create balance payments, manage refunds, export CSV |
| `/staff/resources` | `resources` | View/edit room inventory, view accommodation stats |
| `/staff/reports` | `reports` | View analytics and statistics |
| `/staff/allocation` | `allocation` | View shared-accommodation registrations, manage roommate preferences |
| `/staff/check-in` and `/api/staff/desk/*` | `registration_desk` | Privacy-minimized attendee lookup, spot registration, profile photo, and check-in |

R14.1 — `/staff/team` remains admin-only (role check). It is not a scope — admin role is required regardless of permissions.

R14.2 — Scopes are additive. A user with `{"scopes": ["allocation", "reports"]}` can access both the allocation page and reports, but not the dashboard or resources.

### requireScope Middleware

R15 — `requireScope(scope)` middleware enforces scope-based access on staff routes. It runs after `authMiddleware` and `requireRole`.

R15.1 — Resolution logic (in order):
1. If `role === 'admin'` → pass. Admin always bypasses scope checks.
2. Look up the user's current `permissions` from the `users` table (see R16 for caching).
3. If `permissions` is `NULL` → pass. Null means full access.
4. If `scope` is in `permissions.scopes` → pass.
5. Otherwise → `403` with `{ "error": "Insufficient permissions" }`.

R15.2 — Scope is resolved from the **database**, not from the JWT. This ensures permission changes take effect without requiring re-authentication.

R15.3 — Route mounting with scopes:
- `/api/staff/allocation/*` → `authMiddleware` + `requireRole("staff", "admin")` + `requireScope("allocation")`
- `/api/staff/registrations/*` → `authMiddleware` + `requireRole("staff", "admin")` + `requireScope("dashboard")`
- `/api/staff/payments/*` → `authMiddleware` + `requireRole("staff", "admin")` + `requireScope("dashboard")`
- `/api/staff/files/*` → `authMiddleware` + `requireRole("staff", "admin")` + `requireScope("dashboard")`
- `/api/staff/export/*` → `authMiddleware` + `requireRole("staff", "admin")` + `requireScope("dashboard")`
- `/api/staff/refunds/*` → `authMiddleware` + `requireRole("staff", "admin")` + `requireScope("dashboard")`
- `/api/staff/resources/*` → `authMiddleware` + `requireRole("staff", "admin")` + `requireScope("resources")`
- `/api/staff/reports/*` → `authMiddleware` + `requireRole("staff", "admin")` + `requireScope("reports")`
- `/api/staff/desk/*` → `authMiddleware` + `requireRole("staff", "admin")` + `requireScope("registration_desk")`
- `/api/staff/my-registration` → `authMiddleware` + `requireRole("staff", "admin")` (no scope — available to all staff)

### Permission Cache

R16 — The `requireScope` middleware caches permission lookups in-process to avoid a database query on every staff request.

R16.1 — Cache key: `userId`. Cache value: the parsed `scopes` array (or `null` for full access). TTL: 5 minutes.

R16.2 — Cache is a simple in-memory `Map` within the worker process. If the worker isolate recycles, the cache starts cold — falls through to the database, which is sub-millisecond for a primary key lookup.

R16.3 — Permission changes made by an admin propagate to all staff requests within 5 minutes (worst case). This is acceptable — scope changes are a setup-time operation, not a runtime concern.

### Staff Navigation Visibility

R17 — The staff navbar shows only links the user has scope for.

R17.1 — When `permissions` is `NULL` (full access), all nav links are shown (current behavior).

R17.2 — When `permissions.scopes` is set, only links whose scope is in the array are shown. Example: a user with `{"scopes": ["allocation"]}` sees only "Allocation" in the nav.

R17.3 — The nav visibility check uses the same permission data as the API middleware — fetched once on page load, not per-navigation.

R17.4 — Admin users always see all links plus "Team" (unchanged).

---

## Token Lifecycle

```
Staff/Admin:
  Enter email on login page
    ↓
  POST /api/auth/magic-link → email sent
    ↓
  Click link → GET /api/auth/verify → JWT issued
    ↓
  Client stores JWT, redirects to dashboard
    ↓
  Token expires after 7 days → re-request magic link

Attendee:
  Submit registration → JWT issued in response
    ↓
  Client stores JWT, navigates to payment
    ↓
  Token expires after 90 days → magic link to get new token
```

R11 — Token revocation does not exist. A compromised token remains valid until expiry. For staff/admin, the 7-day window limits exposure. Deactivating a user (R3.4) prevents new tokens but does not invalidate existing ones.

---

## Login Audit

R12 — All login events are audited.

R12.1 — `login_requested` — when magic link is requested. Records: target email, role resolved (or "unknown"). `registration_id` = null for non-registration contexts.

R12.2 — `login_succeeded` — when magic link is verified and JWT issued. Records: email, role, IP address.

R12.3 — `login_failed` — when magic link verification fails. Records: token hash prefix, failure reason (expired, used, invalid).

R12.4 — `login_link_generated` — when an admin generates a copyable login link
for an active staff user. Records: admin email, target user ID, target email,
target role, and expiry duration. The raw token is not recorded.

R12.5 — The `audit_log.registration_id` column must be nullable to support login and staff-management actions that have no registration context.

---

## States

From the client's perspective:

| State | What the client has | What the client can do |
|-------|-----|------|
| Unauthenticated | No token | Submit registration (public), request magic link |
| Authenticated (attendee) | Valid attendee JWT | View own registration, upload proof |
| Authenticated (staff) | Valid staff JWT | Dashboard, verify payments, view all registrations, own registration |
| Authenticated (admin) | Valid admin JWT | Everything staff can do + manage users |
| Token expired | Expired JWT | Request new magic link |

---

## Edge Cases

- A staff member who is also a registered alumnus always gets a staff JWT (identity resolution checks `users` first). They access their own registration via `/api/staff/my-registration`.
- If an admin deactivates a staff member who has a valid JWT, the JWT remains valid until expiry. The deactivation only prevents new magic link requests and verifications.
- If `admin@example.com` registers as an attendee, they get a registration row AND a users row. Magic link resolves to admin (users checked first).
- Multiple registrations with the same email: magic link for an attendee-only email resolves to the most recent registration.
- Magic link requested for an email not in any table: 200 OK returned, no email sent (prevents enumeration).

---

## Dependencies

- Consumed by: `submission-api.spec.md`, `staff-operations.spec.md`, `user-management.spec.md`
- Token issued by: `POST /api/registrations` (attendee), `GET /api/auth/verify` (staff/admin)
- Magic link email: uses Mailgun integration (`email.service.ts`)
- Audit: shares `audit_log` table (nullable `registration_id`)
