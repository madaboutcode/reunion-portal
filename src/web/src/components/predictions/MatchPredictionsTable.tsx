import { Link } from "react-router-dom";
import { DepartmentPill } from "@/components/leaderboard/DepartmentPill";
import { AccuracyMedal } from "./AccuracyMedal";
import type { ReplayPick } from "@/lib/prediction-types";

function scoreLabel(pick: ReplayPick): string {
  return pick.predictedHome === null || pick.predictedAway === null
    ? "-"
    : `${pick.predictedHome}-${pick.predictedAway}`;
}

function MobileCard({ pick }: { pick: ReplayPick }) {
  const isUpset = pick.upsetPoints > 0;
  return (
    <div className={`rounded-2xl border p-4 shadow-[0_6px_18px_rgba(94,62,20,0.05)] ${isUpset ? "border-amber-300/50 bg-gradient-to-r from-amber-100/50 to-amber-50/20 shadow-[0_0_8px_rgba(245,158,11,0.12)]" : "border-[rgba(200,180,150,0.18)] bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-sport text-[15px] font-semibold text-[#e8722a]">#{pick.rank}</div>
          <Link
            to={`/predictions?player=${encodeURIComponent(pick.player.displayName)}`}
            className="mt-1 block font-bold text-[#0a1628] hover:underline"
          >
            {pick.player.displayName}
          </Link>
          <DepartmentPill department={pick.player.batch} className="mt-2" />
        </div>
        <div className={`font-sport text-[24px] font-semibold ${pick.totalPoints > 0 ? "text-[#e8722a]" : "text-[#9CA3AF]"}`}>
          {pick.totalPoints}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#8A7E6E]">
            Prediction
          </div>
          <div className="mt-1 font-sport text-[18px] font-semibold text-[#0a1628]">
            {scoreLabel(pick)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#8A7E6E]">
            Accuracy
          </div>
          <div className="mt-1">
            <AccuracyMedal tier={pick.tier} goalsOff={pick.goalsOff} />
          </div>
        </div>
      </div>
      {pick.jokerPoints > 0 && (
        <div className="mt-3 flex items-center gap-1 text-[11px] font-bold text-[#e8722a]">
          <span aria-hidden="true" className="text-[18px] leading-none">🤡</span> +{pick.jokerPoints}
        </div>
      )}
      {pick.upsetPoints > 0 && (
        <div className="mt-3 flex items-center gap-1 text-[11px] font-bold text-purple-600">
          <span aria-hidden="true" className="text-[14px] leading-none">⚡</span> +{pick.upsetPoints} upset
        </div>
      )}
      {pick.predictedMom && (
        <div
          className={`mt-3 flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
            pick.momPoints > 0
              ? "bg-gradient-to-r from-blue-500/15 via-indigo-500/15 to-blue-500/15 text-blue-700 ring-1 ring-blue-400/40"
              : "text-[#5B6670]"
          }`}
        >
          <span aria-hidden="true" className="text-[14px] leading-none">🏃‍♂️</span>
          {pick.predictedMom} {pick.momPoints > 0 ? "✓" : "✗"}
          {pick.momPoints > 0 ? ` +${pick.momPoints}` : ""}
        </div>
      )}
    </div>
  );
}

export function MatchPredictionsTable({
  picks,
  totalPicks,
}: {
  picks: ReplayPick[];
  totalPicks: number;
}) {
  if (totalPicks === 0) {
    return (
      <div className="rounded-[18px] border border-[rgba(200,180,150,0.22)] bg-white px-5 py-10 text-center shadow-[0_8px_20px_rgba(94,62,20,0.07)]">
        <p className="font-heading text-2xl font-bold text-[#0a1628]">No predictions yet</p>
        <p className="mt-2 text-sm text-[#8A7E6E]">
          This scored match does not have any registered picks to show.
        </p>
      </div>
    );
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-heading text-[20px] font-bold text-[#0a1628]">
          All predictions{" "}
          <span className="font-sans text-sm font-semibold text-[#8A7E6E]">
            ({picks.length})
          </span>
        </h2>
        <span className="text-[12px] font-semibold text-[#8A7E6E]">Sorted by points</span>
      </div>

      <div className="space-y-3 md:hidden">
        {picks.map((pick) => (
          <MobileCard key={pick.player.email} pick={pick} />
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-[18px] border border-[rgba(200,180,150,0.22)] bg-white shadow-[0_8px_20px_rgba(94,62,20,0.07)] md:block">
        <table className="w-full border-collapse text-[13px]">
          <thead className="bg-[linear-gradient(180deg,#fff,#fdf3ef)]">
            <tr>
              <th className="px-3 py-3 text-right text-[10px] font-extrabold uppercase tracking-[0.05em] text-[#8A7E6E]">#</th>
              <th className="px-3 py-3 text-left text-[10px] font-extrabold uppercase tracking-[0.05em] text-[#8A7E6E]">Player</th>
              <th className="px-3 py-3 text-left text-[10px] font-extrabold uppercase tracking-[0.05em] text-[#8A7E6E]">Prediction</th>
              <th className="hidden px-3 py-3 text-left text-[10px] font-extrabold uppercase tracking-[0.05em] text-[#8A7E6E] lg:table-cell">Accuracy</th>
              <th className="hidden px-3 py-3 text-left text-[10px] font-extrabold uppercase tracking-[0.05em] text-[#8A7E6E] lg:table-cell">Bonus</th>
              <th className="px-3 py-3 text-right text-[10px] font-extrabold uppercase tracking-[0.05em] text-[#8A7E6E]">Pts</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((pick) => (
              <tr key={pick.player.email} className={`border-t border-[rgba(200,180,150,0.12)] ${pick.upsetPoints > 0 ? "bg-gradient-to-r from-amber-100/50 to-amber-50/20" : ""}`}>
                <td className="px-3 py-3 text-right font-sport text-[15px] font-semibold text-[#3A3024]">
                  {pick.rank}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/predictions?player=${encodeURIComponent(pick.player.displayName)}`}
                      className="font-bold text-[#0a1628] hover:underline"
                    >
                      {pick.player.displayName}
                    </Link>
                    <DepartmentPill department={pick.player.batch} />
                  </div>
                </td>
                <td className="px-3 py-3 font-sport text-[17px] font-semibold text-[#0a1628]">
                  {scoreLabel(pick)}
                </td>
                <td className="hidden px-3 py-3 lg:table-cell">
                  <AccuracyMedal tier={pick.tier} goalsOff={pick.goalsOff} />
                </td>
                <td className="hidden px-3 py-3 text-[11px] font-bold lg:table-cell">
                  <div className="flex flex-col gap-1">
                    {pick.jokerPoints > 0 && (
                      <span className="flex items-center gap-1 text-[#e8722a]">
                        <span aria-hidden="true" className="text-[18px] leading-none">🤡</span> +{pick.jokerPoints}
                      </span>
                    )}
                    {pick.upsetPoints > 0 && (
                      <span className="flex items-center gap-1 text-purple-600">
                        <span aria-hidden="true" className="text-[14px] leading-none">⚡</span> +{pick.upsetPoints} upset
                      </span>
                    )}
                    {pick.predictedMom && (
                      <span
                        className={`flex w-fit items-center gap-1 rounded-full px-2 py-0.5 ${
                          pick.momPoints > 0
                            ? "bg-gradient-to-r from-blue-500/15 via-indigo-500/15 to-blue-500/15 text-blue-700 ring-1 ring-blue-400/40"
                            : "text-[#5B6670]"
                        }`}
                      >
                        <span aria-hidden="true" className="text-[14px] leading-none">🏃‍♂️</span>
                        {pick.predictedMom} {pick.momPoints > 0 ? "✓" : "✗"}
                        {pick.momPoints > 0 ? ` +${pick.momPoints}` : ""}
                      </span>
                    )}
                    {pick.jokerPoints === 0 &&
                      pick.upsetPoints === 0 &&
                      !pick.predictedMom && <span className="text-[#9CA3AF]">-</span>}
                  </div>
                </td>
                <td className={`px-3 py-3 text-right font-sport text-[18px] font-semibold ${pick.totalPoints > 0 ? "text-[#e8722a]" : "text-[#9CA3AF]"}`}>
                  {pick.totalPoints}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-5 text-[13px] font-semibold">
        <Link to="/leaderboard" className="text-[#e8722a] hover:underline">
          ← Back to Leaderboard
        </Link>
      </p>
    </section>
  );
}
