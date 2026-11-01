import { useIsMobile } from "@/hooks/useIsMobile";
import { PostcardCollage } from "@/components/registration/PostcardCollage";
import { EventTimeline } from "@/components/registration/EventTimeline";
import { SelectionCheckmark } from "@/components/registration/SelectionCheckmark";
import { ParticipationIcon } from "@/components/registration/ParticipationIcons";

const TITLE = "Complete Reunion Experience";
const PRICE = "₹8,500";
const BADGE = "Recommended";
const HIGHLIGHT = "underline decoration-[rgba(215,107,81,0.5)] decoration-2 underline-offset-4";
const HIGHLIGHT_TEAL = "underline decoration-[rgba(185,223,226,0.6)] decoration-2 underline-offset-4";
const CALLOUT = "Full celebration works best when we stay together through the evening.";

export interface FullCelebrationCardProps {
  selected: boolean;
  onSelect: () => void;
}

export function FullCelebrationCard({ selected, onSelect }: FullCelebrationCardProps) {
  const isMobile = useIsMobile();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSelect}
        data-testid="plan-full_celebration"
        className={[
          "relative w-full text-left cursor-pointer",
          "border-2 rounded-[14px]",
          "transition-all duration-150",
          "p-4 sm:p-6",
          "shadow-[0_2px_12px_rgba(80,60,40,0.08)]",
          "hover:shadow-[0_4px_20px_rgba(80,60,40,0.14)]",
          selected
            ? "border-terracotta bg-terracotta-light/40"
            : "border-border bg-[#fafafa]",
        ].join(" ")}
      >
        {selected && <SelectionCheckmark />}

        {isMobile ? (
          <>
            <div className="flex items-start gap-2.5 mb-2 pr-8">
              <ParticipationIcon
                name="people-group"
                size={22}
                className="text-terracotta shrink-0 mt-0.5"
              />
              <h3 className="font-heading text-base font-bold text-charcoal min-w-0">
                {TITLE}
              </h3>
            </div>
            <div className="flex items-center gap-2.5 mb-3">
              <p className="text-xl font-bold text-charcoal m-0">{PRICE}</p>
              <span className="text-xs bg-terracotta text-white px-2.5 py-0.5 rounded-full font-semibold">
                {BADGE}
              </span>
            </div>
            <p className="text-sm text-muted leading-[1.5] mb-4">
              For most of us, this is the first real batch meetup in{" "}
              <span className={`${HIGHLIGHT}`}>20 years</span>
              {" "}— and this isn&apos;t just a meetup, it&apos;s our{" "}
              <span className={`${HIGHLIGHT}`}>20th year celebration</span>.
              {" "}Stay for the whole thing — the campus walk, the dinner, the{" "}
              <span className={HIGHLIGHT_TEAL}>late-night catching up</span>.
              {" "}<span className={HIGHLIGHT}>When do we get everyone in one place again?</span>
            </p>
            <PostcardCollage />
            <div className="mt-4 rounded-[12px] bg-soft-aqua-light/80 border border-soft-aqua/40 px-3.5 py-2.5 flex gap-2.5 items-center">
              <ParticipationIcon
                name="attendees"
                size={18}
                className="text-[#2a7a80] shrink-0"
              />
              <p className="text-xs text-[#2a7a80] leading-[1.4] m-0">
                {CALLOUT}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1 pr-10">
              <div className="flex items-center gap-2 min-w-0">
                <ParticipationIcon
                  name="people-group"
                  size={24}
                  className="text-terracotta shrink-0"
                />
                <h3 className="font-heading text-[20px] font-bold text-charcoal m-0">
                  {TITLE}
                </h3>
              </div>
              <span className="text-[22px] font-bold text-terracotta shrink-0 ml-4">
                {PRICE}
              </span>
            </div>
            <span className="inline-flex items-center gap-1 text-xs bg-terracotta text-white px-2.5 py-0.5 rounded-full font-semibold mb-3">
              {BADGE}
            </span>
            <div className="grid grid-cols-[minmax(180px,1fr)_minmax(200px,300px)] gap-x-6 items-start">
              <p className="text-sm text-muted leading-[1.55] m-0">
                For most of us, this is the first real batch meetup in{" "}
                <span className={`${HIGHLIGHT}`}>20 years</span>
                {" "}— and this isn&apos;t just a meetup, it&apos;s our{" "}
                <span className={`${HIGHLIGHT}`}>20th year celebration</span>.
                {" "}Stay for the whole thing — the campus walk, the dinner, the{" "}
                <span className={HIGHLIGHT_TEAL}>late-night catching up</span>.
                {" "}<span className={HIGHLIGHT}>When do we get everyone in one place again?</span>
              </p>
              <PostcardCollage />
            </div>
            <EventTimeline />
          </>
        )}
      </button>
    </div>
  );
}