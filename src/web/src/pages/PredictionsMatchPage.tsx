import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
import { MatchPicker } from "@/components/predictions/MatchPicker";
import { MatchPredictionsTable } from "@/components/predictions/MatchPredictionsTable";
import { MatchResultCard } from "@/components/predictions/MatchResultCard";
import { MatchSummaryChips } from "@/components/predictions/MatchSummaryChips";
import { ReplayHero } from "@/components/predictions/ReplayHero";
import { LedgerHero } from "@/components/predictions/LedgerHero";
import { LedgerView } from "@/components/predictions/LedgerView";
import { TierFilterPills } from "@/components/predictions/TierFilterPills";
import { usePredictionsMatchData } from "@/hooks/usePredictionsMatchData";
import { useWhosComingAvatars } from "@/hooks/useWhosComingAvatars";
import { useLedgerData } from "@/hooks/useLedgerData";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  buildPlayerIndex,
  computeMatchCrowdSummary,
  getLatestScoredMatchId,
  getScoredMatchOrder,
  groupScoredMatchesByRound,
  joinMatchReplay,
} from "@/lib/prediction-aggregates";
import {
  buildPlayerPickerList,
  computeEmailHash,
} from "@/lib/ledger-aggregates";
import {
  parseLeaderboardData,
  type LeaderboardEntry,
  type LeaderboardResponse,
} from "@/components/leaderboard/types";
import type { PredictionTier, ReplayFilter } from "@/lib/prediction-types";

const EMPTY_COUNTS: Record<PredictionTier, number> = {
  exact: 0,
  goalDiff: 0,
  outcome: 0,
  miss: 0,
};

function PredictionsSkeleton() {
  const card = "border border-[rgba(200,180,150,0.22)] bg-white shadow-[0_8px_20px_rgba(94,62,20,0.07)]";
  const fill = "animate-pulse rounded bg-[#ece6da]";

  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-12 md:px-7 md:pb-14" aria-hidden="true">
      <div className="mb-5">
        <div className={`mb-2 h-3 w-24 ${fill}`} />
        <div className="flex items-center gap-2 sm:gap-3">
          <div className={`h-11 w-11 shrink-0 animate-pulse rounded-xl ${card}`} />
          <div className={`h-14 flex-1 animate-pulse rounded-2xl ${card}`} />
          <div className={`h-11 w-11 shrink-0 animate-pulse rounded-xl ${card}`} />
        </div>
      </div>
      <div className={`mb-4 rounded-[18px] px-4 py-5 ${card}`}>
        <div className={`mx-auto mb-4 h-3 w-52 ${fill}`} />
        <div className="flex items-center justify-center gap-5 sm:gap-7">
          <div className="flex flex-col items-center gap-2">
            <div className="h-11 w-11 animate-pulse rounded-full bg-[#ece6da]" />
            <div className={`h-3 w-16 ${fill}`} />
          </div>
          <div className="h-16 w-24 animate-pulse rounded-[22px] bg-[#e2dccd]" />
          <div className="flex flex-col items-center gap-2">
            <div className="h-11 w-11 animate-pulse rounded-full bg-[#ece6da]" />
            <div className={`h-3 w-16 ${fill}`} />
          </div>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`h-9 w-28 animate-pulse rounded-full ${card}`} />
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`h-11 w-24 animate-pulse rounded-full ${card}`} />
        ))}
      </div>
      <div className={`overflow-hidden rounded-[18px] ${card}`}>
        <div className="border-b border-[rgba(200,180,150,0.18)] bg-[#fdf3ef] px-4 py-3">
          <div className={`h-3 w-40 ${fill}`} />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-t border-[rgba(200,180,150,0.12)] px-4 py-4"
          >
            <div className={`h-5 w-5 ${fill}`} />
            <div className="flex-1">
              <div className={`mb-2 h-3 w-32 ${fill}`} />
              <div className={`h-3 w-20 ${fill}`} />
            </div>
            <div className={`h-7 w-16 ${fill}`} />
            <div className={`h-6 w-10 ${fill}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LedgerSkeleton() {
  const card = "border border-[rgba(200,180,150,0.22)] bg-white shadow-[0_8px_20px_rgba(94,62,20,0.07)]";
  const fill = "animate-pulse rounded bg-[#ece6da]";

  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-12 md:px-7 md:pb-14" aria-hidden="true">
      <div className={`mb-6 rounded-2xl px-4 py-4 ${card}`}>
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 animate-pulse rounded-full bg-[#ece6da]" />
          <div className="flex-1">
            <div className={`mb-2 h-4 w-32 ${fill}`} />
            <div className={`h-3 w-48 ${fill}`} />
          </div>
        </div>
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`h-14 w-20 animate-pulse rounded-xl ${card}`} />
        ))}
      </div>
      <div className={`mb-6 h-[160px] animate-pulse rounded-2xl ${card}`} />
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className={`mb-4 rounded-2xl ${card}`}>
          <div className="px-4 py-3">
            <div className={`h-4 w-40 ${fill}`} />
          </div>
          {Array.from({ length: 3 }).map((_, j) => (
            <div key={j} className="border-t border-[rgba(200,180,150,0.12)] px-4 py-3">
              <div className={`h-3 w-full ${fill}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function useLeaderboardData() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/datasources/predictions/Leaderboard");
        if (!response.ok) return;
        const payload = (await response.json()) as LeaderboardResponse;
        if (!cancelled) {
          setEntries(parseLeaderboardData(payload.data));
        }
      } catch {
        // Non-fatal — leaderboard unavailable
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  return entries;
}

