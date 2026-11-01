import { useIsMobile } from "@/hooks/useIsMobile";
import { SelectionCheckmark } from "@/components/registration/SelectionCheckmark";
import { ParticipationIcon, ParticipationIconBadge } from "@/components/registration/ParticipationIcons";

const BOTANICAL = "/assets/registration/postcard-ui/botanical-flourish.webp";

export interface DonationOnlyCardProps {
  selected: boolean;
  onSelect: () => void;
}

export function DonationOnlyCard({ selected, onSelect }: DonationOnlyCardProps) {
  const isMobile = useIsMobile();

  const borderClass = selected
    ? "border-terracotta bg-terracotta-light/40"
    : "border-border bg-white";

  if (isMobile) {
    return (
      <button
        type="button"
        onClick={onSelect}
        data-testid="plan-donation_only"
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
        <ParticipationIconBadge name="donation" variant="teal" size={48} />
        <div className="flex-1 min-w-0 pr-6">
          <div className="flex justify-between gap-2 mb-0.5">
            <span className="text-base font-bold text-charcoal">Donation Only</span>
            <span className="text-sm font-semibold text-[#2a7a80] shrink-0">
              Choose amount
            </span>
          </div>
          <p className="text-xs text-muted leading-[1.4]">
            Can&apos;t attend in person? Support the batch contribution and reunion fund.
          </p>
          <span className="inline-block mt-1.5 text-[10px] font-semibold text-subtle bg-[#f4f4f4] px-2 py-0.5 rounded-full">
            No event pass
          </span>
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
      data-testid="plan-donation_only"
      className={[
        "relative w-full text-left",
        "border-2 rounded-[14px]",
        "transition-all duration-150",
        "p-5 px-6 flex gap-5 items-center",
        "shadow-[0_2px_12px_rgba(80,60,40,0.08)]",
        "hover:shadow-[0_4px_20px_rgba(80,60,40,0.14)]",
        borderClass,
      ].join(" ")}
    >
      {selected && <SelectionCheckmark />}
      <ParticipationIconBadge name="donation" variant="teal" size={64} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-3 mb-1">
          <span className="font-heading text-[17px] font-bold text-charcoal">Donation Only</span>
          <span className="text-sm font-semibold text-[#2a7a80] shrink-0">
            Choose amount
          </span>
        </div>
        <p className="text-sm text-muted leading-[1.45]">
          Support the reunion from anywhere. No event pass.
        </p>
      </div>
      <div
        className="absolute inset-0 overflow-hidden rounded-[12px] pointer-events-none"
        aria-hidden
      >
        <img
          src={BOTANICAL}
          alt=""
          className="absolute -right-4 -bottom-2 w-[280px] h-auto object-contain opacity-60"
        />
      </div>
    </button>
  );
}