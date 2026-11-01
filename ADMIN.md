# Running your reunion with this portal: operations guide

This guide is for the organizers who run the event after the portal is deployed, and for the AI agents they hand this file to. It covers setup, payments, reports, rooms, event day and what comes after. It does not cover building or deploying the site; for that see [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md), and for changing names, dates, prices and branding see [MAKE-IT-YOURS.md](./MAKE-IT-YOURS.md). Terms you may not know (D1, R2, UTR, canary, scope) are in the [glossary](./docs/GLOSSARY.md).

Three rules apply to everything below.

1. **Staging first.** Try every new step on the staging site, then repeat it on production. Production holds real money and real people's data. Every script takes `stg` or `prod` as an explicit argument; none has a default.
2. **Production data is read-only for AI agents** unless a human gives permission for one specific change (see [section 8](#8-production-safety-rules)).
3. **Reports contain names, phone numbers and amounts.** Keep them in the git-ignored `tmp/` folder. Never publish them at a public URL and never commit them. Share them privately (see [section 4](#4-reports)).

Run every command from the repository root unless a section says otherwise.

How sure each statement is: the original team ran the workflows in sections 3, 5 and 6 on a real event (Smriti 2026, event date 2026-08-15). Where this guide says "not run", "not verified" or "inferred", nobody checked it against a live site. [Section 11](#11-what-is-not-verified) lists those items together.

## Where to look

| You need to... | Go to |
|---|---|
| Set up tools, tokens, staff accounts, flags | [1. Setup once](#1-setup-once) |
| Know what to do this week | [2. Timeline](#2-timeline) |
| Match a bank statement to registrations, fix a payment | [3. Payments and reconciliation](#3-payments-and-reconciliation) |
| Produce a list, sheet or count | [4. Reports](#4-reports) |
| Assign hotel rooms | [5. Rooms](#5-rooms) |
| Run the desk, the LED wall, ID cards | [6. Event day](#6-event-day) |
| Open stories, magazine, photos, refunds after the event | [7. After the event](#7-after-the-event) |
| Know what an AI agent may do | [8. Production safety rules](#8-production-safety-rules) |
| Copy a prompt for an agent | [9. Working with AI](#9-working-with-ai-for-ops) |
| Fix something that broke | [10. Troubleshooting](#10-troubleshooting) |

---

## 1. Setup once

### 1.1 Tools to install

| Tool | Needed for | Required |
|---|---|---|
| `uv` | Runs every Python script (`uv run scripts/<name>.py`) and `make doctor`. It installs each script's dependencies itself. Install: `curl -LsSf https://astral.sh/uv/install.sh \| sh`, or see [docs.astral.sh/uv](https://docs.astral.sh/uv/getting-started/installation/). | Yes |
| Node.js (version in `.node-version`) and `npm install` | `wrangler`, the ID-card layout editor, the Mailgun test script | Yes |
| `wrangler` (Cloudflare CLI) | The devops scripts (`d1-query`, `worker-logs`) and `scripts/deploy.sh` call it. It is installed by `npm ci` inside the workspaces; run it as `npx -w @smriti/server wrangler ...` from the repository root. | Yes |
| `gh` (GitHub CLI), logged in | `.claude/skills/devops/scripts/ci` shows deploy status. | Recommended |
| Claude Code (or another agent that reads `.claude/skills/`) | The `payment-reconcile` and `devops` skills, and the `extract-statement` workflow | Recommended |
| `agent-browser` | Only the browser smoke test in `scripts/ui/scenarios/smoke_registration.py`. Not needed to run the event. | Optional |

### 1.2 Where the scripts get their settings

Three places, each with one job. Scripts and skills read them for you; you do not `source` anything.

| File | Holds | In git? |
|---|---|---|
| `src/server/wrangler.toml` | Cloudflare resources: account ID, Worker, D1 database, R2 buckets | Yes |
| `site.config.json` | Event name and title, site and CDN URLs, Pages project, report bucket, attendance sheet ID | Yes |
| `.env.ops` | Secrets only: the agent token and optional Google, Mailgun and image-generation keys | No |

Set up `.env.ops` once:

```bash
cp .env.ops.example .env.ops      # .env.ops is git-ignored; never commit it
# edit .env.ops: paste the agent token after CLOUDFLARE_API_TOKEN=
make doctor                       # checks the files and lists anything missing
```

A variable already exported in your shell wins over the line in `.env.ops`. A missing setting stops the command with a message that names the key and the file that owns it, before any request is made. `d1-query` also stops while any `REPLACE_WITH_*` value remains in `wrangler.toml`.

| Tool | Reads |
|---|---|
| Report scripts (`allocate-rooms.py`, `build-desk-roster.py`, `build-payment-pending-report.py`, `build-tshirt-size-report.py`, `query-accommodation-stats.py`, `whos-coming.py`) | Account and D1 database from `wrangler.toml` for the chosen `--env`; the agent token; `eventName` and `eventSubtitle` from `site.config.json` where a report prints them. `whos-coming.py` also reads the R2 buckets |
| `d1-query`, `audit-log`, `worker-logs` | The agent token; D1 and Worker names from `wrangler.toml` |
| `scripts/deploy.sh`, `make stg-*` | Both committed files; the deploy token from the process environment only |
| `reconcile` and `reconcile.py` (payment reconciliation) | The agent token; D1 and R2 from `wrangler.toml`; `siteUrl`, `eventTitle`, `reports.*` from `site.config.json`; the registration-code prefix from `src/shared/src/reg-code.ts`; plus a staff token file |
| ID-card scripts | The agent token and `cdnUrl` for `make dump ENV=prod`; `cdnUrl` for `make editor ENV=prod` |
| Google Sheets scripts (`sync_attendance.py`, `compute-awards-v2.py`, `committee-todo-cli.py`) | `GOOGLE_SA_KEY` and the sheet IDs from `.env.ops`, then from `src/server/.dev.vars`; the attendance sheet ID from `site.config.json` |

**Every script takes the environment explicitly.** Reports use `--env stg|prod`, `d1-query` and the other devops scripts take `stg` or `prod` as the first argument, `reconcile` takes it as an argument, and the ID-card `make` targets take `ENV=stg|prod`. There is no default. A prod command prints its target (database, Worker, bucket, URL) before it acts. Reports only read data, but pass `--env stg` while you test.

### 1.3 Cloudflare API tokens

Create tokens at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens). The full permission list is in [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md), step 5. Keep two tokens apart:

| Token | Permissions | Lives in | Use for |
|---|---|---|---|
| Agent token | D1 Read, Workers Tail Read, Workers R2 Storage Read | `.env.ops` | Reports, `d1-query`, `worker-logs`, proof downloads, reconciliation reads. The only token an AI agent may hold |
| Deploy token | Pages Write, Workers Scripts Write, D1 Write; add Workers R2 Storage Write for R2 CORS and report upload | The CI secret `CLOUDFLARE_API_TOKEN`; or your shell for one command | `scripts/deploy.sh`, migrations, R2 CORS, report upload |

Never put the deploy token in `.env.ops`, and never export it in a shell an AI agent can read. To deploy by hand, type the token at a hidden prompt: `read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN && scripts/deploy.sh stg server; unset CLOUDFLARE_API_TOKEN`. A person runs this, not an AI agent.

Cloudflare may not let a read-only token run D1 queries. `d1-query` therefore refuses any SQL that is not a read unless you pass `--write`, and a prod write outside CI asks you to type `write prod`. That guard stops mistakes. If you had to grant D1 Edit to the agent token, that token can write to production: the read guard covers only d1-query, not direct wrangler commands, so rely on the agent rules in ADMIN.md section 8. `cf-token` shows whether the token is set (masked) and from which source; `cf-token --verify` asks Cloudflare whether it is valid.

### 1.4 Staff and admin accounts

Staff sign in with a magic link sent to their email. Their address must already exist as a user.

| Account type | How it is created |
|---|---|
| Admin | Only through database migration `src/server/migrations/0003_users_and_auth.sql`, which seeds one admin address (`admin@example.com` in this repo). Change it to your own address before the first migration. After that you cannot add admins from the site. |
| Staff | An admin adds them at `/staff/team` (admin only): email, name and scopes. |

At `/staff/team` an admin can also resend an invite or generate a login link. The generated link works for 10 minutes and sends no email. Login links sent to attendees also last 10 minutes; payment links last 24 hours.

**Mailgun must be set up on a deployed site.** Without it the server sends no email, and a deployed Worker does not write login links to its log: it logs `email is not configured` and leaves the link out, because anyone who can read the log could otherwise log in. Only a local API prints links. If login emails do not arrive, see [section 10](#10-troubleshooting). The "Generate login link" button at `/staff/team` still works for staff without email.

**Removing a staff member.** Deactivating a staff user at `/staff/team` stops new logins. A session that already exists keeps working until its token expires, up to 7 days. To cut access at once, change `JWT_SECRET` for that environment, which signs everyone out (inferred from how tokens are signed; not run). A change to a person's scopes takes up to 5 minutes to reach a session that is already open (see below).

A staff member sees only the pages their scopes allow. An admin ignores scopes. A staff user whose permissions are empty sees no feature pages. Scope changes can take up to 5 minutes to reach an open session (inferred from the 300-second cache in `auth.middleware.ts`; not run).

| Scope | Pages it unlocks | Typical person |
|---|---|---|
| `dashboard` | `/staff/dashboard`, registration details, `/staff/refunds`, `/staff/coming`, `/staff/archived`; verify and reject payments | Finance lead, treasurer |
| `bank_txns` | `/staff/bank-transactions` (import and link statements) | Finance lead |
| `registration_desk` | `/staff/check-in` | Desk volunteers (give this scope only) |
| `allocation` | `/staff/allocation` (room preferences and groups) | Accommodation lead |
| `resources` | `/staff/resources`, `/staff/rooms` (room inventory) | Accommodation lead |
| `reports` | `/staff/reports` | Committee |
| `admin-tools` | `/staff/tools`, `/staff/daily-report`, thumbnail regeneration | Event-day lead |

Two things to know. `/staff/tools` and `/staff/daily-report` are not in the navigation menu; open them by typing the address. The daily report page needs `admin-tools`, but the data it loads needs `reports` and `dashboard` as well. Give the person all three, or use an admin (inferred from code; not run).

The Admin menu holds `/staff/team` and `/staff/config`. Both are admin only.

### 1.5 Feature flags

Flags switch parts of the public site on and off without a deploy. An admin sets them at `/staff/config`. Each switch saves on its own.

**Every flag is off until someone turns it on.** The code defines the list of flags and a default (`off`) for each in `src/shared/src/feature-flags.ts`. A flag with no row in the database counts as off. The original production site had 4 catalog flags with no database row. When the site and the config page disagree, check the database:

```bash
.claude/skills/devops/scripts/d1-query prod "SELECT * FROM feature_flags"
```

| Flag | What it controls | Turn it on |
|---|---|---|
| `registration_show_page` | The registration form page. Off: `/register` and `/new` show "registration unavailable", and the "Register Now" buttons on the home, connect and who's-coming pages are hidden. | At launch, before `registration_accept_new`. Turn it off after the event. |
| `registration_accept_new` | New submissions. Off: the form says "registration closed" and `POST /api/registrations` returns 403. | At launch. Turn it off at your registration deadline. |
| `navigation_show_register` | The Register button in the top navigation bar. | At launch with the two above. |
| `navigation_show_my_pass` | The "My Pass" link in the navigation bar for confirmed attendees. | When passes are ready, in the last weeks before the event. |
| `memories_show_stories` | The public stories page and its read API. | After the event. |
| `memory_stories_accept_submissions` | Whether signed-in users can write and edit stories. | After the event. |
| `navigation_show_stories` | The "Autograph" link in the navigation bar. | After the event, once the page is open. |
| `homepage_show_memory_stories` | The "In Our Own Words" story preview on the home page. | After the event, once some stories are approved. |
| `debug_tools` | Debug routes for admins. | Staging only. Leave off in production. |

Gate every entry point. In the original event, the home page "Register Now" buttons were plain links that ignored the flags until a later fix. In this repo the home page reads `registration_show_page`. After you flip a flag, load the home page, the nav and the direct URL in a private browser window to confirm.

The suggested order for the four stories flags, `memories_show_stories`, `memory_stories_accept_submissions`, `navigation_show_stories`, `homepage_show_memory_stories`, is the order of the table: the page first, then submissions, then the links. This order is a suggestion; the original team did not record theirs.

Flip flags through the page, not through SQL. A direct database edit leaves no audit row.

---

## 2. Timeline

Phases are relative to your event day. The weekly payment rhythm below is a suggestion; the original sessions do not record how often the team reconciled.

| Phase | Tasks | Where |
|---|---|---|
| **Before launch** | Create tokens, fill `.env.ops`, run `make doctor-strict`, change the seeded admin address. Set up Mailgun. Add staff accounts. Set your bank and UPI details in code (see `MAKE-IT-YOURS.md`). Send one test email. Walk the wizard on staging. | [1](#1-setup-once), [10](#10-troubleshooting) |
| **Launch** | Turn on `registration_show_page`, `registration_accept_new`, `navigation_show_register`. | [1.5](#15-feature-flags) |
| **Weeks before** | Reconcile payments regularly (suggest weekly). Publish the payment-pending report privately to chasers. Check accommodation counts and the t-shirt order. Who's Coming is public by default (see section 4); decide that before launch. | [3](#3-payments-and-reconciliation), [4](#4-reports) |
| **Last week** | Close registration (`registration_accept_new` off) on your deadline. Final reconcile. Run room allocation and send the hotel sheet. Build the desk roster and print it. Build ID cards and print one test card. Turn on `navigation_show_my_pass`. Test the LED wall on staging. Precache LED wall photos on the wall machine. | [3](#3-payments-and-reconciliation), [5](#5-rooms), [6](#6-event-day) |
| **Event day** | Desk check-in and spot registration, desk payments, LED wall, live logs, daily report. Reconcile again if money arrives. | [6](#6-event-day) |
| **After** | Turn on the stories flags. Moderate stories. Publish the magazine. Clear refunds. Reconcile income and expenses. Archive or delete personal data you no longer need. | [7](#7-after-the-event) |

---

## 3. Payments and reconciliation

### 3.1 How payment works

There is no payment gateway. A registrant pays by bank transfer or UPI to the account you set up, then uploads a screenshot (the proof) on their payment page.

| Step | What happens | Who |
|---|---|---|
| 1 | Registrant submits the wizard. Registration status is `pending`. They get a payment page at `/pay/<reg code>`. | Registrant |
| 2 | They transfer the money and upload proof. Status becomes `pending_verification`. | Registrant |
| 3 | Staff match the transfer to the bank statement and verify the payment. Status becomes `confirmed`. | Staff |
| 4 | If the proof is wrong, staff reject it. The payment goes back to payment pending and the registrant is emailed a new payment link. | Staff |

Payment status gates only desk check-in: the desk refuses a check-in while money is outstanding. It does not control who appears on the public who's coming page, whether someone can download the entry pass, or who appears on the LED wall (that needs a desk check-in).

Staff can verify one payment by hand on the registration page (`dashboard` scope). The tools below exist for doing it in batches against the bank statement, and for the odd cases.

### 3.2 The reconciliation loop

This is the loop the original team ran, in this order. The first time, run the whole loop on staging.

**What you need once:**

- A staff token in `tmp/staff-jwt.txt` (see [3.5](#35-the-staff-token)).
- For SBI HTML exports, the `ACCOUNT_*` constants edited once at the top of `scripts/convert-sbi-html-to-text.py` (account name, address, number, branch, IFS code). The script refuses to run while any is still a placeholder, and names which ones.

**Each round.** `$PY` stands for `.claude/skills/payment-reconcile/scripts/reconcile.py`, so `uv run $PY pending prod` means `uv run .claude/skills/payment-reconcile/scripts/reconcile.py pending prod`. Use `stg` in place of `prod` on staging.

| Step | Action | Command or place |
|---|---|---|
| 1 | Export the account statement from SBI YONO as HTML. Save it as `tmp/statement.html`. | Bank website |
| 2 | Convert it to SBI text. | `uv run scripts/convert-sbi-html-to-text.py tmp/statement.html --output tmp/statement.txt` |
| 3 | Import the `.txt` in the staff UI. A person does this step; the scripts do not. The server removes duplicates by a SHA-256 hash of date, description and amount, so re-importing the same file is safe and the result shows how many rows were new and how many skipped. | `/staff/bank-transactions` (scope `bank_txns`) |
| 4 | List registrations and refunds still open. | `uv run $PY pending prod` |
| 5 | Download proof images for payments waiting for verification. They land in `tmp/proofs/`. | `uv run $PY download-proofs prod` |
| 6 | Have an agent read each proof image and write `tmp/proofs.json` (UTR, amount, date, time, sender, method). One agent per image worked. The prompt is in `.claude/skills/payment-reconcile/SKILL.md`, Step 2. | Agent |
| 7 | Match proofs to bank rows. Show the matches; verify nothing yet. | `uv run $PY prematch prod --proof-data tmp/proofs.json` |
| 8 | A person reviews the proposed matches and the unmatched rows. | You |
| 9 | Write a manifest (`tmp/manifest-<date>.json`) with the approved `links` and `verified_today` entries. The format is in the skill, Step 4. | You or agent |
| 10 | Verify payments. One payment goes first (the canary); the rest continue only if it succeeds. | `uv run $PY verify ./tmp/manifest-<date>.json prod` |
| 11 | Link bank rows to the payments. Canary first again. Linking does not change payment status. | `uv run $PY link ./tmp/manifest-<date>.json prod` |
| 12 | Build the status report. | `uv run $PY report ./tmp/manifest-<date>.json prod` |
| 13 | Delete `tmp/staff-jwt.txt` and `tmp/proofs/`. | `rm tmp/staff-jwt.txt` |

Notes on the loop:

- **Prematch matches only when sure.** It matches on a UTR of at least 8 characters found in the bank row; on sender name plus amount; or on a registration code plus amount. Amount-only and name-only guesses appear as hints and are never matched. If one bank row matches several registrations, all of them are demoted to unmatched with a warning.
- **Verify first, then link.** Verification is what confirms the registration. A link is a bookkeeping record. If a link fails, the verified payment stays verified. Without the link, the bank row stays "unreconciled" and later prematch runs offer it again.
- **`report` writes a local file and does not upload.** The report lists names and WhatsApp links. Open `tmp/registration-status-<date>.html` locally and share it privately. `--upload` is an explicit option: it needs `reports.bucket` in `site.config.json` and a token with R2 write passed in your shell for that command (the agent token cannot write). Use it only with a private bucket that only your committee can read; never a public URL.
- **The report has six tabs:** Confirmed, Verified Today, Proof Submitted, Payment Pending, Needs Attention and Refunds Due. Before it writes anything the script checks that confirmed + proof submitted + payment pending + needs attention equals the total number of registrations, and it stops with an error if not. Verified Today and Refunds Due are not part of that sum.
- **Local state.** `tmp/reconcile-state/processed.json` records which payments the tool already verified, so the next `pending` run shows only new ones.
- **Statement cutoff.** Payments after the statement's last row will not appear. Put the cutoff time in the manifest's `statement_cutoff`.
- **Live data changes under you.** Desk staff can edit a registration while you reconcile. Run `pending` again before reporting.

### 3.3 If you only have a PDF, or a different bank

| You have | Do this |
|---|---|
| SBI HTML export | The loop above. |
| SBI `.txt` or `.xls` download | Skip step 2; import it directly in step 3. The import accepts only these two formats. |
| PDF only (fallback) | `uv run scripts/build-statement-images.py statement.pdf` writes page images to `tmp/statement-pages/`. **It deletes and recreates that folder on every run**, so copy out anything you want to keep first (use `--out DIR` to write somewhere else). Then ask Claude Code to run the `extract-statement` workflow (`.claude/workflows/extract-statement.js`) with the page image paths. It is a Claude Code workflow, not a Node script; do not run it with `node`. Delete `tmp/statement-pages/` afterwards. |
| A bank other than SBI | The import parser (`src/server/src/lib/sbi-statement-parser.ts`) and the bank-description parsing understand only SBI formats. You need a new parser, or a converter that writes SBI-format text from your bank's export (the way `convert-sbi-html-to-text.py` does). The converter is the smaller job; I have not tried it. |

**The PDF fallback output cannot be imported.** The workflow returns JSON. The staff import page accepts only `.txt` and `.xls` in SBI format, so the JSON does not enter the bank-transactions table and does not feed `prematch`. Use it to match payments by hand or with an agent, then verify through the surgical commands in 3.4. Its name and reference parsing also assumes SBI description formats.

### 3.4 Odd cases

Use these one payment at a time. Show the situation to a person and get a decision first. `$RECONCILE` is `.claude/skills/payment-reconcile/scripts/reconcile`. The `verify` argument is `payment_id:reference:amount`. Every write command prints the host, the endpoint and the body before it sends.

| Situation | What to do |
|---|---|
| **Exact payment, no batch** | `$RECONCILE verify tmp/staff-jwt.txt prod 78:SBIY000000:13810`, then `$RECONCILE link tmp/staff-jwt.txt prod 42 78` (42 is the bank row id). |
| **Paid too little** (partial payment, or bank fees on an international transfer) | `verify ... --with-shortfall`. The server verifies the amount received, creates a balance payment for the gap, and emails the registrant. In a manifest, set `"withShortfall": true` and list the payment under `pending_committee` if the committee must decide whether to accept the shortfall. |
| **Paid too much** | Verify with the amount actually received. The server verifies at the expected amount and records the excess as a pending refund. |
| **One transfer covers two registrations** (couples, families) | Verify each registration separately with the same reference; use `--with-shortfall` on the one that is short. Then link one bank row to both payments: `$RECONCILE link tmp/staff-jwt.txt prod 42 78 77`. |
| **Bank credit from someone else's name** | Read the proof image and the bank remark to find the registrant. Show the evidence to a person before linking. |
| **Wrong or unreadable proof** | `$RECONCILE reject tmp/staff-jwt.txt prod 80 "reason"`. The payment goes back to payment pending and the registrant is emailed a new link. There is no canary and no undo: run it one at a time. |
| **Refund owed** | List: `$RECONCILE refunds tmp/staff-jwt.txt prod --status pending`. After the money has left your account: `$RECONCILE refund-complete tmp/staff-jwt.txt prod 3 UTR456789`. One at a time, no undo. Refunds also appear at `/staff/refunds`. |
| **Proof missing for a real payment** | Staff can upload a proof on the registrant's behalf from the registration page. A proof made from bank data records what was entered; it is not a scan of the payer's own proof. Say so in the comment. |

Three rules from the original event:

- **Edit the cost before the proof is uploaded.** To add a charge to a registration (for example an extra night), do it while the payment is still `payment_pending`. The pending amount updates by itself. After a proof is uploaded, a cost change creates a refund instead.
- **Verify one first.** Before any batch of writes, verify a single payment and look at the result on the registration page. `verify` and `link` in `reconcile.py` do this on their own. The wrapper's `reject` and `refund-complete` do not.
- **Two dates per payment.** The payment record is created when the registration is made; the money arrives later. Track both. If you query the database, stored timestamps are epoch milliseconds.

One refund in the original event was marked completed by mistake and had to be put back by hand. The reconcile tool has no undo, so confirm each `refund-complete` before you send it.

### 3.5 The staff token

The write commands need a staff session token (a JWT) in a text file.

1. Sign in at `/login` as an admin, or as staff with `dashboard` (verify, reject) and `bank_txns` (link, import) scopes.
2. Open the browser developer console and run `copy(localStorage.getItem("smriti_token"))`. The key name is `TOKEN_KEY` in `src/web/src/lib/auth.ts`; it is `smriti_token` unless you renamed it.
3. Paste the result into `tmp/staff-jwt.txt`. Only the repo's ignored `tmp/` folder is safe; never `/tmp`.
4. When you finish: `rm tmp/staff-jwt.txt`.

The file is a live credential. Do not paste its content into a chat. If a command answers 401, sign in again and copy a new token (inferred; not run).

### 3.6 After the event: income and expense reconciliation

The scripts the original team used for the post-event income and expense statement were not published in this repo. This is the approach, with the mistakes to avoid.

1. Build income from the registrations' price breakdown (`pricing_snapshot`), split by participation type, campus versus full, and spouse or additional guests. Keep different rates as separate lines.
2. Check every category against its source field, not only the total. In the original, the sum check passed while college-cause money sat on the wrong line. A matching total does not show that each amount is in the right category.
3. "Ties to the bank" needs bank rows. Comparing verified payments to registration totals is circular, because a registration becomes confirmed when its payments cover it. Account for every bank credit one by one. In the original, 262 credits were found, 230 matched a registration and 32 did not, and the 32 were read item by item.
4. Stop and fix when a category does not match its source. Do not write a report with a known mismatch. The original script had six abort checks for this.
5. Leave pending pledges out of every total. Count confirmed registrations only.
6. Compute by code, not by hand. Have a second reader check the arithmetic. Format amounts in the units your committee uses (lakh grouping in the original).
7. If you must fix a figure by direct database edit, follow section 8.

---

## 4. Reports

All report scripts read the live database (`SELECT` only) and write to `tmp/`. Every one requires `--env stg` or `--env prod`; there is no default, so use `stg` to test. `--dry-run` prints a summary without writing a file where the script supports it. `--token FILE` reads the Cloudflare token from a file instead of `.env.ops`.

| Report | Command | Contains | For |
|---|---|---|---|
| Payment pending | `uv run scripts/build-payment-pending-report.py --env <stg\|prod> [--dry-run]` writes `tmp/payment-pending-report.html` | Registrations with an unpaid balance (no proof yet): name, branch, WhatsApp, days pending, amount pending, total still to collect, donor and attendee split | The people who chase payments |
| T-shirt sizes | `uv run scripts/build-tshirt-size-report.py --env <stg\|prod>` writes `tmp/tshirt-size-report-<date>.xlsx` | The t-shirt order by size | Whoever places the order |
| Accommodation counts | `uv run scripts/query-accommodation-stats.py --env <stg\|prod>` prints to the screen | Counts by accommodation type | Accommodation lead, hotel booking |
| Desk roster | `uv run scripts/build-desk-roster.py --env <stg\|prod>` writes `tmp/desk-roster-<date>.xlsx` | One printable A4 sheet per branch: id, name, type, t-shirts, food coupon counts (veg and non-veg), children, WhatsApp | Desk volunteers who prepare welcome kits and food coupons |
| Who's Coming | `uv run scripts/whos-coming.py --env <stg\|prod> [--country X] [--details] [--out P]` writes `tmp/whos-coming-<date>.html` | One-file page of attendees with inlined photos. It includes registrations that are still pending payment | Attendees, only after your committee decides they may see it |
| Room allocation | `uv run scripts/allocate-rooms.py --env <stg\|prod> [--dry-run]` writes `tmp/room-allocation-report.xlsx` and `tmp/room-allocation-hotel.xlsx` | Who rooms with whom, hotel handoff sheet | Accommodation lead, hotel |
| Registration status | `report` step of the reconciliation loop writes `tmp/registration-status-<date>.html` | Six tabs: confirmed, verified today, proof submitted, payment pending, needs attention, refunds due | Finance lead |

In the staff UI: `/staff/reports` shows revenue, budget progress, branch participation and a registration timeline (scope `reports`). The dashboard at `/staff/dashboard` can export a CSV.

Before you share any report, run the script against staging first (`--env stg`), or with `--dry-run`, and check the row count against what you expect.

**Privacy rule.** Reports contain names, phone numbers and in some cases amounts. They stay in `tmp/` (git-ignored). Do not put them at a public URL. Do not commit them. Do not paste their contents into a public chat. Send a file to the people who need it, privately. `whos-coming.py --upload` and `reconcile upload` write the file into the bucket named by `reports.bucket` in `site.config.json`; they publish personal data if that bucket is public. Both need a token with R2 write in your shell, and `whos-coming.py --upload` asks you to type `upload` first. Check the bucket's visibility before you answer.

**Who's coming is public by default.** The public page and API show the name, branch, city, country and photo of every registration, including unpaid ones, to anyone, with no consent step. This is a pre-launch decision: see MAKE-IT-YOURS.md, section 3.6, for the options. The `whos-coming.py` report is a separate file for your committee; it does not change what the public page shows.

Delete files you no longer need from `tmp/` when the work is done: proofs, statement images, snapshots, rosters.

The original event also used an unregistered-alumni report that compared a roster with registrations. That script is not in this repo.

---

## 5. Rooms

Accommodation is optional. This section applies only if your event offers shared hotel rooms.

There are two separate things.

**The staff allocation UI** (`/staff/allocation`, scope `allocation`) is where people's room preferences, mutual groups and "room together" requests are reviewed and where staff convert or assign rooms. Room quotas (how many rooms of each type exist) are set at `/staff/rooms` (scope `resources`). The public site shows availability from these quotas.

**`scripts/allocate-rooms.py`** builds a workbook for the hotel from the database. It only reads. It does not write to the app's room tables, so the staff UI and the workbook can disagree until you copy decisions over by hand.

Before the first run, set `eventName` and `eventSubtitle` in `site.config.json` (the workbooks print them), and edit the two settings at the top of `scripts/allocate-rooms.py`: `NIGHT_DATES` (the hotel nights) and `MANUAL_GROUPS` (room pairs you want fixed by hand).

```bash
uv run scripts/allocate-rooms.py --env stg --dry-run     # print the summary only
uv run scripts/allocate-rooms.py --env prod              # writes tmp/room-allocation-report.xlsx and tmp/room-allocation-hotel.xlsx
```

Rules the original team set, and the script follows:

- **Mutual requests first.** Two people who both asked for each other are placed together. One-way requests count less than mutual ones.
- **Same branch breaks ties.** Among people with no preference, a same-branch pairing is better than a stranger pairing. It never overrides a real request.
- **Genders are separated.** Rooms are paired within a gender.
- **Odd numbers leave one person alone.** Which person that is, the script does not decide; a human reviewer should check it.
- **A human reviews the result.** The goal is a draft that is easy to review, not a final plan.
- **Extra bed.** A person booked for two nights in a shared double needs an extra bed. The hotel sheet lists extra-bed requirements.
- **Two nights.** The script assumes exactly two hotel nights. Dates come from `NIGHT_DATES`, but the internal logic and console labels are built for two. A different length needs code changes.

The hotel sheet and the report show one attendee per row, with the room number as a column.

---

## 6. Event day

### 6.1 Registration desk

Desk volunteers need an account with the `registration_desk` scope, and nothing else. They sign in at `/login` and use `/staff/check-in`.

What the desk can do:

| Task | How |
|---|---|
| Find a person | Use the search box. Search results show the photo from the public CDN. The detail view shows the full-size photo. |
| Check in | Open the person and confirm attendance. Repeating a check-in does not create a second one (the endpoint is idempotent per the original sessions). |
| Undo check-in | The "absent" action on the same page. |
| Collect a pending payment | If a registration is payment pending, choose the mode (cash or online transfer) and add an optional comment, then confirm attendance. |
| Take an extra payment or add a charge | From the person's detail view. |
| Register a walk-in | The spot registration panel. Email is required. |
| See counts | Totals and checked-in counts, by participation type, at the bottom of the desk page. |

T-shirt rows show on the desk as read-only information; collection is not tracked. Check-in and walk-in registration each trigger a welcome message, and the original sessions record that the server sends only one per registration (not checked in code here).

**Scanning a pass.** There is no camera scanner inside the app. The QR code on a pass holds `<site>/pass#<code>`. A volunteer scans it with the phone camera, which opens the public pass page. If that person is signed in with the `registration_desk` scope, the page forwards them to that person's desk record. Anyone else sees the public pass. The forwarding is a convenience, not access control.

**Cash is recorded in the system.** The desk records cash and transfer payments there, so your next reconciliation shows them. Include cash in the daily total.

### 6.2 LED wall

`/led-wall` is a public full-screen display of checked-in attendees as drifting photo strips by branch, with a spotlight on each new arrival. Press `f` for full screen and `/` for the hidden controls panel. There is no link to it in the site; open the address directly.

Prepare in this order:

1. **Check the live endpoint on staging first.** The wall reads `GET /api/public/desk-roster`. On the original event this endpoint returned 404 on the live site because the code had been merged to `main` but not into the release branch that CI deploys. Merge to the release branch and confirm: `curl -s -o /dev/null -w "%{http_code}" https://<your-site>/api/public/desk-roster` should print `200`.
2. **Test the wall on staging** with some test check-ins. No session of the original event records a live wall run, so treat the wall as untested at scale.
3. **Pre-cache the photos.** Open `/led-wall/precache` once on the machine that will drive the wall, on a good network, before the event. The wall then loads photos from the browser cache. This page cannot detect a photo that failed to load (it uses opaque requests), so look at the wall for broken portraits afterwards.
4. **Plan for refresh.** The wall polls for new check-ins every 3 seconds and re-reads the full list every 60 seconds (the agreed design; not timed live). A replaced photo can take up to 4 hours to reach the wall because the CDN caches for that long.

The desk-roster endpoint is public and needs no sign-in. It returns checked-in attendees' names and portrait links. Wall membership depends on desk check-in, not on payment status; the desk is what refuses a check-in while money is owed. Keep that in mind when you decide whether to turn the wall on before the event.

### 6.3 Daily report and live monitoring

- `/staff/daily-report` (scope `admin-tools`; see 1.4 for the extra scopes it needs).
- Live Worker logs: `.claude/skills/devops/scripts/worker-logs prod` (add `--status error` for errors only). Press Ctrl+C to stop.
- Recent audit events: `.claude/skills/devops/scripts/audit-log prod recent` (also `logins`, `payments`, `registration <id>`).

### 6.4 ID cards

Cards are made by a separate tool, not by the website. It turns a list of attendees into a PDF with one portrait CR80 card (54 x 85.6 mm) per person. Work in `scripts/idcard-mailmerge/`.

```bash
cd scripts/idcard-mailmerge
make dump ENV=prod                           # attendees from production D1 + portraits into data/ (needs the agent token in .env.ops; the CDN is cdnUrl in site.config.json)
make validate MANIFEST=data/attendees.json
make render MANIFEST=data/attendees.json     # the PDF, in output/
make proof MANIFEST=data/attendees.json      # guided proof PDF and PNG pages, in proof/
make editor ENV=prod                         # layout editor (portraits come from cdnUrl)
```

What each needs:

- **Photos.** Each card needs a transparent portrait at `<cdnUrl>/portraits/<id>.webp`. The original team produced these with an AI photo pipeline that is not in this repo (`scripts/imagegen` is a general image tool, not that pipeline). `make dump ENV=prod` fetches them from the CDN. To use a local folder of portraits named `<id>.webp` instead, run `dump_attendees.py` with `--portraits-src DIR` (see its `--help`).
- **Who gets a card.** `make dump` includes every registration except donation-only ones, whatever its payment status. The original team chose this after a status filter dropped about 16 people (166 cards against 182 or more expected). The comment at the top of `dump_attendees.py` shows a `status='confirmed'` filter; the Makefile does not use it. Look at the count before you print and remove anyone who should not have a card.
- **Validation fails the whole batch.** A duplicate id, a missing or corrupt photo, or text that does not fit stops everything before any PDF is written. Fix the data and run again.
- **Branding.** The card template carries the original event's text and logo (for example "TKMCE BATCH OF 2006"). Change them with the layout editor or in `layout.json` before you print.
- **Print one physical card first, at 100% (actual size).** Direct-card printers can clip edges or change colours even when the PDF is correct.

What was not exercised: the sessions show a dump and render run (and a count gap that was traced to the dump filter), but not the printing, the layout editor, or the proof step on a real batch. Treat those steps as untested here. The outputs under `data/`, `output/` and `proof/` hold names and photos and are git-ignored.

### 6.5 Incidents from the original event

| Incident | What to do |
|---|---|
| Staff needed to reset check-ins for all attendees on event day (reason not recorded). | Take a snapshot of who is checked in before you change anything. Count rows, check that the endpoint works on one row, run a dry run, then run for all with retries and write a log. Use the staff "absent" action for each registration (`POST /api/staff/desk/registrations/:id/absent`), not a database write. Afterwards, check the database shows zero still present and that the audit log has one undo row each. The script used for this was not published. |
| Cloudflare answered every Python script call with an error 1010 block. | Fixed. Every script request now sends a browser-style User-Agent (`scripts/ops_common.py`). If you write your own script, do the same. |
| Wrangler printed a banner into a JSON file and broke the parser. | Fixed in `d1-query`, which uses `wrangler --json` and keeps messages separate. If you capture wrangler output yourself, use `--json`. |
| An agent was blocked from running a command that touches a release branch or reads a stored admin token. | A human runs that command. Do not look for a way around the block. |

---

## 7. After the event

### 7.1 Memory stories

Stories let attendees write short memories on a public page. They are controlled by four flags (see 1.5). Authors can write up to three stories each. A story author can delete their own stories at any time, even when submissions are closed.

Moderation is through the API for admins. There is no page for it in the staff UI. An admin can list stories (`GET /api/admin/memory-stories`) and hide or show one (`PUT /api/admin/memory-stories/:id/visibility`). When a story is hidden, the author is emailed. Ask your developer or an agent to do this with the admin token file, and apply the same one-change rule as in section 8. This path was not run for this guide.

### 7.2 Prediction contest awards (optional)

Only if you ran the match prediction contest. `uv run scripts/compute-awards-v2.py` reads the contest sheet and prints awards to the screen. It needs `GOOGLE_SPREADSHEET_ID` and `GOOGLE_SA_KEY` in `.env.ops` (or `src/server/.dev.vars`), and the sheet shared with the service account's email address. It writes nothing.

### 7.3 Magazine

The magazine viewer at `/magazine` loads its issue files from your public CDN, not from the repo. Upload the issue files to the public bucket. The browser must be allowed to read them from your site's address. That is a CORS rule on the bucket, and the repo has one ready:

```bash
npx -w @smriti/server wrangler r2 bucket cors set <bucket> --file devops/public-r2-cors.json
```

The file allows `GET` and `HEAD` from any origin. This needs the deploy token (R2 write permission), so a human runs it with the token passed in their shell. **After you change CORS, purge the CDN cache for the bucket's host.** The edge cache keeps answers that were stored without CORS headers, so the fix does not show until you purge. In the original event the magazine index failed with a CORS error; the sessions do not record whether the fix and purge were applied.

### 7.4 Photos and thumbnails

Photo thumbnails are made by the site when attendees upload. Admins with the `admin-tools` scope can re-make them (`POST /api/staff/regenerate-thumbnails` and `POST /api/staff/sync-public-thumbnails`). Put event photo galleries in their own public bucket, not the bucket that holds private uploads. The original event's gallery pipeline (download, resize, blur check, upload) is not in this repo.

### 7.5 Refunds and archiving

- **Refunds.** Work through `/staff/refunds`, or the commands in 3.4. Pay out first, then record the payout. A refund the registrant caused by paying a vendor directly is not in the refunds table; keep such cases in your own notes.
- **Cancel or archive.** The registration page offers cancel (when money was verified) and archive (when there is no real payment activity). The server refuses both while an uploaded proof is still unreviewed. Archived registrations are at `/staff/archived`.
- **Personal data.** After the event, decide how long you keep ID documents, photos and phone numbers, and delete local copies (`tmp/`, `scripts/idcard-mailmerge/data/`).

---

## 8. Production safety rules

| Rule | Why |
|---|---|
| Try on staging first. | Production has real payments and people. |
| **Production D1 is read-only for AI agents** unless a human grants one named change. | `d1-query` refuses non-reads without `--write` and asks a human to type `write prod`, but the guard is a safeguard against mistakes, not against intent. |
| Prefer staff API endpoints and the staff UI over SQL writes. | They write the audit log. In the original event a direct `UPDATE` left no audit row, and the stored price breakdown still held old figures until it was fixed by hand. |
| Take a snapshot before a bulk change. | You need a way back. For D1 use Time Travel: `npx -w @smriti/server wrangler d1 time-travel info <db> --env production` shows the current bookmark (`docs/DEPLOYMENT.md`, "Backups"; not run for this guide). `make stg-db-snapshot` exports staging only. |
| Deploy only through CI: merge `main` into `release/stg`, push, then `release/prod`, push. | GitHub Actions builds and deploys. Watch with `.claude/skills/devops/scripts/ci deploys`. |
| `scripts/deploy.sh prod` is a last resort. | Outside CI it asks you to type `deploy prod` first. |
| An agent never pushes to `release/prod` unless a human approved that specific push. | A push publishes to live users. |
| Never paste tokens or the staff JWT into a chat. | A chat transcript is not a safe place. Use files in ignored `tmp/` and delete them. |
| Keep the deploy token out of `.env.ops` and out of any shell an agent can read. | It can edit and deploy; nothing else limits what it can do. |
| Log every production write: what, why, rows touched, the Time Travel bookmark from before, the rollback command. | You can explain and undo it later. |

**How to give an AI a one-change permission.** Say exactly what may change, once, and nothing else:

> This time you have permission for one production change: set the donation on registration 123 from 5000 to 4000 through the staff API. Do not run any other write. Show me the exact request before you send it. Write the audit row the app would write, update the stored price breakdown, and tell me when it is done.

If a direct database write is allowed, it must also write the audit row the app would write, update every stored copy of the changed figure (`pricing_snapshot` in particular), and be logged. The permission ends when that change is done.

---

## 9. Working with AI for ops

Give the agent this file and the `payment-reconcile` and `devops` skills. These prompts worked, or follow patterns that did. The part after "Check" tells you what to look at before you accept the result.

| Task | Prompt | Check |
|---|---|---|
| Counts | "Query production for registration counts by status and participation type. Read only. Show a table." | The totals match `/staff/dashboard`. |
| Payment pending | "Run the payment-pending report against staging first and tell me the row count before I share it. Then run it on production." | The row count; the file is in `tmp/`, not uploaded. |
| Prematch | "Prematch the imported statement and show me the matches. Don't verify anything yet." | Each match shows the UTR or name plus amount that matched. Conflicts are listed as unmatched. |
| Verify batch | "Verify the approved manifest on production. Verify one first, show me the result, then continue." | The canary result on the registration page before the rest runs. |
| Odd payment | "This couple paid one transfer for two registrations. Show me both registrations and the bank row, and propose the verify and link commands. Don't run them." | The amounts add up to the bank row. |
| Reconcile report | "Build the registration status report from the manifest. Do not upload it." | The file is under `tmp/`; confirmed + proof submitted + payment pending + needs attention equals the registration total (the script checks this itself). |
| Bulk change | "Before changing anything, snapshot who is checked in and give me the count. Then do a dry run of the reset through the staff undo action and stop." | The snapshot file exists; the dry run lists the same count. |
| Audit | "Show the audit log for registration 123 and tell me who changed it and when." | Rows exist for each change you expect. |
| One write | "You have permission for this one change: [exact change]. Use the staff API, not SQL. Show the request first." | The request body before it is sent. |
| Rooms | "Run room allocation with `--dry-run` against staging and list who ends up alone." | The people left alone; your `MANUAL_GROUPS` were applied. |
| Flags | "Query the `feature_flags` table on production and compare it to the flag list in `src/shared/src/feature-flags.ts`. Tell me which flags have no row." | Flags with no row are off. |
| Income report | "Reconcile income to the bank statement rows, not to registration totals. List every bank credit that does not match a registration. Stop if a category does not match its source field." | Every credit is accounted for; no figure comes only from a total. |
| Deploy status | "Show the latest deploy runs on release/stg and release/prod. Do not push anything." | The run id and status. |

Habits that worked in the original event: ask for the plan before the change; ask the database before trusting the screen; ask for computed numbers, not mental arithmetic; and start a fresh session from a written handoff when a session gets confused.

---

## 10. Troubleshooting

| Problem | What to check |
|---|---|
| **Magic link does not arrive** | First check the sender settings: `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` on the Worker, and that the Mailgun domain shows as verified. With neither set, a deployed Worker sends nothing and logs `email is not configured` (`worker-logs prod`); the log has no link, on purpose. Ask the person to look in junk mail. In the original project, mail to Outlook addresses landed in junk even though SPF, DKIM and DMARC all passed, and changes to headers and content did not help. This was not resolved; the last advice was to check the sender's reputation and sending IP pool. For staff, use `/staff/team` "Generate login link". To test sending: `npm -w @smriti/server run spike:mailgun:confirmation -- --to A --env stg --dry-run` renders without sending (`--env` fills the link address and sender name from `site.config.json`); drop `--dry-run` to send one real email. It reads the Mailgun keys from `.env.ops` or `src/server/.dev.vars`. |
| **Login link says expired** | Links work once and expire after 10 minutes. After 3 requests in 10 minutes for one address, further requests are dropped silently with a normal-looking response. Wait, then try once. |
| **`d1-query` or a report fails with "not set" or "placeholder"** | The message names the missing key and the file that owns it. Fix it in that file (1.2), then run `make doctor`. |
| **`d1-query prod` fails** | For `prod`, `d1-query` passes `--env production` to wrangler, to match `wrangler.toml` and `deploy.sh`. This was not run against a live database; check it on first use and tell the maintainers if it fails. |
| **Report or token request gets HTTP 403 "1010"** | A custom script is using a default Python User-Agent. Use `scripts/ops_common.py` or send a browser-style header. |
| **JSON file starts with text** | Wrangler printed a banner. Use `d1-query` (it uses `--json`) or add `--json` to your wrangler call. |
| **Flag looks off on the site** | Flags with no database row are off. Flip it at `/staff/config`, then query `feature_flags` to confirm. Check the nav, the home page and the direct URL, not only the nav. |
| **Magazine index or images blocked by CORS** | Set CORS on the public bucket (7.3), then purge the CDN cache. |
| **`/api/public/desk-roster` returns 404** | The code is not deployed. Merge into the release branch and wait for CI (6.2). |
| **Photos on the LED wall are stale or missing** | The CDN caches for up to 4 hours. Re-run `/led-wall/precache` on the wall machine. |
| **A staff member sees "Access denied"** | Their scope does not cover the page. Check `/staff/team`. Scope changes take up to 5 minutes. |
| **Every API call returns 500 "Server configuration error"** | A Worker variable such as `APP_BASE_URL` is missing. The Worker was deployed without `scripts/deploy.sh`. Redeploy through CI or `deploy.sh` ([docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)). |
| **Deploy ran but nothing changed** | CI deploys only from `release/*` branches. A commit on `main` alone does nothing. Check `ci status`. |
| **A turn or command dies during a deploy watch** | Re-attach to the same run (`gh run watch`). Do not push again. |
| **`make dev` fails locally** | Another program may hold port 5173 or 8787: stop it, or move the API with `API_PORT=8799 make dev`. Run `make db-migrate-local` for the local database. |

---

## 11. What is not verified

Nobody checked these against a live site or ran them for this guide.

- `d1-query prod` with `--env production` and `--json`; `worker-logs`; `reconcile registrations|proofs|upload|refunds`; every D1 report script with real data; `whos-coming --upload`; `committee-todo-cli`; `sync_attendance`; `compute-awards-v2` with real credentials; `ci` with `gh`.
- The ID-card steps after `make dump` and `make render` on a real batch: proof, layout editor, printing.
- The LED wall on a live event. The polling timings are the agreed design, not measured.
- Admin moderation of stories through the API.
- The staff scope cache delay (5 minutes) and the extra scopes the daily report needs: read from code, not run.
- The Time Travel commands for snapshots, taken from `docs/DEPLOYMENT.md`.
- Converting another bank's export to SBI format.
- The Outlook junk-mail problem and the magazine CORS fix: unresolved or unconfirmed in the original sessions.

Not in this repo, so this guide describes the approach only: the check-in reset script, the post-event income report script, the unregistered-alumni report, the photo gallery pipeline, and the AI portrait pipeline for ID cards.
