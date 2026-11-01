import type { CSSProperties } from "react";
import type { LayoutTree } from "./layout";
import { Polaroid } from "./Polaroid";
import { getBranchInfo } from "./branchCatalog";
import type { PresentAttendee } from "./types";

interface SpotlightLayerProps {
  layout: LayoutTree;
  attendee: PresentAttendee | null;
  visible: boolean;
}

export function SpotlightLayer({ layout, attendee, visible }: SpotlightLayerProps) {
  const { spot } = layout;
  const cardGeometry = attendee
    ? {
        attendeeId: attendee.id,
        name: attendee.fullName,
        ini: attendee.fullName.split(" ").map((word) => word[0] ?? "").slice(0, 2).join(""),
        width: spot.cardW,
        mat: spot.mat,
        matBottom: spot.matB,
        capPad: spot.capPad,
        photoHeight: spot.photoH,
        rotation: 2.6,
        marginTop: 0,
        paper: "linear-gradient(155deg,#f4ead2,#dccdaa)",
        bg: "linear-gradient(150deg,#40525e,#202b33)",
        veil: 0.1,
        tapeX: spot.tapeX,
        tapeW: spot.tapeW,
        tapeR: -5,
        tapeOp: 0.8,
        initialsSize: spot.ini,
        nameSize: spot.capName,
        subSize: spot.capMeta,
        floatDur: 0,
        floatDelay: 0,
        branchShort: getBranchInfo(attendee.branch).short,
      }
    : null;

  return (
    <div className="led-wall-spotlight-layer" aria-hidden={!visible}>
      {attendee && cardGeometry && (
        <>
          <div className="led-wall-spotlight-copy" style={{ left: `${spot.textX}px`, top: `${spot.textY}px`, width: `${spot.textW}px` }}>
            <img className="led-wall-spotlight-copy__logo" src="/assets/led-wall/smriti-logo.png" alt="Smriti" />
            <div className="led-wall-spotlight-copy__eyebrow" style={{ fontSize: `${spot.eyebrow}px` }}>Look who&apos;s here</div>
            <div className="led-wall-spotlight-copy__name" style={{ fontSize: `${spot.name}px` }}>{attendee.fullName}</div>
            <div className="led-wall-spotlight-copy__meta" style={{ fontSize: `${spot.meta}px` }}>2006 Batch · {attendee.branch}</div>
            <div className="led-wall-spotlight-copy__quote" style={{ fontSize: `${spot.quote}px` }}>Welcome back to where it began.</div>
          </div>
          <div className="led-wall-spotlight-card" style={{ left: `${spot.cardX}px`, top: `${spot.cardY}px` } satisfies CSSProperties}>
            <Polaroid attendee={attendee} geometry={cardGeometry} spotlight />
          </div>
          <div className="led-wall-confetti" aria-hidden="true">
            {layout.confetti.map((piece, index) => (
              <span
                key={index}
                style={{
                  left: `${piece.x}%`,
                  width: `${piece.w}px`,
                  height: `${piece.h}px`,
                  background: piece.c,
                  ["--dx" as string]: `${piece.dx}px`,
                  ["--spin" as string]: `${piece.spin}deg`,
                  animationDuration: `${piece.dur}s`,
                  animationDelay: `${piece.d}s`,
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
