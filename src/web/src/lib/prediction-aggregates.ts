import type {
  FixtureRow,
  MatchCrowdSummary,
  MatchPickerGroup,
  MatchReplay,
  PlayerRow,
  PlayerSummary,
  PredictionRow,
  PredictionTier,
  ReplayPick,
  ScoreRow,
} from "./prediction-types";

export function parseSheetDate(raw: string): number {
  const value = raw.trim();
  const match = value.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );

  if (match) {
    const [, month, day, year, hour = "0", minute = "0", second = "0"] = match;
    return Date.UTC(
      Number.parseInt(year, 10),
      Number.parseInt(month, 10) - 1,
      Number.parseInt(day, 10),
      Number.parseInt(hour, 10),
      Number.parseInt(minute, 10),
      Number.parseInt(second, 10),
    );
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseScore(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatKickoffLabel(raw: string): string {
  const time = parseSheetDate(raw);
  if (!time) return raw;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(time));
}

function buildScorelineLabel(home: number | null, away: number | null): string {
  if (home === null || away === null) return "-";
  return `${home}-${away}`;
}

/** Flat bonus for correctly guessing Man of the Match, folded into the base Scores row (e.g. Detail "CLOSE -1 (18) +MOM" = 18 + 20). */
export const MOM_BONUS_POINTS = 20;

export function parseScoreDetail(
  detail: string,
): { tier: PredictionTier; goalsOff: number | null; momPoints: number } {
  const normalized = detail.trim().toUpperCase();
  const momPoints = /\+MOM\b/.test(normalized) ? MOM_BONUS_POINTS : 0;

  if (normalized.startsWith("EXACT")) return { tier: "exact", goalsOff: 0, momPoints };

  const closeMatch = normalized.match(/^CLOSE\s+-(\d+)/);
  if (closeMatch) {
    const off = Number.parseInt(closeMatch[1], 10);
    return { tier: off <= 2 ? "goalDiff" : "outcome", goalsOff: off, momPoints };
  }

  if (normalized === "GOAL-DIFF") return { tier: "goalDiff", goalsOff: null, momPoints };
  if (normalized === "OUTCOME") return { tier: "outcome", goalsOff: null, momPoints };
  return { tier: "miss", goalsOff: null, momPoints: 0 };
}

export function mapDetailToTier(detail: string): PredictionTier {
  return parseScoreDetail(detail).tier;
}

export function dedupeLatestPredictions(
  predictions: PredictionRow[],
): PredictionRow[] {
  const latestByKey = new Map<string, { row: PredictionRow; time: number }>();

  predictions.forEach((row) => {
    const key = `${row.Email}::${row.MatchId}`;
    const time = parseSheetDate(row.Timestamp);
    const existing = latestByKey.get(key);

    if (!existing || time >= existing.time) {
      latestByKey.set(key, { row, time });
    }
  });

  return Array.from(latestByKey.values(), (entry) => entry.row);
}

export function buildPlayerIndex(players: PlayerRow[]): Map<string, PlayerSummary> {
  return new Map(
    players
      .filter((row) => row.Email && row.DisplayName)
      .map((row) => [
        row.Email.trim().toLowerCase(),
        {
          email: row.Email.trim().toLowerCase(),
          displayName: row.DisplayName.trim(),
          batch: row.Batch.trim(),
        },
      ]),
  );
}

function assignDenseRanks(picks: Omit<ReplayPick, "rank">[]): ReplayPick[] {
  let rank = 1;

  return picks.map((pick, index) => {
    const previous = picks[index - 1];
    if (previous && pick.totalPoints < previous.totalPoints) {
      rank += 1;
    }

    return { ...pick, rank };
  });
}

export function joinMatchReplay(params: {
  fixtures: FixtureRow[];
  predictions: PredictionRow[];
  scores: ScoreRow[];
  players: PlayerRow[];
  matchId: string;
}): MatchReplay | null {
  const fixture = params.fixtures.find((row) => row.MatchId === params.matchId);
  if (!fixture || fixture.Scored !== "Y") {
    return null;
  }

  const playerIndex = buildPlayerIndex(params.players);
  const dedupedPredictions = dedupeLatestPredictions(params.predictions);
  const baseScores = new Map<string, ScoreRow>();
  const jokerScores = new Map<string, ScoreRow>();
  const upsetScores = new Map<string, ScoreRow>();

  params.scores.forEach((row) => {
    if (row.MatchId !== params.matchId) return;
    const email = row.Email.trim().toLowerCase();

    if (row.Stage === "JOKER") {
      jokerScores.set(email, row);
      return;
    }

    if (row.Stage === "UPSET") {
      upsetScores.set(email, row);
      return;
    }

    if (row.Stage === fixture.Stage || !baseScores.has(email)) {
      baseScores.set(email, row);
    }
  });

  const picks = dedupedPredictions
    .filter((row) => row.MatchId === params.matchId)
    .map((row) => {
      const player = playerIndex.get(row.Email.trim().toLowerCase());
      if (!player) return null;

      const baseScoreRow = baseScores.get(player.email);
      const jokerScoreRow = jokerScores.get(player.email);
      const upsetScoreRow = upsetScores.get(player.email);
      const basePoints = Number.parseInt(baseScoreRow?.Points ?? "0", 10) || 0;
      const jokerPoints = Number.parseInt(jokerScoreRow?.Points ?? "0", 10) || 0;
      const upsetPoints = Number.parseInt(upsetScoreRow?.Points ?? "0", 10) || 0;

      const { tier, goalsOff, momPoints } = parseScoreDetail(baseScoreRow?.Detail ?? "miss");

      return {
        player,
        predictedHome: parseScore(row.PredHome),
        predictedAway: parseScore(row.PredAway),
        predictedMom: row.PredMOM?.trim() || null,
        basePoints,
        jokerPoints,
        upsetPoints,
        momPoints,
        totalPoints: basePoints + jokerPoints + upsetPoints,
        tier,
        goalsOff,
      };
    })
    .filter((pick): pick is Omit<ReplayPick, "rank"> => pick !== null)
    .sort((a, b) => {
      return (
        b.totalPoints - a.totalPoints ||
        b.basePoints - a.basePoints ||
        a.player.displayName.localeCompare(b.player.displayName)
      );
    });

  return {
    fixture: {
      id: fixture.MatchId,
      round: fixture.Round,
      stage: fixture.Stage,
      group: fixture.Group?.trim() ?? "",
      kickoffUtc: fixture.KickoffUTC,
      kickoffLabel: formatKickoffLabel(fixture.KickoffUTC),
      homeTeam: fixture.HomeTeam,
      awayTeam: fixture.AwayTeam,
      actualHome: parseScore(fixture.ActualHome),
      actualAway: parseScore(fixture.ActualAway),
      status: fixture.Status?.trim() || "FINAL",
      scored: fixture.Scored === "Y",
    },
    picks: assignDenseRanks(picks),
  };
}

export function computeMatchCrowdSummary(
  picks: Array<Pick<ReplayPick, "tier" | "basePoints" | "predictedHome" | "predictedAway">>,
): MatchCrowdSummary {
  const scorelineCounts = new Map<string, number>();

  picks.forEach((pick) => {
    const scoreline = buildScorelineLabel(pick.predictedHome, pick.predictedAway);
    scorelineCounts.set(scoreline, (scorelineCounts.get(scoreline) ?? 0) + 1);
  });

  const mostPickedScoreline = Array.from(scorelineCounts.entries()).sort((a, b) => {
    return b[1] - a[1] || a[0].localeCompare(b[0]);
  })[0]?.[0] ?? "-";

  return {
    predictionsCount: picks.length,
    exactCount: picks.filter((pick) => pick.tier === "exact").length,
    gotPointsCount: picks.filter((pick) => pick.basePoints > 0).length,
    mostPickedScoreline,
  };
}

export function groupScoredMatchesByRound(fixtures: FixtureRow[]): MatchPickerGroup[] {
  const scoredFixtures = fixtures
    .filter((row) => row.Scored === "Y")
    .sort((a, b) => parseSheetDate(b.KickoffUTC) - parseSheetDate(a.KickoffUTC));

  const groups = new Map<string, MatchPickerGroup>();

  scoredFixtures.forEach((fixture) => {
    const round = fixture.Round.trim() || "Scored matches";
    const group = groups.get(round) ?? { round, matches: [] };

    group.matches.push({
      matchId: fixture.MatchId,
      label: `${fixture.HomeTeam} ${buildScorelineLabel(parseScore(fixture.ActualHome), parseScore(fixture.ActualAway))} ${fixture.AwayTeam}`,
      sublabel: [fixture.Group?.trim(), formatKickoffLabel(fixture.KickoffUTC)]
        .filter(Boolean)
        .join(" · "),
      scoreline: buildScorelineLabel(parseScore(fixture.ActualHome), parseScore(fixture.ActualAway)),
      kickoffTime: parseSheetDate(fixture.KickoffUTC),
    });

    groups.set(round, group);
  });

  return Array.from(groups.values());
}

export function getLatestScoredMatchId(fixtures: FixtureRow[]): string | null {
  const latest = fixtures
    .filter((row) => row.Scored === "Y")
    .sort((a, b) => parseSheetDate(b.KickoffUTC) - parseSheetDate(a.KickoffUTC))[0];

  return latest?.MatchId ?? null;
}

export function getScoredMatchOrder(fixtures: FixtureRow[]): string[] {
  // Chronological order (oldest first) so the array index doubles as the
  // match's position in time: index 0 = earliest, last index = latest.
  // This keeps the picker's counter (e.g. 40/40 for the newest match) and
  // arrow directions (→ later, ← earlier) reading naturally.
  return fixtures
    .filter((row) => row.Scored === "Y")
    .sort((a, b) => parseSheetDate(a.KickoffUTC) - parseSheetDate(b.KickoffUTC))
    .map((row) => row.MatchId);
}

export function getTierLabel(tier: PredictionTier, goalsOff?: number | null): string {
  if (goalsOff != null && goalsOff > 0) {
    return goalsOff === 1 ? "1 goal off" : `${goalsOff} goals off`;
  }
  switch (tier) {
    case "exact":
      return "Exact score";
    case "goalDiff":
      return "Right margin";
    case "outcome":
      return "Right result";
    case "miss":
    default:
      return "Missed";
  }
}
