# Specification: Access Control (RBAC)

## Purpose

The single source of truth for who can do what across the Smriti portal — roles, scopes, server-side enforcement, client-side gating, and the full endpoint/page matrix. The auth model itself (JWT issuance, magic links, identity resolution) is defined in `authentication.spec.md`; this spec covers the authorization layer on top of it.

## Contents

- [Scope](#scope)
- [Roles](#roles)
- [Scopes](#scopes)
- [Permissions Model](#permissions-model)
- [Enforcement Layers](#enforcement-layers)
- [API Gate Matrix](#api-gate-matrix)
- [UI Gate Matrix](#ui-gate-matrix)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Implementation Guidelines](#implementation-guidelines)
- [Open Scoping Questions](#open-scoping-questions)
- [Dependencies](#dependencies)

## Scope

**Covers:** Role and scope definitions, the canonical permission matrix, server middleware (`requireRole`, `requireScope`), client gating (`ProtectedRoute`, nav visibility, per-page guards), every API endpoint and UI route's required role+scope.

**Does not cover:** Auth model internals — JWT structure, magic-link flow, identity resolution, token lifecycle (see `authentication.spec.md` R4–R12). User management CRUD (see `user-management.spec.md`). Feature-level business rules (see per-feature specs).

**Compliance work** — gaps between this spec and the current code, and the fixes for them — lives in `./tasks/2026-07-23-rbac-*`. This spec is the destination; the tasks are the journey.

## Roles

R1 — The portal has three roles (from `authentication.spec.md` R1):

| Role | Identity table | JWT lifetime | Created by |
|------|---------------|--------------|------------|
| `attendee` | `registrations` | 90 days | Registration submission |
| `staff` | `users` (role='staff') | 7 days | Admin via `POST /api/admin/users` |
| `admin` | `users` (role='admin') | 7 days | Bootstrap migration only |

R1.1 — **Strict superset for capability purposes**: `admin` ⊇ `staff` ⊇ `attendee`. A staff JWT can do everything an attendee JWT can, plus staff operations. An admin JWT can do everything a staff JWT can, plus admin operations.

R1.2 — **Superset does NOT bypass explicit gates.** A staff member who is also a registered alumnus uses the staff JWT (identity resolution checks `users` first per `authentication.spec.md` R8.3) and accesses their own registration via `GET /api/staff/my-registration` (no scope required — any staff can see their own). They do NOT call attendee endpoints with the staff JWT.

R1.3 — **Admin bypasses scope, not role.** A staff role JWT does not pass `requireRole('admin')` even with full-access permissions. Admin-only endpoints check role, not scope.

## Scopes

R2 — Staff users can be restricted to a subset of features via these scopes:

| Scope | Features gated | UI nav | API prefix |
|-------|----------------|--------|------------|
| `dashboard` | Registrations list, detail, payments (verify/reject/balance/refunds/upload-proof), file proxy, export, archive, edit, photo replacement | Attendees · Finances (Refunds) | `/api/staff/registrations/*`, `/api/staff/payments/*`, `/api/staff/files/*`, `/api/staff/export`, `/api/staff/refunds/*`, `/api/staff/registrations/:id/{archive,upload-proof,photo}`, `/api/staff/archived/*` |
| `resources` | Resources aggregates, room inventory | Resources · Rooms (sub-page) | `/api/staff/resources`, `/api/staff/room-inventory` |
| `reports` | Reports analytics, branch breakdown, revenue, budget, timeline | Reports | `/api/staff/reports` |
| `allocation` | Roommate preferences, overnight-accommodation registration list, accommodation conversion (3-share → 2-share), outstanding-balance visibility, payment-link generation | Allocation | `/api/staff/allocation/*` |
| `admin-tools` | System maintenance: thumbnail regeneration, public-CDN sync, status reconciliation | (reached from `/staff/tools`) | `/api/staff/regenerate-thumbnails`, `/api/staff/sync-public-thumbnails`, `/api/staff/reconcile-statuses` |
| `bank_txns` | Bank transaction import, list, comment, link — and the bank-txn matching modal in VerifyRejectBar | Finances (Bank Transactions) | `/api/staff/bank-transactions/*` |
| `registration_desk` | Privacy-minimized attendee lookup, spot registration, payment-state display, and check-in | Registration Desk | `/api/staff/desk/*` |

R2.0 — Scope definitions for `dashboard`, `resources`, `reports`, `allocation` originate in `authentication.spec.md` R14 (the original spec for the scoped-permissions model). `admin-tools` is defined in this spec, `bank_txns` in `bank-txn-matching.spec.md` R1, and `registration_desk` in `registration-desk.spec.md` R1. This spec is the consolidated registry.

R2.1 — A staff user's `permissions` column is either:
- `NULL` — full access to all scopes. Default for all existing and newly created staff accounts unless explicitly scoped.
- `'{}'` (valid JSON without a `scopes` key) — equivalent to `NULL`; `parsed.scopes ?? null` resolves to `null` (unrestricted). This is a documented equivalence, not a bug — it follows the same "absent means unrestricted" semantics as `NULL`.
- `{"scopes": ["..."]}` — additive allow-list. Only the listed scopes are granted. Multiple scopes are listed together: `{"scopes": ["allocation", "admin-tools"]}`.

R2.2 — `admin` role bypasses scope check entirely (`requireScope` short-circuits to `await next()` for `role === 'admin'`). Admin's `permissions` column is informational only — ignored at runtime.

R2.3 — Scopes are additive. A user with `["allocation", "reports"]` can access both the Allocation page AND the Reports page, but NOT the Dashboard, Resources, `admin-tools`, or `bank_txns` endpoints.

R2.4 — Scope is a flat string, not hierarchical. There is no "all" or "admin" scope value. Admin is a role, not a scope. The `admin-tools` scope is named for the kind of work (admin-level maintenance), not because only admins can hold it — any non-admin staff with `["admin-tools"]` in their permissions can also use these endpoints.

R2.5 — `admin-tools` is intentionally a separate scope (not absorbed into admin role) so that a trusted non-admin staff member (e.g., a tech lead or a designated data operator) can run maintenance operations without being granted the full admin role.

R2.6 — **Allocation payload exposure rule** (decision `docs/decisions/20260803-allocation-scope-upgrade-carveout.md`, amending the posture recorded in `20260723-capability-scopes-deferred.md`). Responses under the `allocation` scope expose, at most:
- coordination fields: name, reg code, branch, gender, email, WhatsApp, photo thumbnail, accommodation type, check-in/check-out dates, roommate preferences;
- registration `status` (`pending` / `pending_verification` / `confirmed`);
- the outstanding balance as a single number (`pendingAmount`, `staff-api.spec.md` R27.8);
- generated payment links (`staff-api.spec.md` R42).

They MUST NOT expose: donation fields or amounts, registration totals, price breakdowns or pricing snapshots, payment histories, proof documents, or ID-document references. Any new allocation endpoint or payload field is checked against this list at spec time.
  Scenario: Given the allocation registrations list response, when its fields are enumerated, then no donation, total, breakdown, payment-history, or document field appears.

## Permissions Model

R3 — Resolution order at every gated boundary, applied left-to-right:

1. **Authentication** — `authMiddleware` validates the JWT. Missing or invalid → `401 { "error": "Missing authorization header" }` or `401 { "error": "Invalid or expired token" }`.
2. **Role** — `requireRole(...roles)` checks `c.var.auth.role` against the allowed list. Mismatch → `403 { "error": "Insufficient permissions" }`.
3. **Scope** — `requireScope(scope)` (staff/admin only): admin → pass; user's `permissions` NULL → pass; `scope` in `permissions.scopes` → pass; else → `403 { "error": "Insufficient permissions" }`.

R3.1 — `401` means "we don't know who you are." `403` means "we know who you are, but you can't do this." Clients can distinguish them; both shape `{ "error": string }` (no `details`).

R3.2 — Scope is fetched from the database on every check, cached in-process for 5 minutes (TTL). The JWT does NOT carry scopes. Permission changes made by an admin propagate to all in-flight requests within 5 minutes without requiring re-authentication.

R3.3 — An attendee JWT does NOT have a `permissions` column. `requireScope` rejects any non-staff/non-admin role outright (`auth.role !== 'staff' && auth.role !== 'admin'` → 403). Attendees never reach a scope check.

R3.4 — The set of valid scope strings is closed: `dashboard`, `resources`, `reports`, `allocation`, `admin-tools`, `bank_txns`, `registration_desk`. The Team management UI rejects any other value with `422`. See `user-management.spec.md` R1.1.1 and `staff-api.spec.md` R14.1.1.

R3.5 — On `permissions` JSON parse failure OR when no user row exists for the JWT's `userId`, the scope resolution returns `[]` (empty array — no access), not `null`. A corrupted row or deleted user must deny access, not grant it.

## Enforcement Layers

### Server (Hono middleware)

R4 — Three middleware functions defined in `src/server/src/middleware/auth.middleware.ts`:

| Function | Purpose | On failure |
|----------|---------|-----------|
| `authMiddleware` | Verifies JWT (HS256, `JWT_SECRET`), sets `c.var.auth: AuthContext` | 401 |
| `requireRole(...roles)` | Checks `c.var.auth.role` ∈ `roles` | 403 |
| `requireScope(scope)` | Admin bypass; valid `permissions.scopes` includes the scope → pass; else → 403 | 403 |

R4.1 — Mounting pattern: each router declares its chain at the top of the file. Preferred order is `authMiddleware → requireRole → requireScope`. Examples from current code:

```ts
adminRoutes.use('*', authMiddleware, requireRole('admin'));
staffRoutes.use('*', authMiddleware, requireRole('staff', 'admin'));
allocationRoutes.use('*', authMiddleware, requireRole('staff', 'admin'), requireScope('allocation'));
bankTransactionRoutes.use('*', authMiddleware, requireRole('staff', 'admin'), requireScope('bank_txns'));
```

R4.2 — A router-level `requireScope` covers every route declared on that router. Per-endpoint scope additions are allowed only when a router serves two scopes. Note: Hono's `use('*')` middleware fires on all matching path prefixes including nested routers mounted after the parent — a router-level scope wildcard on `/staff` would leak onto `/staff/allocation` and `/staff/bank-transactions`. For cross-scope prefixes like `/staff`, per-endpoint `requireScope` is the correct pattern (see G4).

R4.3 — Scope cache is a process-local `Map<userId, { scopes, expiresAt }>`. The cache is cleared on cold start of the worker isolate. A permission change made by an admin takes up to 5 minutes (TTL) to propagate to a user's requests. The cache is exported as `_scopeCache` for test isolation.

R4.4 — `requireScope` resolution MUST treat "no user row found" and "malformed `permissions` JSON" as `[]` (no access), per R3.5. A 5-minute cache miss followed by a parse error or missing row returns `[]` and is cached as such.

### Client (React)

R5 — Four gating mechanisms, in order of authority:

| Mechanism | Where | Authority | Failure mode |
|-----------|-------|-----------|--------------|
| `<ProtectedRoute requiredRoles>` | Route layout (React Router) | Role only | Redirects to `/login?returnTo=...` |
| `<ProtectedRoute requiredScopes>` | Route layout | Role + scopes | Redirects to `/staff/dashboard?denied=1` |
| Page-level `useMyPermissions()` guard | Inside a page | Scopes per-page | Renders "Access denied" state |
| `SiteNav` scope filter | Top-level nav | Scopes (advisory) | Hides link; fail-open on fetch error |

R5.1 — `SiteNav` fetches `/api/staff/me/permissions` on mount, stores scopes in state, filters visible nav links by `userScopes`. Until `scopesLoaded` is true, no staff links are shown (prevents flash of unauthorized links). On fetch error, all links are shown (fail-open — nav is informational; the API is authoritative).

R5.2 — `/api/staff/me/permissions` is unauthenticated-by-scope — any staff/admin can read their own permissions. Admin returns `{ permissions: null, role: "admin" }`.

R5.3 — `isStaff()` and `isAdmin()` in `src/web/src/lib/auth.ts` read the role from `localStorage`. These are synchronous and used for non-API UI gating (e.g., showing the public Dashboard link, hiding the Login link).

R5.4 — Page-level scope checks render an "Access denied" state for users missing the required scope. A 403 from the API is defense-in-depth, not the first line of user feedback.

R5.5 — `useMyPermissions()` is a shared hook (`{ scopes: string[] | null; loaded: boolean; role: 'staff' | 'admin' | null }`) used by `SiteNav`, `ProtectedRoute`, and any page-level guard. Cache per session; invalidate on logout. **Implementation note:** the hook is implemented as `useStaffScopes()` in `src/web/src/hooks/useStaffScopes.ts` (same shape, same contract).

## API Gate Matrix

R6 — Every API endpoint in the portal, grouped by required gate. Endpoints are listed in router-file order; `:id` etc. denote path parameters.

### Public (no auth)

| Method | Path | Purpose | Reference |
|--------|------|---------|-----------|
| GET | `/api/health` | Liveness | — |
| GET | `/api/config/pricing` | Pricing config | — |
| GET | `/api/accommodation/availability` | Public room availability | `room-availability.spec.md` R5 |
| POST | `/api/auth/magic-link` | Request magic link | `authentication.spec.md` R7.1 |
| GET | `/api/auth/verify` | Verify magic link, issue JWT | `authentication.spec.md` R7.6 |
| POST | `/api/registrations` | Submit registration | `submission-api.spec.md` R3 |
| GET | `/api/registrations/check-email` | Email existence check | `submission-api.spec.md` R3.16 |
| GET | `/api/public/whos-coming` | Public Who's Coming | `interfaces/` |
| GET | `/api/public/photos/*` | Public photo CDN | `interfaces/` |
| POST | `/api/auth/payment-link` | Generate payment link for reg code | `auth.routes.ts:61` |
| POST | `/api/registrations/lookup` | Resolve reg code to pass data (name, accommodation, participation) | `registration.routes.ts:74` |
| GET | `/api/registrations/:code/pass.pdf` | PDF pass keyed on reg code (60-bit crypto-random, unguessable; see R14 note below) | `pass.routes.ts:43` |
| POST | `/api/uploads/id-document` | Upload ID document (pre-registration, currently unhardened; hardening deferred — see R4 deferral) | `upload.routes.ts` |
| POST | `/api/uploads/photo` | Upload photo (pre-registration, currently unhardened; hardening deferred — see R4 deferral) | `upload.routes.ts` |
| GET | `/api/datasources/:sourceId/:sheetName` | Proxy Google Sheets data (intentionally public per contract, non-sensitive; no rate limit — see R15 note) | `datasources.routes.ts:36` |
| GET | `/api/flags/:code` | Proxy country flag image from flagcdn.com (2-letter code, cacheable; no rate limit — see R15 note) | `flags.routes.ts:6` |

R6.0.1 — **R14 (PII-by-regcode):** `/api/registrations/lookup` and `/api/registrations/:code/pass.pdf` serve attendee PII (name, accommodation) keyed on the `regCode`. This is by design — attendees retrieve their own pass via an unguessable code without login, consistent with the project constraint "no passwords/accounts for alumni — email is auth identity." The `regCode` is generated by `crypto.getRandomValues` with 12 Crockford base32 characters (60 bits of entropy, ~1.15×10¹⁸ possibilities); brute-force is infeasible and all public routes are rate-limited. Revisit if regCode format/entropy ever weakens or if stakeholder wants pass retrieval behind auth.

R6.0.2 — **R15 (unauth proxies):** `/api/datasources/:sourceId/:sheetName` and `/api/flags/:code` are fully public outbound-fetch proxies with no rate limiting (weaker than other public routes). Low risk: datasources self-declares non-sensitive data; flags proxies cacheable 2-letter country codes. Missing rate-limit rides the deferred rate-limit backlog (R6.5 platform limitation).

### Attendee+ (any valid JWT — attendee, staff, or admin)

`requireRole` is not called; `authMiddleware` is the only gate. The handler enforces the registration-owner check by matching the JWT `sub` to the resource ID.

| Method | Path | Purpose | Reference |
|--------|------|---------|-----------|
| GET | `/api/registrations/me` | Get own registration | `submission-api.spec.md` R4 |
| GET | `/api/registrations/:id` | Get registration by ID (sub must match) | `submission-api.spec.md` R5 |
| POST | `/api/registrations/:regCode/pay/upload-proof` | Upload payment proof | `submission-api.spec.md` R6 |

### Staff+ (role: staff or admin, no scope)

These endpoints are available to any staff member regardless of scope assignment. They serve personal or system-level needs.

| Method | Path | Purpose | Reference |
|--------|------|---------|-----------|
| GET | `/api/staff/my-registration` | Staff member's own registration | `staff-api.spec.md` R11 |
| GET | `/api/staff/me/permissions` | Staff member's own scopes | `authentication.spec.md` R13 |

### Staff+ scope: `dashboard`

| Method | Path | Purpose | Reference |
|--------|------|---------|-----------|
| GET | `/api/staff/dashboard` | Aggregate stats | `staff-api.spec.md` R5 |
| GET | `/api/staff/registrations` | Filterable, paginated list | `staff-api.spec.md` R6 |
| GET | `/api/staff/registrations/:id` | Full registration detail | `staff-api.spec.md` R7 |
| POST | `/api/staff/payments/:id/verify` | Verify a payment; supports optional `withShortfallPayment: boolean` body flag to create a balance payment in the same call (the `verify-partial` shape from the spec — see `staff-api.spec.md` R23). | `staff-api.spec.md` R8, R23 |
| POST | `/api/staff/payments/:id/reject` | Reject a payment proof | `staff-api.spec.md` R9 |
| POST | `/api/staff/registrations/:id/upload-proof` | Upload proof on behalf | `staff-api.spec.md` R10 |
| POST | `/api/staff/registrations/:id/balance-payment` | Create shortfall payment | `staff-api.spec.md` R22 |
| POST | `/api/staff/registrations/:id/photo` | Replace photo | `photo-replacement.spec.md` R4 |
| POST | `/api/staff/registrations/:id/send-payment-link` | Send payment link email | `staff-api.spec.md` (internal) |
| POST | `/api/staff/registrations/:id/generate-payment-link` | Generate payment link URL | `staff-api.spec.md` (internal) |
| PUT | `/api/staff/registrations/:id` | Edit registration | `staff-api.spec.md` R18 |
| POST | `/api/staff/registrations/:id/archive` | Archive registration | `staff-api.spec.md` R19 |
| GET | `/api/staff/archived` | List archived registrations | `staff-api.spec.md` R20 |
| GET | `/api/staff/archived/:id` | Archived snapshot detail | `staff-api.spec.md` R20.3 |
| GET | `/api/staff/files/*` | File proxy (private) | `staff-api.spec.md` R12 |
| GET | `/api/staff/export` | CSV export | `staff-api.spec.md` R13 |
| GET | `/api/staff/refunds` | List refund records | `staff-api.spec.md` R24 |
| POST | `/api/staff/refunds/:id/complete` | Mark refund completed | `staff-api.spec.md` R25 |

### Staff+ scope: `bank_txns`

| Method | Path | Purpose | Reference |
|--------|------|---------|-----------|
| GET | `/api/staff/bank-transactions` | List bank transactions | `bank-transaction.routes.ts:86` |
| GET | `/api/staff/bank-transactions/summary` | Bank tx summary | `bank-transaction.routes.ts:115` |
| GET | `/api/staff/bank-transactions/:id` | Bank tx detail | `bank-transaction.routes.ts:131` |
| POST | `/api/staff/bank-transactions/import` | Import SBI statement | `bank-transaction.routes.ts:54` |
| POST | `/api/staff/bank-transactions/:id/comment` | Set comment | `bank-transaction.routes.ts:149` |
| POST | `/api/staff/bank-transactions/:id/link` | Link to payments | `bank-transaction.routes.ts:187` |
| DELETE | `/api/staff/bank-transactions/:id/link/:paymentId` | Unlink payment | `bank-transaction.routes.ts:235` |

### Staff+ scope: `registration_desk`

The registration desk scope is a privacy-minimized boundary. It does not grant access to any `dashboard` endpoint.

| Method | Path | Purpose | Reference |
|--------|------|---------|-----------|
| GET | `/api/staff/desk/search` | Search eligible attendees using narrow fields | `interfaces/registration-desk-api.ispec.md` R2 |
| GET | `/api/staff/desk/lookup` | Resolve a pass code to the desk-safe attendee overview | `interfaces/registration-desk-api.ispec.md` R3 |
| GET | `/api/staff/desk/registrations/:id/photo` | Serve the desk-safe profile thumbnail | `interfaces/registration-desk-api.ispec.md` R3.3 |
| POST | `/api/staff/desk/registrations/:id/present` | Mark an attendee present (409 `payment_required` if unpaid) | `interfaces/registration-desk-api.ispec.md` R4 |
| POST | `/api/staff/desk/registrations/:id/payment` | Settle the full outstanding balance in person | `interfaces/registration-desk-api.ispec.md` R7 |
| POST | `/api/staff/desk/registrations/:id/charge` | Add an ad-hoc charge | `interfaces/registration-desk-api.ispec.md` R8 |
| POST | `/api/staff/desk/registrations` | Create a narrow spot registration | `interfaces/registration-desk-api.ispec.md` R5 |

### Staff+ scope: `resources`

| Method | Path | Purpose | Reference |
|--------|------|---------|-----------|
| GET | `/api/staff/resources` | Resource planning aggregates | `staff-api.spec.md` |
| GET | `/api/staff/room-inventory` | Current room quotas + occupancy | `room-availability.spec.md` R8.4 |
| PUT | `/api/staff/room-inventory` | Update room quotas | `room-availability.spec.md` R8.4 |

### Staff+ scope: `reports`

| Method | Path | Purpose | Reference |
|--------|------|---------|-----------|
| GET | `/api/staff/reports` | Committee analytics | `staff-api.spec.md` |

### Staff+ scope: `allocation`

| Method | Path | Purpose | Reference |
|--------|------|---------|-----------|
| GET | `/api/staff/allocation/registrations` | Shared-accommodation list | `staff-api.spec.md` R27 |
| GET | `/api/staff/allocation/registrations/:id/preferences` | Get preferences | `staff-api.spec.md` R28 |
| PUT | `/api/staff/allocation/registrations/:id/preferences` | Replace preferences | `staff-api.spec.md` R29 |
| DELETE | `/api/staff/allocation/registrations/:id/preferences` | Clear preferences | `staff-api.spec.md` R30 |
| PUT | `/api/staff/allocation/registrations/:id/accommodation` | Convert 3-share → 2-share | `staff-api.spec.md` R41 |
| POST | `/api/staff/allocation/registrations/:id/payment-link` | Generate payment link | `staff-api.spec.md` R42 |

### Staff+ scope: `admin-tools`

System-maintenance operations. The committee has a small set of one-off data operations (regenerating derived state, syncing caches, reconciling status) that are not part of the daily registration workflow.

| Method | Path | Purpose | Reference |
|--------|------|---------|-----------|
| POST | `/api/staff/regenerate-thumbnails` | Backfill private thumbnails for registrations missing them | `staff.routes.ts:1175` |
| POST | `/api/staff/sync-public-thumbnails` | Sync public CDN thumbnails from private storage | `staff.routes.ts:1184` |
| POST | `/api/staff/reconcile-statuses` | Reconcile registration `status` against payment state | `staff.routes.ts:1193` |

R6.1 — The three `admin-tools` endpoints accept a `dryRun` flag to preview without writing. `regenerate-thumbnails` and `sync-public-thumbnails` use a `?dryRun=true` query parameter; `reconcile-statuses` reads `body.dryRun` from JSON. Each operation writes a `system_audit_log` entry on completion (success and dry-run).

R6.2 — The bank-transaction router (`bank-transaction.routes.ts:48`) mounts `requireScope('bank_txns')` at the router level — single chain for the whole prefix. Cleaner than `staff.routes.ts`'s per-endpoint pattern.

R6.3 — The `dashboard`-scope router in `staff.routes.ts` (line 135) mounts only `requireRole('staff', 'admin')` at the router level; per-endpoint `requireScope('dashboard')` is the current pattern. Per-endpoint scope is allowed (R4.2) but router-level is preferred for prefixes that don't cross scopes.

### Admin only (role: admin, no scope)

| Method | Path | Purpose | Reference |
|--------|------|---------|-----------|
| POST | `/api/admin/users` | Create staff account | `staff-api.spec.md` R14 |
| GET | `/api/admin/users` | List all accounts | `staff-api.spec.md` R15 |
| PATCH | `/api/admin/users/:id` | Update / deactivate | `staff-api.spec.md` R16 |
| POST | `/api/admin/users/:id/resend-invite` | Resend magic link | `staff-api.spec.md` R17 |
| POST | `/api/admin/users/:id/generate-login-link` | Generate staff login link | `staff-api.spec.md` R43 |

### File proxy key validation

R6.4 — `GET /api/staff/files/*` MUST validate the requested key against a strict allow-list of R2 key prefixes before fetching. Acceptable prefixes (reality-derived from every key producer/consumer, 2026-07-23; derivation evidence: `tasks/2026-07-23-rbac-compliance/evidence/t2-allowlist-derivation.txt`):
- `payment-proofs/` — payment proof files (written by staff upload-proof)
- `id-docs/pending/` — pre-relocation ID document uploads (the only `id-docs/` sub-prefix ever written; the bare `id-docs/` prefix is NOT allowed)
- `photos/pending/` — pre-relocation photo uploads (staff pages fetch these keys verbatim when background relocation has not yet run or has failed)
- `registrations/<regCode>/` — registration-scoped files post-relocation (private original, photo, thumbs), where `<regCode>` matches the canonical format: `SMRT` + 12 Crockford base32 characters (alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`; see `reg-id` CONTRACT)
  Scenario: Given a staff user with `dashboard` scope, when they request
  `/api/staff/files/photos/pending/abc.jpg` the file is served; when they request
  `/api/staff/files/internal-config/secrets.json` or
  `/api/staff/files/registrations/NOTACODE/x.jpg` the response is 404 and no
  storage fetch or `file_viewed` audit entry occurs.

Keys outside these prefixes return 404 (do not leak the existence of other keys), are rejected before any storage access, and write no `file_viewed` audit entry. Path-traversal payloads (`..`, `\`, NUL, leading `/`, and percent-encoded variants) are rejected regardless of prefix. The wildcard `*` is for routing only — it is not a license to fetch any R2 key the bucket contains.

### Rate limiting

R6.5 — Staff, admin, bank-tx, and allocation endpoints SHOULD be rate-limited per authenticated user (target: 60 GET / 30 mutate per min per `userId`). **Platform limitation:** Cloudflare Workers isolates hold per-isolate in-memory counters with no shared KV or Durable Object store available in this deployment; per-userId limits are best-effort per-isolate, not fleet-wide. Fleet-wide enforcement is deferred to a shared store (KV, Durable Objects, or an external rate-limit service) when the platform supports it.

The rate-limit key for staff routes is `userId` (from `c.var.auth.userId`), not IP — staff are behind shared Cloudflare egress, and IP-based limits would throttle the whole team. Public routes use IP-based `rateLimitByCategory` (per-isolate, same limitation).

### Mutating endpoint audit

R6.6 — Every staff-mutating endpoint writes a `system_audit_log` entry on completion:
- `action`: a string from `SystemAuditAction` union
- `actor`: staff email (from `c.var.auth.email`)
- `targetType` / `targetId`: the affected entity
- `details`: relevant diff, count, or payload

The audit list (per `staff-operations.spec.md` R7/R12) MUST cover every mutating route in R6, including:
- `reconcile-statuses` (`action: statuses_reconciled`)
- `room-inventory` PUT (`action: room_inventory_updated`)
- `bank-transactions/import` (`action: bank_txn_imported`)
- `bank-transactions/:id/comment` (`action: bank_txn_commented`)
- `bank-transactions/:id/link` and unlink (`action: bank_txn_linked` / `bank_txn_unlinked`)

## UI Gate Matrix

R7 — Every UI route, its API dependencies, and required gate.

### Public routes (no gate)

| Path | Page | APIs called | Gate |
|------|------|-------------|------|
| `/` | `HomePage` | — | none |
| `/connect` | `ConnectPage` | — | none |
| `/whos-coming` | `PublicWhosComingPage` | `GET /api/public/whos-coming` | none |
| `/awards` | `PredictionAwardsPage` | — | none |
| `/sponsor` | `SponsorPage` | — | none |
| `/new` | `NewRegistrationPage` | — | none |
| `/register` | `RegisterPage` | `POST /api/registrations` | none (POST is public) |
| `/pay/:regCode` | `BankTransferPage` | `GET /api/registrations/:id`, `POST /api/registrations/:regCode/pay/upload-proof` | attendee+ (sub check) |
| `/pay/:regCode/advice` | `PaymentAdvicePage` | `GET /api/registrations/:id` | attendee+ (sub check) |
| `/pass` | `PassPage` | — | none |
| `/size-chart` | `SizeChartPage` | — | none |
| `/leaderboard` | `LeaderboardPage` | — | none |
| `/predictions` | `PredictionsMatchPage` | — | none |
| `/bank-details` | `BankDetailsPage` | — | none |
| `/login` | `LoginPage` | `POST /api/auth/magic-link` | none |
| `/auth/verify` | `AuthVerifyPage` | `GET /api/auth/verify` | none |

### Attendee routes (any valid JWT)

| Path | Page | APIs called | Gate |
|------|------|-------------|------|
| `/confirmation/:id` | `ConfirmationPage` | `GET /api/registrations/me` | attendee+ (sub check) |

### Staff routes (role: staff or admin)

Every page in this section mounts a `<RequireScope scope="...">` guard at the top of the tree (R5.4). Missing scope renders an "Access denied" state.

| Path | Page | APIs called | Required scope |
|------|------|-------------|----------------|
| `/staff/dashboard` | `StaffDashboardPage` | `GET /api/staff/dashboard`, `GET /api/staff/registrations` | `dashboard` |
| `/staff/registrations/:id` | `RegistrationDetailPage` | `GET /api/staff/registrations/:id`, `GET /api/staff/files/*`, `POST /api/staff/payments/:id/{verify,reject}`, `POST /api/staff/registrations/:id/{upload-proof,balance-payment,photo,archive}`, `PUT /api/staff/registrations/:id` | `dashboard` |
| `/staff/resources` | `ResourcesPage` | `GET /api/staff/resources` | `resources` |
| `/staff/rooms` | `RoomInventoryPage` | `GET/PUT /api/staff/room-inventory` | `resources` |
| `/staff/reports` | `ReportsPage` | `GET /api/staff/reports` | `reports` |
| `/staff/refunds` | `RefundsPage` | `GET /api/staff/refunds`, `POST /api/staff/refunds/:id/complete` | `dashboard` |
| `/staff/bank-transactions` | `BankTransactionsPage` | `GET /api/staff/bank-transactions*`, `POST /api/staff/bank-transactions/import` | `bank_txns` |
| `/staff/check-in` | Registration desk page | `GET/POST /api/staff/desk/*` | `registration_desk` |
| `/staff/coming` | `WhosComingPage` (staff mode) | `GET /api/staff/registrations`, `GET /api/public/whos-coming` | `dashboard` |
| `/staff/allocation` | `AllocationPage` | `GET /api/staff/allocation/registrations`, `GET/PUT/DELETE /api/staff/allocation/registrations/:id/preferences`, `PUT /api/staff/allocation/registrations/:id/accommodation`, `POST /api/staff/allocation/registrations/:id/payment-link` | `allocation` |
| `/staff/tools` | `StaffToolsPage` | `POST /api/staff/regenerate-thumbnails`, `POST /api/staff/sync-public-thumbnails`, `POST /api/staff/reconcile-statuses` | `admin-tools` |
| `/staff/daily-report` | `DailyReportPage` | `GET /api/staff/reports`, `GET /api/staff/registrations`, `GET /api/staff/files/*` | `admin-tools` (see Open Scoping Questions) |
| `/staff/archived` | `ArchivedRegistrationsPage` | `GET /api/staff/archived` | `dashboard` |
| `/staff/archived/:id` | `ArchivedDetailPage` | `GET /api/staff/archived/:id` | `dashboard` |

### Admin routes (role: admin only)

| Path | Page | APIs called | Gate |
|------|------|-------------|------|
| `/staff/team` | `TeamManagementPage` | `GET /api/admin/users`, `POST /api/admin/users`, `PATCH /api/admin/users/:id`, `POST /api/admin/users/:id/resend-invite`, `POST /api/admin/users/:id/generate-login-link` | role: admin (explicit `<ProtectedRoute requiredRoles={["admin"]}>`) |

### Debug routes (dev only)

`App.tsx` mounts `/debug/*` routes gated on `import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEBUG === 'true'`. In a production build, `import.meta.env.DEV` is statically `false`; the Vite build tree-shakes that branch. The `VITE_ENABLE_DEBUG` runtime string is a separate concern — see Implementation Guideline G8.

## States

R8 — Access-control states from the client perspective:

| State | What client has | What client can do |
|-------|-----------------|---------------------|
| Unauthenticated | No JWT, `localStorage` empty | Browse public routes; submit registration; request magic link |
| Authenticated (attendee) | Valid attendee JWT | View own registration, upload proof, view own confirmation/pass |
| Authenticated (staff, null permissions) | Valid staff JWT, full access | Everything a staff JWT allows — all scopes |
| Authenticated (staff, scoped) | Valid staff JWT, scopes in `permissions.scopes` | Only features whose scope is in the list |
| Authenticated (admin) | Valid admin JWT | Everything (role + bypassed scope) |
| Authenticated, token expired | Expired JWT | API returns 401; client redirects to `/login` |
| Authenticated, role mismatch | Valid JWT, wrong role | API returns 403; client shows "Access denied" state (R5.4) |
| Authenticated, scope mismatch | Valid staff JWT, no matching scope | API returns 403; page renders "Access denied" state |
| Authenticated, no user row (deleted) | Valid JWT, no `users` row | All scoped endpoints return 403 (R3.5); page renders "Access denied" |
| Authenticated, malformed permissions | Valid JWT, corrupted `permissions` JSON | All scoped endpoints return 403 (R3.5); admin is notified to fix the row |

R8.1 — `localStorage` keys: `smriti_token` (JWT), `smriti_role`, `smriti_sub`, `smriti_email`, `smriti_reg_id` (set on attendee login, cleared on staff login). See `src/web/src/lib/auth.ts`.

## Data Flow

### Read path (request)

R9 — End-to-end flow for a typical staff API call:

1. **Client** attaches `Authorization: Bearer <JWT>` from `localStorage.smriti_token`.
2. **`authMiddleware`** verifies the JWT against `JWT_SECRET`, extracts claims, sets `c.var.auth` with the typed `AuthContext` union (`authentication.spec.md` R6). 401 on failure.
3. **`requireRole`** checks `c.var.auth.role` against the allowed list. 403 on mismatch.
4. **`requireScope`** (if mounted) resolves the user's `permissions` from the `users` table via the in-process cache. Admin bypasses. 403 on mismatch (or on missing row / malformed JSON per R3.5).
5. **Handler** runs with the narrowed `AuthContext` available as `c.var.auth`.

### Read path (nav)

R10 — `SiteNav` flow for staff mode:

1. On mount, if `isStaff` and not admin, fetch `GET /api/staff/me/permissions`.
2. While loading, `scopesLoaded === false`; no staff links rendered.
3. On success, set `userScopes = res.permissions?.scopes ?? null` and `scopesLoaded = true`. Filter `staffLinks` by scope.
4. On error, set `scopesLoaded = true` with no scopes change. Fail-open: all non-admin-only links shown.
5. On role change / logout, the effect re-runs.

### Write path (admin updates a user's scopes)

R11 — Admin updates `permissions` via `PATCH /api/admin/users/:id`:

1. Admin's request hits `adminRoutes` with `requireRole('admin')` only — no scope.
2. Handler validates the new `permissions` shape (R3.4), writes to the `users.permissions` column.
3. The affected user's next request within 5 minutes may still see the OLD scope (cache TTL). Worst-case staleness: 5 minutes.

## Edge Cases

- **Cache cold start**: A fresh worker isolate has an empty scope cache. The first request for a user does a D1 read for `permissions`. Sub-millisecond. (R3.2, R4.3.)
- **Permission change for self**: An admin cannot deactivate their own account. Scope changes for self are allowed — admin's scopes are bypassed at runtime regardless.
- **Multiple registrations with same email**: Identity resolution returns the most recent registration for an attendee-only email (`authentication.spec.md` R12.5). Staff with that email get staff JWT; `my-registration` returns the latest.
- **Concurrent permission changes**: Two admins editing different users' permissions concurrently is safe (no shared state). Two admins editing the SAME user: last write wins; the other's changes are silently overwritten. Audit log records both. No transactional guarantee.
- **Deactivated user with valid JWT**: Per `authentication.spec.md` R11 — the JWT remains valid until expiry. `is_active = 0` only blocks new magic-link requests/verifications.
- **Scope check on attendee JWT**: `requireScope` rejects any non-staff/non-admin role (R3.3). An attendee cannot reach a scope-checked endpoint.
- **Deleted user with valid JWT**: `requireScope` returns `[]` (no access) for the userId when the row is missing. The JWT is technically valid but every scoped endpoint 403s. (R3.5)
- **Malformed `permissions` JSON**: `requireScope` returns `[]` (no access) on parse failure. The 5-minute cache stores the empty result. (R3.5)
- **Fail-open nav vs fail-closed API**: Nav is fail-open (UX) — better to show a link that returns 403 than to hide a legitimate route. API is fail-closed (security) — `requireScope` never passes on missing or malformed data.
- **Test cache pollution**: Tests that exercise scoped users MUST clear `_scopeCache` between cases (exposed as `_scopeCache` from `auth.middleware.ts`). See `auth-roles.test.ts:23` and `auth-roles.test.ts:784`.
- **Route mount order**: `adminRoutes` must be mounted AFTER `staffRoutes` in `app.ts` so the more-specific admin path takes precedence. (Not currently a bug — paths are disjoint — but worth noting for future router additions.)

## Implementation Guidelines

G1 — **Default-deny.** Every API endpoint and every UI route MUST have an explicit gate. Unmapped = rejected. The matrices in R6 and R7 are the source of truth — additions land there first, code second.

G2 — **Same scope for same feature.** When a feature has both a page and APIs, the page's nav link, the page's API calls, and any per-action UI inside the page all use the same scope value. No mixing.

G3 — **Server is authoritative.** Client gates (role check, scope check) are advisory. The API's `requireRole` + `requireScope` chain is the final word. A client may hide a route; it MUST NOT skip the API call.

G4 — **Mount at router level when possible.** Prefer router-level `requireScope` over per-endpoint scope. Easier to audit; one place to read. Per-endpoint additions are allowed only when a router serves two scopes.

G5 — **Use the shared scope list.** Define scopes once as a `StaffScope` type in `src/web/src/lib/staff-types.ts:214` and `src/server/src/domain/types.ts:527`. Don't string-literal "dashboard" in route files. The `VALID_SCOPES` constant in `admin.routes.ts:39` and the `StaffScope` type must stay in sync.

G6 — **Admin bypass is intentional.** Admin role always passes scope checks. A feature meant for admins-only can be gated by `requireRole('admin')` alone. A feature meant for a small set of trusted non-admin staff (e.g., system maintenance, finance reconciliation, or registration-desk operations) should be a new scope (`admin-tools`, `bank_txns`, `registration_desk`) so the grant is explicit and revocable — see R2.5 and the R2 table.

G7 — **New scope = new spec section.** Adding a scope requires: (a) a row in the R2 scope table, (b) rows in the R6 API matrix, (c) rows in the R7 UI matrix, (d) rows in the R8 nav table, (e) a checkbox in the Team management UI (`user-management.spec.md` R3.7.1), (f) added to `VALID_SCOPES` in `admin.routes.ts:39`, (g) added to `StaffScope` type in both client and server domain types.

G8 — **Production builds physically exclude debug routes.** The `VITE_ENABLE_DEBUG` environment variable is replaced at build time by Vite's `define` plugin: a `flag=false` production build statically replaces the check with `'false' === 'true'`, and Rollup constant-folds and tree-shakes the entire debug-route branch — zero debug markers remain in the dist output (verified by `scripts/assert-debug-excluded.sh`; evidence: `tasks/2026-07-23-rbac-compliance/spike-debug-treeshake.md`). Defense in depth: (a) build-time exclusion (L1 lock — the assertion script fails the build if any debug marker survives), (b) where debug does ship (staging with `VITE_ENABLE_DEBUG=true`), access is gated on a D1-backed feature flag (`debug_tools`) AND admin role, (c) server debug routes mount only in `index.dev.ts`, never in the deployed `index.ts`.

G9 — **Audit actor is the staff email.** Every staff-mutating action records `actor = staff_email` (from `c.var.auth.email`). For admin actions, actor is the admin's email. The audit log is the canonical record of who-did-what, separate from the access-control decision (which is enforced by the middleware chain).

## Open Scoping Questions

These are scope-assignment decisions that haven't been made. Each is an open question, not a gap — the current assignment is functional; the question is whether a different scope would be more correct.

**Q1 — Should any `dashboard`-scope endpoints move to `admin-tools`?**

| Endpoint | Current scope | Why it could move to `admin-tools` | Why it could stay in `dashboard` |
|----------|---------------|--------------------------------------|----------------------------------|
| `GET /api/staff/export` | `dashboard` | Bulk CSV export of all registrations is a leadership/data-ops task | Committee uses it during the run-up to the event for spreadsheet work |
| `POST /api/staff/registrations/:id/photo` | `dashboard` | Replaces the public CDN thumbnail; affects Who's Coming | Day-to-day registration fixup; the spec frames it as a "view-mode replace action" |
| `GET /api/staff/files/*` | `dashboard` | Reads private files; could be privacy-sensitive | Committee needs it to review payment proofs and ID docs |
| `GET /api/staff/refunds`, `POST /api/staff/refunds/:id/complete` | `dashboard` | Refund resolution requires writing a bank transfer reference (UPI/NEFT) — the "treasury" workflow | Refunds are created by the same staff who verify overpayments (dashboard-scope) |

**Q2 — Should any `dashboard`-scope endpoints move to `bank_txns`?**

| Endpoint | Current scope | Why it could move to `bank_txns` | Why it could stay in `dashboard` |
|----------|---------------|----------------------------------|---------------------------------|
| `GET /api/staff/refunds`, `POST /api/staff/refunds/:id/complete` | `dashboard` | Refund resolution writes a `bankReference` — same data flow as bank-txn linking | Refund verification is on the registration detail page (dashboard UI) |
| `POST /api/staff/registrations/:id/send-payment-link` | `dashboard` | Sends the payment-link email that drives bank inflow | Standard dashboard workflow |
| `POST /api/staff/registrations/:id/generate-payment-link` | `dashboard` | Generates the link that ends up in a UPI/IMPS description | Standard dashboard workflow |

**Q3 — Should `/staff/daily-report` be `admin-tools` instead of `reports + dashboard`?**

`DailyReportPage` calls both `fetchReports` (requires `reports`) and `fetchRegistrations` + `fetchFile` (requires `dashboard`). A user with only one of the two scopes sees a half-broken page. Two options:
- (a) Require both scopes (`reports` AND `dashboard`) — page accessible to anyone with either, but renders fully only for both.
- (b) Re-scope the page to `admin-tools` only — committee leadership who runs the event would have `admin-tools` (and `dashboard` and `reports`); other staff would not. The mixed-scope problem goes away because the page is for leadership.

The current spec reflects option (b) (see R7 row for `/staff/daily-report`).

## Dependencies

- `authentication.spec.md` — auth model, JWT, magic links, identity resolution, scoped permissions, `requireScope` middleware definition, `requireRole` middleware definition, AuthContext shape, token lifecycle, login audit.
- `user-management.spec.md` — staff CRUD, scope validation, scope checkboxes UI.
- `staff-api.spec.md` — staff + admin endpoint contracts, scope mounting.
- `staff-operations.spec.md` — staff service logic, audit actions.
- `room-availability.spec.md` — `room-inventory` API + UI, scope `resources`.
- `roommate-preferences.spec.md` — allocation feature, scope `allocation`, branch rep workflow.
- `photo-replacement.spec.md` — photo replacement endpoint, scope `dashboard`.
- `bank-txn-matching.spec.md` — `bank_txns` scope, bank-txn picker modal, link-on-verify.
- `team-management.spec.md` — admin team UI, scope checkboxes.
- `staff-console.spec.md` — staff navbar scope filtering, `SiteNav` link visibility.
- `staff-dashboard.spec.md` — Attendees/Donors list page, scope `dashboard`.
- `staff-resources.spec.md` — Resources page, scope `resources`.
- `staff-reports.spec.md` — Reports page, scope `reports`.
- `tasks/2026-07-23-rbac-*` — compliance work to bring the code into conformance with this spec.
