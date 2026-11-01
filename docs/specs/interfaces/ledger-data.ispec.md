# Interface Spec: Ledger Data Layer

## Purpose

Pure functions and hook that compute a single player's points ledger from the existing predictions dataset. Consumers receive fully computed, display-ready data — no aggregation logic lives in components.

**Functional spec:** `docs/specs/the-ledger.spec.md` (R3, R7, R9, R10, R11)
**Design:** `tasks/2026-07-07-points-ledger/design.md`

---

## Scope

**In scope:**

- `ledger-aggregates.ts` — all pure functions
- `useLedgerData` hook — thin orchestrator over the pure functions
- Types: `LedgerEntry`, `LedgerStatsData`, `LedgerRoundGroupData`, `ChartPoint`, `ClosingStatementData`, `Standing`, `PlayerPickerItem`
- Reuse of existing exports from `prediction-aggregates.ts` and `prediction-types.ts`

**Out of scope:**

- Visual components (see `ledger-page.ispec.md`)
- Avatar matching (see `whos-coming-avatars.ispec.md`)
- Data fetching (existing `usePredictionsMatchData` hook, unchanged)

---

## Types

### LedgerEntry

```typescript
interface LedgerEntry {
  matchId: string
  fixture: {
    homeTeam: string
    awayTeam: string
    actualHome: number
    actualAway: number
    round: string
    stage: string
    kickoffUtc: string
  }
  prediction: {
    predHome: number
    predAway: number
    isJoker: boolean
  }
  basePoints: number
  jokerPoints: number
  upsetPoints: number
  totalPoints: number
  tier: PredictionTier       // from prediction-types.ts
  goalsOff: number | null
  runningBalance: number
}
```

R-IF-D1 — `PredictionTier` is the existing union `"exact" | "goalDiff" | "outcome" | "miss"` from `prediction-types.ts`. No new tier values.

R-IF-D2 — `runningBalance` is the cumulative total *after* this entry, computed chronologically by `KickoffUTC` ascending. The first entry's `runningBalance` equals its `totalPoints`.

R-IF-D3 — `totalPoints` = `basePoints` + `jokerPoints` + `upsetPoints`. Always non-negative integers. A miss entry has `totalPoints` = 0, `basePoints` = 0, `jokerPoints` = 0, `upsetPoints` = 0.

R-IF-D4 — `isJoker` is true when a JOKER `ScoreRow` exists for this `(email, matchId)` pair, OR when `PredictionRow.Joker` is a non-empty string after trimming (e.g. `"Yes"`). A player can have `isJoker: true` with `jokerPoints: 0` (joker on a miss — the JOKER score row has 0 points, or only the prediction flag is set with no corresponding score row).

### LedgerStatsData

```typescript
interface LedgerStatsData {
  total: number           // sum of all entry totalPoints
  matchesPlayed: number   // count of entries
  exactCount: number      // entries where tier === "exact"
  hitRate: number         // percentage (0-100): entries with totalPoints > 0 / matchesPlayed
  jokerBonus: number      // sum of jokerPoints across all entries
  upsetBonus: number      // sum of upsetPoints across all entries
}
```

R-IF-D5 — `hitRate` is `Math.round((entriesWithPoints / matchesPlayed) * 100)` when `matchesPlayed > 0`, else `0`. An entry "has points" when `totalPoints > 0`.

### LedgerRoundGroupData

```typescript
interface LedgerRoundGroupData {
  round: string           // round label from Fixture.Round
  subtotal: number        // sum of entry totalPoints in this round
  exactCount: number      // count of exact-tier entries in this round
  entries: LedgerEntry[]  // entries in this round, reverse-chrono by KickoffUTC
}
```

### ChartPoint

```typescript
interface ChartPoint {
  matchId: string
  running: number         // running balance at this point
  points: number          // points earned this match
  tier: PredictionTier
  matchLabel: string      // "{HomeTeam} v {AwayTeam}"
}
```

