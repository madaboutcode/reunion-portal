# Glossary

Terms used across the README, the guides and the specs, in alphabetical order. Terms that belong to one feature only (desk user, attendance feed, spot registration) are defined in [docs/specs/glossary.md](./specs/glossary.md).

| Term | Meaning |
|---|---|
| Agent token | A narrow Cloudflare API token for day-to-day reads by you or an AI agent (database reads, storage reads, log tail). It lives in `.env.ops`. It cannot deploy. Compare *deploy token*. |
| Binding | A named connection from the Worker to a Cloudflare resource, such as `DB` for the D1 database or `STORAGE` for an R2 bucket. Bindings are declared in `src/server/wrangler.toml`. |
| Canary | The first item of a batch, run alone. In payment reconciliation the tool verifies or links one payment, and continues with the rest only if that one succeeded. |
| CDN | Content delivery network. Here, a custom domain (for example `cdn.example.com`) in front of a public R2 bucket, used for thumbnails and portraits. |
| CR80 | The standard size of a plastic ID card: 54 x 85.6 mm. The ID-card tool in `scripts/idcard-mailmerge` makes one portrait CR80 card per person. |
| D1 | Cloudflare's hosted SQLite database. The portal keeps all registrations, payments and settings in it. |
| Deploy token | A broader Cloudflare API token that can edit Pages, Workers and D1. It lives only in the CI secret `CLOUDFLARE_API_TOKEN` or in a human's shell for one command. Never in `.env.ops`. |
| Doctor | `make doctor` lists config values that still equal the original Smriti example and checks that the config files agree. `make doctor-strict` fails if any are left. |
| Environment (`stg`, `prod`) | The two copies of the system. Staging (`stg`) is for trying things. Production (`prod`) holds real data. Every ops script takes the environment as an explicit argument. |
| Fail closed | When a required setting is missing, refuse to work instead of guessing. Here, a Worker deployed without `APP_BASE_URL` answers every request with a 500 configuration error. |
| Flag (feature flag) | An on/off switch stored in the database and changed at `/staff/config`, so behavior changes without a deploy. There are nine. |
| Hono | The small web framework the API is written in. |
| Idempotent | Safe to repeat: doing it twice has the same result as doing it once. Repeating a desk check-in does not create a second check-in. |
| JWT | JSON Web Token. A signed login token the browser keeps after you click a magic link and sends with each API call. |
| Magic link | A one-time login link sent by email. The portal has no passwords. A link works once and expires after 10 minutes (payment links: 24 hours). |
| Mailgun | The email service the API uses to send login and payment emails. Required in any deployed environment (see [SECURITY.md](../SECURITY.md)). |
| Migration | A numbered SQL file in `src/server/migrations/` that changes the database structure. Migrations only go forward; an applied one is never edited or deleted. |
| Pages (Cloudflare Pages) | Cloudflare's static site host. It serves the built web app. |
| Pass | The entry pass: a PDF and a page at `/pass` with a QR code. |
| `pass#` | The QR code holds the address `<site>/pass#<code>`. The part after `#` is the registration code, read by the pass page in the browser. |
| PWA | Progressive web app: a website a phone can install like an app. Here only the committee todo page is installable. |
| R2 | Cloudflare's file storage (like Amazon S3). A bucket is one storage space. The portal uses a private bucket for uploads and a public one for thumbnails. |
| Registration code (reg code) | The code that identifies a registration, such as `SMRT...`. Its prefix is the constant `REG_CODE_PREFIX` in `src/shared/src/reg-code.ts`. Do not change it after real registrations exist. |
| Scope | A permission that unlocks one group of staff screens, such as `reports` or `registration_desk`. Admins ignore scopes. |
| Service account (Google) | A robot Google identity. You share a sheet with its email address, and the portal's scripts and API read the sheet through it. |
| Spec | A file in `docs/specs/` that states what a feature must do. It is the source of truth for behavior. |
| Time Travel | A D1 feature that restores a database to any minute in the last 30 days. It is the main backup. |
| UPI | The Indian instant bank-transfer system. Registrants can pay by UPI instead of a bank transfer. |
| UTR | Unique Transaction Reference: the number a bank gives every transfer. Reconciliation matches a payment proof to a bank statement row by UTR. |
| Worker (Cloudflare Worker) | A small program that Cloudflare runs on demand. Here it is the API. |
| wrangler | Cloudflare's command-line tool. It runs the local API, applies migrations and deploys Workers and Pages. |
| Zone | A domain added to your Cloudflare account. The API route (`yourdomain.com/api/*`) needs an active zone. |
