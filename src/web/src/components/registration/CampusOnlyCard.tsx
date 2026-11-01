import { useIsMobile } from "@/hooks/useIsMobile";
import { SelectionCheckmark } from "@/components/registration/SelectionCheckmark";
import { PARTICIPATION_POSTCARDS } from "@/components/registration/participation-postcards";
import { ParticipationIcon, ParticipationIconBadge } from "@/components/registration/ParticipationIcons";
import { Postcard } from "@/components/registration/Postcard";

export interface CampusOnlyCardProps {
  selected: boolean;
  onSelect: () => void;
}

export function CampusOnlyCard({ selected, onSelect }: CampusOnlyCardProps) {
  const isMobile = useIsMobile();
  const { campus } = PARTICIPATION_POSTCARDS;

  const borderClass = selected
    ? "border-terracotta bg-terracotta-light/40"
    : "border-border bg-white";

  if (isMobile) {
    return (
      <button
        type="button"
        onClick={onSelect}
        data-testid="plan-campus_only"
        className={[
          "relative w-full text-left",
          "border-2 rounded-[14px] p-4",
          "transition-all duration-150",
          "flex items-center gap-3",
          "shadow-[0_2px_12px_rgba(80,60,40,0.08)]",
          "hover:shadow-[0_4px_20px_rgba(80,60,40,0.14)]",
          borderClass,
        ].join(" ")}
      >
        {selected && <SelectionCheckmark />}
        <ParticipationIconBadge name="building" variant="teal" size={48} />
        <div className="flex-1 min-w-0 pr-6">
          <div className="flex justify-between gap-2 mb-0.5">
            <span className="text-base font-bold text-charcoal">
              Campus Day Only
            </span>
            <span className="text-sm font-semibold text-charcoal shrink-0">
              ₹5,500
            </span>
          </div>
          <p className="text-xs text-muted leading-[1.4]">
            For batchmates who must leave after the formal college program.
          </p>
          <p className="text-[11px] text-terracotta mt-1 flex items-center gap-1">
            <ParticipationIcon name="bus" size={12} className="shrink-0" />
            Ends before Raviz
          </p>
        </div>
        <ParticipationIcon
          name="chevron-right"
          size={18}
          className="text-muted shrink-0"
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid="plan-campus_only"
      className={[
        "relative w-full text-left",
        "border-2 rounded-[14px]",
        "transition-all duration-150",
        "p-5 px-6",
        "shadow-[0_2px_12px_rgba(80,60,40,0.08)]",
        "hover:shadow-[0_4px_20px_rgba(80,60,40,0.14)]",
        borderClass,
      ].join(" ")}
    >
      {selected && <SelectionCheckmark />}
      <div className="flex gap-4 items-center">
        <ParticipationIconBadge name="building" variant="teal" size={56} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 mb-1">
            <span className="font-heading text-[17px] font-bold text-charcoal">
              Campus Day Only
            </span>
            <span className="text-[17px] font-bold text-charcoal shrink-0">
              ₹5,500
            </span>
          </div>
          <p className="text-sm text-muted leading-[1.45]">
            Includes campus program, lunch and batch moments. Ends before the Raviz
            evening.
          </p>
        </div>
        <div className="w-[110px] shrink-0 overflow-visible flex items-center justify-center">
          <Postcard
            label=""
            spritePosition={campus.spritePosition}
            rotation={-3}
            accent="tape"
            showLabel={false}
            className="w-[100px]"
          />
        </div>
      </div>
      <div
        className={[
          "mt-3 flex items-center gap-2",
          "rounded-[10px] border border-amber-200 bg-amber-50",
          "px-3.5 py-2.5 text-xs text-amber-900 leading-[1.4]",
        ].join(" ")}
      >
        <ParticipationIcon
          name="warning"
          size={16}
          className="text-amber-700 shrink-0"
        />
        <span>
          You&apos;ll miss the Raviz evening — concert, dinner, DJ night, and casual
          reunion time.
        </span>
      </div>
    </button>
  );
}