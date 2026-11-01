import { useEffect, useRef } from "react";
import type { FilterOption } from "./FilterPills";

export interface ScrollFilterChipsProps {
  options: FilterOption[];
  activeKey: string;
  onChange: (key: string) => void;
}

export function ScrollFilterChips({ options, activeKey, onChange }: ScrollFilterChipsProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const active = row.querySelector<HTMLButtonElement>(`[data-filter-key="${activeKey}"]`);
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeKey]);

  return (
    <div
      ref={rowRef}
      className="flex gap-2 flex-nowrap"
      role="tablist"
      aria-label="Filter by branch"
    >
      {options.map((option) => {
        const isActive = option.key === activeKey;

        return (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-filter-key={option.key}
            onClick={() => onChange(option.key)}
            className={[
              "shrink-0 px-3.5 py-2 rounded-full text-sm font-medium transition-colors duration-150",
              isActive
                ? "bg-charcoal text-white font-semibold shadow-sm"
                : "bg-white/80 text-charcoal shadow-[0_1px_3px_rgba(90,72,52,0.08)] hover:bg-white",
            ].join(" ")}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={isActive ? "ml-1 text-[11px] opacity-70" : "ml-1 text-[11px] text-muted"}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}