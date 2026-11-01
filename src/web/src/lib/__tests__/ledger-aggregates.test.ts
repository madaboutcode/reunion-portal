import { describe, it, expect } from "vitest";
import {
  buildLedgerEntries,
  computeLedgerStats,
  groupEntriesByRound,
  buildChartData,
  computeClosingStatement,
  computeStanding,
  computeEmailHash,
  buildPlayerPickerList,
} from "../ledger-aggregates";
import type {
  FixtureRow,
  LedgerEntry,
  PlayerRow,
  PredictionRow,
  ScoreRow,
} from "../prediction-types";
import type { LeaderboardEntry } from "@/components/leaderboard/types";

function fixture(overrides: Partial<FixtureRow> & { MatchId: string }): FixtureRow {
  return {
    Round: "Group A",
    Stage: "GROUP",
    KickoffUTC: "6/14/2026 18:00:00",
    HomeTeam: "USA",
    AwayTeam: "MEX",
    ActualHome: "2",
    ActualAway: "1",
    Scored: "Y",
    ...overrides,
  };
}

function prediction(
  overrides: Partial<PredictionRow> & { MatchId: string; Email: string },
): PredictionRow {
  return {
    Timestamp: "6/14/2026 12:00:00",
    PredHome: "2",
    PredAway: "1",
    ...overrides,
  };
}

function score(
  overrides: Partial<ScoreRow> & { MatchId: string; Email: string },
): ScoreRow {
  return {
    Stage: "GROUP",
    Points: "10",
    Detail: "EXACT SCORE",
    ...overrides,
  };
}

const PLAYERS: PlayerRow[] = [
  { Email: "omar@example.com", DisplayName: "Omar Mock", Batch: "ECE" },
  { Email: "raj@example.com", DisplayName: "RajK", Batch: "CSE" },
];

