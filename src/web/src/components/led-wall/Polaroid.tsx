import { useState } from "react";
import type { CSSProperties } from "react";
import type { PolaroidCard } from "./layout";
import type { PresentAttendee } from "./types";

interface PolaroidProps {
  attendee: PresentAttendee;
  geometry: PolaroidCard;
  spotlight?: boolean;
}

function Initials({ attendee, fontSize }: { attendee: PresentAttendee; fontSize: number }) {
  return (
    <div className="led-wall-initials" style={{ fontSize: `${fontSize}px` }}>
      {attendee.fullName.split(" ").map((word) => word[0] ?? "").slice(0, 2).join("")}
    </div>
  );
}

/** Photo fallback chain: 0 = transparent cutout, 1 = thumbnail, 2 = initials. */
type PhotoTier = 0 | 1 | 2;

function initialTier(attendee: PresentAttendee): PhotoTier {
  if (attendee.portraitUrl) return 0;
  if (attendee.thumbnailUrl) return 1;
  return 2;
}

/** Monotonic: only ever moves toward 2, and only past a tier whose url actually exists. */
function nextTier(current: PhotoTier, attendee: PresentAttendee): PhotoTier {
  if (current === 0) return attendee.thumbnailUrl ? 1 : 2;
  return 2;
}

function tierSrc(tier: PhotoTier, attendee: PresentAttendee): string | null {
  if (tier === 0) return attendee.portraitUrl;
  if (tier === 1) return attendee.thumbnailUrl;
  return null;
}

export function Polaroid({ attendee, geometry, spotlight = false }: PolaroidProps) {
  // A spotlight (and, less often, a rotation-strip slot) can be reused for a different
  // attendee across renders without this component unmounting — the tier must not
  // outlive the attendee/urls it was recorded for. Reset synchronously during render
  // (not a useEffect) so there's no stale-content flash before the correction lands.
  const identity = `${attendee.id}:${attendee.portraitUrl ?? ""}:${attendee.thumbnailUrl ?? ""}`;
  const [trackedIdentity, setTrackedIdentity] = useState(identity);
  const [tier, setTier] = useState<PhotoTier>(() => initialTier(attendee));
  if (trackedIdentity !== identity) {
    setTrackedIdentity(identity);
    setTier(initialTier(attendee));
  }
  const photoSrc = tierSrc(tier, attendee);
  const frameStyle: CSSProperties = {
    width: `${geometry.width}px`,
    padding: `${geometry.mat}px ${geometry.mat}px ${geometry.matBottom}px`,
    background: geometry.paper,
    transform: `rotate(${geometry.rotation}deg)`,
  };

  return (
    <div
      className={spotlight ? "led-wall-polaroid led-wall-polaroid--spotlight" : "led-wall-polaroid"}
      style={frameStyle}
    >
      {!spotlight && (
        <div
          className="led-wall-tape"
          style={{
            left: `${geometry.tapeX}px`,
            width: `${geometry.tapeW}px`,
            transform: `rotate(${geometry.tapeR}deg)`,
            opacity: geometry.tapeOp,
          }}
          aria-hidden="true"
        />
      )}
      <div
        className="led-wall-polaroid__photo"
        style={{
          height: `${geometry.photoHeight}px`,
          background: geometry.bg,
        }}
      >
        {photoSrc ? (
          <img
            src={photoSrc}
            alt={attendee.fullName}
            onError={() => setTier((current) => nextTier(current, attendee))}
            className="led-wall-polaroid__portrait"
          />
        ) : (
          <Initials attendee={attendee} fontSize={geometry.initialsSize} />
        )}
        <div className="led-wall-polaroid__veil" style={{ opacity: geometry.veil }} aria-hidden="true" />
      </div>
      <div
        className="led-wall-polaroid__caption"
        style={{ paddingTop: `${geometry.capPad}px` }}
      >
        <div
          className="led-wall-polaroid__name"
          style={{ fontSize: `${geometry.nameSize}px` }}
          title={attendee.fullName}
        >
          {attendee.fullName}
        </div>
        <div className="led-wall-polaroid__branch" style={{ fontSize: `${geometry.subSize}px` }}>
          {geometry.branchShort}
        </div>
      </div>
    </div>
  );
}
