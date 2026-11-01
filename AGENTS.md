# AGENTS.md

Orientation for an AI agent working in this reunion portal. Humans: read [README.md](./README.md) first.

## Start here

Pick the task, then read the file for it before you edit anything.

| The task is | Read |
|---|---|
| Adapt the portal to a new batch: rebrand, change dates and prices, remove features | [MAKE-IT-YOURS.md](./MAKE-IT-YOURS.md). Show the user a plan before any edit. |
| Run the event: staff, payments, reconciliation, reports, desk day, rooms, ID cards, post-event | [ADMIN.md](./ADMIN.md) |
| Deploy or set up Cloudflare | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) |
| Edit config (names, URLs, resources, tokens) | "Where settings live" below, then run `make doctor` |
| Query production or staging, read logs, check CI | The `devops` skill: [.claude/skills/devops/SKILL.md](./.claude/skills/devops/SKILL.md) |
| Match a bank statement, verify a payment, refund | The `payment-reconcile` skill: [.claude/skills/payment-reconcile/SKILL.md](./.claude/skills/payment-reconcile/SKILL.md) |
| Understand how the parts fit, or where data lives | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| Change behavior of an existing feature | The matching spec in `docs/specs/` (index: `docs/specs/README.md`), then this file |
| Prepare a change for upstream, or report a vulnerability | [CONTRIBUTING.md](./CONTRIBUTING.md), [SECURITY.md](./SECURITY.md) |

## What this is

A registration and event-operations portal (React SPA + Hono API on Cloudflare Workers, D1, R2). It was built for Smriti 2026 (TKMCE Class of 2006). The Smriti branding, copy, prices, dates and venue are kept as a working example. Adapting it takes two kinds of edit: **identity and infrastructure** go in two config files (see "Where settings live"), and **event facts, copy and features** are code and assets. MAKE-IT-YOURS.md lists the places to edit, the removal set for each feature, and example prompts. Work through it one category at a time and re-run the checks after each. Terms you do not know are in [docs/GLOSSARY.md](./docs/GLOSSARY.md).

## Layout

```
src/shared/   @smriti/shared  types, pricing, validation, constants, feature-flag catalog (no build step)
src/web/      @smriti/portal  React 19 + Vite + Tailwind v4 + React Router v7 (public/ has assets and _redirects; src/web/site-templates/ holds the _headers, robots.txt and sitemap.xml templates)
src/server/   @smriti/server  Hono API; entry src/index.ts (prod) and src/index.dev.ts (local); migrations/
docs/specs/   behavior specs, source of truth for what each feature should do (index: docs/specs/README.md)
docs/         ARCHITECTURE.md, DEPLOYMENT.md, GLOSSARY.md, STYLE_GUIDE.md, decisions/
site.config.json   identity and per-environment URLs (committed)
scripts/      ops and report scripts, imagegen, idcard-mailmerge, ui helpers (see ADMIN.md)
.claude/      skills (devops, payment-reconcile) and workflows/extract-statement.js
.github/workflows/deploy.yml   CI: make check, then deploy on push to release/stg or release/prod
```

Each workspace has its own `CLAUDE.md` with module-level notes (entry points, conventions). Read the one for the area you change.

## Where settings live

Every setting has one owner file. Change it there and nowhere else, then run `make doctor`.

| File | Owns | In git? |
|---|---|---|
| `site.config.json` | Event name, subtitle, title, sender name, GitHub repo. Per environment (`stg`, `prod`): `siteUrl`, `cdnUrl`, `publicThumbsUrl`, `pagesProject`. Reports bucket and prefix. Attendance sheet ID. Identity and URLs only, never feature switches. | Yes |
| `src/server/wrangler.toml` | Cloudflare infrastructure: account ID, Worker names, routes, D1 names and IDs, R2 bucket names. Top level is staging; `[env.production]` is production. It holds no URL variables. | Yes |
| `.env.ops` (from `.env.ops.example`) | Operator secrets only: the agent `CLOUDFLARE_API_TOKEN`, `GOOGLE_*`, `MAILGUN_*`, `GEMINI_API_KEY`. Scripts and skills load it themselves; a variable already in the process environment wins. | No |
| `src/server/.dev.vars` (from `.dev.vars.example`) | Local development values for the Worker: `JWT_SECRET`, `APP_BASE_URL`, `SENDER_NAME`, optional Mailgun and Google keys. `make dev` creates it if missing. | No |
| Worker secrets (`wrangler secret put`) | Deployed `JWT_SECRET`, `MAILGUN_*`, `GOOGLE_*` | Cloudflare |
| `src/shared/src/constants.ts`, `src/shared/src/upi.ts` | Prices, branches, dates, causes, payee | Yes |
| `src/shared/src/reg-code.ts` | `REG_CODE_PREFIX`. Never change it after registrations exist. | Yes |
| `src/server/migrations/0003_users_and_auth.sql` | First admin email. Edit before the first remote migration. | Yes |

