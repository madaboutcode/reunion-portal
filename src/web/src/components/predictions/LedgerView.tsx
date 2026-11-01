import { Link } from "react-router-dom";
import type {
  ChartPoint,
  ClosingStatementData,
  LedgerEntry,
  LedgerRoundGroupData,
  LedgerStatsData,
  PlayerPickerItem,
  Standing,
} from "@/lib/prediction-types";
import type { PlayerSummary } from "@/lib/prediction-types";
import { PlayerPicker } from "./PlayerPicker";
import { LedgerStats } from "./LedgerStats";
import { PointsChart } from "./PointsChart";
import { LedgerRoundGroup } from "./LedgerRoundGroup";
import { ClosingStatement } from "./ClosingStatement";

export interface LedgerViewProps {
  player: PlayerSummary;
  entries: LedgerEntry[];
  stats: LedgerStatsData;
  standing: Standing | null;
  roundGroups: LedgerRoundGroupData[];
  chartData: ChartPoint[];
  closingStatement: ClosingStatementData;
  allPlayers: PlayerPickerItem[];
  onSelectPlayer: (displayName: string) => void;
}

export function LedgerView({
  player,
  entries,
  stats,
  standing,
  roundGroups,
  chartData,
  closingStatement,
  allPlayers,
  onSelectPlayer,
}: LedgerViewProps) {
  const currentPlayer = allPlayers.find(
    (p) => p.displayName.toLowerCase() === player.displayName.toLowerCase(),
  ) ?? {
    displayName: player.displayName,
    batch: player.batch,
    totalPoints: stats.total,
    rank: standing?.rank ?? 0,
    avatarUrl: null,
  };

  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-12 md:px-7 md:pb-14">
      <PlayerPicker
        currentPlayer={currentPlayer}
        players={allPlayers}
        onSelect={onSelectPlayer}
        standing={standing}
      />

      {entries.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-[rgba(200,180,150,0.22)] bg-white px-6 py-10 text-center shadow-[0_8px_20px_rgba(94,62,20,0.07)]">
          <p className="font-heading text-xl font-bold text-[#0a1628]">
            No predictions yet
          </p>
          <p className="mt-2 text-sm text-[#8A7E6E]">
            This player hasn&apos;t submitted any predictions.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <LedgerStats stats={stats} />
          </div>

          <div className="mt-6">
            <PointsChart data={chartData} />
          </div>

          <div className="mt-8 space-y-4">
            {roundGroups.map((group, index) => (
              <LedgerRoundGroup
                key={group.round}
                round={group.round}
                subtotal={group.subtotal}
                exactCount={group.exactCount}
                entries={group.entries}
                defaultExpanded={index === 0}
              />
            ))}
          </div>

          <div className="mt-8">
            <ClosingStatement data={closingStatement} />
          </div>
        </>
      )}

      <p className="mt-8 text-[13px] font-semibold">
        <Link to="/leaderboard" className="text-[#e8722a] hover:underline">
          &larr; Back to Leaderboard
        </Link>
      </p>
    </div>
  );
}
