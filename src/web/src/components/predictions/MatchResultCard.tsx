import type { ReplayFixture } from "@/lib/prediction-types";
import { getTeamFlagEmoji } from "@/lib/team-flags";

function TeamBadge({ team }: { team: string }) {
  const flagEmoji = getTeamFlagEmoji(team);

  return (
    <div className="min-w-[92px] text-center sm:min-w-[118px]">
      <div className="mx-auto flex h-11 items-center justify-center sm:h-12">
        {flagEmoji && (
          <span
            role="img"
            aria-label={`${team} flag`}
            className="font-flag text-[30px] leading-none sm:text-[34px]"
          >
            {flagEmoji}
          </span>
        )}
      </div>
      <div className="mt-1.5 max-w-[112px] text-[12px] font-bold text-[#0a1628] sm:mt-2 sm:max-w-[124px] sm:text-[14px]">
        {team}
      </div>
    </div>
  );
}

export function MatchResultCard({ fixture }: { fixture: ReplayFixture }) {
  const meta = [fixture.group, fixture.round, fixture.kickoffLabel, "Full time"]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="mb-4 overflow-hidden rounded-[18px] border border-[rgba(200,180,150,0.22)] bg-white shadow-[0_8px_20px_rgba(94,62,20,0.07)]">
      <div className="border-b border-[rgba(200,180,150,0.22)] px-4 py-5 text-center sm:px-5">
        <p className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#8A7E6E]">
          {meta}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
          <TeamBadge team={fixture.homeTeam} />
          <div className="rounded-[22px] bg-[#0a1628] px-5 py-3 font-sport text-[28px] font-semibold leading-none text-white shadow-[0_10px_24px_rgba(10,22,40,0.18)] sm:px-6 sm:py-4 sm:text-[34px]">
            {fixture.actualHome ?? "-"}-{fixture.actualAway ?? "-"}
            <small className="mt-1 block font-sans text-[9px] font-bold lowercase tracking-[0.14em] text-white/75 sm:text-[10px]">
              actual
            </small>
          </div>
          <TeamBadge team={fixture.awayTeam} />
        </div>
      </div>
    </section>
  );
}
