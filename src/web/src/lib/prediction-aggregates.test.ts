import { describe, expect, it } from "vitest";
import {
  buildPlayerIndex,
  computeMatchCrowdSummary,
  dedupeLatestPredictions,
  getLatestScoredMatchId,
  groupScoredMatchesByRound,
  joinMatchReplay,
  mapDetailToTier,
  parseScoreDetail,
} from "./prediction-aggregates";
import type { FixtureRow, PlayerRow, PredictionRow, ScoreRow } from "./prediction-types";

const fixtures: FixtureRow[] = [
  {
    MatchId: "1",
    Round: "Matchday 1",
    Stage: "GROUP",
    Group: "Group A",
    KickoffUTC: "6/12/2026 5:00:00",
    HomeTeam: "Mexico",
    AwayTeam: "South Africa",
    ActualHome: "2",
    ActualAway: "0",
    Status: "FINAL",
    Scored: "Y",
  },
  {
    MatchId: "2",
    Round: "Matchday 2",
    Stage: "GROUP",
    Group: "Group A",
    KickoffUTC: "6/13/2026 5:00:00",
    HomeTeam: "USA",
    AwayTeam: "Paraguay",
    ActualHome: "4",
    ActualAway: "1",
    Status: "FINAL",
    Scored: "Y",
  },
  {
    MatchId: "3",
    Round: "Quarter-finals",
    Stage: "QF",
    Group: "",
    KickoffUTC: "7/10/2026 5:00:00",
    HomeTeam: "Brazil",
    AwayTeam: "Spain",
    ActualHome: "",
    ActualAway: "",
    Status: "OPEN",
    Scored: "",
  },
];

const players: PlayerRow[] = [
  {
    Email: "jai.fixture@example.com",
    DisplayName: "Jai Fixture",
    Batch: "Electronics and Communication Engineering",
  },
  {
    Email: "rahul@example.com",
    DisplayName: "Rahul",
    Batch: "Electrical and Electronics Engineering",
  },
];

const predictions: PredictionRow[] = [
  {
    Timestamp: "6/1/2026",
    Email: "jai.fixture@example.com",
    MatchId: "1",
    PredHome: "1",
    PredAway: "0",
    Joker: "",
  },
  {
    Timestamp: "6/2/2026",
    Email: "jai.fixture@example.com",
    MatchId: "1",
    PredHome: "2",
    PredAway: "0",
    Joker: "TRUE",
  },
  {
    Timestamp: "6/2/2026",
    Email: "rahul@example.com",
    MatchId: "1",
    PredHome: "2",
    PredAway: "1",
    Joker: "",
  },
  {
    Timestamp: "6/2/2026",
    Email: "outsider@example.com",
    MatchId: "1",
    PredHome: "2",
    PredAway: "0",
    Joker: "",
  },
];

const scores: ScoreRow[] = [
  {
    Email: "jai.fixture@example.com",
    MatchId: "1",
    Stage: "GROUP",
    Points: "10",
    Detail: "EXACT 2-0",
  },
  {
    Email: "jai.fixture@example.com",
    MatchId: "1",
    Stage: "JOKER",
    Points: "10",
    Detail: "JOKER x2 (G1)",
  },
  {
    Email: "rahul@example.com",
    MatchId: "1",
    Stage: "GROUP",
    Points: "7",
    Detail: "GOAL-DIFF",
  },
];

describe("mapDetailToTier", () => {
  it("maps old score details to tiers (backward compat)", () => {
    expect(mapDetailToTier("EXACT 2-0")).toBe("exact");
    expect(mapDetailToTier("GOAL-DIFF")).toBe("goalDiff");
    expect(mapDetailToTier("OUTCOME")).toBe("outcome");
    expect(mapDetailToTier("miss")).toBe("miss");
  });

  it("maps new closeness details to tiers", () => {
    expect(mapDetailToTier("CLOSE -1 (9)")).toBe("goalDiff");
    expect(mapDetailToTier("CLOSE -2 (8)")).toBe("goalDiff");
    expect(mapDetailToTier("CLOSE -3 (7)")).toBe("outcome");
    expect(mapDetailToTier("CLOSE -4 (6)")).toBe("outcome");
    expect(mapDetailToTier("CLOSE -5 (5)")).toBe("outcome");
    expect(mapDetailToTier("wrong result")).toBe("miss");
  });
});