R-IF-D6 — `ChartPoint[]` is in chronological order (earliest first, left of chart). This is the opposite of the display order for match rows.

### ClosingStatementData

```typescript
interface ClosingStatementData {
  matchesPredicted: number
  resultsCorrect: number     // entries with totalPoints > 0
  hitRate: number            // same computation as LedgerStatsData.hitRate
  exactCount: number
  goalDiffCount: number      // tier === "goalDiff"
  outcomeCount: number       // tier === "outcome"
  missCount: number          // tier === "miss"
  basePoints: number         // sum of basePoints across all entries
  jokerBonus: number         // sum of jokerPoints across all entries
  upsetBonus: number         // sum of upsetPoints across all entries
  closingBalance: number     // total points (= basePoints + jokerBonus + upsetBonus)
  bestMatch: { label: string; points: number } | null  // highest totalPoints entry
  longestMissStreak: number  // longest consecutive run of totalPoints === 0 (chrono order)
  leaderboardRank: number | null  // from Leaderboard sheet, null if unavailable
}
```

R-IF-D7 — `bestMatch.label` is `"{HomeTeam} v {AwayTeam}"`. When multiple entries tie for highest points, the earliest by `KickoffUTC` wins. `null` when the player has zero entries.

R-IF-D8 — `longestMissStreak` counts consecutive entries with `totalPoints === 0` in chronological order. When no misses exist, the value is `0`.

### Standing

```typescript
interface Standing {
  rank: number
  leaderDistance: number    // points behind #1 (0 if player IS #1)
  avgDistance: number       // points above/below average (positive = above)
  average: number           // rounded mean of all leaderboard entry points
  isLeading: boolean        // true when rank === 1
}
```

R-IF-D9 — `average` is `Math.round(sum / count)` of all leaderboard entries' points. `avgDistance` = player's total − `average`. Positive means above average.

### PlayerPickerItem

```typescript
interface PlayerPickerItem {
  displayName: string
  batch: string
  totalPoints: number
  rank: number
  avatarUrl: string | null
}
```

R-IF-D10 — `PlayerPickerItem[]` is sorted by `rank` ascending (best first), then alphabetically by `displayName` for ties.

---

## Functions: ledger-aggregates.ts

All functions are pure (no side effects, no React imports, no network). Each is independently unit-testable.

### buildLedgerEntries

```typescript
function buildLedgerEntries(
  fixtures: FixtureRow[],
  predictions: PredictionRow[],
  scores: ScoreRow[],
  players: PlayerRow[],
  playerEmail: string,
): LedgerEntry[]
```

R-IF-D11 — Returns entries for scored fixtures the player predicted, sorted **chronologically** by `KickoffUTC` ascending, with `runningBalance` computed cumulatively.

R-IF-D12 — Joins: for each scored fixture the player predicted, finds three score rows keyed by `(email, matchId)`:
- **Base:** the `ScoreRow` where `Score.Stage` matches `Fixture.Stage`. Fallback: if no stage-match exists, use the first score row where `Stage` is neither `"JOKER"` nor `"UPSET"`. If no base row exists at all, treat as miss (0 points).
- **Joker:** the optional `ScoreRow` where `Score.Stage === "JOKER"`.
- **Upset:** the optional `ScoreRow` where `Score.Stage === "UPSET"`.

This matches the existing `joinMatchReplay` logic in `prediction-aggregates.ts`.

R-IF-D13 — Tier is derived via `parseScoreDetail(baseScoreRow.Detail)`, never from `Score.Stage`. When no base score row exists, tier is `"miss"` and points are `0`.

R-IF-D14 — Predictions are deduped via `dedupeLatestPredictions` (latest `Timestamp` wins per email+match pair). Predictions from emails not in the `Players` sheet are excluded — uses `buildPlayerIndex`.

R-IF-D15 — `playerEmail` matching is case-insensitive, trimmed (consistent with `buildPlayerIndex` from `prediction-aggregates.ts`).

