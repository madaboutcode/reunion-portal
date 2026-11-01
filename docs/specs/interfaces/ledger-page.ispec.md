# Interface Spec: Ledger Page

## Purpose

The visual and routing layer for The Ledger — how a player's points ledger appears and behaves in the browser. Covers route handling, all visual components, entry point integration from leaderboard and predictions replay.

**Functional spec:** `docs/specs/the-ledger.spec.md` (R1, R4, R5, R8, R9, R10, R11, R12, R14)
**Data layer spec:** `docs/specs/interfaces/ledger-data.ispec.md`
**Avatar spec:** `docs/specs/interfaces/whos-coming-avatars.ispec.md`
**Design:** `tasks/2026-07-07-points-ledger/design.md`

---

## Scope

**In scope:**

- Route integration: `PredictionsMatchPage` handling `?player=` param
- Components: `LedgerView`, `PlayerPicker`, `LedgerStats`, `PointsChart`, `LedgerRoundGroup`, `LedgerMatchRow`, `ClosingStatement`
- Entry point integration: `LeaderboardTable`, `PodiumSection`, `MatchPredictionsTable` player name links
- Page shell, loading, error, and empty states

**Out of scope:**

- Data computation (see `ledger-data.ispec.md`)
- Avatar fetching/matching (see `whos-coming-avatars.ispec.md`)
- Match replay view (existing, unchanged — see `predictions-replay.spec.md`)

---

## Route: PredictionsMatchPage (modified)

### Current behavior

`/predictions` renders `PredictionsMatchPage`. It reads `?match=<MatchId>` to select a match for replay.

### Modified behavior

R-IF-P1 — The page reads both `player` and `match` query params from the URL.

R-IF-P2 — When `?player=<DisplayName>` is present, the page renders the ledger view (`LedgerView`), not the match replay. `player` takes precedence over `match` — when both are present, the ledger is shown.

R-IF-P3 — When `?player=` is absent, existing match replay behavior is unchanged.

R-IF-P4 — Player matching: the `player` param value is matched case-insensitively against `PlayerSummary.displayName` from the `Players` sheet (via `buildPlayerIndex`). The match is against the trimmed display name.

R-IF-P5 — Invalid or unmatched `player` param → "Player not found" empty state with a link back to `/leaderboard`. No error card, no retry — the name simply doesn't match anyone.

R-IF-P6 — Document title: `"<DisplayName>'s Ledger"` (e.g., `"Omar Mock's Ledger"`) when a player is matched. Uses the existing `useDocumentTitle` hook.

R-IF-P7 — Data fetching: reuses `usePredictionsMatchData` for the four prediction sheets (Fixtures, Predictions, Scores, Players). Adds `Leaderboard` and `whos-coming` as separate fetches. The four prediction sheets are already fetched if the user navigated from match replay — no re-fetch.

R-IF-P8 — Any prediction data fetch failure → error card + retry button. Same pattern as existing match replay error state. Leaderboard and whos-coming failures are non-fatal — degrade gracefully (hide standing; hide avatars).

### States

| State | Condition | Display |
|-------|-----------|---------|
| Loading | Data fetching in progress | Skeleton layout + `aria-busy="true"` on `<main>` |
| Error | Any of the four prediction sheets failed | Error card: "Could not load predictions data" + `{error.message}` + retry button |
| Player not found | `?player=` present but doesn't match any player | "Player not found" heading + "Pick a player from the leaderboard to see their ledger." + `<Link to="/leaderboard">` |
| No scored matches | Player matched but no fixtures have `Scored === "Y"` | "No scored matches yet" heading + "Check back after the first matchday." |
| No predictions | Player matched, scored matches exist, but player has zero predictions | Player picker visible + "No predictions yet" heading + "This player hasn't submitted any predictions." |
| Ready | Player matched, data loaded, entries available | Full ledger view |

---

## Component: LedgerView

**Role:** Full ledger layout for a single player. Receives all computed data, renders the page body in order: PlayerPicker → LedgerStats → PointsChart → round groups → ClosingStatement → back link.

### Props

```typescript
interface LedgerViewProps {
  player: PlayerSummary
  entries: LedgerEntry[]
  stats: LedgerStatsData
  standing: Standing | null
  roundGroups: LedgerRoundGroupData[]
  chartData: ChartPoint[]
  closingStatement: ClosingStatementData
  allPlayers: PlayerPickerItem[]
  onSelectPlayer: (displayName: string) => void
}
```

