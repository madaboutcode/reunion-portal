import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { LeaderboardHero } from "@/components/leaderboard/LeaderboardHero";
import { LeaderboardSkeleton } from "@/components/leaderboard/LeaderboardSkeleton";
import { PodiumSection } from "@/components/leaderboard/PodiumSection";
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable";
import { ScoringRules } from "@/components/leaderboard/ScoringRules";
import {
  parseLeaderboardData,
  type LeaderboardEntry,
  type LeaderboardResponse,
} from "@/components/leaderboard/types";

type PageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; entries: LeaderboardEntry[] };

export default function LeaderboardPage() {
  useDocumentTitle("Leaderboard");
  const [state, setState] = useState<PageState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function loadLeaderboard() {
      try {
        const response = await fetch("/api/datasources/predictions/Leaderboard");
        if (!response.ok) {
          throw new Error(`Failed to load leaderboard (${response.status})`);
        }

        const payload = (await response.json()) as LeaderboardResponse;
        if (cancelled) return;

        setState({
          status: "ready",
          entries: parseLeaderboardData(payload.data),
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to load leaderboard",
        });
      }
    }

    void loadLeaderboard();

    return () => {
      cancelled = true;
    };
  }, []);

  const isLoading = state.status === "loading";
  const entries = state.status === "ready" ? state.entries : [];
  const topThree = entries.slice(0, 3);
  const rest = entries.slice(3);
  const maxPoints = entries[0]?.points ?? 1;

  return (
    <div className="leaderboard-page-shell flex min-h-screen flex-col text-[#3A3024]">
      <SiteNav />

      <main
        className="flex-1"
        aria-busy={isLoading}
        aria-live="polite"
      >
        <LeaderboardHero
          loading={isLoading}
          participantCount={state.status === "ready" ? entries.length : undefined}
        />

        <div className="mx-auto max-w-[1120px] px-5 pt-5 text-center md:px-7 md:text-right">
          <Link to="/awards" className="text-sm font-semibold text-[#e8722a] hover:underline">
            Prediction Awards →
          </Link>
        </div>

        {isLoading && <LeaderboardSkeleton />}

        {state.status === "error" && (
          <div className="mx-auto max-w-md px-5 py-10">
            <div className="rounded-2xl border border-[rgba(232,114,42,0.32)] bg-[#fffdf8] px-6 py-8 text-center shadow-[0_8px_22px_rgba(232,114,42,0.1)]">
              <p className="font-heading text-xl font-bold text-[#0a1628]">
                Could not load leaderboard
              </p>
              <p className="mt-2 text-sm text-[#8A7E6E]">{state.message}</p>
            </div>
          </div>
        )}

        {state.status === "ready" && (
          <>
            <PodiumSection topThree={topThree} />
            <LeaderboardTable entries={rest} maxPoints={maxPoints} />
          </>
        )}

        <ScoringRules />
      </main>

      <SiteFooter />
    </div>
  );
}
