import type {
  ChartPoint,
  ClosingStatementData,
  FixtureRow,
  LedgerEntry,
  LedgerRoundGroupData,
  LedgerStatsData,
  PlayerPickerItem,
  PlayerRow,
  PredictionRow,
  ScoreRow,
  Standing,
} from "./prediction-types";

import type { LeaderboardEntry } from "@/components/leaderboard/types";

import {
  buildPlayerIndex,
  dedupeLatestPredictions,
  parseScoreDetail,
  parseSheetDate,
} from "./prediction-aggregates";

export function buildLedgerEntries(
  fixtures: FixtureRow[],
  predictions: PredictionRow[],
  scores: ScoreRow[],
  players: PlayerRow[],
  playerEmail: string,
): LedgerEntry[] {
  const playerIndex = buildPlayerIndex(players);
  const normalizedEmail = playerEmail.trim().toLowerCase();

  if (!playerIndex.has(normalizedEmail)) return [];

  const dedupedPredictions = dedupeLatestPredictions(predictions);

  const playerPredictions = dedupedPredictions.filter(
    (row) => row.Email.trim().toLowerCase() === normalizedEmail,
  );

  const scoredFixtureMap = new Map<string, FixtureRow>();
  for (const f of fixtures) {
    if (f.Scored === "Y") {
      scoredFixtureMap.set(f.MatchId, f);
    }
  }

  const scoresByMatch = new Map<string, ScoreRow[]>();
  for (const s of scores) {
    if (s.Email.trim().toLowerCase() !== normalizedEmail) continue;
    const arr = scoresByMatch.get(s.MatchId) ?? [];
    arr.push(s);
    scoresByMatch.set(s.MatchId, arr);
  }

  const entries: LedgerEntry[] = [];

  for (const pred of playerPredictions) {
    const fixture = scoredFixtureMap.get(pred.MatchId);
    if (!fixture) continue;

    const matchScores = scoresByMatch.get(pred.MatchId) ?? [];

    let baseRow: ScoreRow | undefined;
    let jokerRow: ScoreRow | undefined;
    let upsetRow: ScoreRow | undefined;

    for (const s of matchScores) {
      if (s.Stage === "JOKER") {
        jokerRow = s;
      } else if (s.Stage === "UPSET") {
        upsetRow = s;
      } else if (s.Stage === fixture.Stage) {
        baseRow = s;
      } else if (!baseRow) {
        baseRow = s;
      }
    }

    const basePoints = Number.parseInt(baseRow?.Points ?? "0", 10) || 0;
    const jokerPoints = Number.parseInt(jokerRow?.Points ?? "0", 10) || 0;
    const upsetPoints = Number.parseInt(upsetRow?.Points ?? "0", 10) || 0;
    const totalPoints = basePoints + jokerPoints + upsetPoints;

    const { tier, goalsOff, momPoints } = parseScoreDetail(baseRow?.Detail ?? "miss");

    const isJoker = jokerRow !== undefined;

    entries.push({
      matchId: pred.MatchId,
      fixture: {
        homeTeam: fixture.HomeTeam,
        awayTeam: fixture.AwayTeam,
        actualHome: Number.parseInt(fixture.ActualHome ?? "0", 10) || 0,
        actualAway: Number.parseInt(fixture.ActualAway ?? "0", 10) || 0,
        round: fixture.Round.trim(),
        stage: fixture.Stage,
        kickoffUtc: fixture.KickoffUTC,
      },
      prediction: {
        predHome: Number.parseInt(pred.PredHome, 10) || 0,
        predAway: Number.parseInt(pred.PredAway, 10) || 0,
        predMom: pred.PredMOM?.trim() || null,
        isJoker,
      },
      basePoints,
      jokerPoints,
      upsetPoints,
      momPoints,
      totalPoints,
      tier,
      goalsOff,
      runningBalance: 0,
    });
  }

  entries.sort(
    (a, b) =>
      parseSheetDate(a.fixture.kickoffUtc) -
      parseSheetDate(b.fixture.kickoffUtc),
  );

  let running = 0;
  for (const entry of entries) {
    running += entry.totalPoints;
    entry.runningBalance = running;
  }

  return entries;
}

