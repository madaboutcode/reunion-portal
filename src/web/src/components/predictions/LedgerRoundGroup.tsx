import { useState } from "react";
import { LedgerMatchRow } from "./LedgerMatchRow";
import type { LedgerEntry } from "@/lib/prediction-types";

export function LedgerRoundGroup({
  round,
  subtotal,
  exactCount,
  entries,
  defaultExpanded,
}: {
  round: string;
  subtotal: number;
  exactCount: number;
  entries: LedgerEntry[];
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="overflow-hidden rounded-[18px] border border-[rgba(200,180,150,0.22)] bg-white shadow-[0_8px_20px_rgba(94,62,20,0.07)]">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-heading text-[15px] font-bold text-[#0a1628]">{round}</span>
          {exactCount > 0 && (
            <span className="rounded-full bg-terracotta/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-terracotta">
              {exactCount} exact
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="font-sport text-[15px] font-semibold text-[#e8722a]">
            +{subtotal}
          </span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={`h-4 w-4 shrink-0 text-[#8A7E6E] transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[rgba(200,180,150,0.18)]">
          <div className="hidden grid-cols-[36px_1fr_72px_72px_56px_64px] gap-3 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#8A7E6E] sm:grid">
            <span />
            <span>Match</span>
            <span className="text-center">Pred</span>
            <span className="text-center">Actual</span>
            <span className="text-right">Pts</span>
            <span className="text-right">Balance</span>
          </div>
          <div className="divide-y divide-[rgba(200,180,150,0.18)]">
            {entries.map((entry) => (
              <LedgerMatchRow key={entry.matchId} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
