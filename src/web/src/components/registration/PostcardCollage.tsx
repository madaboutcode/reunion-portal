import { useIsMobile } from "@/hooks/useIsMobile";
import { Postcard } from "@/components/registration/Postcard";
import { ParticipationChapter } from "@/components/registration/ParticipationStepMarker";
import { PARTICIPATION_POSTCARDS, CHAPTERS } from "@/components/registration/participation-postcards";

function PostcardFromAsset({
  asset,
  className,
}: {
  asset: (typeof PARTICIPATION_POSTCARDS)[keyof typeof PARTICIPATION_POSTCARDS];
  className?: string;
}) {
  return (
    <Postcard
      label={asset.label}
      spritePosition={asset.spritePosition}
      rotation={asset.rotation}
      accent={asset.accent}
      className={className}
    />
  );
}

/** Desktop mockup: scattered overlapping postcards — hand-placed on a table feel. */
function DesktopPostcardGrid() {
  const { campus, raviz, violin, dj } = PARTICIPATION_POSTCARDS;

  return (
    <div className="grid grid-cols-2 gap-x-1 gap-y-2 w-full py-3">
      <div className="translate-x-1.5 -translate-y-0.5 z-10">
        <PostcardFromAsset asset={campus} />
      </div>
      <div className="-translate-x-2 translate-y-1.5 z-20">
        <PostcardFromAsset asset={raviz} />
      </div>
      <div className="translate-x-3 -translate-y-2 z-[15]">
        <PostcardFromAsset asset={violin} />
      </div>
      <div className="-translate-x-2 -translate-y-1.5 z-[25]">
        <PostcardFromAsset asset={dj} />
      </div>
    </div>
  );
}

/** Mobile mockup: alternating postcards + numbered chapters inline. */
function MobileAlternatingStory() {
  const { campus, raviz, violin, dj } = PARTICIPATION_POSTCARDS;

  return (
    <div className="space-y-5 py-1">
      <div className="flex gap-3 items-start">
        <PostcardFromAsset asset={campus} className="w-[46%] max-w-[168px] shrink-0" />
        <ParticipationChapter
          n={1}
          title={CHAPTERS.campus.title}
          body={CHAPTERS.campus.body}
        />
      </div>

      <div className="flex gap-3 items-start">
        <ParticipationChapter
          n={2}
          title={CHAPTERS.raviz.title}
          body={CHAPTERS.raviz.body}
        />
        <PostcardFromAsset
          asset={raviz}
          className="w-[46%] max-w-[168px] shrink-0 -mt-4"
        />
      </div>

      <div className="flex gap-3 items-start">
        <div className="w-[46%] max-w-[168px] shrink-0 space-y-2.5">
          <PostcardFromAsset asset={violin} />
          <PostcardFromAsset asset={dj} className="w-[88%]" />
        </div>
        <ParticipationChapter
          n={3}
          title={CHAPTERS.evening.title}
          body={CHAPTERS.evening.body}
        />
      </div>
    </div>
  );
}

export function PostcardCollage() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileAlternatingStory /> : <DesktopPostcardGrid />;
}