R-IF-P9a — The current player's avatar URL comes from `allPlayers` — the `PlayerPickerItem` matching the current player carries `avatarUrl`. No separate `avatarUrl` prop; single source of truth.

R-IF-P9 — LedgerView does NOT fetch data, manage URL params, or know about other views. It is a pure display component with a callback for player selection.

R-IF-P10 — The component renders the full page content inside the existing page shell (`SiteNav` → hero → LedgerView → `SiteFooter`). The page shell is owned by `PredictionsMatchPage`, not LedgerView.

R-IF-P11 — At the bottom: "← Back to Leaderboard" link using `<Link to="/leaderboard">`. Internal routing, no full reload.

---

## Component: PlayerPicker

**Role:** Collapsed card showing the current player; expands to a searchable player list for navigation.

### Props

```typescript
interface PlayerPickerProps {
  currentPlayer: PlayerPickerItem
  players: PlayerPickerItem[]
  onSelect: (displayName: string) => void
  standing: Standing | null
}
```

R-IF-P12 — PlayerPicker does NOT know about the ledger, manage URL state, or fetch data.

### Collapsed state

R-IF-P13 — Shows: avatar (from `currentPlayer.avatarUrl` — image if URL, initials circle if `null`), display name, batch pill, total points, rank.

R-IF-P14 — Below the main line, standing context (when `standing` is not null):
- Leader distance: `"{leaderDistance} behind #1"` when not leading; `"Leading"` when `isLeading` is true.
- Average comparison: `"{avgDistance} above avg ({average})"` when positive; `"{Math.abs(avgDistance)} below avg ({average})"` when negative; `"At avg ({average})"` when zero.

R-IF-P15 — When `standing` is `null` (leaderboard unavailable), the standing context lines are hidden. No error message.

R-IF-P16 — Initials circle: first letter of display name, uppercase, with a styled background. Used when `avatarUrl` is `null`.

R-IF-P17 — Tap the card → expands to show the player list. The card is the tap target.

### Expanded state

R-IF-P18 — Search input at top: placeholder "Search players...". Autofocus on expand.

R-IF-P19 — Scrollable player list below the search input. Max height 280px (`max-h-[280px]`), overflow-y scroll.

R-IF-P20 — Each player row: rank, avatar (image or initials), display name, batch pill, total points. Rows sorted by rank ascending (from `PlayerPickerItem` sort order).

R-IF-P21 — Current player row highlighted (visually distinct background or border).

R-IF-P22 — Search filters the list by display name: substring match, case-insensitive. Filtering is instant (no debounce needed for ~70 items).

R-IF-P23 — Empty search result → "No players matching '[query]'" message inside the dropdown. The picker stays open so the user can clear/retype.

R-IF-P24 — Tap a player row → calls `onSelect(displayName)`. The caller updates the URL and the picker collapses.

R-IF-P25 — Tap the collapsed trigger area (the current player card at top) while expanded → collapses without selecting.

R-IF-P26 — Touch targets: all tappable rows ≥ 44px height.

---

## Component: LedgerStats

**Role:** Row of stat chips.

### Props

```typescript
interface LedgerStatsProps {
  stats: LedgerStatsData
}
```

R-IF-P27 — Renders five chips in a horizontal row (wraps to multiple rows on mobile):

| Chip label | Value | Format | Visibility |
|------------|-------|--------|------------|
| Total | `stats.total` | Number | Always |
| Matches | `stats.matchesPlayed` | Number | Always |
| Exact | `stats.exactCount` | Number | Always |
| Hit Rate | `stats.hitRate` | `{value}%` | Always |
| Joker | `stats.jokerBonus` | `+{value}` | Always |
| Upset | `stats.upsetBonus` | `+{value}` | Only when `upsetBonus > 0` |

R-IF-P28 — Mobile (≤ 375px): chips wrap to 2 rows. All chips remain visible — no truncation.

---

## Component: PointsChart

**Role:** SVG sparkline showing points progression over time.

### Props

```typescript
interface PointsChartProps {
  data: ChartPoint[]
}
```

R-IF-P29 — Renders an inline `<svg>` element. No charting library.

R-IF-P30 — X-axis: match sequence (chronological, left = earliest, right = latest). Y-axis: cumulative points (0 at bottom, max running balance at top with padding).

