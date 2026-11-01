# Specification: The Ledger

## Purpose

Single-player **points ledger** at `/predictions?player=<DisplayName>`. Shows how a player's score accumulated match by match — a bank-statement view with current balance at top, reverse-chronological match rows grouped by round, stats, and a progression chart. Reachable by tapping any player name on the leaderboard or predictions replay.

**BRD:** `tasks/2026-07-07-points-ledger/brd.md`
**Flows:** `tasks/2026-07-07-points-ledger/flows.md`
**Spike:** `tmp/build_ledger.py`, `tmp/Omar Mock_ledger.html`

---

## Scope

**Covers:**

- Route `/predictions?player=<DisplayName>` — single-player ledger view
- Entry from leaderboard (player name tap) and predictions replay (player name tap)
- Player picker with search for browsing between players
- Client-side join of `Fixtures`, `Predictions`, `Scores`, `Players`, `Leaderboard`
- Avatar matching from `/api/public/whos-coming` via name+branch
- Portal shell consistent with `/leaderboard` and `/predictions` (`SiteNav`, hero, `SiteFooter`)

**Does not cover (V1):**

- Rank trajectory (rank after each round)
- Player-to-player comparison / head-to-head
- Tournament picks or non-match-prediction scoring
- Server-side aggregation, writes, alumni auth

---

## Requirements

### R1: Route

R1 — Query param `player=<DisplayName>` on `/predictions` renders the Ledger view.

R1.1 — Player matching is case-insensitive against `Players.DisplayName`.

R1.2 — Invalid or unmatched player param → "Player not found" empty state with link back to leaderboard.

R1.3 — Picker selection updates `?player=` via `replace` (no full reload).

R1.4 — When both `player=` and `match=` are present, `player=` takes precedence (ledger view, not match replay). Rationale: the ledger is the more specific view — a player link should always land on that player's ledger regardless of stale match params in the URL.

### R2: Data sources

R2 — Parallel fetch on mount:

```
GET /api/datasources/predictions/Fixtures
GET /api/datasources/predictions/Predictions
GET /api/datasources/predictions/Scores
GET /api/datasources/predictions/Players
GET /api/datasources/predictions/Leaderboard
GET /api/public/whos-coming
```

R2.1 — Any prediction data fetch failure → error card + retry. All four prediction sheets must succeed. Leaderboard and whos-coming failures are non-fatal (degrade: hide standing-in-context; hide avatars).

R2.2 — Response shapes: prediction sheets per existing `DatasourceResponse`; Leaderboard per existing `LeaderboardResponse`; whos-coming per existing public API shape.

R2.3 — Reuse `usePredictionsMatchData` for the four prediction sheets (already fetched if coming from match replay). Add Leaderboard + whos-coming as separate fetches.

R2.4 — Per `(Email, MatchId)`, keep prediction row with latest `Timestamp` (same dedupe as match replay).

R2.5 — Exclude predictions from emails not in `Players` (same filter as match replay).

### R3: Ledger entry construction

R3 — For the selected player, build a ledger entry for each scored fixture they predicted:

R3.1 — Each entry joins: the Fixture (teams, actual score, round, stage, kickoff), the Prediction (predicted score, joker flag), the base Score row (where `Score.Stage` matches `Fixture.Stage`), the optional joker Score row (where `Score.Stage === "JOKER"`), and the optional upset Score row (where `Score.Stage === "UPSET"`).

R3.2 — Entry total = base Score points + joker Score points + upset Score points. Same scoring model as the match replay (which already includes all three components).

R3.3 — Tier derived from `Score.Detail` via `parseScoreDetail` (existing function). Never from `Score.Stage`.

R3.4 — Running balance computed by summing entry totals in chronological order by `Fixtures.KickoffUTC` (earliest first), using the same `parseSheetDate` function as the match replay. Each entry stores the cumulative total *after* that entry.

R3.5 — Display order: reverse chronological by `KickoffUTC` (newest match first). Running balance decreases as user scrolls down.

### R4: Page shell

R4 — `SiteNav` → hero → ledger content → `SiteFooter`. Reuse existing page shell classes.

R4.1 — Hero: **THE** / **LEDGER**, Caveat tagline, consistent with LeaderboardHero and ReplayHero patterns.