function usePlayerEmailHashes(
  players: { Email: string; DisplayName: string }[] | undefined,
) {
  const [hashes, setHashes] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!players?.length) return;
    let cancelled = false;

    async function compute() {
      const map = new Map<string, string>();
      await Promise.all(
        players!.map(async (p) => {
          const hash = await computeEmailHash(p.Email);
          if (hash) map.set(p.DisplayName.trim(), hash);
        }),
      );
      if (!cancelled) setHashes(map);
    }

    void compute();
    return () => { cancelled = true; };
  }, [players]);

  return hashes;
}

export default function PredictionsMatchPage() {
  const { state, retry } = usePredictionsMatchData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<ReplayFilter>("all");

  const playerParam = searchParams.get("player");
  const matchId = searchParams.get("match");

  const isLedgerMode = playerParam !== null;

  useDocumentTitle(
    isLedgerMode && playerParam
      ? `${playerParam}'s Ledger`
      : "Predictions Replay",
  );

  const leaderboardEntries = useLeaderboardData();
  const { getAvatarUrl } = useWhosComingAvatars();

  const playerIndex = useMemo(() => {
    if (state.status !== "ready") return null;
    return buildPlayerIndex(state.players);
  }, [state]);

  const resolvedPlayer = useMemo(() => {
    if (!playerParam || !playerIndex) return null;
    const normalizedParam = playerParam.trim().toLowerCase();
    for (const [, summary] of playerIndex) {
      if (summary.displayName.trim().toLowerCase() === normalizedParam) {
        return summary;
      }
    }
    return null;
  }, [playerParam, playerIndex]);

  const playerEmailHashes = usePlayerEmailHashes(
    state.status === "ready" ? state.players : undefined,
  );

  const ledgerData = useLedgerData(
    state.status === "ready"
      ? { fixtures: state.fixtures, predictions: state.predictions, scores: state.scores, players: state.players }
      : null,
    resolvedPlayer?.email ?? null,
    leaderboardEntries,
    resolvedPlayer?.displayName ?? null,
  );

  const allPlayers = useMemo(() => {
    if (!leaderboardEntries) return [];
    const avatarMap = new Map<string, string>();
    for (const [, emailHash] of playerEmailHashes) {
      const url = getAvatarUrl(emailHash);
      if (url) avatarMap.set(emailHash, url);
    }
    return buildPlayerPickerList(leaderboardEntries, avatarMap, playerEmailHashes);
  }, [leaderboardEntries, playerEmailHashes, getAvatarUrl]);

  const handleSelectPlayer = useCallback(
    (displayName: string) => {
      const next = new URLSearchParams();
      next.set("player", displayName);
      setSearchParams(next, { replace: true });
    },
    [setSearchParams],
  );

  // --- Match replay derived data (unchanged) ---
  const derived = useMemo(() => {
    if (state.status !== "ready" || isLedgerMode) return null;

    const groups = groupScoredMatchesByRound(state.fixtures);
    const order = getScoredMatchOrder(state.fixtures);
    const fallbackMatchId = getLatestScoredMatchId(state.fixtures);
    const requestedMatchId = matchId && order.includes(matchId) ? matchId : null;
    const selectedMatchId = requestedMatchId ?? fallbackMatchId;
    const replay = selectedMatchId
      ? joinMatchReplay({
          fixtures: state.fixtures,
          predictions: state.predictions,
          scores: state.scores,
          players: state.players,
          matchId: selectedMatchId,
        })
      : null;

    return { groups, order, fallbackMatchId, selectedMatchId, replay };
  }, [matchId, state, isLedgerMode]);

  const isLoading = state.status === "loading";
  const activeReplay = derived?.replay ?? null;
  const summary = activeReplay
    ? computeMatchCrowdSummary(activeReplay.picks)
    : { predictionsCount: 0, exactCount: 0, gotPointsCount: 0, mostPickedScoreline: "-" };

  const tierCounts = activeReplay?.picks.reduce<Record<PredictionTier, number>>(
    (counts, pick) => {
      counts[pick.tier] += 1;
      return counts;
    },
    { ...EMPTY_COUNTS },
  ) ?? { ...EMPTY_COUNTS };

  const filteredPicks = activeReplay?.picks.filter((pick) => {
    return filter === "all" ? true : pick.tier === filter;
  }) ?? [];

  const order = derived?.order ?? [];
  const currentIndex = derived?.selectedMatchId
    ? order.indexOf(derived.selectedMatchId)
    : -1;

  function updateMatch(nextMatchId: string) {
    setFilter("all");
    const next = new URLSearchParams(searchParams);
    next.set("match", nextMatchId);
    setSearchParams(next, { replace: true });
  }

  function moveBy(delta: number) {
    if (currentIndex < 0) return;
    const nextMatchId = order[currentIndex + delta];
    if (nextMatchId) updateMatch(nextMatchId);
  }

  const matchesScored = order.length;
  const picksThisMatch = activeReplay?.picks.length ?? 0;

  return (
    <div className="leaderboard-page-shell flex min-h-screen flex-col text-[#3A3024]">
      <SiteNav />

      <main className="flex-1" aria-busy={isLoading} aria-live="polite">
        {isLedgerMode ? <LedgerHero /> : (
          <ReplayHero
            loading={isLoading}
            matchesScored={matchesScored}
            picksThisMatch={picksThisMatch}
          />
        )}

        {isLoading && (isLedgerMode ? <LedgerSkeleton /> : <PredictionsSkeleton />)}

        {state.status === "error" && (
          <div className="mx-auto max-w-md px-5 py-10">
            <div className="rounded-2xl border border-[rgba(232,114,42,0.32)] bg-[#fffdf8] px-6 py-8 text-center shadow-[0_8px_22px_rgba(232,114,42,0.1)]">
              <p className="font-heading text-xl font-bold text-[#0a1628]">
                Could not load predictions data
              </p>
              <p className="mt-2 text-sm text-[#8A7E6E]">{state.message}</p>
              <button
                type="button"
                onClick={retry}
                className="mt-5 min-h-11 rounded-full bg-[#e8722a] px-5 py-2 text-sm font-bold text-white transition hover:brightness-95"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Ledger view */}
        {state.status === "ready" && isLedgerMode && (
          <>
            {playerParam && !resolvedPlayer && (
              <div className="mx-auto max-w-md px-5 py-10">
                <div className="rounded-2xl border border-[rgba(200,180,150,0.22)] bg-white px-6 py-8 text-center shadow-[0_8px_20px_rgba(94,62,20,0.07)]">
                  <p className="font-heading text-xl font-bold text-[#0a1628]">
                    Player not found
                  </p>
                  <p className="mt-2 text-sm text-[#8A7E6E]">
                    Pick a player from the leaderboard to see their ledger.
                  </p>
                  <Link
                    to="/leaderboard"
                    className="mt-5 inline-block min-h-11 rounded-full bg-[#e8722a] px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-95"
                  >
                    View Leaderboard
                  </Link>
                </div>
              </div>
            )}

            {resolvedPlayer && !state.fixtures.some((f) => f.Scored === "Y") && (
              <div className="mx-auto max-w-md px-5 py-10">
                <div className="rounded-2xl border border-[rgba(200,180,150,0.22)] bg-white px-6 py-8 text-center shadow-[0_8px_20px_rgba(94,62,20,0.07)]">
                  <p className="font-heading text-xl font-bold text-[#0a1628]">
                    No scored matches yet
                  </p>
                  <p className="mt-2 text-sm text-[#8A7E6E]">
                    Check back after the first matchday.
                  </p>
                </div>
              </div>
            )}

            {resolvedPlayer && ledgerData && state.fixtures.some((f) => f.Scored === "Y") && (
              <LedgerView
                player={resolvedPlayer}
                entries={ledgerData.entries}
                stats={ledgerData.stats}
                standing={ledgerData.standing}
                roundGroups={ledgerData.roundGroups}
                chartData={ledgerData.chartData}
                closingStatement={ledgerData.closingStatement}
                allPlayers={allPlayers}
                onSelectPlayer={handleSelectPlayer}
              />
            )}
          </>
        )}

        {/* Match replay view (unchanged) */}
        {state.status === "ready" && !isLedgerMode && (
          <div className="mx-auto max-w-[1120px] px-5 pb-12 md:px-7 md:pb-14">
            {derived?.selectedMatchId && derived.groups.length > 0 && (
              <MatchPicker
                currentMatchId={derived.selectedMatchId}
                groups={derived.groups}
                position={Math.max(currentIndex, 0)}
                total={order.length}
                hasPrevious={currentIndex > 0}
                hasNext={currentIndex >= 0 && currentIndex < order.length - 1}
                onPrevious={() => moveBy(-1)}
                onNext={() => moveBy(1)}
                onChange={updateMatch}
              />
            )}

            {!derived?.fallbackMatchId && (
              <div className="rounded-2xl border border-[rgba(232,114,42,0.32)] bg-[#fffdf8] px-6 py-8 text-center shadow-[0_8px_22px_rgba(232,114,42,0.1)]">
                <p className="font-heading text-xl font-bold text-[#0a1628]">
                  No scored matches yet
                </p>
                <p className="mt-2 text-sm text-[#8A7E6E]">
                  Replay opens once the first match has been scored.
                </p>
              </div>
            )}

            {derived?.fallbackMatchId && !activeReplay && (
              <div className="rounded-2xl border border-[rgba(232,114,42,0.32)] bg-[#fffdf8] px-6 py-8 text-center shadow-[0_8px_22px_rgba(232,114,42,0.1)]">
                <p className="font-heading text-xl font-bold text-[#0a1628]">
                  Match not found
                </p>
                <p className="mt-2 text-sm text-[#8A7E6E]">
                  Pick a scored match from the list to jump back into the replay.
                </p>
              </div>
            )}

            {activeReplay && (
              <>
                <MatchResultCard fixture={activeReplay.fixture} />
                <MatchSummaryChips summary={summary} />
                <TierFilterPills
                  activeFilter={filter}
                  counts={tierCounts}
                  onChange={setFilter}
                />
                <MatchPredictionsTable
                  picks={filteredPicks}
                  totalPicks={activeReplay.picks.length}
                />
              </>
            )}
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
