import type { ClosingStatementData } from "@/lib/prediction-types";

export interface ClosingStatementProps {
  data: ClosingStatementData;
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-white/60">{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

export function ClosingStatement({ data }: ClosingStatementProps) {
  return (
    <div className="rounded-2xl bg-[#1F2A33] px-5 py-2">
      <div>
        <Row label="Matches predicted" value={data.matchesPredicted} />
        <Row
          label="Results correct"
          value={`${data.resultsCorrect} (${data.hitRate}%)`}
        />
      </div>

      <div className="border-t border-white/10">
        <Row label="Exact scores" value={data.exactCount} />
        <Row label="Correct goal diff" value={data.goalDiffCount} />
        <Row label="Correct winner" value={data.outcomeCount} />
        <Row label="Wrong result" value={data.missCount} />
      </div>

      <div className="border-t border-white/10">
        <Row label="Match points" value={data.basePoints} />
        <Row label="Joker bonus" value={`+${data.jokerBonus}`} />
        {data.upsetBonus !== 0 && (
          <Row label="Upset bonus" value={`+${data.upsetBonus}`} />
        )}
        {data.momBonus !== 0 && (
          <Row label="Man of the Match bonus" value={`+${data.momBonus}`} />
        )}
        {data.tournamentBonus !== 0 && (
          <Row label="Tournament predictions" value={`+${data.tournamentBonus}`} />
        )}
      </div>

      <div className="border-t border-white/10">
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-white/60">Closing balance</span>
          <span className="text-4xl font-bold text-[#D76B51]">
            {data.closingBalance}
          </span>
        </div>
        {data.bestMatch && (
          <Row
            label="Best match"
            value={`${data.bestMatch.label} (+${data.bestMatch.points})`}
          />
        )}
        {data.longestMissStreak !== 0 && (
          <Row label="Longest miss streak" value={data.longestMissStreak} />
        )}
      </div>

      {data.leaderboardRank !== null && (
        <div className="border-t border-white/10">
          <Row label="Leaderboard" value={`#${data.leaderboardRank}`} />
        </div>
      )}
    </div>
  );
}
