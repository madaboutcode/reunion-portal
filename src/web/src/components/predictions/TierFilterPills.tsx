import { getTierLabel } from "@/lib/prediction-aggregates";
import type { PredictionTier, ReplayFilter } from "@/lib/prediction-types";

const ORDER: ReplayFilter[] = ["all", "exact", "goalDiff", "outcome", "miss"];

export function TierFilterPills({
  activeFilter,
  counts,
  onChange,
}: {
  activeFilter: ReplayFilter;
  counts: Record<PredictionTier, number>;
  onChange: (filter: ReplayFilter) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {ORDER.map((filter) => {
        const selected = activeFilter === filter;
        const label = filter === "all" ? "All" : getTierLabel(filter);
        const count = filter === "all"
          ? counts.exact + counts.goalDiff + counts.outcome + counts.miss
          : counts[filter];

        return (
          <button
            key={filter}
            type="button"
            onClick={() => onChange(filter)}
            className={`min-h-11 rounded-full border px-4 py-2 text-[11px] font-bold transition ${
              selected
                ? "border-[#1F2A33] bg-[#1F2A33] text-white"
                : "border-[rgba(200,180,150,0.28)] bg-white text-[#8A7E6E] hover:border-[#e8722a] hover:text-[#0a1628]"
            }`}
          >
            {filter === "all" ? label : `${label} (${count})`}
          </button>
        );
      })}
    </div>
  );
}