describe("buildLedgerEntries", () => {
  it("builds entries with correct tiers, points, and running balances", () => {
    const fixtures = [
      fixture({ MatchId: "M1", KickoffUTC: "6/14/2026 18:00:00" }),
      fixture({
        MatchId: "M2",
        KickoffUTC: "6/15/2026 18:00:00",
        HomeTeam: "BRA",
        AwayTeam: "ARG",
        ActualHome: "1",
        ActualAway: "0",
      }),
    ];

    const predictions = [
      prediction({ MatchId: "M1", Email: "omar@example.com", PredHome: "2", PredAway: "1" }),
      prediction({ MatchId: "M2", Email: "omar@example.com", PredHome: "2", PredAway: "0" }),
    ];

    const scores = [
      score({ MatchId: "M1", Email: "omar@example.com", Points: "10", Detail: "EXACT SCORE" }),
      score({ MatchId: "M2", Email: "omar@example.com", Points: "3", Detail: "OUTCOME", Stage: "GROUP" }),
    ];

    const entries = buildLedgerEntries(fixtures, predictions, scores, PLAYERS, "omar@example.com");

    expect(entries).toHaveLength(2);
    expect(entries[0].matchId).toBe("M1");
    expect(entries[0].tier).toBe("exact");
    expect(entries[0].basePoints).toBe(10);
    expect(entries[0].totalPoints).toBe(10);
    expect(entries[0].runningBalance).toBe(10);

    expect(entries[1].matchId).toBe("M2");
    expect(entries[1].tier).toBe("outcome");
    expect(entries[1].basePoints).toBe(3);
    expect(entries[1].runningBalance).toBe(13);
  });

  it("returns empty array for unknown player", () => {
    const entries = buildLedgerEntries(
      [fixture({ MatchId: "M1" })],
      [prediction({ MatchId: "M1", Email: "unknown@example.com" })],
      [],
      PLAYERS,
      "unknown@example.com",
    );
    expect(entries).toEqual([]);
  });

  it("excludes unscored fixtures", () => {
    const fixtures = [fixture({ MatchId: "M1", Scored: "N" })];
    const predictions = [prediction({ MatchId: "M1", Email: "omar@example.com" })];
    const scores = [score({ MatchId: "M1", Email: "omar@example.com" })];

    const entries = buildLedgerEntries(fixtures, predictions, scores, PLAYERS, "omar@example.com");
    expect(entries).toHaveLength(0);
  });

  it("joker checkbox ticked but not applied — isJoker false", () => {
    const fixtures = [fixture({ MatchId: "M1" })];
    const predictions = [
      prediction({ MatchId: "M1", Email: "omar@example.com", Joker: "Yes", PredHome: "2", PredAway: "1" }),
    ];
    const scores = [
      score({ MatchId: "M1", Email: "omar@example.com", Points: "10", Detail: "EXACT SCORE", Stage: "GROUP" }),
    ];

    const entries = buildLedgerEntries(fixtures, predictions, scores, PLAYERS, "omar@example.com");
    expect(entries).toHaveLength(1);
    expect(entries[0].prediction.isJoker).toBe(false);
    expect(entries[0].jokerPoints).toBe(0);
    expect(entries[0].totalPoints).toBe(10);
  });

  it("handles joker on a miss — isJoker true, jokerPoints 0", () => {
    const fixtures = [fixture({ MatchId: "M1" })];
    const predictions = [
      prediction({ MatchId: "M1", Email: "omar@example.com", Joker: "Yes", PredHome: "0", PredAway: "0" }),
    ];
    const scores = [
      score({ MatchId: "M1", Email: "omar@example.com", Points: "0", Detail: "MISS", Stage: "GROUP" }),
      score({ MatchId: "M1", Email: "omar@example.com", Points: "0", Detail: "", Stage: "JOKER" }),
    ];

    const entries = buildLedgerEntries(fixtures, predictions, scores, PLAYERS, "omar@example.com");
    expect(entries).toHaveLength(1);
    expect(entries[0].prediction.isJoker).toBe(true);
    expect(entries[0].jokerPoints).toBe(0);
    expect(entries[0].totalPoints).toBe(0);
    expect(entries[0].tier).toBe("miss");
  });

  it("includes upset points", () => {
    const fixtures = [fixture({ MatchId: "M1" })];
    const predictions = [prediction({ MatchId: "M1", Email: "omar@example.com" })];
    const scores = [
      score({ MatchId: "M1", Email: "omar@example.com", Points: "10", Detail: "EXACT SCORE", Stage: "GROUP" }),
      score({ MatchId: "M1", Email: "omar@example.com", Points: "5", Detail: "", Stage: "UPSET" }),
    ];

    const entries = buildLedgerEntries(fixtures, predictions, scores, PLAYERS, "omar@example.com");
    expect(entries[0].basePoints).toBe(10);
    expect(entries[0].upsetPoints).toBe(5);
    expect(entries[0].totalPoints).toBe(15);
  });

  it("handles predicted match with no score rows (miss with 0 points)", () => {
    const fixtures = [fixture({ MatchId: "M1" })];
    const predictions = [prediction({ MatchId: "M1", Email: "omar@example.com" })];
    const scores: ScoreRow[] = [];

    const entries = buildLedgerEntries(fixtures, predictions, scores, PLAYERS, "omar@example.com");
    expect(entries).toHaveLength(1);
    expect(entries[0].tier).toBe("miss");
    expect(entries[0].totalPoints).toBe(0);
    expect(entries[0].goalsOff).toBeNull();
  });

  it("deduplicates predictions — latest timestamp wins", () => {
    const fixtures = [fixture({ MatchId: "M1" })];
    const predictions = [
      prediction({ MatchId: "M1", Email: "omar@example.com", PredHome: "1", PredAway: "0", Timestamp: "6/14/2026 10:00:00" }),
      prediction({ MatchId: "M1", Email: "omar@example.com", PredHome: "2", PredAway: "1", Timestamp: "6/14/2026 12:00:00" }),
    ];
    const scores = [score({ MatchId: "M1", Email: "omar@example.com" })];

    const entries = buildLedgerEntries(fixtures, predictions, scores, PLAYERS, "omar@example.com");
    expect(entries).toHaveLength(1);
    expect(entries[0].prediction.predHome).toBe(2);
    expect(entries[0].prediction.predAway).toBe(1);
  });

  it("is case-insensitive for email matching", () => {
    const fixtures = [fixture({ MatchId: "M1" })];
    const predictions = [prediction({ MatchId: "M1", Email: "OMAR@EXAMPLE.COM" })];
    const scores = [score({ MatchId: "M1", Email: "omar@example.com" })];

    const entries = buildLedgerEntries(fixtures, predictions, scores, PLAYERS, "omar@example.com");
    expect(entries).toHaveLength(1);
  });
});