How the files reach the running system:
- `scripts/deploy.sh <env>` reads `site.config.json` and `wrangler.toml` and passes `APP_BASE_URL`, `SENDER_NAME`, `PUBLIC_PORTRAITS_URL` and `PUBLIC_THUMBS_URL` to the Worker with `--var`. A deploy that skips `deploy.sh` leaves `APP_BASE_URL` unset, and the Worker then answers every request with a 500 configuration error (it fails closed).
- The web build reads `site.config.json` itself (Vite mode `production` or `staging`) and fills canonical URLs, Open Graph tags, the security headers, `robots.txt` and `sitemap.xml` from the templates in `src/web/site-templates/`.
- Scripts and skills read settings through `scripts/site-config` (for example `scripts/site-config get stg d1Name`, `scripts/site-config keys`).

Two Cloudflare tokens exist and must stay apart:
- **Agent token**: in `.env.ops`, narrow scopes (D1, R2 read, Workers tail). The only token an agent may hold.
- **Deploy token**: only in the CI secret `CLOUDFLARE_API_TOKEN`, or in a human's shell for one command. Never in `.env.ops`. CI needs no other secret.

## Commands

Requires Node 23.11.0 (`.node-version`) and `uv` for Python scripts. `npm ci` may print an `EBADENGINE` warning for `eslint-visitor-keys` on this Node version; it is harmless.

| Command | Purpose |
|---|---|
| `npm ci` | install |
| `make fonts` | download self-hosted fonts (git-ignored output). `make dev` runs it by itself when the output is missing; run it again only after you change fonts |
| `make dev` | local web (5173) + API (8787; `API_PORT=<port>` changes it). Creates `src/server/.dev.vars` from the example if missing, stops with a message if the API port is busy, applies migrations to a local D1, stops both servers if one fails |
| `make check` | typecheck (web + server) + lint (ESLint, zero warnings) |
| `make test` | server, web and shared test suites (`make test-server`, `make test-web`, `make test-shared`) |
| `make build` | production build of the web app |
| `make doctor` | list config values that still equal the Smriti example, and check that the config files agree. Informational (exit 0). Run it after every config edit |
| `make doctor-strict` | same, but fails while any example value is left. The gate before a fork launches |
| `scripts/deploy.sh <stg\|prod> [web\|server\|all] [--dry-run]` | deploy by hand. `--dry-run` builds and prints every command and needs no token. Normal deploys go through CI |

Expected test totals in this tree (run on a fresh clone): server 1464, web 932 passed (3 skipped), shared 427. `src/server/src/__tests__/staff-edit-archive.test.ts` has been seen to fail about once in ten runs ("Registration was modified by another request"); rerun before investigating. CI runs `make check` only, so run the tests yourself.

Local admin login: ask for a link on `/login` as `admin@example.com`; the API terminal prints a `localhost:5173/auth/verify?...` link. Links are printed only when `APP_BASE_URL` is a local address. Shortcut: `curl -s -X POST localhost:8787/api/debug/magic-link -H 'content-type: application/json' -d '{"email":"admin@example.com"}'` returns a link (dev API only).

## Rules

1. **Staging first.** Try every deploy and every data operation on `stg`, then repeat on `prod`.
2. **Name the environment.** Every ops script takes `stg` or `prod`; none has a default. Never guess it.
3. **Reads by default.** Agents run production reads only. `d1-query` refuses non-reads without `--write`, and a prod write needs a typed confirmation from a human. A production write needs the user's explicit, named permission for that one change.
4. **Never commit secrets or personal data.** `.env.ops`, `src/server/.dev.vars`, tokens, staff JWT files and everything in `tmp/` (reports, proofs, rosters) stay out of git. Never paste a token into a chat.
5. **Run `make doctor` after any config edit**, and `make check` after any code edit.
6. **Do not push, deploy or write to a remote database** unless the user asked for that action by name. Deploys go through GitHub CI: merge `main` into `release/stg`, then `release/prod`.
7. **Never hold the deploy token.** If a task needs it, give the command to the user.
8. **Migrations only go forward.** Never delete or edit an applied migration (MAKE-IT-YOURS.md section 3.3).

## Conventions

TypeScript
- Strict mode. Prefer `interface` for object shapes. Export types with their implementations. No `any`: use `unknown` and narrow.

