import type { ReactNode } from "react";

export interface CompactOptionCardProps {
  icon: ReactNode;
  title: string;
  price: string;
  description: string;
  badge?: string;
  selected: boolean;
  onSelect: () => void;
}

export function CompactOptionCard({
  icon,
  title,
  price,
  description,
  badge,
  selected,
  onSelect,
}: CompactOptionCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "w-full p-4 px-3.5",
        "border-2 rounded-[14px]",
        "text-left cursor-pointer",
        "transition-all duration-150",
        "flex items-center gap-3",
        selected
          ? "border-soft-aqua bg-soft-aqua-light"
          : "border-border bg-[#fafafa]",
      ].join(" ")}
    >
      <span className="text-2xl leading-none shrink-0" aria-hidden="true">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <span
            className={[
              "text-base font-bold",
              selected ? "text-[#2a7a80]" : "text-charcoal",
            ].join(" ")}
          >
            {title}
          </span>
          <span className="text-sm font-semibold text-charcoal shrink-0">
            {price}
          </span>
        </div>
        <p className="text-xs text-subtle leading-[1.4]">{description}</p>
        {badge && (
          <p className="text-[11px] text-subtle italic mt-1 leading-[1.4]">
            {badge}
          </p>
        )}
      </div>
    </button>
  );
}