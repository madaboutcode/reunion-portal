// ── Types ──────────────────────────────────────────────────────────────────

export interface FilterOption {
  key: string;
  label: React.ReactNode;
  count?: number;
}

export interface FilterPillsProps {
  options: FilterOption[];
  activeKey: string;
  onChange: (key: string) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function FilterPills({ options, activeKey, onChange }: FilterPillsProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((option) => {
        const isActive = option.key === activeKey;

        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={[
              "inline-flex items-center px-3 py-1.5 rounded-full text-sm transition-colors duration-150",
              isActive
                ? "bg-terracotta text-white font-semibold"
                : "bg-white border border-border text-charcoal hover:border-terracotta hover:text-terracotta",
            ].join(" ")}
          >
            <>
              {option.label}
              {option.count !== undefined && (
                <span className={isActive
                  ? "ml-1.5 text-[10px] font-bold bg-black/15 px-1.5 py-0.5 rounded-full"
                  : "ml-1.5 text-[10px] font-bold bg-border text-muted px-1.5 py-0.5 rounded-full"
                }>
                  {option.count}
                </span>
              )}
            </>
          </button>
        );
      })}
    </div>
  );
}