R-IF-D16 — Only fixtures with `Scored === "Y"` produce entries. Unscored fixtures are silently excluded.

R-IF-D17 — When a player predicted a scored fixture but has no Score rows for that match, the entry has `basePoints: 0`, `jokerPoints: 0`, `upsetPoints: 0`, `totalPoints: 0`, `tier: "miss"`, `goalsOff: null`.

### computeLedgerStats

```typescript
function computeLedgerStats(entries: LedgerEntry[]): LedgerStatsData
```

R-IF-D18 — Pure aggregation over entries. No filtering, no sorting — operates on whatever entries are passed.

R-IF-D19 — When `entries` is empty, returns `{ total: 0, matchesPlayed: 0, exactCount: 0, hitRate: 0, jokerBonus: 0, upsetBonus: 0 }`.

### groupEntriesByRound

```typescript
function groupEntriesByRound(entries: LedgerEntry[]): LedgerRoundGroupData[]
```

R-IF-D20 — Groups entries by `entry.fixture.round`. Groups ordered by the latest `KickoffUTC` within each group, descending (newest round first).

R-IF-D21 — Within each group, entries are ordered reverse-chronologically by `KickoffUTC` (newest match first within the round).

R-IF-D22 — Each group's `subtotal` is the sum of `totalPoints` for its entries. `exactCount` is the count of entries where `tier === "exact"`.

### buildChartData

```typescript
function buildChartData(entries: LedgerEntry[]): ChartPoint[]
```

R-IF-D23 — Expects entries in chronological order (as returned by `buildLedgerEntries`). Returns `ChartPoint[]` in the same chronological order.

R-IF-D24 — `matchLabel` is `"{fixture.homeTeam} v {fixture.awayTeam}"`.

R-IF-D25 — When `entries` is empty, returns `[]`.

### computeClosingStatement

```typescript
function computeClosingStatement(
  entries: LedgerEntry[],
  leaderboardRank: number | null,
): ClosingStatementData
```

R-IF-D26 — `closingBalance` equals `basePoints + jokerBonus + upsetBonus` (the final running balance). It must equal the last entry's `runningBalance` when entries are chronologically ordered.

R-IF-D27 — `longestMissStreak` is computed from entries in chronological order. Streak = consecutive entries where `totalPoints === 0`.

R-IF-D28 — When `entries` is empty, all counts are `0`, `bestMatch` is `null`, `closingBalance` is `0`, `longestMissStreak` is `0`.

### computeStanding

```typescript
function computeStanding(
  playerDisplayName: string,
  leaderboardEntries: LeaderboardEntry[],
): Standing | null
```

R-IF-D29 — Returns `null` when `leaderboardEntries` is empty.

R-IF-D30 — Finds the player by case-insensitive match of `playerDisplayName` against `LeaderboardEntry.name`. When no match is found (player not on leaderboard), returns `null`. `rank` is the matched entry's dense rank from the leaderboard (already computed by `parseLeaderboardData`).

R-IF-D31 — `leaderDistance` = `leaderboardEntries[0].points - matchedEntry.points`. When the player IS the leader (rank 1), `leaderDistance` is `0` and `isLeading` is `true`.

R-IF-D32 — `average` = `Math.round(sum of all entry points / entry count)`. `avgDistance` = `matchedEntry.points - average`. Test vector: entries with points [199, 195, 190, 187] → average = `Math.round(771/4)` = 193; player with 187 → avgDistance = -6.

### buildPlayerPickerList

```typescript
function buildPlayerPickerList(
  leaderboardEntries: LeaderboardEntry[],
  avatarMap: Map<string, string>,
  playerEmailHashes: Map<string, string>,
): PlayerPickerItem[]
```

R-IF-D33a — Builds the full picker list by joining leaderboard data with avatar URLs. For each `LeaderboardEntry`, looks up the avatar via `playerEmailHashes.get(entry.name)` → emailHash → `avatarMap.get(emailHash)` → avatarUrl or `null`.

