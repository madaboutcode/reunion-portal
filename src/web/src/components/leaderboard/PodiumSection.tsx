import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type { LeaderboardEntry } from "./types";
import { DepartmentPill } from "./DepartmentPill";

type PodiumTier = "gold" | "silver" | "bronze";

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

interface PodiumConfig {
  tier: PodiumTier;
  rank: number;
  medalSrc: string;
  frameHeight: string;
  frameHeightSm: string;
  windowClass: string;
  baseClass: string;
  badgeClass: string;
}

const PODIUM_CONFIG: Record<PodiumTier, Omit<PodiumConfig, "tier" | "rank" | "medalSrc">> = {
  gold: {
    frameHeight: "h-[372px]",
    frameHeightSm: "max-[560px]:h-[244px]",
    windowClass: "left-[16%] top-[33.5%] h-[45%] w-[68%]",
    baseClass: "bottom-[4.5%]",
    badgeClass:
      "text-[#6a4810] [text-shadow:0_1px_0_rgba(255,255,255,0.5)] border border-white/55 bg-[linear-gradient(118deg,rgba(255,255,255,0.7)_6%,rgba(255,255,255,0)_32%),linear-gradient(180deg,#FCECB6_0%,#F2CE6C_30%,#DAA02F_62%,#B8801C_100%)] shadow-[0_3cqw_7cqw_rgba(90,55,5,0.34),inset_0_1.5px_0_rgba(255,255,255,0.9),inset_0_-2px_2px_rgba(120,80,10,0.42)]",
  },
  silver: {
    frameHeight: "h-[298px]",
    frameHeightSm: "max-[560px]:h-[196px]",
    windowClass: "left-[15%] top-[30%] h-[47.5%] w-[72%]",
    baseClass: "bottom-[3.4%]",
    badgeClass:
      "text-[#38424d] [text-shadow:0_1px_0_rgba(255,255,255,0.65)] border border-white/75 bg-[linear-gradient(118deg,rgba(255,255,255,0.8)_6%,rgba(255,255,255,0)_32%),linear-gradient(180deg,#FCFDFE_0%,#DEE3E8_30%,#B0B8C1_62%,#8B939C_100%)] shadow-[0_3cqw_7cqw_rgba(60,70,80,0.3),inset_0_1.5px_0_rgba(255,255,255,0.95),inset_0_-2px_2px_rgba(110,120,130,0.45)]",
  },
  bronze: {
    frameHeight: "h-[292px]",
    frameHeightSm: "max-[560px]:h-[196px]",
    windowClass: "left-[14.5%] top-[31%] h-[47%] w-[72%]",
    baseClass: "bottom-[3.4%]",
    badgeClass:
      "text-[#5a3214] [text-shadow:0_1px_0_rgba(255,240,225,0.4)] border border-[rgba(255,236,220,0.5)] bg-[linear-gradient(118deg,rgba(255,255,255,0.55)_6%,rgba(255,255,255,0)_32%),linear-gradient(180deg,#F6CFA5_0%,#DD9C5C_30%,#C07A36_62%,#9A5A22_100%)] shadow-[0_3cqw_7cqw_rgba(80,45,15,0.34),inset_0_1.5px_0_rgba(255,245,235,0.7),inset_0_-2px_2px_rgba(120,65,25,0.45)]",
  },
};

const MOBILE_CARD_CLASSES: Record<PodiumTier, { card: string; num: string }> = {
  gold: {
    card: "border-[rgba(216,150,30,0.55)] bg-[linear-gradient(135deg,#FDF1C8,#F7DA84)]",
    num: "text-[#6a4810]",
  },
  silver: {
    card: "border-[rgba(150,160,170,0.5)] bg-[linear-gradient(135deg,#F8FAFC,#E6EBEF)]",
    num: "text-[#3a444f]",
  },
  bronze: {
    card: "border-[rgba(190,120,55,0.45)] bg-[linear-gradient(135deg,#FBF0E5,#F6DEC9)]",
    num: "text-[#5a3214]",
  },
};

const RISE_DELAY: Record<PodiumTier, string> = {
  gold: "0.1s",
  silver: "0.35s",
  bronze: "0.6s",
};

