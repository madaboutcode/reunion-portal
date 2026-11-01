import { useState } from "react";
import { COST_CATEGORIES, SPONSORSHIP_ADJUSTMENT } from "@/lib/cost-categories";
import { formatINR } from "@/lib/pricing";

interface CostBreakupProps {
  className?: string;
}

export function CostBreakup({ className }: CostBreakupProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center gap-1",
          "bg-transparent border-0 p-0 cursor-pointer",
          "text-xs text-subtle hover:text-muted",
          "transition-colors duration-150",
        ].join(" ")}
      >
        What this covers
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          <polyline points="4,2 8,6 4,10" />
        </svg>
      </button>

      {open && (
        <div className="mt-3 space-y-1.5">
          {COST_CATEGORIES.map((cat) => (
            <div key={cat.label} className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-muted leading-snug">{cat.label}</span>
              <span className="text-xs text-muted tabular-nums whitespace-nowrap">
                {cat.amount != null ? formatINR(cat.amount) : "TBD"}
              </span>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-emerald-600 leading-snug">
              {SPONSORSHIP_ADJUSTMENT.label}
            </span>
            <span className="text-xs text-emerald-600 tabular-nums whitespace-nowrap">
              −{formatINR(Math.abs(SPONSORSHIP_ADJUSTMENT.amount))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
