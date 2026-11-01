# src/server — Hono API (@smriti/server)

Cloudflare Workers API using Hono. Shares types, pricing, and validation with the web app via `@smriti/shared`.

## Jumpstart

**Updated:** 2026-05-19

Hono API on Cloudflare Workers. Middleware injects repos and services into context for each request. Routes call services, services call repositories, domain types enforce invariants.

## Entry Points

| Task | File |
|------|------|
| App wiring + DI | `src/index.ts` |
| Registration endpoint | `src/routes/registration.routes.ts` |
| Payment endpoint | `src/routes/payment.routes.ts` |
| File upload endpoint | `src/routes/upload.routes.ts` |
| Error handling | `src/middleware/error.middleware.ts` |
| Auth (jwt) | `src/middleware/auth.middleware.ts` |

## Commands

```bash
make dev-server      # wrangler dev (http://localhost:8787)
```

**Deployment is via GitHub Actions (push to `release/stg` or `release/prod`; see `.github/workflows/deploy.yml`). Avoid running deploy commands by hand.**

## Structure

- `src/index.ts` — Hono app with `basePath("/api")`
- `wrangler.toml` — Workers config, routes, account ID
- `migrations/` — D1 migration SQL files (applied via `make db-migrate-local` or `make dev`)
- `src/db/schema.sql` — reference schema for the test harness (migrations are authoritative; never deploy from it)
- All routes are under `/api/*`

## Conventions

- CORS allows only the `APP_BASE_URL` origin (plus localhost:5173 when `ENVIRONMENT=development`). `APP_BASE_URL`, `SENDER_NAME`, `PUBLIC_*_URL` come from `site.config.json` through `scripts/deploy.sh` (`wrangler deploy --var`); locally from `.dev.vars`. No fallback: a missing `APP_BASE_URL` returns a 500 config error
- `secureHeaders()` middleware on all routes
- Import shared logic from `@smriti/shared` (types, pricing, validation, constants)
- Timestamps: Unix epoch milliseconds (`number`). No ISO strings, no Date objects. DB uses `INTEGER DEFAULT (unixepoch() * 1000)`. JS uses `Date.now()`. Client handles formatting/timezones.
- Booleans in D1: `number` (0|1) in row types, coerced to `boolean` in domain types via converter functions
- `erasableSyntaxOnly: true` in tsconfig — use explicit property declarations, not constructor parameter properties
- New D1 migrations go in `migrations/` — NOT `src/db/`. Name them `NNNN_description.sql` (zero-padded 4-digit sequence). `wrangler.toml` points to `migrations/`; files in `src/db/` are ignored

## Deployment

| What | Where |
|------|-------|
| Web | Cloudflare Pages → https://beta.smriti2026.com |
| API | Cloudflare Workers → https://beta.smriti2026.com/api/* |

`scripts/deploy.sh` reads the Cloudflare token from the `CLOUDFLARE_API_TOKEN` environment variable.

For DNS changes, token permissions, wrangler config, or any Cloudflare infrastructure work → read `docs/DEPLOYMENT.md`

## Finding Things

| To understand... | Look in / Grep for |
|------------------|--------------------|
| Business logic (registration) | `src/services/registration.service.ts` |
| Business logic (pricing) | `src/services/pricing.service.ts` |
| Database queries | `src/repositories/*.repo.ts` |
| Route handlers | `src/routes/*.routes.ts` |
| Middleware chain | `src/index.ts` (middleware.use) |
| Payment flow (bank transfer / UPI proof upload) | `src/services/payment.service.ts` + `src/repositories/payment.repo.ts` |
| Test-harness reference schema | `src/db/schema.sql` |

## Tests

| What's tested | File | Run with |
|--------------|------|----------|
| Routes + services (e2e) | `src/__tests__/e2e.test.ts` | `make test-server` |
| Adversarial validation | `src/__tests__/adversarial.test.ts` | `make test-server` |
| Test setup | `src/__tests__/setup.test.ts` | `make test-server` |

## Gotchas

- All repos constructed per-request in middleware — don't instantiate outside request scope
- DB booleans are `0|1` integers in row types, `boolean` in domain types — converter functions handle the mapping
- `scripts/deploy.sh` reads `CLOUDFLARE_API_TOKEN` from the environment — no `.env` file needed for deploy
- Photo URLs: `photo_thumb_key` is a PRIVATE bucket key — never use it in public-facing URLs. Public CDN photos live at `{registrationId}.jpg` (e.g., `https://cdn.smriti2026.com/1179.jpg`). Use `publicPhotoUrl(id, base, version)` from `src/web/src/lib/api.ts` or construct as `${PUBLIC_THUMBS_URL}/${id}.jpg`. Append `?v=` for cache busting. Source of truth: `src/web/src/components/whos-coming/WhosComingView.tsx`.

## Remote Data — Hard Rules

**NEVER run these commands.** They modify remote data and need an edit-capable token (agents should only ever hold a read-only `CLOUDFLARE_API_TOKEN`):
- `stg-db-exec`
- `stg-db-migrate`
- Any command run with an admin/edit token

**NEVER run `wrangler d1 execute` with mutating operations:**
- INSERT, UPDATE, DELETE, DROP, ALTER, or CREATE

The deploy token is read-only for D1. For testing data mutations, use `wrangler dev` (local SQLite, safe).

**NEVER use an admin or edit-capable Cloudflare token.** A human must run remote writes.

**Safe operations:**
- `make stg-db-query SQL="SELECT ..."` — read-only, uses deploy token
- `wrangler dev` — local D1/R2, no remote access

**If a task requires schema changes or data migration:** Stop and tell the user. Do not attempt it yourself.

## Design & Documentation

- Route contracts live in `docs/specs/` — document request/response shapes and invariants
- When service logic changes significantly, update this file and comments in relevant service files
- Keep domain type definitions and converter functions documented inline — row types ↔ domain types boundary is critical

## Testing

- Test contracts: every GUARANTEE, EXPECTS violation, and FAILURE BEHAVIOR gets a test
- Don't stats-pad — new features need new tests that exercise the new code path
- Test the full registration flow: validation → service → repo → response mapping