function DesktopPodium({
  entry,
  tier,
  medalSrc,
}: {
  entry: LeaderboardEntry;
  tier: PodiumTier;
  medalSrc: string;
}) {
  const config = PODIUM_CONFIG[tier];
  const isGold = tier === "gold";

  return (
    <div
      className={`championship-podium-card championship-podium-card--${tier} flex flex-col items-center opacity-0`}
      style={{ animation: `podium-rise 1s cubic-bezier(0.16, 1, 0.3, 1) ${RISE_DELAY[tier]} both` }}
    >
      <div
        className={`relative overflow-hidden leading-none ${config.frameHeight} ${config.frameHeightSm}`}
      >
        <img
          src={medalSrc}
          alt=""
          className="block h-full w-auto [filter:drop-shadow(0_22px_36px_rgba(70,42,10,0.28))]"
        />

        <div
          className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
        >
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.35) 48%, rgba(255,255,255,0.12) 52%, transparent 60%)",
              animation: `podium-shine 6s cubic-bezier(0.4, 0, 0.2, 1) ${isGold ? "2s" : tier === "silver" ? "2.4s" : "2.8s"} infinite`,
              willChange: "transform",
            }}
          />
        </div>

        <div
          className={`pwindow ${isGold ? "championship-first-place-focus" : ""} absolute flex items-center justify-center text-center [container-type:inline-size] ${config.windowClass}`}
        >
          <div className="pcard flex w-[84cqw] flex-col items-center gap-[2.8cqw] leading-[1.04] [transform-origin:center_center]">
            <div className="font-sport text-[23cqw] leading-[0.9] font-semibold text-[#0a1628]">
              {entry.rank}
            </div>
            <Link
              to={`/predictions?player=${encodeURIComponent(entry.name)}`}
              className="font-sport text-[16cqw] leading-[1.02] font-bold tracking-[0.02em] text-[#0a1628] uppercase hover:underline"
            >
              {firstName(entry.name)}
            </Link>
            <DepartmentPill
              department={entry.department}
              className="!rounded-[1.6cqw] !px-[3.6cqw] !py-[1cqw] !text-[6.4cqw]"
            />
          </div>
        </div>

        <div
          className={`basebox absolute right-0 left-0 flex justify-center [container-type:inline-size] ${config.baseClass}`}
        >
          <div
            className={`ptbadge rounded-full px-[5.6cqw] py-[1.8cqw] font-sport text-[12.5cqw] leading-none font-bold whitespace-nowrap ${config.badgeClass}`}
          >
            {entry.points.toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

function MobilePodiumCard({
  entry,
  tier,
  medalSrc,
  showLeader,
}: {
  entry: LeaderboardEntry;
  tier: PodiumTier;
  medalSrc: string;
  showLeader?: boolean;
}) {
  const styles = MOBILE_CARD_CLASSES[tier];

  const MOBILE_DELAY: Record<PodiumTier, string> = {
    gold: "0.1s",
    silver: "0.3s",
    bronze: "0.5s",
  };

  return (
    <Link
      to={`/predictions?player=${encodeURIComponent(entry.name)}`}
      className={`championship-mobile-podium championship-mobile-podium--${tier} relative flex items-center gap-3.5 overflow-hidden rounded-[18px] border-[1.5px] px-[18px] py-[13px] opacity-0 shadow-[0_6px_16px_rgba(90,60,30,0.08)] ${styles.card}`}
      style={{ animation: `podium-mobile-slide 0.8s cubic-bezier(0.16, 1, 0.3, 1) ${MOBILE_DELAY[tier]} both` }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-70" />
      {showLeader && (
        <div className="absolute top-[15px] right-[-36px] rotate-45 bg-[linear-gradient(180deg,#F47A2E,#E8521C)] px-[42px] py-1 text-[10px] font-extrabold tracking-[0.14em] text-white shadow-[0_2px_6px_rgba(232,82,28,0.4)]">
          LEADER
        </div>
      )}

      <div className="relative w-[74px] shrink-0 leading-none">
        <img
          src={medalSrc}
          alt=""
          className="block w-full [filter:drop-shadow(0_4px_7px_rgba(120,80,20,0.28))]"
        />
        <span
          className={`absolute top-[57%] left-1/2 -translate-x-1/2 -translate-y-1/2 font-sport text-[26px] leading-none font-bold [text-shadow:0_1px_0_rgba(255,255,255,0.45)] ${styles.num}`}
        >
          {entry.rank}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <span className="font-sport text-[clamp(17px,4.8vw,22px)] leading-[1.05] font-bold tracking-[0.02em] text-[#0a1628] uppercase">
          {firstName(entry.name)}
        </span>
        <DepartmentPill department={entry.department} className="mt-1.5" />
      </div>

      <div className="inline-flex shrink-0 items-baseline gap-1.5">
        <span className="font-sport text-[clamp(23px,6.6vw,30px)] leading-none font-bold text-[#e8722a]">
          {entry.points.toLocaleString()}
        </span>
        <span className="text-[11px] font-bold tracking-[0.06em] text-[#8A7E6E]">
          PTS
        </span>
      </div>

      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="h-4 w-4 shrink-0 text-[#0a1628]/20"
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

export interface PodiumSectionProps {
  topThree: LeaderboardEntry[];
}

export function PodiumSection({ topThree }: PodiumSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function fitPodiumCards() {
      const root = containerRef.current;
      if (!root) return;

      root.querySelectorAll<HTMLElement>(".pwindow").forEach((win) => {
        const card = win.querySelector<HTMLElement>(".pcard");
        if (!card) return;

        card.style.transform = "scale(1)";
        const availW = win.clientWidth * 0.9;
        const availH = win.clientHeight * 0.95;
        const w = card.scrollWidth;
        const h = card.scrollHeight;
        if (!w || !h) return;

        const scale = Math.min(1, availW / w, availH / h);
        card.style.transform = `scale(${Math.round(scale * 1000) / 1000})`;
      });
    }

    fitPodiumCards();
    window.addEventListener("resize", fitPodiumCards);
    document.fonts?.ready.then(fitPodiumCards);

    return () => window.removeEventListener("resize", fitPodiumCards);
  }, [topThree]);

  const gold = topThree[0] ?? null;
  const silver = topThree[1] ?? null;
  const bronze = topThree[2] ?? null;

  const mobileOrder: Array<{
    entry: LeaderboardEntry;
    tier: PodiumTier;
    medal: string;
    leader?: boolean;
  }> = [];

  if (gold) {
    mobileOrder.push({
      entry: gold,
      tier: "gold",
      medal: "/assets/leaderboard/medal-gold.png",
      leader: true,
    });
  }
  if (silver) {
    mobileOrder.push({
      entry: silver,
      tier: "silver",
      medal: "/assets/leaderboard/medal-silver.png",
    });
  }
  if (bronze) {
    mobileOrder.push({
      entry: bronze,
      tier: "bronze",
      medal: "/assets/leaderboard/medal-bronze.png",
    });
  }

  if (topThree.length === 0) return null;

  return (
    <div ref={containerRef} className="mx-auto max-w-[1120px] px-5 md:px-7">
      <div className="leaderboard-podium-stage mt-14 hidden min-[761px]:flex items-end justify-center gap-[clamp(4px,1.5vw,22px)]">
        {silver && (
          <DesktopPodium
            entry={silver}
            tier="silver"
            medalSrc="/assets/leaderboard/podium-silver.png"
          />
        )}
        {gold && (
          <DesktopPodium
            entry={gold}
            tier="gold"
            medalSrc="/assets/leaderboard/podium-gold.png"
          />
        )}
        {bronze && (
          <DesktopPodium
            entry={bronze}
            tier="bronze"
            medalSrc="/assets/leaderboard/podium-bronze.png"
          />
        )}
      </div>

      <div className="mt-7 flex flex-col gap-3.5 min-[761px]:hidden">
        {mobileOrder.map(({ entry, tier, medal, leader }) => (
          <MobilePodiumCard
            key={entry.id}
            entry={entry}
            tier={tier}
            medalSrc={medal}
            showLeader={leader}
          />
        ))}
      </div>
    </div>
  );
}
