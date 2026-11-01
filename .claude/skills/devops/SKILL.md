---
name: devops
description: >
  Reunion portal devops operations — querying remote databases, debugging auth issues,
  inspecting deployments, and understanding the Cloudflare infrastructure. Use this
  skill whenever investigating production issues, querying remote D1 databases,
  debugging auth/login failures, checking deployments, or any operational task
  involving the staging or production environments. Trigger when the user mentions
  "prod", "staging", "logs", "D1 query", "deploy", or asks about what's happening
  in the live environment.
---

# Reunion Portal DevOps

Terms such as D1, R2, Worker and scope are defined in [docs/GLOSSARY.md](../../../docs/GLOSSARY.md). Use this skill for questions about the live staging or production site; for adapting or running the event see [MAKE-IT-YOURS.md](../../../MAKE-IT-YOURS.md) and [ADMIN.md](../../../ADMIN.md).

## Where settings live

Every setting has exactly one owner file. Scripts read them through `scripts/site_config.py`; do not copy a value into a script, a shell profile or a skill.

| File | Owns |
|------|------|
| `src/server/wrangler.toml` (committed) | Cloudflare infra per environment: account ID, Worker name, routes, D1 database name and ID, R2 bucket names. Top level = staging (`stg`), `[env.production]` = production (`prod`). |
| `site.config.json` (committed) | Identity and URLs: event name, subtitle and title, sender name, GitHub repo, per-environment site URL, CDN URL, public thumbnails URL, Pages project, reports bucket and prefix, attendance sheet ID. Identity and infra only: never feature switches (features change in code). The registration-code prefix is not here: it is the constant `REG_CODE_PREFIX` in `src/shared/src/reg-code.ts`. |
| `.env.ops` (git-ignored) | Secrets only: the agent `CLOUDFLARE_API_TOKEN`, `GOOGLE_*`, `MAILGUN_*`, `GEMINI_API_KEY`. A variable in the process environment overrides the file. |

Resolution order for a secret: process environment, then `.env.ops` (then `src/server/.dev.vars` for secrets the Worker also uses, such as `GOOGLE_SA_KEY`). A missing value stops the command with a message that names the key and the owner file. To inspect settings:

```bash
scripts/site-config get stg d1Name        # one value (global keys: scripts/site-config get global eventTitle)
scripts/site-config target prod           # the resources a prod command would touch
scripts/site-config keys                  # every key and its owner file
make doctor                               # example values left, mismatches between the files, missing token
```

**The environment is always explicit.** Every script takes `stg` or `prod`; there is no default. Prod operations print their target (database, Worker, bucket, URL) before they act.

## Tokens

There are two Cloudflare tokens. Do not mix them.

| Token | Where it lives | Used for | Scope |
|-------|----------------|----------|-------|
| Agent token | `.env.ops` as `CLOUDFLARE_API_TOKEN` | `d1-query`, `worker-logs`, `audit-log`, report scripts, `reconcile` reads | As narrow as Cloudflare allows: D1, R2 read, Workers tail. No deploy or edit rights. |
| Deploy token | The GitHub Actions secret `CLOUDFLARE_API_TOKEN` (CI), or passed in your shell for one command when a human deploys locally. **Never stored in `.env.ops`.** | `scripts/deploy.sh`, D1 migrations, R2 writes | Workers, Pages, D1 edit |

`scripts/deploy.sh` reads the deploy token from the process environment only. An agent must not be handed the deploy token.

`d1-query` also guards writes itself: without `--write` it refuses anything that is not a read (`SELECT`, `WITH ... SELECT`, `PRAGMA table_info`, `EXPLAIN`). Cloudflare may not let a read-only D1 token run queries at all (not verified). If you had to grant D1 Edit to the agent token, that token can write to production: the read guard covers only d1-query, not direct wrangler commands, so rely on the agent rules in ADMIN.md section 8. `--write` on prod outside CI asks you to type `write prod`. Agents run reads only unless the organizer explicitly asks for a write.

Prerequisites: `uv` (or Python 3.11+) and Node; `gh` (GitHub CLI), logged in, for the `ci` script; `src/server/wrangler.toml` filled in (replace every `REPLACE_WITH_*`; `d1-query` stops while placeholders remain).

Scripts live in `scripts/` next to this file:

```
SCRIPTS=.claude/skills/devops/scripts
```

| Script | What it does |
|--------|-------------|
| `worker-logs <stg\|prod>` | Stream live worker logs: errors, requests, console output |
| `d1-query <stg\|prod> "SQL"` | Run SQL against remote D1 (prints JSON). Reads only unless `--write`; `--dry-run` shows the target and the guard verdict without any network call. |
| `audit-log <stg\|prod> <cmd>` | Pre-built queries against system_audit_log (logins, payments, by-registration) |
| `ci` | CI runs and deployment status via `gh` (repo from `site.config.json` `githubRepo`) |
| `cf-token` | Check that the agent token resolves (masked form only, and which source it came from); `--verify` asks Cloudflare if it is valid |