export function computeLedgerStats(
  entries: LedgerEntry[],
  tournamentBonus = 0,
): LedgerStatsData {
  if (entries.length === 0) {
    return {
      total: tournamentBonus,
      matchesPlayed: 0,
      exactCount: 0,
      hitRate: 0,
      jokerBonus: 0,
      upsetBonus: 0,
      momBonus: 0,
      tournamentBonus,
    };
  }

  let matchTotal = 0;
  let exactCount = 0;
  let entriesWithPoints = 0;
  let jokerBonus = 0;
  let upsetBonus = 0;
  let momBonus = 0;

  for (const e of entries) {
    matchTotal += e.totalPoints;
    if (e.tier === "exact") exactCount++;
    if (e.totalPoints > 0) entriesWithPoints++;
    jokerBonus += e.jokerPoints;
    upsetBonus += e.upsetPoints;
    momBonus += e.momPoints;
  }

  return {
    total: matchTotal + tournamentBonus,
    matchesPlayed: entries.length,
    exactCount,
    hitRate: Math.round((entriesWithPoints / entries.length) * 100),
    jokerBonus,
    upsetBonus,
    momBonus,
    tournamentBonus,
  };
}

export function groupEntriesByRound(
  entries: LedgerEntry[],
): LedgerRoundGroupData[] {
  const groupMap = new Map<
    string,
    { entries: LedgerEntry[]; latestKickoff: number }
  >();

  for (const entry of entries) {
    const round = entry.fixture.round;
    const existing = groupMap.get(round);
    const kickoff = parseSheetDate(entry.fixture.kickoffUtc);

    if (existing) {
      existing.entries.push(entry);
      if (kickoff > existing.latestKickoff) {
        existing.latestKickoff = kickoff;
      }
    } else {
      groupMap.set(round, { entries: [entry], latestKickoff: kickoff });
    }
  }

  const groups: LedgerRoundGroupData[] = [];

  for (const [round, { entries: roundEntries }] of groupMap) {
    const sorted = [...roundEntries].sort(
      (a, b) =>
        parseSheetDate(b.fixture.kickoffUtc) -
        parseSheetDate(a.fixture.kickoffUtc),
    );

    groups.push({
      round,
      subtotal: sorted.reduce((sum, e) => sum + e.totalPoints, 0),
      exactCount: sorted.filter((e) => e.tier === "exact").length,
      entries: sorted,
    });
  }

  groups.sort((a, b) => {
    const aMax = groupMap.get(a.round)!.latestKickoff;
    const bMax = groupMap.get(b.round)!.latestKickoff;
    return bMax - aMax;
  });

  return groups;
}

export function buildChartData(entries: LedgerEntry[]): ChartPoint[] {
  if (entries.length === 0) return [];

  return entries.map((e) => ({
    matchId: e.matchId,
    running: e.runningBalance,
    points: e.totalPoints,
    tier: e.tier,
    matchLabel: `${e.fixture.homeTeam} v ${e.fixture.awayTeam}`,
  }));
}