describe("computeLedgerStats", () => {
  it("computes stats from entries", () => {
    const entries: LedgerEntry[] = [
      { matchId: "M1", basePoints: 10, jokerPoints: 0, upsetPoints: 0, totalPoints: 10, tier: "exact", goalsOff: 0, runningBalance: 10 } as LedgerEntry,
      { matchId: "M2", basePoints: 3, jokerPoints: 0, upsetPoints: 0, totalPoints: 3, tier: "outcome", goalsOff: null, runningBalance: 13 } as LedgerEntry,
      { matchId: "M3", basePoints: 0, jokerPoints: 0, upsetPoints: 0, totalPoints: 0, tier: "miss", goalsOff: null, runningBalance: 13 } as LedgerEntry,
    ];

    const stats = computeLedgerStats(entries);
    expect(stats.total).toBe(13);
    expect(stats.matchesPlayed).toBe(3);
    expect(stats.exactCount).toBe(1);
    expect(stats.hitRate).toBe(67);
    expect(stats.jokerBonus).toBe(0);
    expect(stats.upsetBonus).toBe(0);
  });

  it("returns zeroes for empty entries", () => {
    const stats = computeLedgerStats([]);
    expect(stats).toEqual({
      total: 0,
      matchesPlayed: 0,
      exactCount: 0,
      hitRate: 0,
      jokerBonus: 0,
      upsetBonus: 0,
      momBonus: 0,
      tournamentBonus: 0,
    });
  });
});

describe("groupEntriesByRound", () => {
  it("groups entries by round with newest round first", () => {
    const entries: LedgerEntry[] = [
      { fixture: { round: "Group A", kickoffUtc: "6/14/2026 18:00:00" }, totalPoints: 10, tier: "exact" } as LedgerEntry,
      { fixture: { round: "Group A", kickoffUtc: "6/15/2026 18:00:00" }, totalPoints: 3, tier: "outcome" } as LedgerEntry,
      { fixture: { round: "Round of 16", kickoffUtc: "6/28/2026 18:00:00" }, totalPoints: 7, tier: "goalDiff" } as LedgerEntry,
    ];

    const groups = groupEntriesByRound(entries);
    expect(groups).toHaveLength(2);
    expect(groups[0].round).toBe("Round of 16");
    expect(groups[0].subtotal).toBe(7);
    expect(groups[1].round).toBe("Group A");
    expect(groups[1].subtotal).toBe(13);
    expect(groups[1].exactCount).toBe(1);
  });

  it("orders entries within a round reverse-chrono (newest first)", () => {
    const entries: LedgerEntry[] = [
      { matchId: "M1", fixture: { round: "Group A", kickoffUtc: "6/14/2026 18:00:00" }, totalPoints: 10, tier: "exact" } as LedgerEntry,
      { matchId: "M2", fixture: { round: "Group A", kickoffUtc: "6/15/2026 18:00:00" }, totalPoints: 5, tier: "goalDiff" } as LedgerEntry,
    ];

    const groups = groupEntriesByRound(entries);
    expect(groups[0].entries[0].matchId).toBe("M2");
    expect(groups[0].entries[1].matchId).toBe("M1");
  });
});

