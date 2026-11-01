import type { ReactNode } from "react";
import { SoccerBall } from "@/components/leaderboard/SoccerBall";

interface ReplayHeroProps {
  loading?: boolean;
  matchesScored?: number;
  picksThisMatch?: number;
}

function StatCard({
  label,
  value,
  loading = false,
  icon,
}: {
  label: string;
  value?: string | number;
  loading?: boolean;
  icon: ReactNode;
}) {
  return (
    <div className="leaderboard-stat-card flex items-center gap-3 rounded-2xl px-5 py-3.5">
      <div className="h-[34px] w-[34px] shrink-0 text-[#e8722a]">{icon}</div>
      <div>
        {loading ? (
          <div className="h-7 w-14 animate-pulse rounded bg-[#0a1628]/10" />
        ) : (
          <div className="font-sport text-[28px] leading-none font-semibold text-[#0a1628]">
            {value ?? 0}
          </div>
        )}
        <div className="text-[13px] font-medium text-[#8A7E6E]">{label}</div>
      </div>
    </div>
  );
}

export function ReplayHero({
  loading = false,
  matchesScored,
  picksThisMatch,
}: ReplayHeroProps) {
  return (
    <section className="leaderboard-hero-shell relative overflow-hidden">
      <div className="leaderboard-hero-atmosphere pointer-events-none absolute inset-0" />
      <div className="absolute inset-0 bg-[url('/assets/leaderboard/prediction-contest-hero.png')] bg-cover bg-center bg-no-repeat opacity-50 [mask-image:linear-gradient(to_bottom,transparent,#000_40%)] md:left-auto md:right-0 md:w-[60%] md:bg-[center_right] md:opacity-100 md:[mask-image:linear-gradient(to_right,transparent_0%,#000_26%,#000_100%)]" />
      <div className="leaderboard-hero-lights pointer-events-none absolute inset-y-0 right-0 hidden w-[62%] md:block" />
      <div className="leaderboard-sparkle-field pointer-events-none absolute inset-0 opacity-80" />

      <div className="mx-auto max-w-[1120px] px-5 md:px-7">
        <div className="relative flex min-h-[460px] items-center md:min-h-[500px]">
          <div className="relative z-[2] w-full py-10 md:w-[54%]">
            <span className="leaderboard-kicker mb-3.5 inline-flex items-center gap-2 text-sm font-extrabold tracking-[0.14em] uppercase">
              <SoccerBall className="h-[19px] w-[19px]" />
              World Cup 2026
            </span>

            <h1 className="font-heading text-[clamp(46px,6vw,76px)] leading-[0.96] font-extrabold tracking-[-0.015em]">
              <span className="block text-[#0a1628]">PREDICTION</span>
              <span className="block text-[#e8722a]">REPLAY</span>
            </h1>

            <p className="mt-3 font-accent text-[30px] font-semibold text-[#e8722a]">
              Who called it?
            </p>

            <p className="mt-4 mb-7 max-w-[380px] text-[17px] leading-[1.55] text-[#5d5446]">
              Every pick for one scored match, sorted by points. See the final
              score and who got closest.
            </p>

            <div className="flex flex-wrap gap-3.5">
              <StatCard
                label="Matches scored"
                value={matchesScored}
                loading={loading}
                icon={(
                  <svg
                    className="h-[34px] w-[34px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <rect x="3" y="5" width="18" height="16" rx="2.5" />
                    <path d="M3 9.5h18M8 3v4M16 3v4" />
                  </svg>
                )}
              />
              <StatCard
                label="Picks this match"
                value={picksThisMatch}
                loading={loading}
                icon={(
                  <svg
                    className="h-[34px] w-[34px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <circle cx="9" cy="8" r="3.2" />
                    <path d="M2.5 19v-.5c0-2.5 2.9-4 6.5-4s6.5 1.5 6.5 4v.5" />
                    <circle cx="17" cy="8" r="2.4" />
                    <path d="M16 14.6c2.6.3 5 1.4 5 3.4v1" />
                  </svg>
                )}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