R4.2 — Document title: `<DisplayName>'s Ledger` via `useDocumentTitle`.

R4.3 — Loading: skeleton + `aria-busy`. Error: retry button. Same patterns as predictions replay.

### R5: Player picker

R5 — Collapsed picker card below the hero shows: avatar (if matched), display name, batch pill, total points, rank, leader distance ("X behind #1"), average comparison ("Y above avg").

R5.1 — Tap the card → expands to show search input + scrollable player list.

R5.2 — Player list: each row shows rank, avatar (if matched), display name, batch pill, total points. Sorted by rank. Current player highlighted.

R5.3 — Search filters the list by display name (substring, case-insensitive). No match → "No players matching '[query]'" inside the dropdown.

R5.4 — Tap a row → ledger switches to that player, URL updates, picker collapses.

R5.5 — Player list data is derived from the same prediction sheets required by R2.1 (Players, Leaderboard). A Players sheet failure triggers the page-level error card (R2.1) before the picker renders — the picker never enters a "couldn't load players" state independently. Leaderboard failure degrades the picker (no rank/points/standing) but does not hide the player list.

### R6: Avatar matching

R6 — Match prediction players to whos-coming attendees for avatar thumbnails via email hash.

R6.1 — Server-side: the `/api/public/whos-coming` endpoint adds an `emailHash` field to each attendee — first 8 characters of `SHA-256(email.trim().toLowerCase())`. No raw email exposed.

R6.2 — Client-side: compute the same hash from the Players sheet `Email` field. Match player to attendee where hashes are equal.

R6.3 — Matched → avatar URL: `{thumbsBaseUrl}/{id}.jpg`. Unmatched → initials circle (first letter of display name, styled background).

R6.4 — Whos-coming fetch failure → all players show initials circles. No error shown to user.

### R7: Stat chips

R7 — Row of stat chips below the picker:

| Chip | Value | Computation |
|------|-------|-------------|
| Total | sum of all entry totals | sum(base + joker + upset for each entry) |
| Matches | count of entries | count of scored fixtures predicted |
| Exact | count where tier = exact | |
| Hit Rate | entries with points > 0 / total entries, as % | |
| Joker | sum of joker Score points only | sum of joker-stage row points |
| Upset | sum of upset Score points only | sum of upset-stage row points (shown only when > 0) |

### R8: Points progression chart

R8 — Sparkline chart showing running balance over time.

R8.1 — X-axis: match sequence (chronological, left = earliest, right = latest). Y-axis: cumulative points. Area fill under the line.

R8.2 — Exact-score entries highlighted as dots on the line.

R8.3 — Hover/tap a point → tooltip with match name, points earned, and running total.

R8.4 — Chart rendered as inline SVG (no charting library). Technique: gradient-filled area path under the line, grid lines at round-number intervals, `<circle>` dots for exact scores, invisible hit-area `<rect>` overlays for tooltips. Reference implementation in `tmp/build_ledger.py` lines 466-510 (ephemeral — approach captured here).

### R9: Round-grouped match rows

R9 — Entries grouped by `Fixture.Round`. Groups ordered by the latest `KickoffUTC` within each round, descending (newest round first).

R9.1 — Round header: round label, round subtotal (`+{sum}`), accuracy highlight (count of exact-tier entries if > 0).

R9.2 — Collapsible: tap header to expand/collapse the group's rows. Default: most recent round expanded, all older rounds collapsed.

R9.3 — Each match row columns:

| Column | Content |
|--------|---------|
| Match # | `M{MatchId}` |
| Match | `{HomeTeam} v {AwayTeam}` + tier badge + joker badge if applicable |
| Predicted | `{PredHome}-{PredAway}` |
| Actual | `{ActualHome}-{ActualAway}` |
| Points | `+{total}` if > 0, else `—` |
| Balance | running balance after this match |

R9.4 — Visual treatment by tier:
- Exact: terracotta left border, subtle highlight background
- Goal diff / close: aqua left border, subtle highlight background
- Outcome: lighter aqua left border
- Miss: dimmed row (reduced opacity)

R9.5 — Joker badge: shown on the match row when `Prediction.Joker` is true. Styled distinctly for joker-with-points vs joker-with-miss.

### R10: Closing statement

R10 — Dark-background card at the bottom of the ledger:

| Line | Value |
|------|-------|
| Matches predicted | count |
| Results correct | count (points > 0) of total (hit rate %) |
| — separator — | |
| Exact scores | count |
| Correct goal diff | count (tier = goalDiff) |
| Correct winner | count (tier = outcome) |
| Wrong result | count (tier = miss) |
| — separator — | |
| Match points | sum of base Score points |
| Joker bonus | sum of joker Score points |
| Upset bonus | sum of upset Score points (omitted when 0) |
| — separator — | |
| **Closing balance** | total points (highlighted) |
| Best match | match name + points (highest single-entry total) |
| Longest miss streak | count of consecutive zero-point entries |
| — separator — | |
| Leaderboard | rank from Leaderboard sheet |

### R11: Standing in context

R11 — Shown in the player picker card (collapsed view):

R11.1 — Leader distance: `{diff} behind #{1 rank}` (or "Leading" if player IS #1).

R11.2 — Average comparison: `{diff} above avg ({avg})` or `{diff} below avg ({avg})`. Average = mean of all Leaderboard entry points, rounded.

R11.3 — Leaderboard fetch failure → hide both lines. No error shown.

### R12: Entry point integration

R12 — Leaderboard table and podium: player names become tappable links to `/predictions?player=<DisplayName>`.

R12.1 — Predictions replay table: player names in the match predictions table become tappable links to `/predictions?player=<DisplayName>`.

R12.2 — Links use `<Link>` (internal routing, no full reload).

### R13: Privacy

R13 — Never render `Email` in UI, URL, or document title. Display `DisplayName` + `Batch` only.

### R14: Non-functional

R14.1 — `make check` passes.

R14.2 — No horizontal scroll at 375px / 768px / 1280px; touch targets >= 44px.

R14.3 — Unit tests: ledger entry construction, running balance computation, round grouping, avatar matching, stat chip values.

R14.4 — No new npm dependencies without approval.

---

## Domain

Refer to cycle glossary: `tasks/2026-07-07-points-ledger/glossary.md`

| Data source | Purpose in the ledger |
|---|---|
| Fixtures | Match context: teams, scores, round, stage, kickoff |
| Predictions | Player's predicted scorelines + joker flags |
| Scores (base rows) | Points awarded per prediction, tier via Detail |
| Scores (joker rows) | Bonus points for joker matches (Stage=JOKER) |
| Players | DisplayName, Batch, Email (internal key) |
| Leaderboard | Rank + total for standing-in-context |
| whos-coming API | Avatar thumbnails via name+branch matching |

---

## Edge cases

- Duplicate predictions → latest `Timestamp` wins (same as match replay)
- Unknown email → excluded (same as match replay)
- Player has zero predictions → player header + "No predictions yet" empty state
- No scored matches in tournament → "No scored matches yet" empty state
- Player has predictions but no scores for a match → entry with 0 points, tier = miss
- Joker on a miss → joker badge shown with miss styling (line-through or dimmed)
- Display name with special characters in URL → URL-encoded
- Very long display name → truncate with ellipsis in picker rows, full in header
- Whos-coming name doesn't match predictions name exactly → no avatar (initials circle), no error

---

## Dependencies

- Existing: `/api/datasources/predictions/*`, `/api/public/whos-coming`, `/api/datasources/predictions/Leaderboard`
- Existing components: `SiteNav`, `SiteFooter`, hero pattern, batch pills, tier badges
- Existing logic: `prediction-aggregates.ts` (parseScoreDetail, dedupeLatestPredictions, buildPlayerIndex)
- Spike reference: `tmp/build_ledger.py` (data model), `tmp/Omar Mock_ledger.html` (visual design)

---

## Reference

| Artifact | Path |
|----------|------|
| BRD | `tasks/2026-07-07-points-ledger/brd.md` |
| Glossary | `tasks/2026-07-07-points-ledger/glossary.md` |
| Flows | `tasks/2026-07-07-points-ledger/flows.md` |
| Spike script | `tmp/build_ledger.py` |
| Spike output | `tmp/Omar Mock_ledger.html` |
| Player picker mockup | `tmp/2026-06-16-predictions-replay-mockups/player-card.html` |
| Predictions replay spec | `docs/specs/predictions-replay.spec.md` |