describe("buildChartData", () => {
  it("builds chart data in chronological order", () => {
    const entries: LedgerEntry[] = [
      { matchId: "M1", fixture: { homeTeam: "USA", awayTeam: "MEX" }, totalPoints: 10, tier: "exact", runningBalance: 10 } as LedgerEntry,
      { matchId: "M2", fixture: { homeTeam: "BRA", awayTeam: "ARG" }, totalPoints: 3, tier: "outcome", runningBalance: 13 } as LedgerEntry,
    ];

    const chart = buildChartData(entries);
    expect(chart).toHaveLength(2);
    expect(chart[0].matchLabel).toBe("USA v MEX");
    expect(chart[0].running).toBe(10);
    expect(chart[0].points).toBe(10);
    expect(chart[1].matchLabel).toBe("BRA v ARG");
    expect(chart[1].running).toBe(13);
  });

  it("returns empty for empty entries", () => {
    expect(buildChartData([])).toEqual([]);
  });
});

describe("computeClosingStatement", () => {
  it("computes tier distribution, best match, and miss streak", () => {
    const entries: LedgerEntry[] = [
      { matchId: "M1", fixture: { homeTeam: "USA", awayTeam: "MEX", kickoffUtc: "6/14/2026 18:00:00" }, basePoints: 10, jokerPoints: 0, upsetPoints: 0, totalPoints: 10, tier: "exact" } as LedgerEntry,
      { matchId: "M2", fixture: { homeTeam: "BRA", awayTeam: "ARG", kickoffUtc: "6/15/2026 18:00:00" }, basePoints: 0, jokerPoints: 0, upsetPoints: 0, totalPoints: 0, tier: "miss" } as LedgerEntry,
      { matchId: "M3", fixture: { homeTeam: "GER", awayTeam: "FRA", kickoffUtc: "6/16/2026 18:00:00" }, basePoints: 0, jokerPoints: 0, upsetPoints: 0, totalPoints: 0, tier: "miss" } as LedgerEntry,
      { matchId: "M4", fixture: { homeTeam: "ESP", awayTeam: "POR", kickoffUtc: "6/17/2026 18:00:00" }, basePoints: 5, jokerPoints: 0, upsetPoints: 0, totalPoints: 5, tier: "goalDiff" } as LedgerEntry,
    ];

    const cs = computeClosingStatement(entries, 3);
    expect(cs.matchesPredicted).toBe(4);
    expect(cs.resultsCorrect).toBe(2);
    expect(cs.hitRate).toBe(50);
    expect(cs.exactCount).toBe(1);
    expect(cs.goalDiffCount).toBe(1);
    expect(cs.missCount).toBe(2);
    expect(cs.closingBalance).toBe(15);
    expect(cs.bestMatch).toEqual({ label: "USA v MEX", points: 10 });
    expect(cs.longestMissStreak).toBe(2);
    expect(cs.leaderboardRank).toBe(3);
  });

  it("handles empty entries", () => {
    const cs = computeClosingStatement([], null);
    expect(cs.matchesPredicted).toBe(0);
    expect(cs.closingBalance).toBe(0);
    expect(cs.bestMatch).toBeNull();
    expect(cs.longestMissStreak).toBe(0);
  });

  it("handles all misses", () => {
    const entries: LedgerEntry[] = [
      { matchId: "M1", fixture: { homeTeam: "A", awayTeam: "B", kickoffUtc: "6/14/2026 18:00:00" }, basePoints: 0, jokerPoints: 0, upsetPoints: 0, totalPoints: 0, tier: "miss" } as LedgerEntry,
      { matchId: "M2", fixture: { homeTeam: "C", awayTeam: "D", kickoffUtc: "6/15/2026 18:00:00" }, basePoints: 0, jokerPoints: 0, upsetPoints: 0, totalPoints: 0, tier: "miss" } as LedgerEntry,
    ];

    const cs = computeClosingStatement(entries, null);
    expect(cs.hitRate).toBe(0);
    expect(cs.longestMissStreak).toBe(2);
    expect(cs.bestMatch).toBeNull();
  });
});