R-IF-D33b — `playerEmailHashes` is a `Map<displayName, emailHash>` pre-computed by the page component: for each player in the `Players` sheet, compute `computeEmailHash(player.Email)` and key by `player.DisplayName`. This map is built once (async, ~70 hashes) when data loads.

R-IF-D33c — Returns `PlayerPickerItem[]` sorted by `rank` ascending, then `displayName` alphabetically for ties (same as R-IF-D10).

R-IF-D33d — When `leaderboardEntries` is empty, returns `[]`. When `avatarMap` is empty (whos-coming failed), all items have `avatarUrl: null` — the list is still populated from leaderboard data.

### computeEmailHash

```typescript
function computeEmailHash(email: string): Promise<string>
```

R-IF-D33 — Returns the first 8 characters of the hex-encoded SHA-256 hash of `email.trim().toLowerCase()`. Lowercase hex output.

R-IF-D34 — Async (returns a `Promise`). Must work in both browser and Cloudflare Workers environments.

---

## Hook: useLedgerData

```typescript
function useLedgerData(
  dataset: PredictionsDataset | null,
  playerEmail: string | null,
  leaderboardEntries: LeaderboardEntry[] | null,
  playerDisplayName: string | null,
): {
  entries: LedgerEntry[]
  stats: LedgerStatsData
  roundGroups: LedgerRoundGroupData[]
  chartData: ChartPoint[]
  closingStatement: ClosingStatementData
  standing: Standing | null
} | null
```

R-IF-D35 — Returns `null` when `dataset` is `null` or `playerEmail` is `null`.

R-IF-D36 — The hook's `entries` field is in **reverse-chronological** order (newest first) — the display order. `chartData` is in chronological order (earliest first). Both are derived from the same underlying computation.

R-IF-D37 — For `standing`, calls `computeStanding(playerDisplayName, leaderboardEntries)`. When `leaderboardEntries` is `null` or `playerDisplayName` is `null`, `standing` is `null`.

R-IF-D38 — Recomputes only when inputs change. Stable output for stable inputs.

R-IF-D39 — Does NOT manage URL state, fetch data, or render anything. All data is passed in by the caller.

---

## Reused exports from prediction-aggregates.ts

The ledger module imports these existing functions. Their contracts are already established; this section documents the dependency:

| Function | Used for |
|----------|----------|
| `parseScoreDetail(detail: string)` | Deriving `tier` and `goalsOff` from `Score.Detail` |
| `dedupeLatestPredictions(predictions: PredictionRow[])` | Keeping latest prediction per email+match |
| `buildPlayerIndex(players: PlayerRow[])` | Building email→PlayerSummary map, filtering unknown emails |

R-IF-D40 — The ledger's date-sorting behavior for `KickoffUTC` must produce the same chronological order as the match replay's existing sort. Implementation note: `parseSheetDate` in `prediction-aggregates.ts` is the existing date parser — it is not currently exported but will need to be.

---

## Privacy invariant

R-IF-D41 — No function in `ledger-aggregates.ts` or `useLedgerData` returns raw email addresses in any consumer-visible field. Email is used internally for joins (as a key) but never surfaces in `LedgerEntry`, `LedgerStatsData`, `ChartPoint`, `ClosingStatementData`, `Standing`, or `PlayerPickerItem`. Display name and batch are the only identity fields in output types.

---

## Edge cases

- Player with zero predictions → `buildLedgerEntries` returns `[]`. All stats are zero. `bestMatch` is `null`.
- Player predicted a match but has no Score rows → entry with 0 points, tier = miss.
- Joker on a miss → `isJoker: true`, `jokerPoints: 0`, `totalPoints: 0`.
- Duplicate predictions → latest Timestamp wins (via `dedupeLatestPredictions`).
- Leaderboard unavailable → `standing: null`, `closingStatement.leaderboardRank: null`.
- Multiple entries tie for `bestMatch` → earliest by KickoffUTC wins.
- All entries are misses → `hitRate: 0`, `longestMissStreak` = total entries.
