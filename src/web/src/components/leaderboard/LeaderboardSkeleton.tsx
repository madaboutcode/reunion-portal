import { SoccerBall } from "./SoccerBall";

function PodiumSkeleton() {
  return (
    <div className="mx-auto max-w-[1120px] px-5 md:px-7" aria-hidden>
      <div className="mt-14 hidden min-[761px]:flex items-end justify-center gap-[clamp(4px,1.5vw,22px)]">
        <div className="h-[298px] w-[140px] max-[560px]:h-[196px] animate-pulse rounded-2xl bg-[#0a1628]/8" />
        <div className="h-[372px] w-[160px] max-[560px]:h-[244px] animate-pulse rounded-2xl bg-[#0a1628]/10" />
        <div className="h-[292px] w-[140px] max-[560px]:h-[196px] animate-pulse rounded-2xl bg-[#0a1628]/8" />
      </div>

      <div className="mt-7 flex flex-col gap-3.5 min-[761px]:hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3.5 rounded-[18px] border border-[rgba(120,95,60,0.14)] bg-[#fffdf8] px-[18px] py-[13px]"
          >
            <div className="h-[74px] w-[74px] shrink-0 rounded-full bg-[#0a1628]/8" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-5 w-32 rounded bg-[#0a1628]/8" />
              <div className="h-4 w-14 rounded-md bg-[#0a1628]/8" />
            </div>
            <div className="h-7 w-16 shrink-0 rounded bg-[#e8722a]/15" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TableRowSkeleton() {
  return (
    <div className="grid grid-cols-[40px_42px_1fr_56px] items-center gap-4 rounded-2xl border border-[rgba(120,95,60,0.14)] bg-[#fffdf8] px-[22px] py-3.5 shadow-[0_6px_16px_rgba(90,60,30,0.05)] min-[921px]:grid-cols-[42px_44px_minmax(150px,1.3fr)_minmax(100px,1.7fr)_56px]">
      <div className="h-10 w-10 rounded-full bg-[#0a1628]/10" />
      <div className="h-[42px] w-[42px] rounded-full bg-[#0a1628]/8" />
      <div className="flex items-center gap-2.5">
        <div className="h-4 w-28 rounded bg-[#0a1628]/8" />
        <div className="h-5 w-12 rounded-md bg-[#0a1628]/8" />
      </div>
      <div className="hidden h-2.5 rounded-full bg-[#F6E4D6] min-[921px]:block">
        <div className="h-full w-[55%] rounded-l-full bg-[#0a1628]/8" />
      </div>
      <div className="space-y-1 text-right">
        <div className="ml-auto h-7 w-10 rounded bg-[#e8722a]/15" />
        <div className="ml-auto h-2.5 w-6 rounded bg-[#0a1628]/8" />
      </div>
    </div>
  );
}

function SectionDivider() {
  return (
    <div className="my-16 flex items-center justify-center gap-4">
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

export function LeaderboardSkeleton() {
  return (
    <div className="animate-pulse">
      <PodiumSkeleton />

      <div className="mx-auto max-w-[1120px] px-5 md:px-7">
        <SectionDivider />

        <div className="mt-6 flex flex-col gap-3" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <TableRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}