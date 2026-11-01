import type { MatchCrowdSummary } from "@/lib/prediction-types";

function SummaryCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white px-3 py-3 text-center">
      <div className="font-sport text-[20px] font-semibold text-[#0a1628]">{value}</div>
      <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#8A7E6E]">
        {label}
      </div>
    </div>
  );
}

export function MatchSummaryChips({ summary }: { summary: MatchCrowdSummary }) {
  return (
    <section className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-[18px] border border-[rgba(200,180,150,0.22)] bg-[rgba(200,180,150,0.22)] shadow-[0_8px_20px_rgba(94,62,20,0.07)] sm:grid-cols-4">
      <SummaryCell label="Predictions" value={summary.predictionsCount} />
      <SummaryCell label="Exact" value={summary.exactCount} />
      <SummaryCell label="Got points" value={summary.gotPointsCount} />
      <SummaryCell label="Most picked" value={summary.mostPickedScoreline} />
    </section>
  );
}
