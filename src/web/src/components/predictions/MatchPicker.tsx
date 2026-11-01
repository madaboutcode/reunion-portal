import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchPickerGroup } from "@/lib/prediction-types";

interface MatchPickerProps {
  currentMatchId: string;
  groups: MatchPickerGroup[];
  position: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onChange: (matchId: string) => void;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function buildRoundBadge(round: string | undefined, position: number): string {
  if (!round) return `#${position + 1}`;

  const matchday = round.match(/^matchday\s+(\d+)$/i);
  if (matchday) {
    return `Day ${matchday[1]}`;
  }

  return round;
}

export function MatchPicker({
  currentMatchId,
  groups,
  position,
  total,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onChange,
}: MatchPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const currentMatch = useMemo(() => {
    return groups
      .flatMap((group) => group.matches)
      .find((match) => match.matchId === currentMatchId) ?? null;
  }, [currentMatchId, groups]);

  const filteredGroups = useMemo(() => {
    const normalizedQuery = normalizeSearch(query);

    if (!normalizedQuery) {
      return groups;
    }

    return groups
      .map((group) => ({
        ...group,
        matches: group.matches.filter((match) => {
          const haystack = `${group.round} ${match.label} ${match.sublabel}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        }),
      }))
      .filter((group) => group.matches.length > 0);
  }, [groups, query]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    inputRef.current?.focus();
  }, [open]);

  function handleSelect(matchId: string) {
    onChange(matchId);
    setOpen(false);
  }

  return (
    <section className="mb-5">
      <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#8A7E6E]">
        Select match
      </p>
      <div className="flex items-start gap-2 sm:gap-3" ref={rootRef}>
        <button
          type="button"
          aria-label="Previous match"
          onClick={onPrevious}
          disabled={!hasPrevious}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[rgba(200,180,150,0.28)] bg-white text-sm text-[#0a1628] shadow-[0_8px_20px_rgba(94,62,20,0.07)] transition hover:border-[#e8722a] hover:bg-[#fff7ef] disabled:cursor-not-allowed disabled:opacity-45"
        >
          ◀
        </button>

        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen((value) => !value)}
            className={`flex min-h-11 w-full items-start justify-between gap-3 rounded-2xl border bg-white px-4 py-3 text-left shadow-[0_8px_20px_rgba(94,62,20,0.07)] transition ${
              open
                ? "border-[#d76b51] shadow-[0_10px_26px_rgba(215,107,81,0.14)]"
                : "border-[rgba(200,180,150,0.28)] hover:border-[#e8722a]"
            }`}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 rounded-full border border-[#b9dfe2] bg-[#e4f3f4] px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[#2A5F63]">
                {buildRoundBadge(
                  groups.find((group) =>
                    group.matches.some((match) => match.matchId === currentMatchId),
                  )?.round,
                  position,
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-bold text-[#0a1628] sm:text-[15px]">
                  {currentMatch?.label ?? "Select a scored match"}
                </span>
                <span className="block truncate text-[12px] font-semibold text-[#8A7E6E]">
                  {currentMatch?.sublabel ?? "Round-grouped picker"}
                </span>
              </span>
            </div>
            <span className="flex shrink-0 items-center gap-3 pl-2">
              <span className="font-sport text-xs text-[#8A7E6E]">
                {total === 0 ? "0/0" : `${position + 1}/${total}`}
              </span>
              <span className={`text-[11px] text-[#d76b51] transition ${open ? "rotate-180" : ""}`}>
                ▼
              </span>
            </span>
          </button>

          {open && (
            <div className="absolute z-30 mt-2 max-h-[360px] w-full overflow-hidden rounded-[22px] border border-[#d76b51] bg-white shadow-[0_20px_44px_rgba(94,62,20,0.18)]">
              <div className="border-b border-[rgba(200,180,150,0.2)] px-4 py-3">
                <label className="flex min-h-11 items-center gap-3 rounded-xl bg-[#fffdf9] px-3 ring-1 ring-[rgba(200,180,150,0.18)]">
                  <svg
                    className="h-4 w-4 shrink-0 text-[#d76b51]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    ref={inputRef}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search round or team..."
                    className="w-full bg-transparent text-[14px] font-semibold text-[#0a1628] outline-none placeholder:text-[#8A7E6E]"
                  />
                </label>
              </div>

              <div className="max-h-[290px] overflow-y-auto">
                {filteredGroups.length === 0 && (
                  <div className="px-4 py-6 text-sm font-semibold text-[#8A7E6E]">
                    No matches found for “{query}”.
                  </div>
                )}

                {filteredGroups.map((group) => (
                  <div key={group.round}>
                    <div className="flex items-center justify-between gap-3 bg-[#fdf3ef] px-4 py-3 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#8A7E6E]">
                      <span>{group.round}</span>
                      <span className="text-[#d76b51]">{group.matches.length} scored</span>
                    </div>

                    {group.matches.map((match) => {
                      const selected = match.matchId === currentMatchId;

                      return (
                        <button
                          key={match.matchId}
                          type="button"
                          onClick={() => handleSelect(match.matchId)}
                          className={`flex w-full items-center justify-between gap-3 border-t border-[rgba(200,180,150,0.12)] px-4 py-4 text-left transition ${
                            selected
                              ? "border-l-4 border-l-[#d76b51] bg-[#fdf7f3] pl-3"
                              : "hover:bg-[#fffaf5]"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold text-[#3A3024] sm:text-[14px]">
                              {match.label}
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] font-semibold text-[#8A7E6E]">
                              {match.sublabel}
                            </span>
                          </span>
                          <span className="shrink-0 font-sport text-[18px] font-semibold text-[#d76b51]">
                            {match.scoreline}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          aria-label="Next match"
          onClick={onNext}
          disabled={!hasNext}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[rgba(200,180,150,0.28)] bg-white text-sm text-[#0a1628] shadow-[0_8px_20px_rgba(94,62,20,0.07)] transition hover:border-[#e8722a] hover:bg-[#fff7ef] disabled:cursor-not-allowed disabled:opacity-45"
        >
          ▶
        </button>
      </div>
    </section>
  );
}
