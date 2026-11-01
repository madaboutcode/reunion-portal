import { useMemo } from "react";
import { usePolaroidClaim } from "@/hooks/usePolaroidClaim";
import {
  imageRefToBackgroundStyle,
  POLAROID_FALLBACK_GRADIENT,
} from "@/lib/polaroid-sprites";

const FRAME_COLOR = "#EDE6D6";

const PHOTO_EFFECTS = {
  sepia: 0.5,
  saturate: 1.1,
  contrast: 1.1,
  brightness: 0.95,
  warmTint: 0.25,
  vignette: 0.2,
};

export interface PolaroidFrameProps {
  slotId: string;
  rotation?: number;
  width?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function PolaroidFrame({
  slotId,
  rotation = -3,
  width = 180,
  className = "",
  style,
}: PolaroidFrameProps) {
  const { imageRef, ready, manifest } = usePolaroidClaim(slotId);

  const photoStyle = useMemo(() => {
    if (!imageRef || !ready || !manifest) {
      return { background: POLAROID_FALLBACK_GRADIENT };
    }

    const spriteStyle = imageRefToBackgroundStyle(imageRef, manifest);
    return spriteStyle ?? { background: POLAROID_FALLBACK_GRADIENT };
  }, [imageRef, ready, manifest]);

  const filterStr = [
    PHOTO_EFFECTS.sepia > 0 ? `sepia(${PHOTO_EFFECTS.sepia})` : "",
    PHOTO_EFFECTS.saturate !== 1 ? `saturate(${PHOTO_EFFECTS.saturate})` : "",
    PHOTO_EFFECTS.contrast !== 1 ? `contrast(${PHOTO_EFFECTS.contrast})` : "",
    PHOTO_EFFECTS.brightness !== 1 ? `brightness(${PHOTO_EFFECTS.brightness})` : "",
  ].filter(Boolean).join(" ") || undefined;

  return (
    <div
      className={`relative inline-block rounded-[3px] px-2 pt-2 pb-3 ${className}`}
      style={{
        width,
        backgroundColor: FRAME_COLOR,
        transform: `rotate(${rotation}deg)`,
        boxShadow: "2px 4px 16px rgba(80, 60, 40, 0.15)",
        ...style,
      }}
    >
      <div
        className="absolute -top-[7px] left-1/2 h-[14px] w-[44px] -translate-x-1/2 rotate-[1deg] rounded-[2px]"
        style={{ background: "rgba(215, 200, 170, 0.55)" }}
        aria-hidden="true"
      />

      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <div
          className="absolute inset-0"
          role={imageRef?.title ? "img" : undefined}
          aria-label={imageRef?.title}
          style={{ ...photoStyle, filter: filterStr }}
        />
        {PHOTO_EFFECTS.warmTint > 0 && (
          <div className="absolute inset-0" style={{
            background: `rgba(180, 120, 60, ${PHOTO_EFFECTS.warmTint})`,
            mixBlendMode: "multiply",
          }} />
        )}
        {PHOTO_EFFECTS.vignette > 0 && (
          <div className="absolute inset-0" style={{
            background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${PHOTO_EFFECTS.vignette}) 100%)`,
          }} />
        )}
      </div>
    </div>
  );
}
