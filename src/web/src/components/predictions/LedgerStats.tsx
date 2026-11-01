import type { LedgerStatsData } from "@/lib/prediction-types";

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-3 py-3 text-center">
      <div className="font-sport text-[20px] font-semibold text-[#0a1628]">{value}</div>
      <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#8A7E6E]">
        {label}
      </div>
    </div>
  );
}

export function LedgerStats({ stats }: { stats: LedgerStatsData }) {
  const cells = [
    { label: "Total", value: String(stats.total) },
    { label: "Matches", value: String(stats.matchesPlayed) },
    { label: "Exact", value: String(stats.exactCount) },
    { label: "Hit Rate", value: `${stats.hitRate}%` },
    { label: "Joker", value: `+${stats.jokerBonus}` },
  ];
  if (stats.upsetBonus > 0) {
    cells.push({ label: "Upset", value: `+${stats.upsetBonus}` });
  }
  if (stats.momBonus > 0) {
    cells.push({ label: "MOM", value: `+${stats.momBonus}` });
  }
  if (stats.tournamentBonus > 0) {
    cells.push({ label: "Tournament", value: `+${stats.tournamentBonus}` });
  }

  const colClass =
    cells.length <= 4
      ? "grid-cols-2 sm:grid-cols-4"
      : cells.length <= 6
        ? "grid-cols-3 sm:grid-cols-6"
        : "grid-cols-4 sm:grid-cols-8";

  return (
    <section
      className={`grid gap-px overflow-hidden rounded-[18px] border border-[rgba(200,180,150,0.22)] bg-[rgba(200,180,150,0.22)] shadow-[0_8px_20px_rgba(94,62,20,0.07)] ${colClass}`}
    >
      {cells.map((cell) => (
        <StatCell key={cell.label} label={cell.label} value={cell.value} />
      ))}
    </section>
  );
}
