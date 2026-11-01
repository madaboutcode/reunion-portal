import { getTierLabel } from "@/lib/prediction-aggregates";
import type { PredictionTier } from "@/lib/prediction-types";

export interface AccuracyMedalProps {
  tier: PredictionTier;
  goalsOff?: number | null;
  showLabel?: boolean;
}

const MEDAL: Partial<Record<PredictionTier, string>> = {
  exact: "/assets/leaderboard/medal-gold.png",
  goalDiff: "/assets/leaderboard/medal-silver.png",
  outcome: "/assets/leaderboard/medal-bronze.png",
};

export function AccuracyMedal({ tier, goalsOff, showLabel = true }: AccuracyMedalProps) {
  const src = MEDAL[tier];
  const label = getTierLabel(tier, goalsOff);
  return (
    <span className="inline-flex items-center gap-2">
      {src ? (
        <img src={src} alt={label} className="h-7 w-auto object-contain" />
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex h-7 w-7 items-center justify-center text-lg"
        >
          👎
        </span>
      )}
      {showLabel && <span className="text-[12px] font-semibold text-[#5B6670]">{label}</span>}
    </span>
  );
}