describe("parseScoreDetail", () => {
  it("parses old details without goalsOff", () => {
    expect(parseScoreDetail("GOAL-DIFF")).toEqual({ tier: "goalDiff", goalsOff: null, momPoints: 0 });
    expect(parseScoreDetail("OUTCOME")).toEqual({ tier: "outcome", goalsOff: null, momPoints: 0 });
    expect(parseScoreDetail("miss")).toEqual({ tier: "miss", goalsOff: null, momPoints: 0 });
  });

  it("parses EXACT with goalsOff = 0", () => {
    expect(parseScoreDetail("EXACT 2-0")).toEqual({ tier: "exact", goalsOff: 0, momPoints: 0 });
  });

  it("parses CLOSE details with goalsOff", () => {
    expect(parseScoreDetail("CLOSE -1 (9)")).toEqual({ tier: "goalDiff", goalsOff: 1, momPoints: 0 });
    expect(parseScoreDetail("CLOSE -2 (8)")).toEqual({ tier: "goalDiff", goalsOff: 2, momPoints: 0 });
    expect(parseScoreDetail("CLOSE -3 (7)")).toEqual({ tier: "outcome", goalsOff: 3, momPoints: 0 });
    expect(parseScoreDetail("CLOSE -4 (6)")).toEqual({ tier: "outcome", goalsOff: 4, momPoints: 0 });
    expect(parseScoreDetail("CLOSE -5 (5)")).toEqual({ tier: "outcome", goalsOff: 5, momPoints: 0 });
  });

  it("handles wrong result as miss", () => {
    expect(parseScoreDetail("wrong result")).toEqual({ tier: "miss", goalsOff: null, momPoints: 0 });
  });

  it("extracts the MOM bonus from a +MOM suffix", () => {
    expect(parseScoreDetail("CLOSE -1 (18) +MOM")).toEqual({ tier: "goalDiff", goalsOff: 1, momPoints: 20 });
    expect(parseScoreDetail("EXACT 2-0 +MOM")).toEqual({ tier: "exact", goalsOff: 0, momPoints: 20 });
    expect(parseScoreDetail("CLOSE -1 (18)")).toEqual({ tier: "goalDiff", goalsOff: 1, momPoints: 0 });
  });
});

describe("dedupeLatestPredictions", () => {
  it("keeps the latest timestamp per email and match", () => {
    const latest = dedupeLatestPredictions(predictions);
    expect(latest).toHaveLength(3);
    expect(
      latest.find((row) => row.Email === "jai.fixture@example.com" && row.MatchId === "1"),
    ).toMatchObject({ PredHome: "2", PredAway: "0" });
  });
});

describe("buildPlayerIndex", () => {
  it("normalizes emails for lookups", () => {
    const index = buildPlayerIndex(players);
    expect(index.get("jai.fixture@example.com")?.displayName).toBe("Jai Fixture");
  });
});

describe("joinMatchReplay", () => {
  it("joins one scored match, excludes unregistered rows, and adds joker points", () => {
    const replay = joinMatchReplay({
      fixtures,
      predictions,
      scores,
      players,
      matchId: "1",
    });

    expect(replay).not.toBeNull();
    expect(replay?.fixture.homeTeam).toBe("Mexico");
    expect(replay?.picks).toHaveLength(2);
    expect(replay?.picks[0]).toMatchObject({
      rank: 1,
      player: { displayName: "Jai Fixture" },
      tier: "exact",
      basePoints: 10,
      jokerPoints: 10,
      upsetPoints: 0,
      totalPoints: 20,
    });
  });
});

describe("joinMatchReplay — closeness scoring", () => {
  const r32Fixtures: FixtureRow[] = [
    {
      MatchId: "73",
      Round: "Round of 32",
      Stage: "R32",
      Group: "",
      KickoffUTC: "6/29/2026 12:00:00",
      HomeTeam: "South Africa",
      AwayTeam: "Canada",
      ActualHome: "0",
      ActualAway: "1",
      Status: "FINAL",
      Scored: "Y",
    },
  ];

  const r32Scores: ScoreRow[] = [
    { Email: "jai.fixture@example.com", MatchId: "73", Stage: "R32", Points: "9", Detail: "CLOSE -1 (9)" },
    { Email: "rahul@example.com", MatchId: "73", Stage: "R32", Points: "0", Detail: "wrong result" },
  ];

  const r32Predictions: PredictionRow[] = [
    { Timestamp: "6/28/2026", Email: "jai.fixture@example.com", MatchId: "73", PredHome: "0", PredAway: "2" },
    { Timestamp: "6/28/2026", Email: "rahul@example.com", MatchId: "73", PredHome: "1", PredAway: "0" },
  ];

  it("populates goalsOff from CLOSE detail", () => {
    const replay = joinMatchReplay({
      fixtures: r32Fixtures,
      predictions: r32Predictions,
      scores: r32Scores,
      players,
      matchId: "73",
    });

    expect(replay).not.toBeNull();
    const jai = replay?.picks.find((p) => p.player.displayName === "Jai Fixture");
    expect(jai).toMatchObject({ tier: "goalDiff", goalsOff: 1, basePoints: 9 });

    const rahul = replay?.picks.find((p) => p.player.displayName === "Rahul");
    expect(rahul).toMatchObject({ tier: "miss", goalsOff: null, basePoints: 0 });
  });
});

