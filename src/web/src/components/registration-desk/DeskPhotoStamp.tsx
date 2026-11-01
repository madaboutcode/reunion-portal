export interface DeskPhotoStampProps {
  /**
   * Play the press-down animation (a live check-in just happened). When false,
   * the stamp renders at its settled final frame with no animation — used when
   * reopening an already-present attendee, and in the search-result list.
   */
  animate?: boolean;
  testId?: string;
}

/**
 * Rubber-stamp overlay for an attendee record (registration-desk check-in).
 *
 * The stamp art is painted through a CSS mask, not shown as an <img>: the ink
 * is a flat `background-color` and the chosen "attendance-stamp-0N.webp" alpha
 * masks it, so one asset recolours to any ink by changing the colour alone.
 *
 * Absolutely positioned against its nearest positioned ancestor and painted on
 * top by source order, so it can cover just a photo OR spill across the photo
 * and adjacent content (name, pills) — put it as the last child of whatever box
 * you want it to roam over, and give that box `relative`. Where the anchor clips
 * (the compact result-card photo), the stamp is confined to it.
 *
 * It presses down (scale + settle) when `animate`, and shows a static inked mark
 * otherwise — the glanceable "this person is present" cue.
 *
 * Geometry, mask and ink all come from CSS custom properties with baked-in
 * fallbacks, so nothing here needs tuning props: the /debug desk-checkin panel
 * sets these on an ancestor to choose stamp/colour/placement live, then we fold
 * the choices into the fallbacks in index.css.
 *   --stamp-src   mask image, e.g. url("/assets/desk/attendance-stamp-03.webp")
 *   --stamp-ink   ink colour (background-color)
 *   --stamp-w     width, % of the anchor
 *   --stamp-x  --stamp-y   nudge from centre, % of the anchor (w/h)
 *   --stamp-rotate   tilt
 *   --stamp-opacity  ink strength at rest
 *
 * Decorative for assistive tech (aria-hidden): a "Present" status pill already
 * carries the same fact, so the stamp must not double-announce it.
 */
export function DeskPhotoStamp({ animate = false, testId }: DeskPhotoStampProps) {
  return (
    <div className="desk-photo-stamp pointer-events-none" aria-hidden="true">
      <div
        data-testid={testId}
        data-animate={animate ? "on" : "off"}
        className={`desk-photo-stamp__ink ${animate ? "is-animate" : "is-static"}`}
      />
    </div>
  );
}
