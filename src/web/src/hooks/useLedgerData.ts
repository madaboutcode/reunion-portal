import { useMemo } from "react";
import type {
  ChartPoint,
  ClosingStatementData,
  LedgerEntry,
  LedgerRoundGroupData,
  LedgerStatsData,
  PredictionsDataset,
  Standing,
} from "@/lib/prediction-types";
import type { LeaderboardEntry } from "@/components/leaderboard/types";
import {
  buildChartData,
  buildLedgerEntries,
  computeClosingStatement,
  computeLedgerStats,
  computeStanding,
  groupEntriesByRound,
} from "@/lib/ledger-aggregates";

interface UseLedgerDataResult {
  entries: LedgerEntry[];
  stats: LedgerStatsData;
  roundGroups: LedgerRoundGroupData[];
  chartData: ChartPoint[];
  closingStatement: ClosingStatementData;
  standing: Standing | null;
}

export function useLedgerData(
  dataset: PredictionsDataset | null,
  playerEmail: string | null,
  leaderboardEntries: LeaderboardEntry[] | null,
  playerDisplayName: string | null,
): UseLedgerDataResult | null {
  return useMemo(() => {
    if (!dataset || !playerEmail) return null;

    const chronoEntries = buildLedgerEntries(
      dataset.fixtures,
      dataset.predictions,
      dataset.scores,
      dataset.players,
      playerEmail,
    );

    const chartData = buildChartData(chronoEntries);

    const reverseEntries = [...chronoEntries].reverse();

    const standing =
      playerDisplayName && leaderboardEntries
        ? computeStanding(playerDisplayName, leaderboardEntries)
        : null;

    const tournamentBonus = playerDisplayName && leaderboardEntries
      ? (leaderboardEntries.find(
          (e) => e.name.trim().toLowerCase() === playerDisplayName.trim().toLowerCase(),
        )?.mainPts ?? 0)
      : 0;

    const stats = computeLedgerStats(chronoEntries, tournamentBonus);
    const roundGroups = groupEntriesByRound(chronoEntries);

    const leaderboardRank = standing?.rank ?? null;
    const closingStatement = computeClosingStatement(
      chronoEntries,
      leaderboardRank,
      tournamentBonus,
    );

    return {
      entries: reverseEntries,
      stats,
      roundGroups,
      chartData,
      closingStatement,
      standing,
    };
  }, [dataset, playerEmail, leaderboardEntries, playerDisplayName]);
}