## Architecture

Names come from the owner files above; read them with `scripts/site-config`.

| Layer | Key | Owner file |
|-------|-----|------------|
| Site and API (`/api/*`) | `siteUrl` | `site.config.json` |
| API Worker | `workerName` | `src/server/wrangler.toml` |
| D1 database | `d1Name`, `d1Id` | `src/server/wrangler.toml` |
| R2 (private files) | `r2Bucket` | `src/server/wrangler.toml` |
| R2 (public thumbnails) | `r2ThumbsBucket` | `src/server/wrangler.toml` |
| Pages project | `pagesProject` | `site.config.json` (Cloudflare Pages projects are not Worker config) |

R2 object key conventions:

| File type | Key pattern |
|-----------|-------------|
| Alumni photo | `registrations/{regCode}/photo.{ext}` |
| Photo thumbnail | `registrations/{regCode}/photo-thumb.jpg` |
| ID document | `registrations/{regCode}/id-doc.{ext}` |
| Payment proof | `registrations/{regCode}/proof-{paymentId}.{ext}` |

## Checking Server Logs

```bash
$SCRIPTS/worker-logs prod                     # stream all live requests (stg or prod is required)
$SCRIPTS/worker-logs prod --format json       # JSON output for filtering
$SCRIPTS/worker-logs prod --status error      # only errors
$SCRIPTS/worker-logs stg                      # staging
```

This streams **live** — shows requests as they arrive with full detail (HTTP status, path, method, console.log output, uncaught exceptions). Press Ctrl+C to stop. For historical data, use `audit-log` or `d1-query`.

## Querying the Database

```bash
$SCRIPTS/d1-query prod "SELECT id, reg_code, email, status FROM registrations ORDER BY id DESC LIMIT 5"
$SCRIPTS/d1-query stg "PRAGMA table_info(magic_links)"
$SCRIPTS/d1-query prod "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

`d1-query` runs reads only (see Tokens). `--dry-run` checks a statement and prints the target without sending it. A write needs `--write` and, on prod outside CI, the typed confirmation.

Key tables: `registrations`, `attendees`, `payments`, `magic_links`, `audit_log`, `system_audit_log`, `users`. Field names are **snake_case** in the DB.

## Debugging Auth / Login Issues

```bash
$SCRIPTS/audit-log prod logins                              # recent login events
$SCRIPTS/audit-log prod logins --email user@example.com     # specific user
$SCRIPTS/audit-log prod registration 1027                   # all events for a reg ID
$SCRIPTS/audit-log prod payments                            # payment actions
$SCRIPTS/audit-log prod recent                              # last 20 system events
$SCRIPTS/audit-log prod sql "SELECT ..."                    # custom query
```

Actions: `login_succeeded`, `login_failed`, `login_requested`, `payment_link_sent`, `payment_link_generated`, `payment_verified`, `payment_rejected`.

The `details` column is JSON — e.g., `{"reason":"invalid_or_expired","tokenHashPrefix":"4dd15a37"}`.

## CI and Deployments

```bash
$SCRIPTS/ci status                    # latest run on each release branch
$SCRIPTS/ci deploys                   # recent runs on release/stg + release/prod
$SCRIPTS/ci runs                      # last 10 workflow runs
$SCRIPTS/ci runs --failed             # only failures
$SCRIPTS/ci run <run-id>              # detail for a specific run
```

## Deploying

Deploys run from GitHub Actions on push to `release/stg` / `release/prod` (see `.github/workflows/deploy.yml`). **Pushing to `release/prod` publishes to live users. An agent must not run these commands unless the user has approved that specific push; give them to the user to run.**

```bash
git checkout release/stg && git merge main --no-edit && git push origin release/stg   # staging
git checkout release/prod && git merge main --no-edit && git push origin release/prod  # production (human-approved only)
```

`scripts/deploy.sh <stg|prod> [web|server|all] [--dry-run]` deploys from your machine with the deploy token read at a hidden prompt for that command (`read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN && scripts/deploy.sh stg server; unset CLOUDFLARE_API_TOKEN`). A person runs this, not an AI agent. For `prod` outside CI it prints the target (Pages project, D1 database, Worker, site URL) and asks you to type `deploy prod`. Use it only when CI is not an option.

## Debugging Patterns

### "User sees a 404"

The SPA's `_redirects` has `/* /index.html 200` — Pages returns HTTP 200 for all paths. A visible "404" is React's `NotFoundPage`, not an HTTP 404. Check `src/web/src/App.tsx` for route definitions.

### "Magic link not working"

```bash
$SCRIPTS/d1-query prod "SELECT * FROM magic_links WHERE registration_id = 1027 ORDER BY id DESC LIMIT 5"
$SCRIPTS/audit-log prod registration 1027
```

- `expires_at` < current epoch ms → expired
- `used_at IS NOT NULL` → already consumed
- `login_failed` then `login_succeeded` seconds apart → initial link expired, fresh one worked
