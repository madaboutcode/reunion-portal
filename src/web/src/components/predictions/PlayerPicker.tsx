import { useEffect, useRef, useState } from "react";
import type { PlayerPickerItem, Standing } from "@/lib/prediction-types";

export interface PlayerPickerProps {
  currentPlayer: PlayerPickerItem;
  players: PlayerPickerItem[];
  onSelect: (displayName: string) => void;
  standing: Standing | null;
}

function PlayerAvatar({
  displayName,
  avatarUrl,
  size = 44,
}: {
  displayName: string;
  avatarUrl: string | null;
  size?: number;
}) {
  const dimension = `${size}px`;
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={displayName}
        className="rounded-full object-cover"
        style={{ width: dimension, height: dimension }}
      />
    );
  }
  const initial = displayName.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-[#B9DFE2] font-bold text-[#1F2A33]"
      style={{ width: dimension, height: dimension }}
    >
      {initial}
    </div>
  );
}

function BatchPill({ batch }: { batch: string }) {
  return (
    <span className="inline-block rounded-full bg-[#B9DFE2]/20 px-2 py-0.5 text-xs text-[#1F2A33]">
      {batch}
    </span>
  );
}

export function PlayerPicker({
  currentPlayer,
  players,
  onSelect,
  standing,
}: PlayerPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded) {
      inputRef.current?.focus();
    } else {
      setQuery("");
    }
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded]);

  const leaderLine = standing
    ? standing.isLeading
      ? "Leading"
      : `${standing.leaderDistance} behind #1`
    : null;

  const avgLine = standing
    ? standing.avgDistance > 0
      ? `${standing.avgDistance} above avg (${standing.average})`
      : standing.avgDistance < 0
        ? `${Math.abs(standing.avgDistance)} below avg (${standing.average})`
        : `At avg (${standing.average})`
    : null;

  const normalizedQuery = query.trim().toLowerCase();
  const filteredPlayers = normalizedQuery
    ? players.filter((player) =>
        player.displayName.toLowerCase().includes(normalizedQuery)
      )
    : players;

  return (
    <div ref={containerRef} className="rounded-2xl border border-[rgba(200,180,150,0.22)] bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-left"
      >
        <PlayerAvatar
          displayName={currentPlayer.displayName}
          avatarUrl={currentPlayer.avatarUrl}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-[#1F2A33]">
              {currentPlayer.displayName}
            </span>
            <BatchPill batch={currentPlayer.batch} />
          </div>
          <div className="text-sm text-[#1F2A33]/70">
            {currentPlayer.totalPoints} pts · #{currentPlayer.rank}
          </div>
          {standing && (
            <div className="mt-0.5 text-xs text-[#1F2A33]/60">
              <div>{leaderLine}</div>
              <div>{avgLine}</div>
            </div>
          )}
        </div>
        <span
          className={`shrink-0 text-[#1F2A33]/50 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          aria-hidden
        >
          ▼
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[rgba(200,180,150,0.22)] px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search players..."
            className="mb-3 min-h-[44px] w-full rounded-lg border border-[rgba(200,180,150,0.3)] px-3 py-2 text-sm text-[#1F2A33] outline-none focus:border-[#D76B51]"
          />
          <div className="max-h-[280px] overflow-y-auto">
            {filteredPlayers.length === 0 ? (
              <div className="py-4 text-center text-sm text-[#1F2A33]/60">
                No players matching &apos;{query}&apos;
              </div>
            ) : (
              filteredPlayers.map((player) => {
                const isCurrent = player.displayName === currentPlayer.displayName;
                return (
                  <button
                    key={player.displayName}
                    type="button"
                    onClick={() => { onSelect(player.displayName); setExpanded(false); }}
                    className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg px-2 py-2 text-left ${
                      isCurrent
                        ? "border-l-2 border-[#D76B51] bg-[#B9DFE2]/10"
                        : "hover:bg-[#B9DFE2]/5"
                    }`}
                  >
                    <span className="w-6 shrink-0 text-sm text-[#1F2A33]/60">
                      #{player.rank}
                    </span>
                    <PlayerAvatar
                      displayName={player.displayName}
                      avatarUrl={player.avatarUrl}
                      size={32}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#1F2A33]">
                      {player.displayName}
                    </span>
                    <BatchPill batch={player.batch} />
                    <span className="shrink-0 text-sm font-semibold text-[#1F2A33]">
                      {player.totalPoints}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