Components (web)
- One component per file, named export. Primitives in `src/web/src/components/ui/`, feature components in domain folders. Props interface exported with the component.
- Tailwind classes only. No inline styles, no CSS modules unless unavoidable. Theme tokens are in `src/web/src/index.css` (`@theme`).
- 44px minimum touch targets on mobile. Test layouts at 375px, 768px and 1280px.

Forms
- React Hook Form + Zod. Schemas live in `src/web/src/lib/validation.ts`, built on `src/shared`.

State and data
- Wizard state is saved to `localStorage` as a draft.
- Pricing is derived, never stored. Prices come from `PRICING_DEFAULTS` in `src/shared/src/constants.ts`; the server recomputes on submit. Do not hardcode prices in components.
- Auth is email magic link only. No passwords or login accounts for alumni.
- There is no payment gateway. Payment is a manual bank or UPI transfer that staff verify (`src/web/src/pages/BankTransferPage.tsx`, `src/server/src/services/payment.service.ts`).

Server
- Routes under `src/server/src/routes/`, business logic in `services/`, D1 access in `repositories/`. All routes are mounted under `/api` in `src/server/src/app.ts`.
- Database changes are forward-only migrations in `src/server/migrations/` (apply with `wrangler d1 migrations apply`). Never delete or edit an applied migration, even when you remove a feature; add a new numbered file instead. `src/server/src/db/schema.sql` is a reference loaded by the test harness; migrations are authoritative.
- Required Worker variables fail closed: `APP_BASE_URL` always, `SENDER_NAME` when Mailgun is configured (`src/server/src/lib/site-config.ts`). Do not add a fallback URL.

Dependencies
- Do not add dependencies without a reason; bundle size matters for mobile users.

Specs and debug pages
- Specs in `docs/specs/` describe behavior. Update the matching spec when behavior changes.
- `/debug` pages render components in isolation. They are excluded from production bundles (`scripts/assert-debug-excluded.sh` checks this). Staging builds include them behind an admin login and the `debug_tools` flag, but the deployed API never mounts `/api/debug/*`; that exists only in the local entry `src/server/src/index.dev.ts`. When you build a component, wire it into the matching case in `src/web/src/pages/DebugPage.tsx`.

Comments and some specs mention `tasks/...` planning files and `docs/releases/...`. Those were private working documents and are not in this repo; the code and specs stand on their own.

## Where event-specific values live

The full map is MAKE-IT-YOURS.md sections 4 to 6. The short version:

- Names, URLs, Cloudflare resources: the config files in "Where settings live". Run `make doctor` for what is left.
- Money, branches, dates, causes, payee: `src/shared/src/constants.ts` (and `src/shared/src/upi.ts`)
- First admin: `src/server/migrations/0003_users_and_auth.sql`
- Copy: spread over about 50 components and `src/server/src/infra/email-templates.ts`; `make doctor` lists the lines. Search for `Smriti`, `TKMCE`, `2006`, `Raviz`, `Kollam`
- Dates: literals like `2026-08-14` in server and web code (the nights list is duplicated)
- People and fixtures: `credits-data.ts` holds the real names of the five contributors, on purpose. Other fixtures (`whos-coming/mock-data.ts`, `awards-data.ts`, debug pages) are synthetic.
- Assets: `src/web/public/assets/`; several images are neutral placeholders

Placeholders you must replace before deploying: `REPLACE_WITH_*` in `wrangler.toml`; `YOUR ALUMNI ASSOCIATION`, `yourassociation@bank` and the bank block in `constants.ts`; `admin@example.com` in migration 0003; `REPLACE_WITH_GROUP_INVITE`, `REPLACE_WITH_PAGE`, `REPLACE_WITH_*.pdf` and the Apps Script placeholder in the web components listed in MAKE-IT-YOURS.md section 5.5.

## Verification before you say it works

1. `make check` passes.
2. `make test` passes (see totals above).
3. `make doctor` shows no mismatches, and after a rename no example values in config.
4. From-zero migration works: `cd src/server && npx wrangler d1 migrations apply DB --local --persist-to /tmp/x`, then `make dev` and `curl localhost:8787/api/health` returns `{"ok":true}`.
5. UI claims need a browser check. The wizard must be reachable end to end (all 7 steps, up to the payment step) with `registration_show_page` and `registration_accept_new` turned on at `/staff/config`.
6. Before a deploy, `scripts/deploy.sh stg all --dry-run` completes.
7. Search the tree for leftover Smriti strings you meant to replace, and for any real names, emails, phone numbers or IDs you pasted in.
