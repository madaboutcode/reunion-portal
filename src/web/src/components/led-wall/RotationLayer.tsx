import type { LayoutTree, PolaroidCard } from "./layout";
import { Polaroid } from "./Polaroid";
import type { PresentAttendee } from "./types";

interface RotationLayerProps {
  layout: LayoutTree;
  attendees: PresentAttendee[];
  visible: boolean;
  idle: boolean;
  showPanel: boolean;
}

/**
 * A card's `attendeeId` is set when `layout.ts` built it from the SAME `attendees` list
 * this layer is handed — under normal operation the id is always found here. If it
 * isn't, `layout` and `attendees` have desynced (a stale memo, a mismatched prop), and
 * the old code's positional fallback (`items[index % items.length]`) would silently
 * render a DIFFERENT, wrong person's name/photo under this card's geometry. Crash
 * instead — a wrong attendee on the wall is worse than a broken frame.
 */
function findAttendee(items: PresentAttendee[], card: PolaroidCard): PresentAttendee {
  const attendee = items.find((candidate) => candidate.id === card.attendeeId);
  if (!attendee) {
    throw new Error(
      `RotationLayer: card references attendee ${card.attendeeId}, who isn't in the current attendee list — layout and attendees have desynced`,
    );
  }
  return attendee;
}

export function RotationLayer({ layout, attendees, visible, idle, showPanel }: RotationLayerProps) {
  const { panel, branch, strip } = layout;
  return (
    <div className="led-wall-rotation-layer" aria-hidden={!visible}>
      <div
        className="led-wall-strip-field"
        style={{
          left: `${strip.x}px`,
          right: `${strip.right}px`,
          maskImage: `linear-gradient(90deg, transparent 0, #000 ${strip.fade}px, #000 calc(100% - ${strip.fadeR}px), transparent 100%)`,
          WebkitMaskImage: `linear-gradient(90deg, transparent 0, #000 ${strip.fade}px, #000 calc(100% - ${strip.fadeR}px), transparent 100%)`,
        }}
      >
        {layout.rows.map((row, rowIndex) => (
          <div
            key={`row-${rowIndex}`}
            className="led-wall-strip-row"
            style={{
              top: `${row.top}px`,
              gap: `${strip.gap}px`,
              animation: row.anim,
            }}
          >
            {row.items.map((card, cardIndex) => {
              const attendee = findAttendee(attendees, card);
              return (
                <div
                  key={`${rowIndex}-${cardIndex}-${attendee.id}`}
                  className="led-wall-card-float"
                  style={{
                    marginTop: `${card.marginTop}px`,
                    animationDuration: `${card.floatDur}s`,
                    animationDelay: `${card.floatDelay}s`,
                  }}
                >
                  <Polaroid attendee={attendee} geometry={card} />
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {showPanel && <div
        className="led-wall-panel"
        style={{
          left: `${panel.x}px`,
          top: `${panel.y}px`,
          width: `${panel.textW}px`,
          transform: `scale(${panel.scale})`,
        }}
      >
        <img
          className="led-wall-panel__logo"
          src="/assets/led-wall/smriti-logo.png"
          alt="Smriti"
          style={{ width: `${panel.logo}px`, height: `${panel.logo}px`, marginLeft: `${panel.logoX}px`, marginBottom: `${panel.logoGap}px` }}
        />
        <div className="led-wall-panel__title" style={{ fontSize: `${panel.title}px` }}>
          {idle ? "2006 BATCH REUNION" : branch.panelTitle}
        </div>
        <div className="led-wall-panel__eyebrow" style={{ marginTop: `${panel.gap1}px`, width: `${panel.ruleW}px` }}>
          <span>{idle ? "WAITING FOR ARRIVALS" : "2006 BATCH REUNION"}</span>
          <span className="led-wall-panel__rule" />
        </div>
        {!idle && (
          <>
            <div className="led-wall-panel__quote" style={{ marginTop: `${panel.gap2}px`, width: `${panel.quoteW}px`, fontSize: `${panel.quote}px`, transform: `rotate(${panel.qRot}deg) skewX(${panel.qSkew}deg)` }}>
              {branch.quote}
            </div>
            <svg className="led-wall-panel__swoosh" viewBox="0 0 230 34" style={{ width: `${panel.swooshW}px`, marginTop: `${panel.gap3}px`, opacity: panel.swooshOp }}>
              <path d="M3 27C58 6 138 3 226 13" />
            </svg>
          </>
        )}
      </div>}
    </div>
  );
}
