import { Link } from "react-router-dom";
import type { LeaderboardEntry } from "./types";
import { DepartmentPill } from "./DepartmentPill";
import { getDeptCode, getDeptTrackClass } from "./department";
import { SoccerBall } from "./SoccerBall";

function ProgressTrack({
  entry,
  maxPoints,
}: {
  entry: LeaderboardEntry;
  maxPoints: number;
}) {
  const pct =
    maxPoints > 0 && entry.points > 0
      ? Math.max(8, Math.round((entry.points / maxPoints) * 100))
      : 0;
  const deptCode = getDeptCode(entry.department);

  return (
    <div
      className="championship-progress-track relative hidden h-2.5 min-[921px]:block rounded-full bg-[#F6E4D6]"
      style={{ "--track-pct": `${pct}%` } as React.CSSProperties}
    >
      <div
        className={`absolute top-0 left-0 h-full w-[var(--track-pct)] rounded-l-full bg-gradient-to-r ${getDeptTrackClass(deptCode)}`}
      />
      <SoccerBall className="pointer-events-none absolute top-1/2 left-[var(--track-pct)] aspect-square h-[22px] w-[22px] shrink-0 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_2px_3px_rgba(0,0,0,0.25)]" />
    </div>
  );
}

function LeaderboardRow({
  entry,
  maxPoints,
}: {
  entry: LeaderboardEntry;
  maxPoints: number;
}) {
  return (
    <Link
      to={`/predictions?player=${encodeURIComponent(entry.name)}`}
      className="championship-table-row grid grid-cols-[40px_42px_1fr_56px_20px] items-center gap-4 rounded-2xl px-[22px] py-3.5 transition-[transform,box-shadow] duration-150 hover:translate-x-[3px] min-[921px]:grid-cols-[42px_44px_minmax(150px,1.3fr)_minmax(100px,1.7fr)_56px_20px] cursor-pointer"
    >
      <div className="championship-rank-badge flex h-10 w-10 items-center justify-center rounded-full font-sport text-[19px] font-semibold text-white">
        {entry.rank}
      </div>

      <div className="championship-avatar-shell flex h-[42px] w-[42px] items-end justify-center overflow-hidden rounded-full bg-[linear-gradient(160deg,#e7e2d8,#cfc8ba)]">
        <svg
          className="h-[76%] w-[76%] opacity-50"
          viewBox="0 0 24 24"
          fill="#7e7466"
          aria-hidden
        >
          <circle cx="12" cy="8.5" r="4" />
          <path d="M3.5 22c0-4.7 3.8-7.5 8.5-7.5s8.5 2.8 8.5 7.5z" />
        </svg>
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        <span className="truncate text-[16.5px] font-bold whitespace-nowrap text-[#0a1628]">
          {entry.name}
        </span>
        <DepartmentPill department={entry.department} />
      </div>

      <ProgressTrack entry={entry} maxPoints={maxPoints} />

      <div className="text-right">
        <div className="font-sport text-[27px] leading-none font-semibold text-[#e8722a]">
          {entry.points.toLocaleString()}
        </div>
        <div className="text-[10.5px] font-bold tracking-[0.08em] text-[#8A7E6E]">
          PTS
        </div>
      </div>

      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="h-4 w-4 shrink-0 text-[#8A7E6E]/40 transition-colors group-hover:text-[#e8722a]"
      >
        <path
          d="M7.5 5L12.5 10L7.5 15"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </Link>
  );
}

function SectionDivider() {
  return (
    <div className="championship-section-divider my-16 flex items-center justify-center gap-4">
      <span className="relative h-0 w-[90px] max-[560px]:w-[30px] shrink border-t-2 border-dashed border-[rgba(232,114,42,0.5)] after:absolute after:top-[-11px] after:left-[-4px] after:text-[13px] after:text-[#e8722a] after:content-['◂']" />
      <SoccerBall className="h-[18px] w-[18px]" />
      <h2 className="font-accent text-[32px] max-[560px]:text-[22px] font-bold text-[#0a1628] whitespace-nowrap">
        Climb the Leaderboard
      </h2>
      <SoccerBall className="h-[18px] w-[18px]" />
      <span className="relative h-0 w-[90px] max-[560px]:w-[30px] shrink border-t-2 border-dashed border-[rgba(232,114,42,0.5)] after:absolute after:top-[-11px] after:right-[-4px] after:text-[13px] after:text-[#e8722a] after:content-['▸']" />
    </div>
  );
}

export interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  maxPoints: number;
}

export function LeaderboardTable({
  entries,
  maxPoints,
}: LeaderboardTableProps) {
  if (entries.length === 0) return null;

  return (
    <div className="mx-auto max-w-[1120px] px-5 md:px-7">
      <SectionDivider />

      <div className="mt-6 flex flex-col gap-3">
        {entries.map((entry) => (
          <LeaderboardRow key={entry.id} entry={entry} maxPoints={maxPoints} />
        ))}
      </div>
    </div>
  );
}