R-IF-P31 — Visual elements:
- Area fill: gradient-filled `<path>` from the line down to the x-axis.
- Line: `<path>` connecting all data points.
- Exact-score dots: `<circle>` elements on data points where `tier === "exact"`.
- Grid lines: horizontal lines at Y-axis intervals. Nice intervals in order of preference: [10, 25, 50, 100, 200, 500]. Pick the smallest interval that yields ≤ 6 lines (`Math.floor(maxValue / interval) <= 6`). This produces 3–6 grid lines for typical max values (100–500). Example: max 187 → interval 50 → lines at 50, 100, 150 (3 lines).

R-IF-P32 — Hover/tap interaction: invisible hit-area `<rect>` overlays per data point. On hover/tap, a tooltip shows: match label, `+{points}`, and running total.

R-IF-P33 — When `data` is empty (no entries), the chart is not rendered (component returns `null`).

R-IF-P34 — Full-width at all breakpoints. Minimum height of 160px. The chart scales horizontally to fill its container.

---

## Component: LedgerRoundGroup

**Role:** Collapsible round section with header and match rows.

### Props

```typescript
interface LedgerRoundGroupProps {
  round: string
  subtotal: number
  exactCount: number
  entries: LedgerEntry[]
  defaultExpanded: boolean
}
```

R-IF-P35 — Round header displays: round label, subtotal (`+{subtotal}`), and accuracy highlight (`{exactCount} exact` when `exactCount > 0`, hidden when 0).

R-IF-P36 — Tap the header → toggle expand/collapse. The header is the tap target (≥ 44px).

R-IF-P37 — Default state on mount: `defaultExpanded` prop controls initial state. The most recent round (first in the list) is expanded; older rounds are collapsed.

R-IF-P38 — Collapsed: header only, rows hidden. Expanded: header + all `LedgerMatchRow` components.

R-IF-P39 — Expand/collapse is local state — toggling one round does not affect others.

---

## Component: LedgerMatchRow

**Role:** Single match row within a round group.

### Props

```typescript
interface LedgerMatchRowProps {
  entry: LedgerEntry
}
```

R-IF-P40 — Row columns:

| Column | Content | Notes |
|--------|---------|-------|
| Match # | `M{matchId}` | Compact identifier |
| Match | `{homeTeam} v {awayTeam}` | Plus tier badge and joker badge where applicable |
| Predicted | `{predHome}-{predAway}` | Player's prediction |
| Actual | `{actualHome}-{actualAway}` | Match result |
| Points | `+{totalPoints}` when > 0, `—` when 0 | |
| Balance | `{runningBalance}` | Running total after this match |

R-IF-P41 — Tier badge: displayed alongside the match name. Uses existing tier badge styling from the predictions replay page.

R-IF-P42 — Joker badge: shown when `entry.prediction.isJoker` is true. Two visual treatments:
- Joker with points (`totalPoints > 0`): standard joker badge.
- Joker with miss (`totalPoints === 0`): dimmed/line-through joker badge.

R-IF-P43 — Visual treatment by tier:

| Tier | Left border | Background | Text opacity |
|------|-------------|------------|-------------|
| exact | Terracotta (`#D76B51`) | Subtle highlight | Full |
| goalDiff | Aqua (`#B9DFE2`) | Subtle highlight | Full |
| outcome | `rgba(185, 223, 226, 0.5)` | None | Full |
| miss | None | None | Reduced (dimmed row) |

R-IF-P44 — Mobile (≤ 375px): columns compress. Match # column is hidden (display none). Predicted and actual scores stack vertically within their cells. Points and balance columns remain visible as single-line values.

---

## Component: ClosingStatement

**Role:** Dark-background summary card at the bottom of the ledger.

### Props

```typescript
interface ClosingStatementProps {
  data: ClosingStatementData
}
```

R-IF-P45 — Renders on a dark background (charcoal or near-black), with light text. Visually distinct from the rest of the page.

R-IF-P46 — Content layout (grouped by separators):

| Line | Value |
|------|-------|
| Matches predicted | `{matchesPredicted}` |
| Results correct | `{resultsCorrect} ({hitRate}%)` |
| — separator — | |
| Exact scores | `{exactCount}` |
| Correct goal diff | `{goalDiffCount}` |
| Correct winner | `{outcomeCount}` |
| Wrong result | `{missCount}` |
| — separator — | |
| Match points | `{basePoints}` |
| Joker bonus | `+{jokerBonus}` |
| Upset bonus | `+{upsetBonus}` — omitted when `upsetBonus === 0` |
| — separator — | |
| **Closing balance** | `{closingBalance}` — visually highlighted (larger font, bold, accent color) |
| Best match | `{bestMatch.label} (+{bestMatch.points})` — omitted when `null` |
| Longest miss streak | `{longestMissStreak}` — omitted when `0` |
| — separator — | |
| Leaderboard | `#{leaderboardRank}` — omitted when `null` |

