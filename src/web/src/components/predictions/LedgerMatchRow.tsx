import { Link } from "react-router-dom";
import { getTierLabel } from "@/lib/prediction-aggregates";
import type { LedgerEntry, PredictionTier } from "@/lib/prediction-types";

const TIER_ROW_CLASS: Record<PredictionTier, string> = {
  exact: "border-l-[3px] border-terracotta bg-terracotta/5",
  goalDiff: "border-l-[3px] border-soft-aqua bg-soft-aqua/10",
  outcome: "border-l-[3px] border-soft-aqua/50",
  miss: "border-l-[3px] border-transparent opacity-70",
};

const TIER_BADGE_CLASS: Record<PredictionTier, string> = {
  exact: "bg-terracotta text-white",
  goalDiff: "bg-soft-aqua text-charcoal",
  outcome: "bg-soft-aqua/40 text-charcoal/80",
  miss: "",
};

function TierBadge({ tier, goalsOff }: { tier: PredictionTier; goalsOff: number | null }) {
  const label = getTierLabel(tier, goalsOff);

  if (tier === "miss") {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#5B6670]">
        <span aria-hidden="true" className="text-[16px] leading-none">👎</span>
        <span className="text-[10px]">{label}</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] ${TIER_BADGE_CLASS[tier]}`}
    >
      {label}
    </span>
  );
}

function JokerBadge({ points, isMiss }: { points: number; isMiss: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full bg-[#e8722a]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] text-[#e8722a] ${isMiss ? "opacity-40 line-through" : ""}`}
    >
      <span aria-hidden="true" className="text-[11px] leading-none">🤡</span>
      Joker{points > 0 ? ` +${points}` : ""}
    </span>
  );
}

function MOMBadge({ guess, points }: { guess: string; points: number }) {
  const correct = points > 0;
  const style = correct
    ? "bg-gradient-to-r from-blue-500/15 via-indigo-500/15 to-blue-500/15 text-blue-700 ring-1 ring-blue-400/40"
    : "bg-[#8A7E6E]/10 text-[#5B6670]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] ${style}`}
    >
      <span aria-hidden="true" className="text-[11px] leading-none">🏃‍♂️</span>
      {guess} {correct ? "✓" : "✗"}
      {correct ? ` +${points}` : ""}
    </span>
  );
}

function UpsetBadge({ points }: { points: number }) {
  return (
    <span className="group relative inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400/20 via-orange-400/20 to-amber-400/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] text-amber-700 ring-1 ring-amber-400/40">
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="h-3 w-3 animate-[upset-spin_3s_ease-in-out_infinite] fill-amber-500 drop-shadow-[0_0_3px_rgba(245,158,11,0.6)]"
      >
        <path d="M10 1.5l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.26l-4.94 2.45.94-5.5-4-3.9 5.53-.8z" />
      </svg>
      Upset +{points}
    </span>
  );
}

export function LedgerMatchRow({ entry }: { entry: LedgerEntry }) {
  const { fixture, prediction } = entry;
  const jokerMiss = prediction.isJoker && entry.totalPoints === 0;
  const isUpset = entry.upsetPoints > 0;
  const upsetClass = isUpset
    ? "bg-gradient-to-r from-amber-100/50 to-amber-50/20 shadow-[0_0_8px_rgba(245,158,11,0.12)]"
    : "";

  return (
    <div
      className={`grid grid-cols-[1fr_56px_64px] items-center gap-2 py-2.5 pl-3 pr-3 sm:grid-cols-[36px_1fr_72px_72px_56px_64px] sm:gap-3 ${TIER_ROW_CLASS[entry.tier]} ${upsetClass}`}
    >
      <div className="hidden font-sport text-[11px] font-semibold text-[#8A7E6E] sm:block">
        M{entry.matchId}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            to={`/predictions?match=${entry.matchId}`}
            className={`truncate text-[13px] font-semibold text-[#0a1628] hover:underline ${entry.tier === "miss" ? "opacity-50" : ""}`}
          >
            {fixture.homeTeam} v {fixture.awayTeam}
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <TierBadge tier={entry.tier} goalsOff={entry.goalsOff} />
          {prediction.isJoker && <JokerBadge points={entry.jokerPoints} isMiss={jokerMiss} />}
          {entry.upsetPoints > 0 && <UpsetBadge points={entry.upsetPoints} />}
          {prediction.predMom && (
            <MOMBadge guess={prediction.predMom} points={entry.momPoints} />
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-4 text-[11px] font-sport font-semibold text-[#0a1628] sm:hidden">
          <span>
            <span className="mr-1 text-[9px] font-sans font-bold uppercase tracking-[0.06em] text-[#8A7E6E]">
              Pred
            </span>
            {prediction.predHome}-{prediction.predAway}
          </span>
          <span>
            <span className="mr-1 text-[9px] font-sans font-bold uppercase tracking-[0.06em] text-[#8A7E6E]">
              Actual
            </span>
            {fixture.actualHome}-{fixture.actualAway}
          </span>
        </div>
      </div>

      <div className="hidden text-center font-sport text-[13px] font-semibold text-[#0a1628] sm:block">
        {prediction.predHome}-{prediction.predAway}
      </div>

      <div className="hidden text-center font-sport text-[13px] font-semibold text-[#0a1628] sm:block">
        {fixture.actualHome}-{fixture.actualAway}
      </div>

      <div
        className={`text-right font-sport text-[14px] font-semibold ${entry.totalPoints > 0 ? "text-[#e8722a]" : "text-[#9CA3AF]"}`}
      >
        {entry.totalPoints > 0 ? `+${entry.totalPoints}` : "—"}
      </div>

      <div className="text-right font-sport text-[14px] font-semibold text-[#0a1628]">
        {entry.runningBalance}
      </div>
    </div>
  );
}
