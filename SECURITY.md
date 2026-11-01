# Security

This portal handles registrants' names, phone numbers, photos, ID documents and payment proofs. This page says how to report a vulnerability, what must never be committed, and which defaults to check before you launch. Terms are in the [glossary](./docs/GLOSSARY.md).

## Report a vulnerability

Use GitHub's private vulnerability reporting on this repository: open the repository's Security tab and choose "Report a vulnerability". That sends the report to the repository owner only. If that option is not available, open a GitHub issue that says only that you have a security report and asks for a private way to send it. Do not put details, tokens or personal data in a public issue.

Include what you found, the steps to reproduce it, and which file or endpoint is involved. There is no bug bounty, and no response time is promised; this is a volunteer project.

If you run a fork, you own its security. A report about your own deployment goes to you, not to this repository.

## Files that must never be committed

| Path | Why |
|---|---|
| `.env.ops` | Holds the agent token and optional Google, Mailgun and Gemini keys |
| `src/server/.dev.vars` | Local development secrets |
| `tmp/` | Reports, payment proofs, statement images, staff token files and rosters: names, phone numbers and amounts |
| `scripts/idcard-mailmerge/data/`, `output/`, `proof/` | Attendee names and photos for ID cards |
| Any staff session token file (for example `tmp/staff-jwt.txt`) | It is a live login credential |

These are in `.gitignore`. Check `git status` before every commit. `.env.ops.example` and `src/server/.dev.vars.example` are tracked and must hold no real values. Cloudflare account and database IDs are in `src/server/wrangler.toml` on purpose; they are identifiers, not secrets, but a private fork may still prefer to keep them out of a public repository.

If a secret is committed, treat it as leaked: revoke it at the provider, create a new one, then remove it from history.

## Token scopes

Two Cloudflare API tokens exist and must stay apart.

| Token | Where | Scopes |
|---|---|---|
| Agent token | `.env.ops` | D1 Read, Workers R2 Storage Read, Workers Tail Read. Nothing that edits or deploys. The only token an AI agent may hold |
| Deploy token | The GitHub secret `CLOUDFLARE_API_TOKEN`, or a human's shell for one command | Pages Write, Workers Scripts Write, D1 Write, and zone Workers Routes Write and Zone Read; R2 Write only if the same token sets R2 CORS or uploads reports |

Never put the deploy token in `.env.ops`. Never paste a token into a chat or an issue. Full list: [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md), step 5.

`JWT_SECRET` must be at least 32 characters and different on staging and production. Otherwise a login token from staging works on production.

## Email is required in production

A deployed site must have Mailgun configured (`MAILGUN_API_KEY` and `MAILGUN_DOMAIN`). The portal has no passwords: a login link sent by email is the only way in, so a link works like a password. Without Mailgun, a deployed Worker sends nothing and logs `email is not configured` without the link. Only a local API (`APP_BASE_URL` is `localhost` or `127.0.0.1`) prints links to its log. The result is that a deployed site without Mailgun has no working login. This is deliberate: if the Worker logged links, anyone who could read its logs could sign in as any user, including an admin.

## Public data

Some data is public by design. Know it before launch.

- **Who's coming** (`GET /api/public/whos-coming` and the `/whos-coming` page) shows the full name, branch, city, country and photo of every registration with participation type `full_celebration` or `campus_only`, including registrations that have not paid. There is no consent step. Decide before launch whether that is acceptable, and tell registrants. Options are in [MAKE-IT-YOURS.md](./MAKE-IT-YOURS.md), section 3.6.
- **LED wall data** (`GET /api/public/desk-roster`) lists the names and portrait links of checked-in attendees, with no login.
- **The committee todo page** can be read and written by anyone who has its URL.
- **Thumbnail addresses** use the numeric registration id, so they can be guessed.

Private data (ID documents, payment proofs, original photos) is in a private R2 bucket. Staff with the `dashboard` scope can read it through the API, and every view is written to the audit log.

## Handling live data

Reports, proofs and rosters contain personal data. Keep them in the ignored `tmp/` folder, share them privately, and delete them when the work is done. Upload a report only to a private bucket, never to a public address. Production data is read-only for AI agents unless a human names one specific change. See [ADMIN.md](./ADMIN.md), sections 4 and 8.

A deactivated staff member keeps an already-issued session for up to 7 days. If you must cut access at once, change `JWT_SECRET` for that environment (this signs everyone out).