describe("joinMatchReplay — upset bonus", () => {
  const r16Fixtures: FixtureRow[] = [
    {
      MatchId: "91",
      Round: "Round of 16",
      Stage: "R16",
      Group: "",
      KickoffUTC: "7/6/2026 12:00:00",
      HomeTeam: "Brazil",
      AwayTeam: "Norway",
      ActualHome: "1",
      ActualAway: "2",
      Status: "FINAL",
      Scored: "Y",
    },
  ];

  const r16Scores: ScoreRow[] = [
    { Email: "jai.fixture@example.com", MatchId: "91", Stage: "R16", Points: "0", Detail: "wrong result" },
    { Email: "rahul@example.com", MatchId: "91", Stage: "R16", Points: "15", Detail: "EXACT 1-2" },
    { Email: "rahul@example.com", MatchId: "91", Stage: "UPSET", Points: "10", Detail: "UPSET exact (1/22=4.5%)" },
  ];

  const r16Predictions: PredictionRow[] = [
    { Timestamp: "7/5/2026", Email: "jai.fixture@example.com", MatchId: "91", PredHome: "2", PredAway: "1" },
    { Timestamp: "7/5/2026", Email: "rahul@example.com", MatchId: "91", PredHome: "1", PredAway: "2" },
  ];

  it("adds upset bonus points to total", () => {
    const replay = joinMatchReplay({
      fixtures: r16Fixtures,
      predictions: r16Predictions,
      scores: r16Scores,
      players,
      matchId: "91",
    });

    expect(replay).not.toBeNull();
    const rahul = replay?.picks.find((p) => p.player.displayName === "Rahul");
    expect(rahul).toMatchObject({
      basePoints: 15,
      upsetPoints: 10,
      totalPoints: 25,
      tier: "exact",
    });

    const jai = replay?.picks.find((p) => p.player.displayName === "Jai Fixture");
    expect(jai).toMatchObject({
      basePoints: 0,
      upsetPoints: 0,
      totalPoints: 0,
      tier: "miss",
    });
  });
});

describe("joinMatchReplay — MOM bonus", () => {
  const qfFixtures: FixtureRow[] = [
    {
      MatchId: "97",
      Round: "Quarter-final",
      Stage: "QF",
      Group: "",
      KickoffUTC: "7/10/2026 6:00:00",
      HomeTeam: "France",
      AwayTeam: "Morocco",
      ActualHome: "2",
      ActualAway: "0",
      Status: "FINAL",
      Scored: "Y",
    },
  ];

  const qfScores: ScoreRow[] = [
    { Email: "jai.fixture@example.com", MatchId: "97", Stage: "QF", Points: "38", Detail: "CLOSE -1 (18) +MOM" },
    { Email: "rahul@example.com", MatchId: "97", Stage: "QF", Points: "18", Detail: "CLOSE -1 (18)" },
  ];

  const qfPredictions: PredictionRow[] = [
    { Timestamp: "7/9/2026", Email: "jai.fixture@example.com", MatchId: "97", PredHome: "2", PredAway: "1", PredMOM: "Kylian Mbappé" },
    { Timestamp: "7/9/2026", Email: "rahul@example.com", MatchId: "97", PredHome: "2", PredAway: "1", PredMOM: "Antoine Griezmann" },
  ];

  it("surfaces the MOM guess and bonus without double-counting the total", () => {
    const replay = joinMatchReplay({
      fixtures: qfFixtures,
      predictions: qfPredictions,
      scores: qfScores,
      players,
      matchId: "97",
    });

    expect(replay).not.toBeNull();
    const jai = replay?.picks.find((p) => p.player.displayName === "Jai Fixture");
    expect(jai).toMatchObject({
      predictedMom: "Kylian Mbappé",
      basePoints: 38,
      momPoints: 20,
      totalPoints: 38,
    });

    const rahul = replay?.picks.find((p) => p.player.displayName === "Rahul");
    expect(rahul).toMatchObject({
      predictedMom: "Antoine Griezmann",
      basePoints: 18,
      momPoints: 0,
      totalPoints: 18,
    });
  });
});

describe("computeMatchCrowdSummary", () => {
  it("computes chips from the replay rows", () => {
    const replay = joinMatchReplay({
      fixtures,
      predictions,
      scores,
      players,
      matchId: "1",
    });

    const summary = computeMatchCrowdSummary(replay?.picks ?? []);
    expect(summary).toEqual({
      predictionsCount: 2,
      exactCount: 1,
      gotPointsCount: 2,
      mostPickedScoreline: "2-0",
    });
  });
});

describe("groupScoredMatchesByRound", () => {
  it("groups only scored matches by round in latest-first order", () => {
    const groups = groupScoredMatchesByRound(fixtures);
    expect(groups).toHaveLength(2);
    expect(groups[0].round).toBe("Matchday 2");
    expect(groups[0].matches[0]).toMatchObject({ matchId: "2" });
    expect(groups[1].matches[0]).toMatchObject({ matchId: "1" });
  });
});

describe("getLatestScoredMatchId", () => {
  it("returns the most recent scored match", () => {
    expect(getLatestScoredMatchId(fixtures)).toBe("2");
  });
});
