import { useIsMobile } from "@/hooks/useIsMobile";
import { ParticipationIconBadge } from "@/components/registration/ParticipationIcons";
import { CHAPTERS, type ChapterContent } from "@/components/registration/participation-postcards";

const SEGMENT_ORDER: (keyof typeof CHAPTERS)[] = ["campus", "raviz", "evening"];

function DesktopSegment({ chapter }: { chapter: ChapterContent }) {
  return (
    <div className="min-w-0 flex gap-3">
      <ParticipationIconBadge name={chapter.icon} variant="teal" size={52} />
      <div>
        <h4 className="font-heading text-sm font-bold text-charcoal mb-1.5 m-0">
          {chapter.title}
        </h4>
        <ul className="m-0 p-0 list-none space-y-0.5">
          {chapter.items.map((item) => (
            <li key={item} className="text-xs text-muted leading-[1.45]">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function EventTimeline() {
  const isMobile = useIsMobile();
  if (isMobile) return null;

  return (
    <div className="grid grid-cols-3 gap-5 pt-5 mt-5 border-t border-border/70">
      {SEGMENT_ORDER.map((key) => (
        <DesktopSegment key={key} chapter={CHAPTERS[key]} />
      ))}
    </div>
  );
}
