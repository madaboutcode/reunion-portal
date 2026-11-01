/**
 * LED wall — data types.
 *
 * Pure data shapes only: no React, no I/O. The geometry engine (`layout.ts`)
 * and the data-source boundary consume these.
 */

/** A checked-in attendee as delivered by the LED wall's data source. */
export interface PresentAttendee {
  /** The registration id. */
  id: number;
  /** The attendee's display name. */
  fullName: string;
  /** Canonical branch name — one of the `Branch` values from `@smriti/shared`. */
  branch: string;
  /** Transparent portrait URL, or `null` when the attendee has none (initials fallback). */
  portraitUrl: string | null;
  /** Fallback thumbnail (JPEG, has a background) shown when no transparent
   *  cutout exists — e.g. a desk walk-in. `null` when the attendee has no
   *  photo at all (initials fallback). */
  thumbnailUrl: string | null;
  /** Epoch milliseconds the attendee was marked present. */
  checkedInAt: number;
}

/**
 * The pluggable boundary between the wall and its data. The milestone-1 dummy
 * source and a future live check-in stream both implement this contract.
 */
export interface LedWallDataSource {
  /** All currently-present attendees, in a stable order. */
  getSnapshot(): Promise<PresentAttendee[]>;
  /** Register an arrival callback; returns an unsubscribe function. */
  subscribe(onArrival: (a: PresentAttendee) => void): () => void;
  /** Optional. Fires when the source knows its snapshot is stale (e.g. a
   *  check-in was undone) and the wall should re-sync now rather than wait
   *  for its timer. Sources without removals omit it. */
  subscribeResync?(onResyncNeeded: () => void): () => void;
}

/**
 * Tunable parameters — a field for every key in the mockup's `DEFAULTS`
 * object. `defaults.ts` holds the exact default values; the ControlsPanel is
 * generated from the same list so the panel cannot drift from the params.
 */
export interface LedWallParams {
  /** Display preset index (0 = 16:9). */
  preset: number;
  /** Design-time wall width in px — runtime layout derives from the viewport instead. */
  wallW: number;
  /** Design-time wall height in px. */
  wallH: number;

  /** Number of film strips (1–3). */
  rows: number;
  /** Multiplier on the base polaroid width. */
  printScale: number;
  /** Strip drift speed in px/s — higher scrolls faster. */
  speed: number;
  /** Left edge of the strip area, px. */
  stripX: number;
  /** Right inset of the strip area, px. */
  stripRight: number;
  /** Width of the left edge fade, px. */
  fade: number;
  /** Width of the right edge fade, px. */
  fadeR: number;
  /** Horizontal gap between cards in a strip, px. */
  stripGap: number;
  /** Top inset of the first film strip, px. */
  stripTopPad: number;

  /** Multiplier on card tilt. */
  tilt: number;
  /** Random tilt spread, ±deg. */
  tiltSpread: number;
  /** Seed for the deterministic tilt hash — bump to reshuffle. */
  tiltSeed: number;
  /** Multiplier on vertical card jitter. */
  dropJitter: number;

  /** Left panel x, px. */
  panelX: number;
  /** Left panel y, px. */
  panelY: number;
  /** Panel scale multiplier. */
  panelScale: number;
  /** Panel text column width, px. */
  panelTextW: number;
  /** Logo size, px. */
  logo: number;
  /** Logo left offset, px. */
  logoX: number;
  /** Gap below the logo, px. */
  logoGap: number;
  /** Multiplier on the computed panel title size. */
  titleAdj: number;
  /** "2006 BATCH REUNION" eyebrow font size, px. */
  eyebrow: number;
  /** Quote font size, px. */
  quoteSize: number;
  /** Quote block width, px. */
  quoteW: number;
  /** Quote rotation, deg. */
  qRot: number;
  /** Quote skew, deg. */
  qSkew: number;
  /** Gap between title and eyebrow, px. */
  gap1: number;
  /** Gap between eyebrow and quote, px. */
  gap2: number;
  /** Gap between quote and swoosh, px. */
  gap3: number;
  /** Eyebrow rule width, px. */
  ruleW: number;
  /** Swoosh SVG width, px. */
  swooshW: number;
  /** Swoosh opacity. */
  swooshOp: number;

  /** Backdrop image zoom. */
  zoom: number;
  /** Backdrop horizontal offset, %. */
  bgX: number;
  /** Backdrop vertical offset, %. */
  bgY: number;
  /** Dim-ramp strength, 0–90. */
  dim: number;
  /** Backdrop image opacity, 0–100. */
  bgOp: number;
  /** Backdrop edge feather, %. */
  feather: number;
  /** Vignette strength, 0–90. */
  vig: number;
  /** Backdrop blur, px. */
  blur: number;

  /** Decoration mode: 0 off, 1 ambient, 2 graphic. */
  decor: number;
  /** Number of dust specks. */
  sparkN: number;
  /** Number of rising embers. */
  emberN: number;
  /** Doodle opacity. */
  doodleOp: number;
  /** Doodle size multiplier. */
  doodleScale: number;

  /** Branch dwell time, s. */
  dwell: number;
  /** Shift-transition duration, ms. */
  outMs: number;
  /** Spotlight hold duration, ms. */
  spotlightHold: number;
  /** Show the safe-area guide overlay. */
  guides: boolean;
}
