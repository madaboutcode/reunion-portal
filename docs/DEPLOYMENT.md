# Deployment guide

How to deploy the reunion portal from zero on your own Cloudflare account, for staging and then production. Do staging first and finish it before you start production. Terms are defined in the [glossary](./GLOSSARY.md).

**What you end up with:** a staging site and a production site, each with a Pages project (the web app), a Worker (the API), a D1 database, two R2 buckets and a domain. Deploys run from GitHub when you push to `release/stg` or `release/prod`.

**The order, in short:** create the Cloudflare resources, write their names and IDs into two config files, set the Worker secrets, create the tokens, run the config check, rehearse with `--dry-run`, then deploy. Change the first-admin email in migration `0003` before any migration touches a remote database.

The names in this repository (`smriti-26-*`, `*-smriti26`, `smriti2026.com`) are the Smriti example names. Replace them with yours. Where this guide shows `yourdomain.com`, `stg-yourproject` and similar, use your own.

## Architecture

```
Browser → Cloudflare CDN
            ├── yourdomain.com       → Cloudflare Pages (static SPA)
            └── yourdomain.com/api/* → Cloudflare Worker (Hono API)
                                        ├── D1 (SQLite database)
                                        ├── R2 (private files + public thumbnails)
                                        └── Images binding (thumbnail generation)
```

