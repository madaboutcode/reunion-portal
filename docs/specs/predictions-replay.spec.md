# Specification: Predictions Replay (V1)

## Purpose

Public **match replay** page at `/predictions`. Alumni pick a scored WC 2026 match and see the actual result plus every classmate's prediction, sorted by points. Data comes from read-only Google Sheets via the public datasources API.

**Developer task:** `tasks/2026-06-17-predictions-match-v1.task.md`  
**Visual mockup:** `tasks/predictions-replay/match-v1.html`  
**Phase 2 archive** (four tabs, wireframes, sprint bricks): `tmp/2026-06-16-predictions-replay/archive/`

---

## Scope

**Covers:**

- Route `/predictions` — match-only, **no tab bar**
- Query param `?match=<MatchId>`; default = most recent scored match
- Client-side join of `Fixtures`, `Predictions`, `Scores`, `Players`
- Portal shell consistent with `/leaderboard` (`SiteNav`, hero, `SiteFooter`)
- Leaderboard entry: ScoringRules link → `/predictions`

**Does not cover (V1):**

- Trends, Crowd Pulse tabs
- `?compare=`, `?tab=` params
- ~~`?player=` param~~ → now covered by `docs/specs/the-ledger.spec.md`
- ~~Leaderboard player-name deep links~~ → now covered by The Ledger (R12)
- `SiteNav` "Predictions" item
- Tournament picks, Player of Match, batch analytics
- Server-side aggregation, writes, alumni auth

---

## Requirements

### R1: Route

R1 — Route `/predictions` renders `PredictionsMatchPage`.

R1.1 — Query param `match=<MatchId>` selects that scored match. Invalid or unscored ID → empty state "Match not found".

R1.2 — No param → most recent scored match (`Scored=Y`, `KickoffUTC` desc).

R1.3 — Picker changes update `?match=` via `replace` (no full reload).

### R2: Data sources

R2 — Parallel fetch on mount:

```
GET /api/datasources/predictions/Fixtures
GET /api/datasources/predictions/Predictions
GET /api/datasources/predictions/Scores
GET /api/datasources/predictions/Players
```

R2.1 — Any fetch failure → error card + retry. All four must succeed.

R2.2 — Response shape: `{ source, sheet, rows, data: Record<string, string>[] }`.

R2.3 — Aggregation in browser only; never show raw sheet rows.

R2.4 — Per `(Email, MatchId)`, keep row with latest `Timestamp`.

R2.5 — Exclude predictions from emails not in `Players`.

### R3: Scoring display

| Sheet `Detail` | Label | Group-stage pts |
|----------------|-------|-----------------|
| `EXACT H-A` | Exact | 10 |
| `GOAL-DIFF` | Goal diff | 7 |
| `OUTCOME` | Outcome | 5 |
| `miss` | Miss | 0 |

R3.1 — Points from `Scores.Points` on match-stage row, not inferred from label.

R3.2 — Joker: separate line when `Stage=JOKER` row exists — `⭐ +{points}`.

R3.3 — Never use binary hit/miss as primary badge.

### R4: Page shell

R4 — `SiteNav` → hero → match content → `SiteFooter`. Reuse leaderboard page shell classes.

R4.1 — Hero: **PREDICTION** / **REPLAY**, Caveat tagline, stat chips (see mockup).

R4.2 — Document title: `Predictions Replay` via `useDocumentTitle`.

R4.3 — Loading: skeleton + `aria-busy`. Error: retry button.

### R5: Match replay (core UI)

R5.1 — Match picker: ◀ ▶ + dropdown grouped by `Fixtures.Round` (Matchday 1 … knockouts).

R5.2 — Result card: teams, actual score, stage/group/round/date, FULL TIME.

R5.3 — Summary chips (unchanged by filters):

| Chip | Value |
|------|-------|
| Predictions | count of latest registered picks |
| Exact | tier = Exact |
| Got points | points > 0 |
| Most picked | mode scoreline |

R5.4 — Filter pills: All, Exact, Goal diff, Outcome, Miss — list only.

R5.5 — Table sorted by total match points desc, then name. Columns: rank, player + batch pill, prediction, tier badge, joker, points.

R5.6 — `← Back to Leaderboard` link.

### R6: Leaderboard integration

R6 — `ScoringRules.tsx` adds link **See who picked what** → `/predictions` (`<Link>`, internal).

### R7: Privacy

R7 — Never render `Email` in UI, URL, or title. Display `DisplayName` + `Batch` only.

### R8: Non-functional

R8.1 — `make check` passes.

R8.2 — No horizontal scroll at 375px / 768px / 1280px; touch targets ≥ 44px.

R8.3 — Unit tests: tier mapping, dedupe, summary chips, round grouping.

R8.4 — No new npm dependencies without approval.

---

## Domain

| Sheet | Columns used |
|-------|----------------|
| Fixtures | MatchId, HomeTeam, AwayTeam, ActualHome, ActualAway, Stage, Round, KickoffUTC, Scored |
| Predictions | Timestamp, Email, MatchId, PredHome, PredAway, Joker |
| Scores | Email, MatchId, Stage, Points, Detail |
| Players | Email, DisplayName, Batch |

Tier enum: `exact` | `goalDiff` | `outcome` | `miss`

---

## Edge cases

- Duplicate predictions → latest `Timestamp` wins
- Unknown email → excluded
- Zero predictions on match → "No predictions" empty state
- Dept pill truncates on mobile (same as leaderboard)

---

## Dependencies

- Public datasources API (`/api/datasources/predictions/*`)
- `/leaderboard` components: `SiteNav`, `SiteFooter`, `LeaderboardHero` pattern, dept pills, `SoccerBall`
- Scoring PDFs linked from leaderboard ScoringRules

---

## Reference

| Artifact | Path |
|----------|------|
| Implementation task | `tasks/2026-06-17-predictions-match-v1.task.md` |
| V1 mockup | `tasks/predictions-replay/match-v1.html` |
| All Phase 1 mockups | `tmp/2026-06-16-predictions-replay-mockups/` |
| Archived four-tab spec + sprint | `tmp/2026-06-16-predictions-replay/archive/` |