R-IF-P47 — Closing balance is the visual anchor — largest type, accent color (terracotta or similar).

R-IF-P48 — When `bestMatch` is `null` or `longestMissStreak` is `0`, those lines are hidden entirely (not shown as "0" or "N/A").

R-IF-P49 — When `leaderboardRank` is `null`, the leaderboard line is hidden.

---

## Entry point integration

### LeaderboardTable + PodiumSection

R-IF-P50 — Player names in `LeaderboardTable` (the `entry.name` text in `LeaderboardRow`) become tappable `<Link>` elements to `/predictions?player={encodeURIComponent(entry.name)}`.

R-IF-P51 — Player names in `PodiumSection` (the `firstName(entry.name)` text in each podium card) become tappable `<Link>` elements to `/predictions?player={encodeURIComponent(entry.name)}`. The displayed text remains the first name (no visual change to podium layout); the `<Link>` href uses the full `entry.name` for the query param.

R-IF-P52 — Uses React Router `<Link>` — internal routing, no full page reload.

R-IF-P53 — Visual treatment: player names gain a tap affordance (underline on hover, cursor pointer). They must remain readable as names — the link treatment should be subtle, not overwhelming.

### MatchPredictionsTable

R-IF-P54 — Player names in `MatchPredictionsTable` (the `pick.player.displayName` text) become tappable `<Link>` elements to `/predictions?player={encodeURIComponent(pick.player.displayName)}`.

R-IF-P55 — Same visual treatment and routing behavior as the leaderboard links.

---

## Page shell

R-IF-P56 — Hero section: "THE" / "LEDGER" in Playfair Display, Caveat tagline beneath (tagline text is a taste decision — TBD by the organizers; placeholder: "every point tells a story"). Consistent with `LeaderboardHero` and `ReplayHero` patterns.

R-IF-P57 — The hero does NOT include stat chips or match counts — those are separate components below it.

R-IF-P58 — Loading skeleton: mirrors the ledger layout (picker placeholder → stat chip placeholders → chart placeholder → round group placeholders). Uses `aria-busy="true"` on `<main>`. Same animation style as existing `PredictionsSkeleton`.

---

## Responsive behavior

R-IF-P59 — No horizontal scroll at 375px, 768px, or 1280px.

R-IF-P60 — Touch targets ≥ 44px on all interactive elements (picker rows, round headers, chart hit areas, back link).

R-IF-P61 — Stat chips: 3 columns on mobile (wraps to 2 rows). Full row on desktop.

R-IF-P62 — Match rows: columns compress on mobile. Match # shrinks. Predicted/actual may stack. Points and balance remain visible.

R-IF-P63 — Player picker: full-width at all breakpoints.

R-IF-P64 — Chart: full-width at all breakpoints, maintains readability.

---

## Player selection flow

R-IF-P65 — When a player is selected (via picker or entry point link):
1. URL updates to `?player={encodeURIComponent(displayName)}` via `setSearchParams` with `{ replace: true }`.
2. Page re-renders with the new player's data.
3. No full page reload.
4. Document title updates to `"{DisplayName}'s Ledger"`.

R-IF-P66 — Browser back button works naturally — each player selection replaces the URL (doesn't push), so back returns to the previous page (leaderboard or match replay), not to the previous player.

---

## Privacy invariant

R-IF-P67 — No component renders a raw email address anywhere: not in the DOM, not in URLs, not in document titles, not in `aria-label` or `title` attributes. Player identity is displayed as `DisplayName` + `Batch` only. Email is used internally for data joins (never in rendered output).

---

## Edge cases

- Display name with special characters in URL → properly URL-encoded via `encodeURIComponent`. Decoded on read via `searchParams.get("player")`.
- Very long display name → truncated with ellipsis in picker rows. Full display name in the player picker header and document title.
- Player has zero predictions → player picker visible, "No predictions yet" empty state below. Stats, chart, round groups, and closing statement are not rendered.
- Rapid player switching → each selection triggers a re-render with new data. No debounce needed — computation is synchronous in `useLedgerData`.
- Player list data failure (prediction sheets loaded but player resolution fails) → the page handles this at the data-fetch level; the picker always receives a populated `players` array when the page is in the Ready state.