| Service | Platform | What it does |
|---|---|---|
| Web (SPA) | Cloudflare Pages | React app: registration wizard, staff dashboard |
| API | Cloudflare Workers | Hono API: registration, payments, auth, file uploads |
| Database | Cloudflare D1 | SQLite: registrations, attendees, payments, audit log |
| File storage | Cloudflare R2 | ID documents, payment proofs and photos (private bucket); 200x200 thumbnails (public bucket) |
| Image resizing | Cloudflare Images | Binding `IMAGES`, makes thumbnails |
| Email | Mailgun | Login links and payment emails. **Required on any deployed site** (see [Production safety](#production-safety)) |

## Where each setting lives

Every setting has one owner file. Do not repeat a value in a second place.

| File | Owns | In git? |
|---|---|---|
| `src/server/wrangler.toml` | Cloudflare infrastructure per environment: account ID, Worker names, routes, D1 names and IDs, R2 bucket names. Top level is staging; `[env.production]` is production. No URL variables. | Yes |
| `site.config.json` | Event name, subtitle, title, sender name, GitHub repo; per environment `siteUrl`, `cdnUrl`, `publicThumbsUrl`, `pagesProject`; reports bucket; attendance sheet ID. Identity and URLs only, never feature switches. | Yes |
| Worker secrets (`wrangler secret put`) | `JWT_SECRET`, `MAILGUN_*`, `GOOGLE_*` on the deployed Worker | Cloudflare |
| `.env.ops` | Operator secrets for scripts: the agent token, `GOOGLE_*`, `MAILGUN_*`, `GEMINI_API_KEY` | No |
| `src/server/.dev.vars` | Local development values only | No |
| CI secret `CLOUDFLARE_API_TOKEN` | The deploy token for GitHub Actions | GitHub |

`scripts/deploy.sh` reads both committed files and gives the Worker its URL variables (`APP_BASE_URL`, `SENDER_NAME`, `PUBLIC_PORTRAITS_URL`, `PUBLIC_THUMBS_URL`) with `wrangler deploy --var`. A deploy that skips `deploy.sh` leaves `APP_BASE_URL` unset, and the Worker then answers every request with a 500 configuration error. This is deliberate: the Worker never guesses a link address.

## Prerequisites

- A Cloudflare account with your domain added as a zone, status Active.
- Node (version in `.node-version`) and `npm ci` run in the repository. `uv` for the config check (`make doctor`).
- A Mailgun account with a verified sending domain and an API key.
- A GitHub repository (your fork) with Actions enabled.
- Log the CLI in once: `npx -w @smriti/server wrangler login`. This opens a browser and lets you create resources in the next step without making an API token first.

The setup steps use your Cloudflare **account ID** and **zone ID**. Both are on the domain's overview page in the dashboard (right sidebar).

## Environment naming

| Environment | Branch | Domain | Resource names (example) |
|---|---|---|---|
| Staging (`stg`) | `release/stg` | `beta.yourdomain.com` | `stg-yourproject` (Pages), `stg-yourproject-api` (Worker), `yourproject-stg` (D1, R2) |
| Production (`prod`) | `release/prod` | `yourdomain.com` | `prod-yourproject`, `prod-yourproject-api`, `yourproject-prod` |

The committed names follow this pattern with `smriti26` and `smriti-26`. Replace them with your own: `scripts/deploy.sh` refuses to deploy while any of them remain (run `make doctor` to list them).

## Step 1: Create the Cloudflare resources

Run these once per environment. Commands run from the repository root.

### 1.1 D1 database

```bash
npx -w @smriti/server wrangler d1 create yourproject-stg
npx -w @smriti/server wrangler d1 create yourproject-prod
```

Write down the `database_id` each command prints.

### 1.2 R2 buckets

Each environment has a private bucket for uploads (binding `STORAGE`) and a public bucket for thumbnails (binding `PUBLIC_THUMBS`).

```bash
npx -w @smriti/server wrangler r2 bucket create yourproject-stg
npx -w @smriti/server wrangler r2 bucket create yourproject-thumbs-stg
npx -w @smriti/server wrangler r2 bucket create yourproject-prod
npx -w @smriti/server wrangler r2 bucket create yourproject-thumbs-prod
```

Give the thumbnails bucket a custom domain in the dashboard (R2, the bucket, Settings, Custom Domains), for example `cdn.yourdomain.com`. That domain is your `publicThumbsUrl`. The CORS rule for the public bucket is in `devops/public-r2-cors.json`:

```bash
npx -w @smriti/server wrangler r2 bucket cors set yourproject-thumbs-prod --file devops/public-r2-cors.json
```

Cloudflare Images needs no setup. The `[images]` block in `wrangler.toml` turns it on.

### 1.3 Pages projects

```bash
npx -w @smriti/portal wrangler pages project create stg-yourproject --production-branch main
npx -w @smriti/portal wrangler pages project create prod-yourproject --production-branch main
```

`scripts/deploy.sh` deploys Pages with `--branch main`, so each project's production branch must be `main`.

## Step 2: Fill in the two config files

### 2.1 `src/server/wrangler.toml` (infrastructure)

Replace every `REPLACE_WITH_*` value, and the example names, with yours. Shape, abridged:

```toml
name = "stg-yourproject-api"          # staging Worker
main = "src/index.ts"
account_id = "your-account-id"        # set once; production inherits it

routes = [
  { pattern = "beta.yourdomain.com/api/*", zone_name = "yourdomain.com" }
]

[[d1_databases]]
binding = "DB"
database_name = "yourproject-stg"
database_id = "your-staging-d1-id"
migrations_dir = "migrations"
migrations_table = "d1_migrations"

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "yourproject-stg"

[[r2_buckets]]
binding = "PUBLIC_THUMBS"
bucket_name = "yourproject-thumbs-stg"

[images]
binding = "IMAGES"

# Production: the same blocks again under [env.production]
# (wrangler does not inherit routes or bindings).
[env.production]
name = "prod-yourproject-api"
routes = [
  { pattern = "yourdomain.com/api/*", zone_name = "yourdomain.com" }
]
# [[env.production.d1_databases]], [[env.production.r2_buckets]] (STORAGE and PUBLIC_THUMBS),
# [env.production.images]
```

The file has no `[vars]` section and no URL variables. Do not add them: `make doctor` reports an error if you do.

### 2.2 `site.config.json` (identity and URLs)

| Key | Set it to |
|---|---|
| `eventName`, `eventSubtitle`, `eventTitle` | Your event's name, subtitle and report title |
| `senderName` | The display name on emails (the address is `noreply@<your Mailgun domain>`) |
| `githubRepo` | `owner/repo` of your fork (used by the `ci` script) |
| `environments.stg.siteUrl`, `environments.prod.siteUrl` | `https://beta.yourdomain.com`, `https://yourdomain.com` |
| `environments.<env>.cdnUrl` | The host that serves portraits, at `<cdnUrl>/portraits` |
| `environments.<env>.publicThumbsUrl` | The custom domain of the thumbnails bucket. Optional: without it the Worker serves thumbnails through `/api/public/photos` |
| `environments.<env>.pagesProject` | The Pages project name from step 1.3 |
| `reports.bucket`, `reports.prefix` | A **private** bucket for uploaded reports. Leave `bucket` empty to keep reports local |
| `sheets.attendance.*` | Only if you use `scripts/sync_attendance.py` |

Then run `make doctor` and clear every line under `Agreement and required settings`. `make doctor` is informational. It lists example values still present and checks that the files agree: route hosts against `siteUrl`, and Pages names against `pagesProject`. Branding copy in the web app and emails stays on the list until you rebrand ([MAKE-IT-YOURS.md](../MAKE-IT-YOURS.md)).

### 2.3 Change the first admin before the first remote migration

Migration `0003_users_and_auth.sql` inserts the first admin. Edit its email from `admin@example.com` to your own address now. Every deploy runs `wrangler d1 migrations apply --remote`, including the first one in CI. A later edit to the file does not change a database that already ran it. Afterwards, staff are added at `/staff/team`; admins can only be created by a migration.

## Step 3: DNS and domains

### Staging (subdomain)

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"beta","content":"stg-yourproject.pages.dev","proxied":true}'
```

Or in the dashboard: DNS, Add record, CNAME, `beta`, `stg-yourproject.pages.dev`, Proxied. This needs a token with DNS Write on the zone; the dashboard route does not.

### Production (apex domain)

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"@","content":"prod-yourproject.pages.dev","proxied":true}'
```

### www redirect

Create a CNAME for `www` to `prod-yourproject.pages.dev` (proxied). Then in the dashboard, Rules, Redirect Rules, create a rule: when hostname equals `www.yourdomain.com`, redirect dynamically to `https://yourdomain.com${http.request.uri.path}` with status 301. The deploy and admin API tokens cannot create this rule; it needs the separate Redirect Rules permission, so do it in the dashboard.

### Pages custom domains

Register each domain with its Pages project so Cloudflare issues the SSL certificate:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCT_ID/pages/projects/stg-yourproject/domains" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"beta.yourdomain.com"}'
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCT_ID/pages/projects/prod-yourproject/domains" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"yourdomain.com"}'
```

SSL validates by itself when the zone is in the same Cloudflare account. It can take a few minutes.

## Step 4: Worker secrets

Set these on each environment's Worker. Each command asks for the value and does not echo it.

| Secret | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | At least 32 characters. Signs login tokens. Use a different value per environment. |
| `MAILGUN_API_KEY` | Yes on a deployed site | Mailgun API key. Without it nobody can log in (see [Production safety](#production-safety)). |
| `MAILGUN_DOMAIN` | Yes on a deployed site | The verified Mailgun sending domain. |
| `GOOGLE_SA_KEY` | No | Base64 of a Google service-account JSON key. Enables the prediction data source and committee todos. |
| `GOOGLE_SPREADSHEET_ID` | No | Prediction contest sheet (needs `GOOGLE_SA_KEY`). |
| `GOOGLE_COMMITTEE_SHEET_ID` | No | Committee todo sheet (needs `GOOGLE_SA_KEY`). Without it `/api/committee` returns 404. |
| `EMAIL_ALLOWED_DOMAINS` | No | Comma-separated list of recipient domains; mail to others is not sent. |

```bash
openssl rand -base64 36                                    # make a JWT secret

cd src/server
npx wrangler secret put JWT_SECRET                         # staging
npx wrangler secret put MAILGUN_API_KEY
npx wrangler secret put MAILGUN_DOMAIN

npx wrangler secret put JWT_SECRET --env production        # production
npx wrangler secret put MAILGUN_API_KEY --env production
npx wrangler secret put MAILGUN_DOMAIN --env production
```

If the Worker was never deployed, `wrangler secret put` creates an empty Worker with that name. That is fine; the first deploy replaces it. A deploy never removes secrets.

Keep staging and production `JWT_SECRET` values different. If they match, a login token minted on staging also works on production.

## Step 5: Tokens

Two Cloudflare API tokens, kept apart. Create them at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

| Token | Lives in | Used for | Permissions |
|---|---|---|---|
| **Deploy token** | GitHub Actions secret `CLOUDFLARE_API_TOKEN`; or a human's shell for one command | `scripts/deploy.sh`, migrations, R2 writes | Account: Pages Write, Workers Scripts Write, D1 Write (migrations). Zone: Workers Routes Write, Zone Read. Add Workers R2 Storage Write only if this token also sets R2 CORS or uploads reports |
| **Agent token** | `.env.ops` as `CLOUDFLARE_API_TOKEN` | `d1-query`, `worker-logs`, `audit-log`, report scripts, reconciliation reads | Account: D1 Read, Workers R2 Storage Read, Workers Tail Read. Nothing that edits or deploys |

Add DNS Write (zone) to whichever token you use for the DNS commands in step 3, or do step 3 in the dashboard.

- **CI needs one secret only:** `CLOUDFLARE_API_TOKEN` (the deploy token). There are no repository variables.
- **Never put the deploy token in `.env.ops`.** `scripts/deploy.sh` reads it from the process environment only. To deploy from your machine, read the token without echo for one command: `read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN && scripts/deploy.sh stg server; unset CLOUDFLARE_API_TOKEN`. A person runs this, not an AI agent.
- Set up the agent token: `cp .env.ops.example .env.ops`, then paste the token after `CLOUDFLARE_API_TOKEN=`. Scripts load the file themselves. A variable already exported in your shell wins over the file.
- Cloudflare may refuse queries from a read-only D1 token (not verified). If you had to grant D1 Edit to the agent token, that token can write to production: the read guard covers only d1-query, not direct wrangler commands, so rely on the agent rules in ADMIN.md section 8. See [ADMIN.md section 8](../ADMIN.md#8-production-safety-rules) and [.claude/skills/devops/SKILL.md](../.claude/skills/devops/SKILL.md).

## Step 6: GitHub Actions

`.github/workflows/deploy.yml` runs on pushes to `release/stg` and `release/prod`. It runs `make check`, downloads fonts, checks that debug code is not in the production bundle, then runs `scripts/deploy.sh <env> all`. It expects `package.json`, `package-lock.json` and `.node-version` at the repository root.

Create two GitHub environments (Settings, Environments): `staging` (no rules) and `production` (optionally add required reviewers). Then set the secret on each:

```bash
gh secret set CLOUDFLARE_API_TOKEN --env staging
gh secret set CLOUDFLARE_API_TOKEN --env production
```

Create the release branches once:

```bash
git branch release/stg main
git branch release/prod main
git push origin release/stg release/prod
```

Do not push both at first: the push to `release/stg` deploys staging immediately, and the push to `release/prod` deploys production. Finish steps 7 and 8 on staging first, then create `release/prod`.

CI runs `make check` only, not the test suites. Run `make test` before you merge to a release branch.

## Step 7: Check the setup, then rehearse

```bash
make doctor                              # no lines under "Agreement and required settings"
scripts/deploy.sh stg all --dry-run      # builds, bundles the Worker, prints every command
```

`--dry-run` needs no token and changes nothing in Cloudflare. It prints the target (Pages project, D1 database, Worker, R2 bucket, site and CDN URLs) and the exact `wrangler` commands, including each `--var` value. A missing or placeholder key stops it with a message that names the key and the file that owns it.

Not covered by the dry run: `wrangler pages deploy` has no dry-run mode, so the Pages upload itself first runs in the real deploy.

Before production launch, run the strict check:

```bash
make doctor-strict
```

It exits non-zero while any Smriti example value remains in the config files, code, static files or branding copy, or while a `REPLACE_WITH_*` value or the `.env.ops` token is missing. A fork should pass it before it opens registration.

## Step 8: First deploy

Deploy staging through CI: merge `main` into `release/stg` and push.

```bash
git checkout release/stg && git merge main && git push origin release/stg
gh run list --workflow=deploy.yml        # then: gh run watch <id>
```

If your connection drops while you watch, re-attach with `gh run watch`. Do not push again.

By hand (when CI is not an option), with the deploy token typed at the hidden prompt:

```bash
read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN && scripts/deploy.sh stg all; unset CLOUDFLARE_API_TOKEN
```

A person runs this, not an AI agent. For `prod` outside CI the script prints the target and asks you to type `deploy prod`.

What the deploy does, in order:
1. Reads the environment's settings from the two config files.
2. Builds the web app with Vite (mode `staging` or `production`), which fills canonical URLs, Open Graph tags, security headers, `robots.txt` and `sitemap.xml` from `site.config.json`.
3. Deploys the web app to Pages with `--project-name <pagesProject> --branch main`.
4. Applies D1 migrations to the remote database.
5. Deploys the Worker with `--var APP_BASE_URL:<siteUrl> --var SENDER_NAME:<senderName> --var PUBLIC_PORTRAITS_URL:<cdnUrl>/portraits` and, if set, `--var PUBLIC_THUMBS_URL:<publicThumbsUrl>`. Variables set in the dashboard are replaced, because wrangler deletes variables not given on the command line. Secrets are untouched.

Repeat steps 7 and 8 for production with `release/prod` after staging works.

## Step 9: Verify

```bash
DOMAIN="beta.yourdomain.com"             # or yourdomain.com for production

curl -s https://$DOMAIN/api/health                       # {"ok":true}
curl -s https://$DOMAIN/api/config/pricing | head -c 100 # JSON with pricing fields
curl -s -o /dev/null -w "%{http_code}" https://$DOMAIN   # 200
curl -s -o /dev/null -w "%{http_code}" https://$DOMAIN/register   # 200 (the SPA serves every path)
curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
  -H "Origin: https://$DOMAIN" -H "Access-Control-Request-Method: POST" \
  https://$DOMAIN/api/registrations                      # 204
curl -sI https://$DOMAIN | grep -iE "x-frame|x-content|referrer|strict-transport|permissions"
curl -sI https://www.$DOMAIN | grep -i location          # production only: https://yourdomain.com/
curl -s -o /dev/null -w "%{http_code}" https://$DOMAIN/api/staff/registrations   # 401
curl -s -o /dev/null -w "%{http_code}" https://$DOMAIN/api/debug                  # 404
```

Expected security headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `Referrer-Policy`, `Permissions-Policy`.

Then in a browser:
1. Open `/login`, enter your admin email and confirm the login email arrives. Production login links are only sent by email. They are not logged. The "Generate login link" button at `/staff/team` needs an admin who is already logged in, so it cannot help the first admin. If the first admin's email does not arrive, the only fix is to get Mailgun working: sending domain verified, DNS records in place, and the `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` secrets set on the Worker for that environment (step 4). There is no backdoor login.
2. Open `/staff/config` and switch on `registration_show_page` and `registration_accept_new`.
3. Walk the registration wizard to the payment step.

If `/api/health` answers 500 with "Server configuration error: APP_BASE_URL is not set", the Worker was deployed without `deploy.sh`. Redeploy through `deploy.sh` or CI.

## Production safety

**Mailgun is required on every deployed site, staging included.** Without `MAILGUN_API_KEY` and `MAILGUN_DOMAIN`, the Worker sends no email. It prints a login link to its log only when `APP_BASE_URL` is a local address (`localhost` or `127.0.0.1`). On any deployed address it logs the error `email is not configured` and leaves the link out. The reason: a login link is a password for that account, and anyone who can read the Worker log (`wrangler tail`, the dashboard, a log export) could log in as an admin if links were logged. So a deployed site without Mailgun has no working login, including for the first admin. Set up Mailgun before step 9.

Other rules:
- Try every step on staging first.
- Keep `JWT_SECRET` different per environment.
- Edit the admin seed in migration `0003` before the first remote migration (step 2.3).
- Take a Time Travel bookmark before a bulk change (see [Backups](#backups)).
- Production data is read-only for AI agents unless a human names one change. Give agents the agent token only.

## Environment variables reference

### Build time (Vite)

| Variable | Default | Description |
|---|---|---|
| `VITE_ENABLE_DEBUG` | `false` | Includes the `/debug/*` pages in the bundle. `false` (production): the debug code is removed from the bundle, and `scripts/assert-debug-excluded.sh` checks this on every deploy. `true` (staging, set by CI): the debug code ships but renders only for an admin session with the `debug_tools` flag on. |

The web build takes URLs from `site.config.json` through the Vite mode: `production` uses `environments.prod`, `staging` uses `environments.stg`. `make dev` uses `http://localhost:5173` with the staging CDN hosts.

### Worker runtime

| Variable | Set by | Description |
|---|---|---|
| `JWT_SECRET` | `wrangler secret put` | Token signing key, at least 32 characters |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` | `wrangler secret put` | Email delivery. Required on a deployed site |
| `EMAIL_ALLOWED_DOMAINS` | secret or variable | Recipient-domain allow-list |
| `GOOGLE_SA_KEY`, `GOOGLE_SPREADSHEET_ID`, `GOOGLE_COMMITTEE_SHEET_ID` | `wrangler secret put` | Google Sheets features (optional) |
| `APP_BASE_URL` | `deploy.sh` (`--var`, from `siteUrl`) | Required. Base address of login and payment links, and the one allowed browser origin (CORS). Local development also allows `http://localhost:5173` and `http://127.0.0.1:5173`. Missing or invalid: every request returns a 500 configuration error. |
| `SENDER_NAME` | `deploy.sh` (`--var`, from `senderName`) | Required when Mailgun is configured. Display name on email |
| `PUBLIC_THUMBS_URL` | `deploy.sh` (`--var`, from `publicThumbsUrl`) | Optional. Public address of the thumbnails bucket. Unset: thumbnails come through `/api/public/photos` |
| `PUBLIC_PORTRAITS_URL` | `deploy.sh` (`--var`, `<cdnUrl>/portraits`) | Public address prefix for portraits |
| `LOG_LEVEL` | variable | Logger verbosity |
| `RATE_LIMIT_{UPLOAD,AUTH,MUTATION,QUERY,PHOTO}_{MAX,WINDOW_MS}` | variable | Rate-limit overrides |
| `ENVIRONMENT` | `.dev.vars` only | `development` locally turns on the debug API and turns rate limits off |

The security headers of the web app (Content-Security-Policy and others) are generated at build time from `site.config.json`, so a rename needs no hand edit. The API's own Content-Security-Policy lists the origins of `PUBLIC_THUMBS_URL` and `PUBLIC_PORTRAITS_URL`.

### Bindings (declared in `wrangler.toml`)

| Binding | Type | Description |
|---|---|---|
| `DB` | D1 database | SQLite database |
| `STORAGE` | R2 bucket | Private uploads (ID documents, proofs, photos) |
| `PUBLIC_THUMBS` | R2 bucket | Public 200x200 thumbnails |
| `IMAGES` | Cloudflare Images | Thumbnail generation (thumbnails are skipped if the binding is missing) |

## Backups

D1 has **Time Travel**: a 30-day rolling point-in-time recovery window, on by default. Restoring replaces the whole database, so note the current bookmark first.

```bash
# Show the current bookmark
npx -w @smriti/server wrangler d1 time-travel info yourproject-prod --env production

# Restore to a point in time (use a UTC timestamp from the last 30 days)
npx -w @smriti/server wrangler d1 time-travel restore yourproject-prod \
  --env production --timestamp="YYYY-MM-DDTHH:MM:SSZ"
```

R2 has no automatic versioning. Export critical files on a schedule if you need them.

## Rate limiting

The API counts requests in memory, per IP address and per Worker instance.

| Category | Max requests | Window | Applied to |
|---|---|---|---|
| auth | 10 | 1 minute | Login-link requests, link verification and payment-link requests, per IP address |
| mutation | 10 | 1 minute | Registration submissions |
| upload | 15 | 1 hour | File uploads |
| query | 30 | 1 minute | GET requests |
| photo | 200 | 1 minute | Photo reads |
| Magic link per address | 3 | 10 minutes | Login links for one email address. Further requests get a normal-looking reply and no email. Counted in the database, not overridable by variable. |

Override the first five with Worker variables, for example `RATE_LIMIT_AUTH_MAX=5`. The in-memory counters are per Worker instance, not shared across Cloudflare's edge, so under heavy load limits are not strict. For about 250 users this is fine. For more, use Cloudflare's own rate-limiting rules. The per-address limit is stored in the database and holds regardless.

## Troubleshooting

| Problem | What to check |
|---|---|
| Every API call returns 500 "Server configuration error: APP_BASE_URL is not set" | The Worker was deployed without `deploy.sh`. Redeploy with `scripts/deploy.sh <env> server` or through CI. |
| `deploy.sh` stops naming a key and a file | A value in `site.config.json` or `wrangler.toml` is missing or still `REPLACE_WITH_*`. Fix it in the file named, then run `make doctor`. |
| Worker returns 522 or 523 | The Worker is not deployed yet, or the route in `wrangler.toml` does not match the domain. |
| CORS errors in the browser | `APP_BASE_URL` (from `siteUrl`) does not match the address in the browser bar. Fix `siteUrl` and redeploy. |
| No login email arrives | Check `MAILGUN_API_KEY` and `MAILGUN_DOMAIN`, and that the Mailgun domain is verified. With no Mailgun settings the log shows `email is not configured` and no link. Check junk mail. |
| Login link opens the wrong domain | Links use `APP_BASE_URL`. Check `siteUrl` for that environment and redeploy through `deploy.sh`. |
| Cannot log in as the first admin | The seed email in migration `0003` is the one that ran. If the database already ran the file, add staff from `/staff/team` or write a new forward migration. |
| D1 migration fails | The deploy token needs D1 Write. Migrations run during `deploy.sh`. |
| Pages 404 on routes | `src/web/public/_redirects` must contain `/* /index.html 200`. Check it is in the build output. |
| SSL certificate pending | Pages custom domains issue SSL when the CNAME points to `*.pages.dev` and the zone is in the same account. Allow a few minutes. |
| Commit on `main` changed nothing | CI deploys only from `release/stg` and `release/prod`. Merge into the release branch. |