export function computeClosingStatement(
  entries: LedgerEntry[],
  leaderboardRank: number | null,
  tournamentBonus = 0,
): ClosingStatementData {
  if (entries.length === 0) {
    return {
      matchesPredicted: 0,
      resultsCorrect: 0,
      hitRate: 0,
      exactCount: 0,
      goalDiffCount: 0,
      outcomeCount: 0,
      missCount: 0,
      basePoints: 0,
      jokerBonus: 0,
      upsetBonus: 0,
      momBonus: 0,
      tournamentBonus,
      closingBalance: tournamentBonus,
      bestMatch: null,
      longestMissStreak: 0,
      leaderboardRank,
    };
  }

  let resultsCorrect = 0;
  let exactCount = 0;
  let goalDiffCount = 0;
  let outcomeCount = 0;
  let missCount = 0;
  let basePoints = 0;
  let jokerBonus = 0;
  let upsetBonus = 0;
  let momBonus = 0;

  let bestEntry: LedgerEntry | null = null;
  let currentStreak = 0;
  let longestMissStreak = 0;

  const chronoEntries = [...entries].sort(
    (a, b) =>
      parseSheetDate(a.fixture.kickoffUtc) -
      parseSheetDate(b.fixture.kickoffUtc),
  );

  for (const e of chronoEntries) {
    if (e.totalPoints > 0) resultsCorrect++;
    if (e.tier === "exact") exactCount++;
    else if (e.tier === "goalDiff") goalDiffCount++;
    else if (e.tier === "outcome") outcomeCount++;
    else missCount++;

    basePoints += e.basePoints;
    jokerBonus += e.jokerPoints;
    upsetBonus += e.upsetPoints;
    momBonus += e.momPoints;

    if (e.totalPoints > 0) {
      if (
        bestEntry === null ||
        e.totalPoints > bestEntry.totalPoints ||
        (e.totalPoints === bestEntry.totalPoints &&
          parseSheetDate(e.fixture.kickoffUtc) <
            parseSheetDate(bestEntry.fixture.kickoffUtc))
      ) {
        bestEntry = e;
      }
    }

    if (e.totalPoints === 0) {
      currentStreak++;
      if (currentStreak > longestMissStreak) {
        longestMissStreak = currentStreak;
      }
    } else {
      currentStreak = 0;
    }
  }

  return {
    matchesPredicted: entries.length,
    resultsCorrect,
    hitRate: Math.round((resultsCorrect / entries.length) * 100),
    exactCount,
    goalDiffCount,
    outcomeCount,
    missCount,
    basePoints,
    jokerBonus,
    upsetBonus,
    momBonus,
    tournamentBonus,
    closingBalance: basePoints + jokerBonus + upsetBonus + tournamentBonus,
    bestMatch: bestEntry
      ? {
          label: `${bestEntry.fixture.homeTeam} v ${bestEntry.fixture.awayTeam}`,
          points: bestEntry.totalPoints,
        }
      : null,
    longestMissStreak,
    leaderboardRank,
  };
}

export function computeStanding(
  playerDisplayName: string,
  leaderboardEntries: LeaderboardEntry[],
): Standing | null {
  if (leaderboardEntries.length === 0) return null;

  const normalizedName = playerDisplayName.trim().toLowerCase();
  const matched = leaderboardEntries.find(
    (e) => e.name.trim().toLowerCase() === normalizedName,
  );

  if (!matched) return null;

  const totalPoints = leaderboardEntries.reduce(
    (sum, e) => sum + e.points,
    0,
  );
  const average = Math.round(totalPoints / leaderboardEntries.length);

  return {
    rank: matched.rank,
    leaderDistance: leaderboardEntries[0].points - matched.points,
    avgDistance: matched.points - average,
    average,
    isLeading: matched.rank === 1,
  };
}

export async function computeEmailHash(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return "";

  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 8);
}

export function buildPlayerPickerList(
  leaderboardEntries: LeaderboardEntry[],
  avatarMap: Map<string, string>,
  playerEmailHashes: Map<string, string>,
): PlayerPickerItem[] {
  if (leaderboardEntries.length === 0) return [];

  return leaderboardEntries
    .map((entry) => {
      const emailHash = playerEmailHashes.get(entry.name);
      const avatarUrl = emailHash ? (avatarMap.get(emailHash) ?? null) : null;

      return {
        displayName: entry.name,
        batch: entry.department,
        totalPoints: entry.points,
        rank: entry.rank,
        avatarUrl,
      };
    })
    .sort(
      (a, b) =>
        a.rank - b.rank || a.displayName.localeCompare(b.displayName),
    );
}