describe("computeStanding", () => {
  const leaderboard: LeaderboardEntry[] = [
    { id: "1", rank: 1, name: "Omar Mock", department: "ECE", points: 199, mainPts: 0 },
    { id: "2", rank: 2, name: "RajK", department: "CSE", points: 195, mainPts: 0 },
    { id: "3", rank: 3, name: "MeenaP", department: "EEE", points: 190, mainPts: 0 },
    { id: "4", rank: 4, name: "AnilM", department: "ME", points: 187, mainPts: 0 },
  ];

  it("computes rank, leader distance, and average", () => {
    const standing = computeStanding("AnilM", leaderboard);
    expect(standing).not.toBeNull();
    expect(standing!.rank).toBe(4);
    expect(standing!.leaderDistance).toBe(12);
    expect(standing!.average).toBe(193);
    expect(standing!.avgDistance).toBe(-6);
    expect(standing!.isLeading).toBe(false);
  });

  it("returns isLeading for the leader", () => {
    const standing = computeStanding("Omar Mock", leaderboard);
    expect(standing!.isLeading).toBe(true);
    expect(standing!.leaderDistance).toBe(0);
  });

  it("is case-insensitive", () => {
    const standing = computeStanding("Omar Mock", leaderboard);
    expect(standing).not.toBeNull();
    expect(standing!.rank).toBe(1);
  });

  it("returns null for empty leaderboard", () => {
    expect(computeStanding("Omar Mock", [])).toBeNull();
  });

  it("returns null when player not on leaderboard", () => {
    expect(computeStanding("Unknown", leaderboard)).toBeNull();
  });
});

describe("computeEmailHash", () => {
  it("produces the correct hash for test vector", async () => {
    const hash = await computeEmailHash("test@example.com");
    expect(hash).toBe("973dfe46");
  });

  it("normalizes with trim and lowercase", async () => {
    const hash1 = await computeEmailHash("  Test@Example.com  ");
    const hash2 = await computeEmailHash("test@example.com");
    expect(hash1).toBe(hash2);
    expect(hash1).toBe("973dfe46");
  });

  it("returns empty string for empty input", async () => {
    expect(await computeEmailHash("")).toBe("");
    expect(await computeEmailHash("  ")).toBe("");
  });
});

describe("buildPlayerPickerList", () => {
  it("builds sorted picker list with avatar urls", () => {
    const leaderboard: LeaderboardEntry[] = [
      { id: "1", rank: 1, name: "Omar Mock", department: "ECE", points: 199, mainPts: 0 },
      { id: "2", rank: 2, name: "RajK", department: "CSE", points: 195, mainPts: 0 },
    ];

    const avatarMap = new Map([["abc12345", "/api/public/photos/42.jpg"]]);
    const emailHashes = new Map([["Omar Mock", "abc12345"]]);

    const list = buildPlayerPickerList(leaderboard, avatarMap, emailHashes);
    expect(list).toHaveLength(2);
    expect(list[0].displayName).toBe("Omar Mock");
    expect(list[0].avatarUrl).toBe("/api/public/photos/42.jpg");
    expect(list[0].rank).toBe(1);
    expect(list[1].displayName).toBe("RajK");
    expect(list[1].avatarUrl).toBeNull();
  });

  it("returns empty for empty leaderboard", () => {
    expect(buildPlayerPickerList([], new Map(), new Map())).toEqual([]);
  });

  it("handles empty avatar map gracefully", () => {
    const leaderboard: LeaderboardEntry[] = [
      { id: "1", rank: 1, name: "Omar Mock", department: "ECE", points: 199, mainPts: 0 },
    ];

    const list = buildPlayerPickerList(leaderboard, new Map(), new Map());
    expect(list[0].avatarUrl).toBeNull();
  });
});
