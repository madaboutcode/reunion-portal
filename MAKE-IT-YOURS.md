# Make it yours

This guide shows how to turn the Smriti 2026 portal into the portal for your own reunion. Your identity and infrastructure go in two config files: `site.config.json` (names and URLs) and `src/server/wrangler.toml` (Cloudflare resources). Everything else is code and assets: search-and-replace of branding copy, removal of features you do not want, and a handful of values in `src/shared/src/constants.ts`. `make doctor` tells you what is left. An AI coding agent (Claude Code, Codex, or similar) can do most of it if you give it this file and [AGENTS.md](./AGENTS.md) and review its plan. Terms you may not know (D1, R2, Worker, UTR, scope) are in the [glossary](./docs/GLOSSARY.md).

**If you are an AI agent reading this:** the person who gave you this file wants to adapt the portal. Do not edit anything until you have read this whole file and AGENTS.md and have shown them a plan (section 1). Every file path below was checked to exist in this repository. Line numbers are left out on purpose because they drift; search by the strings given.

**Contents**

1. [Using this guide with an AI agent](#1-using-this-guide-with-an-ai-agent)
2. [First hour and first-day checklist](#2-first-hour-and-first-day-checklist)
3. [Feature catalogue](#3-feature-catalogue)
4. [Rebrand](#4-rebrand)
5. [Event facts](#5-event-facts)
6. [Config files, domains and Cloudflare names](#6-config-files-domains-and-cloudflare-names)
7. [Example prompts](#7-example-prompts)
8. [Local development loop](#8-local-development-loop)
9. [Watch-outs](#9-watch-outs)

How sure each statement is: a claim is "run" when it was executed on a fresh clone, "read from code" when taken from the source without running it, and "reported" when it comes from the original team's AI session logs. Claims with no label are plain facts about the file layout.

---

## 1. Using this guide with an AI agent

### Start the session

Open the agent in the repository root and send this as the first message:

> Read `MAKE-IT-YOURS.md` and `AGENTS.md` completely. We are adapting this reunion portal for our batch. Do not edit any file yet. First reply with a short plan: which sections of MAKE-IT-YOURS.md apply, in what order, and what you need from me (event facts, logo files, domain names). Then wait for my go-ahead.

### Working rules that paid off for the original team

These come from the sessions in which the Smriti team built and ran the portal. Adapt them to your agent.

| Rule | What it looks like in practice |
|---|---|
| Ask for a plan before edits | "List the files you will change and why. Do not edit yet." Approve or trim the list, then say go. |
| Work one feature or one category at a time | Rebrand colors, then fonts, then dates, then one feature removal. Do not batch them. A review of 10 small diffs is possible; a review of one diff touching 300 files is not. |
| Verify after every step | `make check` after each change; the web and server tests after each removal; look at the result on localhost. A step is not done until you have seen the output. |
| Commit after every verified step | One commit per step lets you undo one step without losing the rest. |
| Check the page in a browser on localhost | Open `/debug` for single components and `/register` for the wizard. See section 8. |
| Staging before production | Deploy to `release/stg`, click through, then merge to `release/prod`. |
| Ask the database before trusting the UI | When a staff page shows a number or a switch state, query the database to confirm. In the original run, this showed that four feature flags had no database row even though the page showed them. |
| Use code to compute, not the model | For totals, counts and date arithmetic: "use a script or query to compute it, do not do it by hand". A total that adds up does not prove the money is in the right category. |
| Say one-change permissions plainly | "This time you may do this one change." Do not grant a standing permission. The agent should refuse any production data write that you have not named. |
| Resolve by query before asking you | The agent should look up a value (for example the exact branch name stored in the database) before asking you which one you meant. |
| Do one, show me, then the rest | For any batch edit or batch write, have the agent do one item first and show you. |
| Ask for a handoff when a session drifts | When replies get slow, confused or contradict earlier decisions: "This session is drifting. Write a handoff: what is done, what is verified, what is left, the commands to resume." Start a new session from that file. |
| Keep personal data out of prompts and commits | Do not paste real names, phone numbers, emails, bank details or registration codes into a prompt or a file you commit. `tmp/` is git-ignored; use it. |

### What the agent must not do without asking

- Delete or edit an applied migration (section 3.3).
- Write to a remote database, deploy, push, or change Cloudflare settings.
- Add a dependency. Bundle size matters on mobile.
- Hardcode prices outside `PRICING_DEFAULTS`.

---

## 2. First hour and first-day checklist

### The first hour

1. Fork the repository and run it locally ([README quick start](./README.md#quick-start)). Confirm you can log in as admin.
2. Create your Cloudflare resources ([docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md), step 1).
3. Edit `site.config.json` and `src/server/wrangler.toml` with your names, URLs and IDs (section 6).
4. Run `make doctor`. Clear every line under "Agreement and required settings". The rest of the list is your remaining branding work.
5. Rebrand: logo, colors, name in copy (section 4).
6. Run `scripts/deploy.sh stg all --dry-run`, then deploy staging through CI.

### The first day

Do these in order. Each row says what you decide and where the change goes. Sections 3 to 6 give the details.

| # | Step | Decide or gather | Where it goes |
|---|---|---|---|
| 1 | Run it locally | Node 23.11.0, `uv`, a terminal | [README Quick start](./README.md#quick-start). Confirm you can log in as admin. |
| 2 | Decide features | Which of the features in section 3 your reunion needs. Drop the rest early; less code means fewer places to change. | Section 3 |
| 3 | Rebrand | Event name, logo files, colors, fonts, footer text | Section 4 |
| 4 | Event facts | Dates, venue, prices, branches or departments, batch year, check-in and check-out days | Section 5 |
| 5 | Payment details | Payee name, UPI ID, bank account block, bank statement format | `src/shared/src/constants.ts`, section 5 |
| 6 | Config files | Your domain, staging subdomain, resource names, IDs | `site.config.json`, `src/server/wrangler.toml`; section 6. Then `make doctor` |
| 7 | Emails | Sender name, subject lines, signature, Mailgun domain (required on any deployed site) | Section 4 (email) |
| 8 | First admin | The email of your first admin | `src/server/migrations/0003_users_and_auth.sql`, before the first remote migration |
| 9 | First deploy to staging | Cloudflare account, GitHub repository, secrets, tokens | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md). Rehearse with `scripts/deploy.sh stg all --dry-run` |
| 10 | Click through on staging | Registration, payment page, staff login, `/staff/config` | Staging site |
| 11 | Production | Same steps with the production names. Run `make doctor-strict` first | `release/prod` |

Replace every placeholder before going live: `REPLACE_WITH_*` (`wrangler.toml` and web components), `YOUR ALUMNI ASSOCIATION`, `yourassociation@bank`, the base64 bank block, and `admin@example.com`. `make doctor-strict` fails while any example value from the config files, code or branding copy is left.

---

## 3. Feature catalogue

Only nine switches exist at runtime, and all of them default to off on a new database. Every other feature has no switch: you remove it by editing code. There are three ways to turn something off.

| Way | Meaning |
|---|---|
| (a) Flag | An admin toggles it at `/staff/config`. The value is stored in the D1 table `feature_flags`. The catalogue is `src/shared/src/feature-flags.ts`. |
| (b) Unset variable | Leave a Worker secret empty. The API answers 404 for that feature. The web page may still load. |
| (c) Code removal | Delete routes, links, components, API mounts, tests and assets. Section 3.5 lists the files. |

### 3.1 The nine flags

A flag marked "UI only" hides a link or page in the browser. The API stays reachable. The flag page says this itself for those flags.

| Flag | Controls | Where it is enforced |
|---|---|---|
| `registration_show_page` | Shows `/register`, `/new` and the Register buttons on home, connect and who's coming | UI only |
| `registration_accept_new` | Lets new registrations be submitted. Off returns 403 `REGISTRATION_CLOSED` | Server and UI |
| `navigation_show_register` | Register item in the top nav | UI only |
| `navigation_show_my_pass` | My Pass item in the top nav | UI only |
| `navigation_show_stories` | Autograph item in the top nav | UI only |
| `homepage_show_memory_stories` | Stories section on the home page | UI only |
| `memories_show_stories` | Public stories page and public read API (404 when off) | Server and UI |
| `memory_stories_accept_submissions` | Posting and editing stories (409 when off). Deleting your own story is never gated. | Server and UI |
| `debug_tools` | Debug pages in builds that include them | Admin gate |

Registration does not open until both `registration_show_page` and `registration_accept_new` are on.

### 3.2 All features at a glance

"Switch" is the best way to turn the feature off. "No switch" means code removal (c). Phase is when the feature matters to attendees or staff.

| Feature | Phase | Switch | Notes |
|---|---|---|---|
| Registration wizard (7 steps) | Pre | (a) `registration_accept_new`, `registration_show_page` | Removing the wizard itself touches many other features (section 3.4). Close it with the flags instead. |
| Payments: bank and UPI, proof upload, staff verify | Pre | No switch | Core. Verification sets the registration status. |
| Bank statement import and matching | Pre, post | No switch | Parser reads SBI statements only. Removable on its own. |
| Refunds and cancellation | Pre, post | No switch | Staff-only. |
| Who's coming | Pre | No switch | Public page with names, branch, city, country and photos of all registrations, paid or not. See 3.6 for the pre-launch decision. |
| Sponsor and donate page | Pre | No switch | Page has no API. "Donation only" is a separate wizard option. |
| Connect (social links) | Pre | No switch | Placeholders for WhatsApp and Facebook. |
| Committee todos (Google Sheet) | Pre | (b) unset `GOOGLE_COMMITTEE_SHEET_ID`. Unsetting `GOOGLE_SA_KEY` also turns off the prediction contest data, because both read their sheets through that one key | The installed app (PWA) opens this page. See "Committee todos" in 3.5. Writes need no login. |
| Room allocation and room assignment | Pre, event | No switch | Staff tools. Tied to accommodation. |
| Accommodation (wizard step 4, pricing, pass line) | Pre | No switch | A code constant with no skip rule. See 3.7. |
| Registration desk, check-in, spot registration | Event | No switch | Feeds the LED wall. |
| Entry pass (QR, PDF, `/pass`) | Event | (a) `navigation_show_my_pass` hides the link only | Not available for donation-only registrations. The pass download does not check payment status. |
| LED wall | Event | No switch | Reachable by URL only. See "LED wall" in 3.5. |
| Staff reports and daily report | Event, post | No switch | Daily report has a scope gap (section 9). |
| ID-card PDF tooling | Event | Delete the folder | Not part of the web app. `scripts/idcard-mailmerge/` |
| Memory stories and autograph | Post | (a) four flags | See "Memory stories" in 3.5. |
| Prediction contest: awards, leaderboard, predictions, credits overlay | Post | (b) unset `GOOGLE_SPREADSHEET_ID` (or `GOOGLE_SA_KEY`, which the committee todo page also needs) hides the data only | The nav link "Awards" has no flag. See "Prediction contest" in 3.5. |
| Magazine viewer | Post | No switch | Issue files are not in this repository. |
| Photos and thumbnails | Pre | No switch | Wizard step 6. Feeds desk, who's coming, LED wall, ID cards. |
| Staff team and scopes | All | No switch | Keep. About 60 staff endpoints check scopes. |
| Feature flags page | All | No switch | Keep. |
| Debug pages | Dev | (a) `debug_tools`, and build variable `VITE_ENABLE_DEBUG` | See section 8. |
| Email through Mailgun | All | Not optional on a deployed site. Without `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` nothing is sent. Only a local API prints the message and its link to the terminal; a deployed Worker logs "email is not configured" with no link, so nobody can log in | `EMAIL_ALLOWED_DOMAINS` limits recipients. |
| Size chart, archive, T-shirts and extra charges, meals, giving back | Pre, event | No switch | Parts of the wizard and staff console. |

### 3.3 Migrations: never delete or edit applied ones

The migration files in `src/server/migrations/` build the database. Staging and production record each file they have run in the table `d1_migrations`. Deleting a file from the repository does not remove its tables from a database that already ran it, so the repository and the live database would disagree. Editing a file does nothing to a database that already ran it, and a fresh database would then differ from the live one. Some migrations also change data (`0003` inserts the admin, `0018` inserts a flag row, `0019` backfills t-shirts). Migration `0021` rebuilds eleven tables (`registrations` and ten tables that point to it) and depends on the earlier files.

So when you remove a feature, keep its migrations. Unused tables are harmless. If you want a table gone, add a new migration file with the next number that drops it, take a snapshot first (`make stg-db-snapshot`), and get approval before you run it on remote data. The one exception is the admin seed in `0003`: editing it is safe only before your first remote migration (section 5). If a fork already migrated with `admin@example.com`, leave `0003` alone and add a new migration with the next number (for example `0026_change_admin_email.sql`) that updates the row in the `users` table (columns `email`, `name`, `role`, `is_active`; `email` is unique):

```sql
UPDATE users SET email = 'you@yourdomain.org', updated_at = unixepoch() * 1000
WHERE email = 'admin@example.com' AND role = 'admin';
```

Take a snapshot first (`make stg-db-snapshot`) and apply it to staging before production. The new address must be able to receive Mailgun email, because login links are only sent by email.

### 3.4 Coupling warnings

Check these before removing anything.

| If you remove or change | These stop working or need edits |
|---|---|
| Payment verification | The registration status (pending to confirmed) gates desk check-in only: the desk refuses a check-in with money outstanding (409 `payment_required`). It also drives reports and the "payment confirmed" email. It does not gate who's coming, the pass download or LED wall membership (see 3.6). Treat payments as core. |
| Accommodation | Pricing, room allocation, desk ledger, pass label, reports, emails, debug pages. See 3.7. |
| Photo upload (wizard step 6) | Desk photo, who's coming avatars, LED wall portraits, ID cards. |
| Check-in (desk) | LED wall. It reads `/api/public/desk-roster`, which lists checked-in people. |
| A wizard step | Every step after it is renumbered: `src/web/src/lib/step-config.ts`, `wizard-steps.ts`, `WizardShell.tsx`, the draft golden fixtures `src/shared/src/__tests__/fixtures/wizard-draft-goldens.ts` and the wizard tests. |
| Staff scopes | Six places: the `requireScope` calls, `src/web/src/components/SiteNav.tsx`, `src/web/src/lib/auth.ts`, `VALID_SCOPES` in `src/server/src/routes/admin.routes.ts`, `SCOPE_OPTIONS` in `src/web/src/pages/TeamManagementPage.tsx`, the `StaffScope` type in `src/web/src/lib/staff-types.ts`. |
| The feature flags page | Flags keep working from the database, but you could only change them with SQL. |
| The committee todo route | The installed app's start URL ("Committee todos" in 3.5). |
| Prediction contest folders | `src/web/src/components/leaderboard/department.ts` is also imported by the room allocation screens. `src/web/src/components/credits/` and `src/web/src/lib/team-flags.ts` are also imported by `src/web/src/pages/DebugPage.tsx`, so edit that page when you remove them. `src/web/src/hooks/useWhosComingAvatars.ts` imports the `WhosComingResponse` type from `lib/prediction-types.ts`, so move that type before you delete the file. |
| Who's coming folder | `src/web/src/components/whos-coming/utils.ts` is imported by the committee todo screens. |

(The last three rows were found by searching imports on this tree.)

A staff session outlives a staff change. Deactivating a staff user stops new logins but does not end a session that already exists: the login token stays valid for up to 7 days. A scope change takes up to 5 minutes to reach an open session. If you must cut access at once, change `JWT_SECRET` for that environment, which logs everyone out (inferred from how tokens are signed; not run).

### 3.5 Removal sets

For each feature: delete what is listed, remove the route in `src/web/src/App.tsx` and the nav or home links named, remove the API mount in `src/server/src/app.ts`, delete the tests and the matching spec in `docs/specs/`, then run `make check` and `make test`. Tests for web components sit next to the component (`*.test.tsx`).

#### Prediction contest

Pages `/awards`, `/leaderboard`, `/predictions`; the credits overlay; data from a Google Sheet. It is specific to the 2026 football World Cup and to the Smriti batch's jokes.

| Part | Files |
|---|---|
| Routes | In `App.tsx`: `/awards`, `/leaderboard`, `/predictions`, and `/debug/credits-export` |
| Links | `src/web/src/components/SiteNav.tsx` ("Awards", desktop and mobile). Cross-links inside the contest pages go away with the pages. |
| Pages | `src/web/src/pages/PredictionAwardsPage.tsx`, `LeaderboardPage.tsx`, `PredictionsMatchPage.tsx`, `CreditsExportPage.tsx` |
| Components | `src/web/src/components/awards/`, `predictions/`, `credits/`, `leaderboard/` (keep `leaderboard/department.ts` if you keep room allocation, see 3.4) |
| Data and logic | `src/web/src/lib/awards-data.ts`, `prediction-aggregates.ts`, `prediction-types.ts`, `ledger-aggregates.ts`, `team-flags.ts`; hooks `src/web/src/hooks/usePredictionsMatchData.ts`, `useLedgerData.ts`. Before you delete `prediction-types.ts`, move the `WhosComingResponse` type out of it: `src/web/src/hooks/useWhosComingAvatars.ts` (kept, it serves who's coming) imports it. |
| API | `src/server/src/routes/datasources.routes.ts`, `src/server/src/services/datasource.registry.ts`, `datasource.types.ts`, `google-sheets.provider.ts`; in `app.ts` the data-source registry block and `app.route("/datasources", ...)` |
| Secrets | `GOOGLE_SPREADSHEET_ID` (and `GOOGLE_SA_KEY`, which the committee todo also uses) |
| Script | `scripts/compute-awards-v2.py` (computes awards from the sheet; run by hand) |
| Tests | `src/web/src/lib/prediction-aggregates.test.ts`, `src/web/src/lib/__tests__/ledger-aggregates.test.ts`, `src/web/src/lib/team-flags.test.ts`, `src/web/src/components/leaderboard/types.test.ts` |
| Assets | `src/web/public/assets/awards/`, `src/web/public/assets/leaderboard/`, `src/web/public/assets/credits/` |
| Specs | `docs/specs/predictions-replay.spec.md`, `the-ledger.spec.md`, `docs/specs/components/credits-reel.spec.md`, `credits-reel-awards.spec.md`, `docs/specs/interfaces/ledger-data.ispec.md`, `ledger-page.ispec.md`; then the matching rows in `docs/specs/README.md` |

To hide it without removing code: unset `GOOGLE_SPREADSHEET_ID`, or `GOOGLE_SA_KEY` (which the committee todo page also needs, so unsetting it switches that page off as well). The data API then returns 404 (read from code). The pages still render and the "Awards" nav link stays. How the pages look with no data was not checked. If you want a reunion-specific contest instead, keep the structure and replace the content in `awards-data.ts`.

#### Magazine

| Part | Files |
|---|---|
| Route | `/magazine` in `App.tsx` |
| Links | `SiteNav.tsx` ("Magazine", desktop and mobile); `src/web/src/pages/HomePage.tsx` ("Read the souvenir magazine") |
| Code | `src/web/src/pages/MagazinePage.tsx`, `src/web/src/components/magazine/`, `src/web/src/lib/magazine.ts`, `magazine-scroll.ts` |
| Styles | The `Magazine scroll intro` block in `src/web/src/index.css` (rules starting `.magazine-`; search for `magazine-intro`) |
| Copy elsewhere | `src/web/src/components/registration/PhotoId.tsx` tells registrants their photo "will be featured in the event magazine". Reword or remove that sentence |
| Tests | `src/web/src/pages/MagazinePage.test.tsx`, `src/web/src/lib/__tests__/magazine-scroll.test.ts`, `magazine-select-intro.test.ts` |
| Spec | `docs/specs/magazine-viewer.spec.md`, and its row in `docs/specs/README.md` |

There is no API. The viewer loads issue files from `MAGAZINE_CDN_ORIGIN` in `magazine.ts`, which now comes from the `cdnUrl` in `site.config.json`. Those files are not in this repository, so keeping the magazine means building your own issue and hosting it.

#### Memory stories and autograph

| Part | Files |
|---|---|
| Switch | (a) the four story flags in 3.1. With all four off, the feature is hidden. |
| Routes | `/memories/stories` and `/autograph` (a redirect) in `App.tsx` |
| Links | `SiteNav.tsx` ("Autograph"); `HomePage.tsx` renders `<MemoryStoriesSection />` |
| Code | `src/web/src/pages/AutographPage.tsx`, `src/web/src/components/autograph/`, `src/web/src/components/home/MemoryStoriesSection.tsx` |
| API | `src/server/src/routes/memory-stories.routes.ts`, `admin-memory-stories.routes.ts`, `src/server/src/services/memory-story.service.ts`, `src/server/src/repositories/memory-story.repo.ts`, `src/shared/src/memory-stories.ts`; three mounts in `app.ts` |
| Shared exports | The two `memory-stories.ts` re-export blocks in `src/shared/src/index.ts` (constants and types) |
| Web API client | The story functions and types in `src/web/src/lib/api.ts` (`fetchPublicStories`, `fetchAuthorState`, `createStory`, `updateStory`, `deleteStory` and the story response types imported at the top) |
| Styles | The `Autograph page` block in `src/web/src/index.css` (rules starting `.autograph-`) |
| Tests | `src/server/src/__tests__/memory-story.repo.test.ts`, `memory-story.service.test.ts`, `src/web/src/__tests__/autograph-redirect.test.tsx` |
| Assets | `src/web/public/assets/stories/` |
| Spec | `docs/specs/memory-stories.spec.md`, `docs/specs/interfaces/memory-stories.ispec.md`, and their rows in `docs/specs/README.md` |
| Also | Remove the four flag entries from `src/shared/src/feature-flags.ts`. |

Keep the migrations `0024` and `0025`.

#### LED wall

| Part | Files |
|---|---|
| Routes | `/led-wall`, `/led-wall/precache`, `/debug/led-wall` in `App.tsx`. No nav or home link points to the wall. |
| Code | `src/web/src/pages/LedWallPage.tsx`, `LedWallPrecachePage.tsx`, `LedWallDebugPage.tsx`; the whole folder `src/web/src/components/led-wall/` |
| API | `GET /api/public/desk-roster` and `GET /api/public/wall-image-manifest` in `src/server/src/routes/public.routes.ts`. Remove them only if nothing else uses them. |
| Other | The photo cache rule `led-wall-photos` in `src/web/vite.config.ts` (its host list comes from `site.config.json`); the precache URL helper in `src/web/src/lib/api.ts` |
| Tests | Tests inside the `led-wall/` folder and beside the three pages; `src/server/src/__tests__/desk-roster.test.ts` |
| Assets | `src/web/public/assets/led-wall/` |
| Spec | `docs/specs/led-wall.spec.md`, `docs/specs/interfaces/led-wall-data-source.ispec.md`, and their rows in `docs/specs/README.md` |

The wall polls the desk roster: a change every 3 seconds and a full refresh every 60 seconds (reported). It shows names and photos of people who are checked in, so it needs the desk and photo upload. Membership depends on desk check-in, not on payment status; the desk is what refuses a check-in while money is owed (3.6).

#### Committee todos

A public page backed by a Google Sheet, for the organising committee.

| Part | Files |
|---|---|
| Route | `/committee/todos` in `App.tsx` |
| Code | `src/web/src/pages/CommitteeTodosPage.tsx`, `src/web/src/components/committee/`, `src/web/src/lib/committee.ts` |
| API | `src/server/src/routes/committee.routes.ts`, `src/server/src/services/committee.service.ts`; the committee block and mount in `app.ts` |
| Secrets | `GOOGLE_COMMITTEE_SHEET_ID`, `GOOGLE_SA_KEY` |
| Test | `src/server/src/routes/__tests__/committee.routes.test.ts` |
| Script | `scripts/committee-todo-cli.py` |
| PWA | `VitePWA` block in `src/web/vite.config.ts`; icons in `src/web/public/assets/pwa/` |

Two things to know. First, anyone who has the URL can read the list and write to it; the route file calls this "honor-system" (read from code). Second, the installed app (PWA) has the manifest name "Smriti Committee Todo" and starts at `/committee/todos?source=pwa`. If you remove the route, change or remove the manifest, or installs open a 404.

#### Sponsor and donate

| Part | Files |
|---|---|
| Route | `/sponsor` in `App.tsx`; `/donate` redirects to it in `src/web/public/_redirects` |
| Link | `HomePage.tsx` ("Want to support the reunion?") |
| Code | `src/web/src/pages/SponsorPage.tsx`; the `sponsor.html` variant in `src/web/vite.config.ts` (its address is built from `siteUrl` in `site.config.json`); `src/web/public/assets/og-sponsor.jpg`; `src/web/src/components/ui/SponsorNote.tsx` |

The page has no API call; its button goes to `/register`. Giving money is a separate path: the wizard option "donation only", with its own pricing, emails and a refusal to issue a pass. Removing that option touches shared types, pricing, `src/web/src/lib/step-config.ts` and the emails in `src/server/src/infra/email-templates.ts`. Tests: `src/shared/src/__tests__/donation-only-contract.test.ts`, `src/web/src/__tests__/registration-flow/donation-only-submit.test.tsx`.

#### Room allocation and accommodation

These are two layers. Accommodation is the hotel choice in wizard step 4 and the price that goes with it. Allocation is the staff tooling that assigns people to rooms.

| Part | Files |
|---|---|
| Allocation routes | `/staff/allocation`, `/staff/rooms`, `/staff/resources` in `App.tsx` |
| Allocation links | `SiteNav.tsx` (Resources, Allocation); `ResourcesPage.tsx` links to `/staff/rooms` |
| Allocation code | `src/web/src/pages/AllocationPage.tsx`, `RoomInventoryPage.tsx`, `ResourcesPage.tsx`, `src/web/src/components/allocation/` |
| Allocation API | `src/server/src/routes/allocation.routes.ts`, `room-assignment.routes.ts`, `accommodation.routes.ts`; services `room-assignment.service.ts`, `availability.service.ts`; repositories `room.repo.ts`, `inventory.repo.ts` |
| Scripts | `scripts/allocate-rooms.py`, `allocate_rooms_lib.py`, `query-accommodation-stats.py` |
| Tests | `src/server/src/__tests__/allocation.test.ts`, `room-assignment-api.test.ts`, `room-availability.test.ts`, `accommodation.test.ts` and the `allocation-*` tests beside them |
| Specs | `accommodation.spec.md`, `room-assignment.spec.md`, `room-availability.spec.md`, `roommate-preferences.spec.md`, `staff-resources.spec.md` in `docs/specs/` |

If your reunion has no overnight stay, do not delete the staff screens first. Remove step 4 and the accommodation pricing (3.7), then the allocation tooling.

### 3.6 Features with no switch, and why it matters

- **Accommodation** has no skip rule and no flag. See 3.7.
- **Prediction contest** has no flag. Unsetting its secrets removes only the data.
- **Magazine** has no flag. It loads issue files from your `cdnUrl`; the Smriti issues are not in this repository.
- **LED wall** has no flag, no link and no login. Anyone with the URL can open it, and it shows photos of checked-in people.
- **Committee todos** has no flag and no login (see its section above).
- **Who's coming** is public and has no flag. See "Decide before launch: who's coming is public" below.

#### Decide before launch: who's coming is public

By default, `GET /api/public/whos-coming` and the `/whos-coming` page show every registration whose participation type is `full_celebration` or `campus_only`: full name, branch, city, country and a thumbnail photo. The filter does not look at payment status, so people who registered and have not paid appear too. Anyone can read it without logging in. There is no consent step in the wizard and no switch (read from `src/server/src/routes/public.routes.ts`, not run against a live site). The response also carries an 8-character hash of each email, which the avatar code uses, and the numeric registration id.

Photo thumbnails sit at addresses that use the numeric registration id, so they can be guessed (read from code, not tested).

Decide this before you open registration, and tell registrants what you chose. Options, from least to most code:

| You want | What to change |
|---|---|
| Keep it as is | Say plainly in the wizard (and your announcement) that the name, branch, city, country and photo of every registrant are public. |
| Show paid registrations only | In `public.routes.ts`, add a payment-status condition to `ELIGIBLE_WHERE` (registration status `confirmed`), update the route tests and `docs/specs/` for who's coming. |
| Show only people who agree | Add a consent field to the wizard (shared types, Zod schema in `src/shared`, a migration for the column, the wizard step), then filter on it in `ELIGIBLE_WHERE`. |
| Hide the page completely | Remove the route and the API handler, using the "Who's coming" row in 3.4 and the removal pattern in 3.5. |

The `scripts/whos-coming.py` report has its own filter and includes pending registrations; share it only as ADMIN.md section 4 allows.

#### What payment status controls

Payment status gates **only desk check-in**. The desk refuses a check-in while money is outstanding. It does not gate who's coming, the entry pass PDF (any registration that is not donation-only can download it) or whether someone appears on the LED wall (that needs a desk check-in). The "My Pass" menu link is shown only for confirmed registrations, but that is a menu rule in the browser, not an API check. If you need payment to gate any of these, it is a code change.

### 3.7 Accommodation in detail

`accommodationEnabled` in `PRICING_DEFAULTS` (`src/shared/src/constants.ts`) is a constant set to `true`. Pricing reads it, but the wizard step skip rule in `src/web/src/lib/step-config.ts` does not: step 4 is skipped only for "donation only" and "campus only" participants (read from code). Setting the constant to `false` therefore stops the charge but, as far as the code shows, still shows step 4. To drop accommodation completely, ask the agent to remove step 4 (and renumber to six steps), the accommodation branches in `src/shared/src/pricing.ts`, the accommodation blocks in `constants.ts`, the accommodation line on the pass (`src/server/src/assets/pass/fields.json` and `src/server/src/services/pass-pdf.service.ts`), the accommodation lines in the email templates, the desk ledger, the reports, and the debug pages. Breakfast pricing depends on accommodation. Keep the migrations.

---

## 4. Rebrand

Do these in this order: logo, colors, fonts, favicon and app icons, page metadata, header and footer, culture-specific copy, emails, pass and ID cards.

### 4.1 Logo

| What | Where |
|---|---|
| Main logo file | `src/web/public/assets/smriti-logo.png`. Rendered by `src/web/src/components/ui/SmritiLogo.tsx` (alt text "Smriti"). |
| Favicon | `src/web/index.html` (`<link rel="icon">` points to the same PNG) |
| Nav labels | `src/web/src/components/SiteNav.tsx` (`aria-label` "Smriti 2026 — Home") |
| LED wall copy of the logo | `src/web/public/assets/led-wall/smriti-logo.png`, used by `components/led-wall/RotationLayer.tsx` and `SpotlightLayer.tsx` |
| Desk artwork | `src/web/public/assets/desk/` (welcome ribbon and attendance stamp) |
| ID-card logo | `scripts/idcard-mailmerge/assets/smriti-logo.png` |
| Building hero images | `src/web/public/assets/tkmce-building-hero-desktop.png`, `tkmce-building-hero-centered.png`, `confirmation/building-backdrop-desktop.png` (college building art) |

To find every use: `git grep -n "smriti-logo"`. The component is named `SmritiLogo`; renaming it is optional.

### 4.2 Colors

Brand tokens are in the `@theme` block of `src/web/src/index.css`: `soft-aqua` `#B9DFE2`, `terracotta` `#D76B51`, `charcoal` `#1F2A33`, plus deeper and ink variants, `page` `#F5F0E8` and `surface` `#FDFBF7`. Changing the tokens re-colors everything that uses Tailwind classes such as `bg-terracotta`.

It does not re-color hardcoded values. A search on this tree finds about 1,100 six-digit hex colors in 116 non-test files under `src/web/src`:

```bash
git grep -nE '#[0-9A-Fa-f]{6}\b' -- src/web/src ':!*.test.*' | wc -l
```

Also hardcoded elsewhere: `<meta name="theme-color">` in `src/web/index.html`; `theme_color` and `background_color` in the manifest in `src/web/vite.config.ts`; branch colors in `src/shared/src/constants.ts` (`BRANCH_COLORS`); colors in `src/server/src/assets/pass/fields.json`; the inline CSS in `layout()` in `src/server/src/infra/email-templates.ts`.

How to ask an agent to do this safely: have it list the distinct hex values with counts first, sort them by closeness to the old palette, and propose a mapping old to new. Keep meaningful colors fixed (veg and non-veg markers, status colors, branch colors unless you also change branches). Apply the mapping only to the values you approved, one folder at a time, and look at the result on localhost. See the prompt in section 7.

### 4.3 Fonts

| Token | Family | How it is loaded |
|---|---|---|
| `--font-heading` | Playfair Display | Self-hosted by `scripts/download-fonts.mjs` |
| `--font-body` | DM Sans | Self-hosted |
| `--font-accent` | Caveat | Self-hosted |
| `--font-malayalam` | Noto Sans Malayalam | Self-hosted |
| `--font-sport` | Oswald | **Not self-hosted.** Loaded from Google at runtime by a `<link>` in `src/web/index.html` |

`make fonts` runs `scripts/download-fonts.mjs`, which writes `src/web/public/fonts/*.woff2` and `src/web/src/fonts.generated.css`. Both are git-ignored. `make dev` (and `npm run dev`) run the script by themselves when the CSS file is missing, and the CI deploy runs it too. Run `make fonts` yourself only after you change the font list. To change families, edit the Google Fonts URL in `download-fonts.mjs` and the tokens in `src/web/src/index.css`. Font hosts are also listed in the Content-Security-Policy, in the meta tag of `src/web/index.html` and in `src/web/site-templates/_headers.tpl`. If you drop Google-hosted Oswald, remove its `<link>` in `index.html`.

Other fonts: the entry pass uses `src/server/src/assets/pass/DMSans-*.ttf`; the ID card uses fonts in `scripts/idcard-mailmerge/assets/fonts/` named in `layout.json`. The flag-emoji font `twemoji-country-flags.woff2` is referenced from `index.css` but is not in the repository and no script creates it, so country flags fall back to system fonts (checked: not in `git ls-files` or the generated fonts folder). Only the World Cup pages use flags.

### 4.4 Favicon, app icons, manifest

- Icons: `src/web/public/assets/pwa/` (`icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-180.png`).
- Manifest: the `VitePWA` block in `src/web/vite.config.ts` (name "Smriti Committee Todo", short name "Committee", `start_url`). This describes the committee app, not the public site. See 3.5, Committee todos.
- iOS title: `apple-mobile-web-app-title` in `src/web/index.html` is "Committee".

### 4.5 Page metadata, social cards, search

All in `src/web/index.html` unless noted:

- `<title>`, `<meta name="description">`, canonical URL.
- Open Graph and Twitter tags; the card image is `src/web/public/assets/og-card.jpg` (1200 by 630).
- The JSON-LD `Event` block: name, dates, venue, city, organizer and two offers with prices. The prices here are typed by hand and duplicate `PRICING_DEFAULTS`.
- Sponsor page variant: `src/web/vite.config.ts` (title, description, `og-sponsor.jpg`, URL).
- Title suffix and description: `src/web/src/hooks/useDocumentTitle.ts`.
- `robots.txt`, `sitemap.xml` and the security headers (`_headers`) are generated at build time from the templates in `src/web/site-templates/`, with your `siteUrl` and CDN hosts from `site.config.json`. The generated files are never committed. Edit the templates only to change their content, not their addresses.

### 4.6 Header, footer and page copy

| Where | What to change |
|---|---|
| `src/web/src/components/SiteFooter.tsx` | Tagline, copyright line ("The Batch of 2006, TKMCE"), and the developer credit |
| `src/web/src/components/staff/StaffFooter.tsx` | Staff footer text |
| `src/web/src/components/SiteNav.tsx` | Nav labels and the logo label |
| `src/web/src/pages/HomePage.tsx` | Hero, schedule, venue, sponsor and connect copy |
| `src/web/src/components/registration/Hero.tsx` | Registration hero: dates, place, subtitle |
| `src/web/src/pages/ConnectPage.tsx` | Social handles, group names, countdown text |
| `src/web/src/pages/SponsorPage.tsx` | Cause text |
| `src/web/src/lib/constants.ts` | Wizard labels such as "I'll be there in person on August 15" |
| `src/shared/src/constants.ts` | Participation labels, such as "Campus Celebration" |

**The COMSKYS'06 footer easter egg.** The footer shows a small terminal that types `./credits` and then prints `COMSKYS'06`, with the aria-label "Developed by Comskys'06". It is a credit to the original developer group, not an event value. Keep it as an acknowledgement, or replace the two strings at the top of `SiteFooter.tsx` with your own team's name, or remove the `ComskysTerminal` component and its use.

To catch strays after you edit: `git grep -niE 'smriti|tkmce|2006|raviz|kollam|comskys|ashtamudi'` (see also section 5).

### 4.7 Malayalam and culture-specific copy

- **Credits reel:** names, roles and portraits in `src/web/src/components/credits/credits-data.ts`. The images are one placeholder, `src/web/public/assets/credits/placeholder-person.svg`. The five names in `credits-data.ts` are the real names of this project's contributors, on purpose: they are credits, and they stay unless you decide to replace them. Every other fixture in the repository (who's coming mock data, awards data, debug pages) is synthetic.
- **Awards:** `src/web/src/lib/awards-data.ts` holds the award titles, page text and the tournament predictions. They reference the World Cup and in-jokes of the Smriti batch. The sticker file names under `src/web/public/assets/awards/stickers/` are those jokes too.
- **Malayalam rendering:** the `:lang(ml)` rule in `index.css`, the font switch by Unicode range in `src/web/src/components/autograph/AutographEntryCard.tsx`, and the Noto Sans Malayalam download. If your batch writes in another script, you need a matching font in `download-fonts.mjs` and a similar rule.
- **Scripts of other languages in stories:** the autograph wall switches fonts for Malayalam only.
- **Hero and leaderboard text** that mention the World Cup: `LeaderboardHero.tsx`, `ReplayHero.tsx`, `PredictionAwardsPage.tsx`.

### 4.8 Email

Sender, subjects and signature are code, not settings.

- Sender display name: `senderName` in `site.config.json`, passed to the Worker as `SENDER_NAME`. The address is `noreply@<MAILGUN_DOMAIN>`. Link addresses come from `siteUrl` (`APP_BASE_URL`); there is no default host. The story-hidden notice lives in `src/server/src/infra/email.service.ts`.
- About 15 subject lines, the header (`<h1>Smriti 2026</h1>`), tagline, footer and the sign-off "Smriti 2026 Organizing Committee": `src/server/src/infra/email-templates.ts`. Body copy there also contains dates and the venue.
- Without Mailgun, nothing is sent. A local API (`APP_BASE_URL` is `localhost`) prints a box with the link to its terminal (run). A deployed Worker logs `email is not configured` and leaves the link out, so a deployed site without Mailgun has no working login (docs/DEPLOYMENT.md, "Production safety").
- `EMAIL_ALLOWED_DOMAINS` (comma-separated): when set, only recipients in those domains get mail.
- Known issue (reported, not solved): in June 2026 the original team saw mail from their Mailgun domain land in an Outlook junk folder even with SPF, DKIM and DMARC passing. Test with an Outlook and a Gmail address early.

### 4.9 Entry pass PDF and ID cards

- **Pass:** `src/server/src/assets/pass/template.pdf` has the artwork baked in; you cannot edit it as text. Make a new template of the same page size and update the field positions and colors in `src/server/src/assets/pass/fields.json`. PDF metadata (title "Smriti 26 - Entry Pass") is in `src/server/src/services/pass-pdf.service.ts`. Labels come from `PARTICIPATION_LABELS` and `ACCOMMODATION_LABELS` in `src/shared/src/constants.ts`.
- **ID cards:** the card layout is `scripts/idcard-mailmerge/layout.json`; literal text such as "TKMCE BATCH OF 2006" is in it. Assets are in `scripts/idcard-mailmerge/assets/`. Running it is covered in ADMIN.md.

### 4.10 Remaining branding copy: what `make doctor` lists

After you edit the config files, `make doctor` still lists the branding text and assets in code, because those are copy, not configuration. Work through the list below, then run `make doctor-strict` until it passes. These are the files at the time of writing; run `make doctor` for the current lines.

| Area | Files |
|---|---|
| Page metadata and head | `src/web/index.html`, `src/web/vite.config.ts` (sponsor page title and description, PWA manifest names) |
| Header, footer, titles | `SiteNav.tsx`, `SiteFooter.tsx`, `staff/StaffFooter.tsx`, `src/web/src/hooks/useDocumentTitle.ts` |
| Pages | `HomePage.tsx`, `ConnectPage.tsx`, `RegisterPage.tsx`, `PaymentAdvicePage.tsx`, `AllocationPage.tsx`, `DailyReportPage.tsx`, `DebugPage.tsx`, `registration/Hero.tsx`, `confirmation/ThankYouCard.tsx`, `committee/PeopleGrid.tsx` |
| Contest and stories | `awards/AwardsHero.tsx`, `autograph/AutographHero.tsx`, `credits/credits-data.ts` |
| Email | `src/server/src/infra/email-templates.ts` (about 33 lines), `email.service.ts`, `src/server/src/routes/debug.routes.ts`, `src/server/scripts/send-mailgun-spike.ts` |
| Pass PDF | `src/server/src/services/pass-pdf.service.ts` |
| ID cards | `scripts/idcard-mailmerge/layout.json`, `editor/defaults.json`, `editor/index.html`, `editor/package.json`, `idcards.py`, `Makefile` |

Paths under `src/web/src/` are shortened above to the file name; search for the name. The ID-card logo and the LED wall logo are image files, not text, so `make doctor` does not list them; see 4.1.

---

## 5. Event facts

### 5.1 Where they live

`src/shared/src/constants.ts` holds most of them. The server and the browser both read this one file, so a change here reaches pricing, validation and the displays that use it.

| Fact | Name in `constants.ts` (search for it) |
|---|---|
| Registration goals, target date, budget | `EVENT_GOALS` |
| Branches (departments), short names, colors | `BRANCHES`, `BRANCH_SHORT_NAMES`, `BRANCH_COLORS` |
| Prices, fees, ages, tax, platform fee | `PRICING_DEFAULTS` |
| College contribution, giving causes | `COLLEGE_CONTRIBUTION_*`, `CONTRIBUTION_CAUSES` |
| Venue and accommodation options and copy | `ACCOMMODATION_*` |
| Check-in and check-out dates | `CHECKIN_OPTIONS`, `CHECKOUT_OPTIONS` |
| Cost breakdown shown to registrants | `COST_CATEGORIES` |
| Sponsorship adjustment and note | `SPONSORSHIP_*` |
| Payee and bank details | `PAYMENT_UPI_VPA_B64`, `PAYMENT_PAYEE_NAME`, `PAYMENT_UPI_MCC`, `PAYMENT_UPI_ORG_ID`, `PAYMENT_BANK_DETAILS_B64` |

Prices must stay in `PRICING_DEFAULTS` and never be copied into components. Exceptions you must update by hand: the two prices in the JSON-LD block of `src/web/index.html`, and any text that quotes an amount (cost breakdown notes in `constants.ts`, email bodies). Search for the old amounts: `git grep -nE '8500|5500|2700|2910'`.

Branch names are stored in the database as typed. If you change `BRANCHES` after real registrations exist, old rows keep the old names.

### 5.2 Dates

The event dates (14 to 16 August 2026 in the original) are typed as text in more than 30 source files, because the list of nights is duplicated. Find every occurrence before you change any:

```bash
git grep -nE '2026-08-1[3-6]|(August|Aug) 1[3-6]|1[3-6](th|st)? (August|Aug)' -- src scripts
git grep -nE '2026-0[5-9]|August 2026|Aug 2026' -- src scripts
```

The first pattern found 84 files on this tree, tests and debug pages included. The important ones: `src/shared/src/constants.ts` (check-in and check-out options, target date), `src/server/src/repositories/attendee.repo.ts` and `src/server/src/services/availability.service.ts` (each has its own `NIGHTS` list), `src/web/src/pages/RoomInventoryPage.tsx`, `ResourcesPage.tsx`, `src/web/src/components/registration/Accommodation.tsx`, `src/web/src/components/allocation/RoomTogetherModal.tsx`, `src/web/src/lib/constants.ts`, `src/web/src/pages/LedWallPage.tsx`, the email templates, `src/web/index.html`, and the page copy files in 4.6. Also update `sitemap.xml` last-modified.

Whether you change the number of event days or nights matters. A different number of nights needs a code change in each `NIGHTS` list and in the room inventory pages, not only a text replacement. Tell the agent which it is.

### 5.3 Payment placeholders: replace before going live

| Item | Placeholder | File |
|---|---|---|
| UPI ID | base64 of `yourassociation@bank` | `PAYMENT_UPI_VPA_B64` in `src/shared/src/constants.ts` |
| Payee name | `YOUR ALUMNI ASSOCIATION` | `PAYMENT_PAYEE_NAME`; also `scripts/convert-sbi-html-to-text.py` |
| UPI category code | `8398` | `PAYMENT_UPI_MCC` |
| Bank's UPI organization ID | `000000` | `PAYMENT_UPI_ORG_ID` (specific to your bank) |
| Bank account block | base64 of a text block "Bank: Your Bank Name ..." | `PAYMENT_BANK_DETAILS_B64`. Create it with `base64 < your-bank-details.txt`. |
| UPI note prefix | `TKMCE Reunion 2026 - ` | `src/shared/src/upi.ts` |

The statement importer (`src/server/src/lib/sbi-statement-parser.ts`) reads State Bank of India statement text only. If your bank is different, the parser and `scripts/convert-sbi-html-to-text.py` need rewriting for your statement format. Without a matching parser, staff can still verify payments by hand.

### 5.4 First admin

`src/server/migrations/0003_users_and_auth.sql` inserts the admin user `admin@example.com`. It is the only way the first admin exists, and it runs on every database that applies migrations, including staging and production. Edit the email **before** the first remote migration. If a database already ran the file, editing it changes nothing; add staff or fix the user with a new forward migration or the staff team page. For a local database you can delete `src/server/.wrangler/` and run `make db-migrate-local` again (run).

### 5.5 Other event text and links

- Venue and vendor names: `constants.ts` (venue, cost table, sponsorship note), `src/web/src/components/registration/participation-postcards.ts`, `PostcardCollage.tsx`, `EventTimeline.tsx`, `PhotoId.tsx`, `CampusOnlyCard.tsx`, `src/web/src/components/ui/SponsorNote.tsx`, `src/web/src/pages/ResourcesPage.tsx`.
- Social links: `src/web/src/pages/ConnectPage.tsx` (Instagram handle; `REPLACE_WITH_PAGE` and `REPLACE_WITH_GROUP_INVITE` placeholders), `src/web/src/components/confirmation/WhatsNextPanel.tsx` (WhatsApp invite).
- Contest rules and sign-up links: `src/web/src/components/leaderboard/ScoringRules.tsx` (placeholders).
- Images that are placeholders: venue and performer postcards in `src/web/public/assets/registration/postcards/`, `polaroids/`, `home-memory-corridor.jpg`.
- People and fixtures: `credits-data.ts` holds the real names of the five contributors, on purpose. The rest is synthetic: `src/web/src/components/whos-coming/mock-data.ts`, `awards-data.ts`, the debug pages, `scripts/idcard-mailmerge/fixtures/attendees.json`.
- Package scope `@smriti/*` in each `package.json` and about 60 imports. Cosmetic. Rename only if you want to.

---

## 6. Config files, domains and Cloudflare names

Two committed files hold your identity and infrastructure. Edit them, then run `make doctor`. Nothing in them is a feature switch: features change in code (section 3). Secrets never go in them.

### 6.1 `site.config.json`: identity and URLs

| Key | What it is |
|---|---|
| `eventName`, `eventSubtitle`, `eventTitle` | Names used by report scripts and room-allocation sheets |
| `senderName` | Display name on emails (becomes the Worker variable `SENDER_NAME`) |
| `githubRepo` | `owner/repo`, read by the `ci` script |
| `environments.stg` and `environments.prod`: `siteUrl` | The site address. It sets canonical and Open Graph URLs, the sitemap, the security headers and the Worker's `APP_BASE_URL` (login and payment link address, and the one allowed browser origin) |
| `environments.<env>.cdnUrl` | Host for portraits (`<cdnUrl>/portraits`), the LED wall and the magazine |
| `environments.<env>.publicThumbsUrl` | Optional. Host of the public thumbnails bucket |
| `environments.<env>.pagesProject` | Cloudflare Pages project name. It lives here, not in `wrangler.toml`, because a Pages project is not Worker configuration |
| `reports.bucket`, `reports.prefix` | A private bucket for report upload. Empty keeps reports local |
| `sheets.attendance.*` | The attendance Google Sheet (ID, tab names, status column) |

### 6.2 `src/server/wrangler.toml`: Cloudflare infrastructure

Account ID, Worker names, routes, D1 database names and IDs, R2 bucket names, for staging (top level) and production (`[env.production]`). It has no URL variables; `scripts/deploy.sh` passes those from `site.config.json`. Replace every `REPLACE_WITH_*` value. [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) shows how to create each resource.

### 6.3 What `make doctor` checks

`make doctor` lists every value that still equals the Smriti example (domains, resource names, event name, title and subtitle) in the config files, code, static files and branding copy. It also lists the same strings in docs and tests, without counting them. It then checks that the files agree: route hosts in `wrangler.toml` against `siteUrl`, no URL variable in `wrangler.toml`, one owner for each value, required keys present, `.env.ops` present. It exits 0 in this repository because the repository is the example. `make doctor-strict` exits non-zero while any example value is left in the config files, code, static files or branding copy, or while a `REPLACE_WITH_*` value or the `.env.ops` token is missing. Run it before launch.

### 6.4 Where the values go (no hand edits needed)

| What | How it follows your config |
|---|---|
| Link host and CORS origin | The Worker reads `APP_BASE_URL`, passed by `deploy.sh` from `siteUrl`. Missing: every API call returns a 500 configuration error |
| Content-Security-Policy and security headers | Generated from `siteUrl`, `cdnUrl` and `publicThumbsUrl`: the web side from `src/web/site-templates/_headers.tpl` and the meta tag in `src/web/index.html`, the API side from `PUBLIC_THUMBS_URL` and `PUBLIC_PORTRAITS_URL` |
| Canonical, Open Graph, sitemap, robots | `src/web/index.html` placeholders and the templates in `src/web/site-templates/`, filled by the Vite config at build time |
| LED wall photo cache and magazine host | `__CDN_URL__` in `src/web/vite.config.ts` and `src/web/src/lib/magazine.ts`, from `cdnUrl` |
| Pages project and D1 database for `deploy.sh` and `make stg-*` | Read from the two files. Local migrations use the binding name `DB` and need no name |
| Email domain | Worker secret `MAILGUN_DOMAIN` |
| GitHub branches and environments | `.github/workflows/deploy.yml`. The only CI secret is `CLOUDFLARE_API_TOKEN` (the deploy token); there are no repository variables |

The one place that cannot follow the config is the registration-code prefix, `REG_CODE_PREFIX` in `src/shared/src/reg-code.ts` (`SMRT` in the original). It is baked into stored registration codes and file keys, so change it before the first real registration or not at all.

### 6.5 Rules that cost the original team time

- CI deploys only when a commit reaches `release/stg` or `release/prod`. A commit on `main` alone deploys nothing (reported: a new API route returned 404 on both sites until `main` was merged into the release branches).
- The deploy script publishes Pages with `--branch main`. Check that matches the production branch of your Pages project.
- Staging and production need different `JWT_SECRET` values.
- A Worker deployed without `deploy.sh` has no `APP_BASE_URL` and fails closed. Always deploy through CI or `deploy.sh`.

---

## 7. Example prompts

Copy a prompt, replace the parts in angle brackets, and send it. Each prompt names what to verify. If the agent skips the "show me first" step, stop it. "Checks" means `make check`, `make test-web`, `make test-server` and `make test-shared` (or `make test` for all three).

### Scope and plan

1. **Plan the adaptation.**
   > Read MAKE-IT-YOURS.md and AGENTS.md. Our event: <name>, <dates>, <venue>, <batch year>, <college>. We want these features: <list>. Write a numbered plan with one item per section of MAKE-IT-YOURS.md that applies. For each item list the files you expect to touch. Do not edit anything.

   Verify: the plan matches your list of features and does not include removals you did not ask for.

2. **Find out what you are about to remove.**
   > List every file, route, nav link, API mount, test, asset and spec that belongs to <feature>, using the removal set in MAKE-IT-YOURS.md section 3.5 as a start and searching imports to check it. Flag anything outside the feature that imports from it. Do not edit.

   Verify: the list includes any shared file the coupling table warns about.

### Remove features

3. **Prediction contest.**
   > Remove the prediction contest entirely: routes, nav links, API routes, components, tests and assets. Keep the migrations. Keep `src/web/src/components/leaderboard/department.ts` because room allocation imports it. Show me the list of files before editing, then run `make check` and the web and server tests.

   Verify: `make check` and tests pass; `git grep -nE 'awards|leaderboard|predictions' -- src` shows only intended leftovers; `/awards` shows the not-found page on localhost.

4. **Magazine.**
   > Remove the magazine viewer: the `/magazine` route, the nav and home links, `MagazinePage`, `src/web/src/components/magazine/`, `lib/magazine*.ts`, their tests and `docs/specs/magazine-viewer.spec.md`. Show the file list first. Then run the checks.

   Verify: home page and nav render without a broken link.

5. **Memory stories.**
   > Remove memory stories and the autograph wall: routes, nav link, home section, API routes, services, repository, shared types, the four flags in `feature-flags.ts`, tests, assets and spec. Keep migrations 0024 and 0025. List the files first, then run the checks.

   Verify: `/staff/config` lists five flags; home page loads.

6. **LED wall.**
   > Remove the LED wall: the three routes, the pages, `src/web/src/components/led-wall/`, the `led-wall-photos` cache rule in `vite.config.ts` and the wall assets. Check whether `/api/public/desk-roster` and `/api/public/wall-image-manifest` have another user before removing them. Keep the desk. List first, then run the checks.

   Verify: desk page still works; tests pass.

7. **Committee todos.**
   > Remove committee todos and the installed-app manifest that points to it: the route, page, components, `lib/committee.ts`, the committee API route and service, the `VitePWA` manifest block and the PWA icons. Keep `components/whos-coming/utils.ts`, which the committee screens import. List first, then run the checks.

   Verify: `make build` succeeds; no `/committee` string remains.

8. **Sponsor page.**
   > Remove the sponsor page and `/donate` redirect: the route, `SponsorPage`, the home link, `public/_redirects` line, the `sponsor.html` variant in `vite.config.ts` and `og-sponsor.jpg`. Do not touch the "donation only" registration option. List first.

   Verify: `make build` produces no `sponsor.html`; the wizard still offers "donation only".

9. **No overnight stay.**
   > We have no accommodation. Remove wizard step 4 and renumber to six steps, the accommodation pricing branches and constants, the accommodation line on the pass and in emails, the desk and report columns, and the debug page parts. Keep the migrations and the allocation tooling for now. Update the wizard draft golden fixtures and tests. Show me the plan first because this touches many files.

   Verify: checks pass; the wizard reaches review with a full-celebration participant; the price estimate has no stay line.

### Rebrand

10. **Colors.**
    > Our brand colors are <primary hex>, <secondary hex>, <dark hex>, <background hex>. First, update the `@theme` tokens in `src/web/src/index.css` only. Then list every distinct hex value hardcoded under `src/web/src` with counts, group the ones close to the old Smriti palette, and propose a mapping old to new. Wait for my approval before replacing any. Leave veg and non-veg colors, status colors and branch colors alone.

    Verify: look at home, `/register`, `/staff/dashboard` and `/debug` on localhost; `make check`.

11. **Logo.**
    > Replace the logo with `assets/our-logo.svg` everywhere it appears: `smriti-logo.png` usages (`git grep -n smriti-logo`), the favicon, the PWA icons in `src/web/public/assets/pwa/`, the OG card `og-card.jpg`, the LED wall logo and the ID-card logo. Tell me which image files I must supply in which sizes; do not invent them.

    Verify: favicon and nav logo on localhost; `git grep -n smriti-logo` is empty or intended.

12. **Fonts.**
    > Change the heading font to <family>. Update the Google Fonts URL in `scripts/download-fonts.mjs`, the `--font-heading` token in `src/web/src/index.css`, and the font hosts in the Content-Security-Policy (meta tag in `src/web/index.html` and `src/web/site-templates/_headers.tpl`) if the host changes. Then run `make fonts` and show me the page.

    Verify: the heading font renders; the browser console shows no CSP error.

13. **Event name and copy.**
    > Replace the event name "Smriti 2026" with "<our name>" and "TKMCE 2006 Batch Reunion" with "<our line>". Search `git grep -niE 'smriti|tkmce|2006'` first and show me the grouped list: page copy, email copy, code identifiers, comments. Change page and email copy only. Do not rename code identifiers or the `@smriti/*` package scope.

    Verify: the grep returns only identifiers and comments; `make check`.

14. **Footer credit.**
    > In `SiteFooter.tsx`, replace the `./credits` and `COMSKYS'06` strings with "<our command>" and "<our team name>", and update the aria-label. Keep the animation.

    Verify: footer on localhost.

15. **Emails.**
    > Change the email sender name, subject lines, header, footer and sign-off in `email-templates.ts` and `email.service.ts` to our event: <name>, <signature>. Show me a table of old and new subject lines before editing. Then trigger one email locally (without Mailgun it prints to the API terminal) and show me the printed text.

    Verify: the console output; tests for email templates pass.

### Event facts

16. **Dates.**
    > Update event dates from 14–16 Aug 2026 to <new dates>. Find every occurrence first with the greps in MAKE-IT-YOURS.md section 5.2 and show me the list grouped by file. Treat the `NIGHTS` lists in `attendee.repo.ts` and `availability.service.ts` and the room inventory pages as code, not text. Then edit, and run the checks.

    Verify: the final grep for the old dates returns nothing except migrations and tests you chose to keep; check-in options in the wizard show the new days.

17. **Prices.**
    > Our prices are: <list>. Update `PRICING_DEFAULTS` in `src/shared/src/constants.ts` only, then find every other place that mentions an old amount (JSON-LD in `index.html`, cost breakdown notes, emails) and list them. Use a script to compute the totals for these three example registrations: <examples>. Do not compute by hand.

    Verify: shared pricing tests, updated for the new values; the estimate in the wizard matches your script output.

18. **Branches.**
    > Replace the list of branches with <list>, with short names and colors. Update `BRANCHES`, `BRANCH_SHORT_NAMES` and `BRANCH_COLORS` in `src/shared/src/constants.ts`, `components/led-wall/branchCatalog.ts`, and every test fixture that names an old branch.

    Verify: the wizard dropdown, the desk and the tests.

19. **Payment details.**
    > Prepare the payment constants for our account. I will give you the UPI ID, payee name and bank details in a file at `tmp/payment.txt` (git-ignored). Produce the base64 values for `PAYMENT_UPI_VPA_B64` and `PAYMENT_BANK_DETAILS_B64` without printing the file into this chat, and update `constants.ts`. Do not commit `tmp/`.

    Verify: the payment page on localhost shows the new payee; `git status` shows no file from `tmp/`.

### Deploy and operate

20. **Cloudflare names and domains.**
    > Here are our domains: <site>, <staging site>, <cdn>, and our resource names: <names>. Update `site.config.json` and `src/server/wrangler.toml` as described in section 6 of MAKE-IT-YOURS.md. Show me the old to new value for each key first. Leave `REPLACE_WITH_*` values that I have not given you. Then run `make doctor` and show me what is left. Do not deploy.

    Verify: `make doctor` reports no mismatches; `git grep -n smriti2026 -- src ':!*.md'` shows only route patterns in `wrangler.toml` if you have not changed them yet; `make check`.

21. **First admin.**
    > Change the bootstrap admin email in `src/server/migrations/0003_users_and_auth.sql` to <email>. Confirm no remote database has run this migration yet by asking me. Then rebuild my local database and show me a working login link.

    Verify: the debug magic-link command returns a link for the new email.

22. **Staging deploy.**
    > Prepare a staging deploy: confirm `make check`, `make test` and `make doctor` pass, run `scripts/deploy.sh stg all --dry-run` and show me the target and the `--var` values it prints, list the secrets I must set, and give me the exact git commands to merge `main` into `release/stg` and watch CI. Do not run the git commands. After I deploy, check `/api/health` on staging.

    Verify: the dry run completes; the CI run is green; `/api/health` returns `{"ok":true}`.

23. **Review what is left.**
    > Search the tree for Smriti leftovers and for real personal data: names, emails, phone numbers, bank details. Report findings by file. Do not edit.

    Verify: the report is empty or accepted.

24. **Handoff.**
    > This session is slow and repeating itself. Write a handoff file in `tmp/handoff.md`: what is done and verified (with the commands you ran), what is in progress, what is next, and the decisions I made. I will start a new session from it.

    Verify: the file lists the commands and their results, not only claims.

---

## 8. Local development loop

### Commands

| Command | What it does |
|---|---|
| `npm ci` | Install dependencies for all three workspaces |
| `make fonts` | Download and self-host fonts. `make dev` and `make build` run it when needed; run it by hand after you change the font list |
| `make dev` | Download fonts if missing, create `src/server/.dev.vars` from the example if missing, stop with a message if the API port is busy, apply migrations to the local D1 database, then start the web app (5173) and the API (8787, or `API_PORT`). If one server fails to start, the other is stopped. |
| `make doctor`, `make doctor-strict` | List config values that still equal the Smriti example and check that the config files agree. The strict form fails while any are left. Needs `uv` |
| `make dev-web`, `make dev-server` | One half only. `dev-server` applies migrations first. |
| `make db-migrate-local` | Apply migrations to the local database without starting anything |
| `make check` | Typecheck web and server, then lint (zero warnings allowed) |
| `make test` | The three suites; or `make test-server`, `make test-web`, `make test-shared` |
| `make build` | Fonts, then the production web build |

Checked on a fresh clone: `make dev` downloads fonts, creates `.dev.vars`, applies migrations 0000 to 0025 and starts both servers; the API answers `GET /api/health` with `{"ok":true}`; the login link printed in the API terminal opens the web app and gives an admin session; `API_PORT=<port> make dev` moves the API and the Vite proxy follows. `make check` passed. The suites passed: server 1464, web 932 (3 skipped), shared 427.

| Port | Service |
|---|---|
| 5173 | Vite web app. It proxies `/api` to the API port. |
| 8787 | The API (wrangler). Default; set `API_PORT=<port>` to change it (for example `API_PORT=8799 make dev`). The proxy follows `API_PORT`. |

Local state lives in `src/server/.wrangler/` (git-ignored). Deleting that folder resets the database (run).

### First admin login on your machine

1. Start `make dev`.
2. Open `http://localhost:5173/login` and enter `admin@example.com` (or your own admin email if you changed migration `0003`). With no Mailgun keys, the API terminal prints `Link: http://localhost:5173/auth/verify?token=...`. Open it in the browser. The link works once; a second use returns "Invalid or expired link". It expires after 10 minutes. You land on `/staff/dashboard`.
3. The link host comes from `APP_BASE_URL` in `src/server/.dev.vars`. `make dev` creates that file from `.dev.vars.example` the first time, with `APP_BASE_URL=http://localhost:5173`. `wrangler.toml` holds no URL variable, so a `.dev.vars` without `APP_BASE_URL` makes every API call return a 500 configuration error: add the line. The terminal prints links only while `APP_BASE_URL` is a local address.
4. Optional shortcut that skips the login page:
   ```bash
   curl -s -X POST localhost:8787/api/debug/magic-link \
     -H 'content-type: application/json' -d '{"email":"admin@example.com"}'
   ```
   The response has a `magicLink` field with the same kind of link. The login endpoint stays silent when the same address asked for three or more links in 10 minutes. It still answers 200 (read from code). Wait ten minutes or use the shortcut.

The debug endpoint exists only in the local API entry `src/server/src/index.dev.ts`. The deployed entry `src/server/src/index.ts` does not mount it.

### Turn on registration

On a fresh database every flag is off, so `/register` shows a "registration closed" message. Log in as admin, open `/staff/config`, and switch on `registration_show_page` and `registration_accept_new`. By API (run): `PUT /api/admin/config/features` with `{"changes":[{"key":"registration_show_page","enabled":true},{"key":"registration_accept_new","enabled":true}]}` and an admin bearer token. After that the public flag endpoint `GET /api/config/features` shows both as true, and `POST /api/registrations` answers 400 (validation) rather than 403 for an empty body.

### Test data: there is no seed script

A fresh database holds the admin user, the `debug_tools` flag row and no registrations (run). To get registrations to work with:

1. **Run the wizard** at `http://localhost:5173/register` with the flags on. This is the closest to real use.
2. **Spot registration at the desk** (`/staff/check-in`, as admin or with the `registration_desk` scope) creates a registration without the wizard.
3. **Debug tools** at `/debug/tools` have buttons to confirm a payment and to create a login link. The page is open on `make dev`, and staging ships it behind an admin login and the `debug_tools` flag. Its buttons call `/api/debug/*`, which exists only in the local API, so they work only locally. The same API also has `POST /api/debug/send-test-email` (read from code).
4. **Browser smoke script** (needs the `agent-browser` CLI on your path): `uv run scripts/ui/scenarios/smoke_registration.py`. It fills all 7 steps up to proof upload against `http://localhost:5173` and writes screenshots to `tmp/ui-screenshots/`. It creates a real registration with a throwaway email. Not run for this guide.

Fixtures for the debug pages are in the code and need no database: `src/web/src/components/whos-coming/mock-data.ts`, `src/web/src/components/led-wall/mockSource.ts`, `src/web/src/lib/awards-data.ts`.

### The debug page

`/debug` shows components in isolation. Each tab is one component, chosen with `?tab=`, for example `/debug?tab=button`. The page is `src/web/src/pages/DebugPage.tsx`. When you build or change a component, wire it into the matching tab and check it there before using it in the wizard. Other debug routes: `/debug/tools`, `/debug/staff`, `/debug/whos-coming`, `/debug/advice`, `/debug/led-wall`, `/debug/confirmations`, `/debug/credits-export`.

How access works:

- In `make dev` the routes are open with no login.
- Staging builds set `VITE_ENABLE_DEBUG=true` (in `.github/workflows/deploy.yml`), so they include the pages. There they need an admin login and the `debug_tools` flag on. A non-admin goes to `/login`; an admin with the flag off gets "not found".
- Production builds set it to `false`, and `scripts/assert-debug-excluded.sh` fails CI if any debug marker remains in the bundle.

### Verify before you say it works

1. `make check` passes.
2. The tests you touched pass, then `make test` passes. Run the suite for the workspace you changed with `npm -w @smriti/server run test`, `npm -w @smriti/portal run test` or `npm -w @smriti/shared run test`; add a file path after `--` to run one file.
3. Look at the change on localhost, at 375, 768 and 1280 pixels wide. With `agent-browser` an agent can open pages and read accessibility snapshots. The original team found that screenshots sometimes hung on one machine and that accessibility snapshots plus DOM checks worked instead (reported).
4. For the wizard: fill all seven steps and reach the payment step with the two registration flags on.
5. Search for leftovers: `git grep -niE 'smriti|tkmce|raviz|kollam'`, and for real names, emails, phone numbers and IDs you pasted.
6. Deploy to staging and repeat the check there before production.

### Staging first

Rehearse with `scripts/deploy.sh stg all --dry-run`, which prints every command and needs no token. Then merge `main` into `release/stg` and push; CI runs `make check`, downloads fonts, checks that debug code is excluded, then deploys web, applies migrations and deploys the API. Follow it with `gh run list --workflow=deploy.yml` and `gh run watch <id>`. If your connection drops during a watch, re-attach to the same run; do not push again (reported). After staging looks right, merge `main` into `release/prod` and push. Deploy details: [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md). Do not run `scripts/deploy.sh` without `--dry-run` by hand for normal releases.

---

## 9. Watch-outs

Each item says how it was learned: run, read from code, or reported by the original team.

| Watch-out | Detail |
|---|---|
| Fonts need network on first run | `make dev` downloads fonts once when `src/web/src/fonts.generated.css` is missing. Offline, it stops with a message; connect and run `make dev` again. |
| Busy ports | If something already uses 8787, start with `API_PORT=8799 make dev`. If another process holds 5173 or the API port, the failing server exits and `make dev` stops the other one. Check with `lsof -nP -i :5173 -i :8787`. |
| `make dev` and migrations | `make dev` runs migrations first. `make dev-web` does not. A reported earlier problem was a local database left unmigrated. |
| Staging ships debug pages without a debug API | Staging builds include `/debug/*` pages behind an admin login and the `debug_tools` flag, but the deployed Worker never mounts `/api/debug/*`, so buttons on `/debug/tools` fail on staging (read from code). |
| Registration flags are off by default | A new deployment shows "registration closed" until you switch on `registration_show_page` and `registration_accept_new` (run, locally). Nav items for Register, My Pass and Autograph are also off by default. |
| UI-only flags leave the API open | `registration_show_page`, the nav flags and `homepage_show_memory_stories` hide things in the browser only. The original team found Register Now buttons on the home page that ignored the flag until they gated every entry point. Gate links and routes, not only the nav (reported). |
| `/staff/daily-report` scope mismatch | The page needs the `admin-tools` scope, but its data calls need `reports` and `dashboard`. A staff member with only `admin-tools` probably sees a page that cannot load its data. Admins are not affected (read from code, not run). |
| Orphan routes | `/bank-details`, `/staff/coming` and `/staff/tools` exist but the navigation has no link to them. `/staff/tools` is reached from the archived registrations page. Reach them by URL (read from code). |
| SBI-only statement parser | Bank statement import understands State Bank of India statement text only (`src/server/src/lib/sbi-statement-parser.ts`). Other banks need a new parser. |
| Tests do not run in CI | `.github/workflows/deploy.yml` runs `make check` only. Run `make test` before you push. Consider adding a test step to the workflow. |
| One flaky test | `src/server/src/__tests__/staff-edit-archive.test.ts` was seen to fail about once in ten runs with "Registration was modified by another request" (reported in AGENTS.md). Two full runs for this guide did not fail. Rerun before investigating. |
| Specs mention files that are not here | 31 files in `docs/` and `src/` refer to `tasks/...` planning files. `tasks/` is git-ignored and not included. The specs stand on their own. |
| Cloudflare blocks Python's default client | Scripts that call your own site from Python with the default `Python-urllib` User-Agent get HTTP 403 with error 1010. `curl` works. Send a browser-like User-Agent (reported). |
| Wrangler output is not clean JSON | `wrangler` can print a banner before the JSON when you redirect its output into a file, which breaks the JSON parser. Parse from the first `[` or use a JSON flag (reported). |
| Release branches deploy | Committing to `main` deploys nothing. Merge into `release/stg` or `release/prod` (reported). Pull the release branch before merging, or the push is rejected as not fast-forward (reported). |
| The first CI deploy runs migrations | `scripts/deploy.sh` applies remote migrations on every deploy. Fix the admin seed email before the first push to a release branch. |
| Committee page has no login | Anyone with the URL can edit the committee todo sheet (read from code). Keep the URL private or add a login. |
| Magic-link rate limit | Three requests in ten minutes for the same address are silently dropped (read from code). |
| Who's coming is public by default | Name, branch, city, country and photo of every registration, paid or not, with no consent step. Decide before launch (3.6). |
| Direct database writes skip the audit log | If you edit production data with SQL, the app's audit log is not written and derived copies (such as the stored `pricing_snapshot` JSON) can go stale. Use the staff pages for changes and keep SQL for reads (reported). |
| Stored times are epoch milliseconds | When you query dates in D1, `created_at`-style columns hold milliseconds since 1970, not seconds (reported). |
| Missing flag font | `twemoji-country-flags.woff2` is referenced by the stylesheet but is not in the repository. Flags fall back to system fonts (checked). |
| Missing `APP_BASE_URL` | The Worker has no fallback link address. A local `.dev.vars` without `APP_BASE_URL`, or a Worker deployed without `scripts/deploy.sh`, answers every API call with a 500 configuration error that names the variable (run in tests; the local login was run). |
| Mail needs Mailgun when deployed | Without `MAILGUN_API_KEY` and `MAILGUN_DOMAIN`, a deployed Worker sends nothing and logs `email is not configured` with no link, so nobody can log in. Only a local API prints links (read from code, covered by a test). |
| Staff sessions outlive a deactivation | Deactivating a staff user does not end a session already issued; it stays valid for up to 7 days. A scope change takes up to 5 minutes to apply (read from code and spec, not run). |
| Mail may land in junk | See 4.8. Test with several mail providers. |
| Stale comment | `src/server/migrations/0000_init.sql` has a comment that calls accommodation "Step 3". It is step 4 now. The comment has no effect. |
