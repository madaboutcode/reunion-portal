/**
 * LED wall — pure geometry engine.
 *
 * Port of the mockup's `renderVals()` + `cards()` into a pure function:
 * viewport + params + branch + present attendees → the full geometry tree the
 * render layers draw. No React, no I/O, no DOM.
 *
 * GUARANTEES:
 * - Deterministic: identical inputs → deeply-equal output (all per-card
 *   variation comes from the `rnd`/`scatter` hash helpers, not Math.random).
 * - No NaN and no negative sizes anywhere in the output tree.
 * - Card photo heights are clamped to the available row height (the mockup's
 *   `maxPhoto` / `Math.max(60, ...)` logic).
 * - Empty attendees → empty rows, no crash.
 *
 * EXPECTS: a non-empty viewport; params within the ControlsPanel slider ranges.
 *
 * Known divergences from the mockup (deliberate):
 * - Mockup `.toFixed(2)` CSS-formatted strings are plain numbers here — the
 *   render layer formats for CSS.
 * - `view`, `guide`, `ui`, `sections`, refs, and the shift-animation state are
 *   shell concerns, not geometry — omitted.
 * - Confetti is always emitted (46 pieces); the shell renders it only during
 *   spotlight mode.
 */
import { getBranchInfo } from "./branchCatalog";
import type { BranchInfo } from "./branchCatalog";
import type { LedWallParams, PresentAttendee } from "./types";

// ── deterministic hash helpers (ported from the mockup) ──────────────────────

/** Deterministic hash → 0..1 for the given integer pair. Same (a, b) always gives the same value. */
export const rnd = (a: number, b: number): number => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Deterministic scatter in [0, span], 0.1-granular. */
export const scatter = (i: number, span: number): number =>
  Math.round((((i * 7919) % 1000) / 1000) * span * 10) / 10;

// ── per-card look arrays (indexed by a deterministic pseudo-index `k`) ───────

/** Photo-area gradient behind a missing portrait. */
const BG = [
  "linear-gradient(150deg,#40525e,#202b33)",
  "linear-gradient(160deg,#4e4438,#26201a)",
  "linear-gradient(140deg,#35474c,#1d282c)",
  "linear-gradient(150deg,#50424a,#261f24)",
  "linear-gradient(165deg,#3b4a5e,#1e2733)",
  "linear-gradient(145deg,#46534b,#212a26)",
];

/** Polaroid paper gradients. */
const PAPER = [
  "linear-gradient(155deg,#f2e7cf,#d9c9a6)",
  "linear-gradient(160deg,#efe0c2,#cdba95)",
  "linear-gradient(150deg,#f4ecd8,#ddcdac)",
  "linear-gradient(165deg,#eadcbe,#c9b691)",
];

const WIDTHS = [200, 226, 208, 232, 196, 216, 228, 204, 220];
const CROPS = [0.72, 0.86, 0.68, 0.8, 0.9, 0.74, 0.82, 0.7, 0.88];
const TILT = [-2.8, 1.9, -1.2, 3.0, -2.1, 1.3, -3.3, 2.4, -0.7];
const OFFSET = [0, 14, -8, 6, 16, -4, 10, -10, 4];
const CONF = ["#f2e7cf", "#e0674a", "#9dd0cb", "#f7d9a8", "#e0674a", "#bde7e4"];

// ── output shapes ────────────────────────────────────────────────────────────

export interface WallDims {
  /** Wall width in px — the viewport width, clamped to a 600px floor. */
  w: number;
  /** Wall height in px — the viewport height, clamped to a 360px floor. */
  h: number;
}

export interface BackdropValues {
  zoom: number;
  /** Horizontal offset, % — may be negative. */
  x: number;
  /** Vertical offset, % — may be negative. */
  y: number;
  /** Image opacity, 0..1. */
  op: number;
  /** Edge feather, %. */
  feather: number;
  /** Feather falloff midpoint, %. */
  feather2: number;
  /** Vignette strength, 0..1. */
  vig: number;
  /** Blur, px. */
  blur: number;
  /** Left dim-ramp alpha, 0..1. */
  dimL: number;
  /** Mid dim-ramp alpha, 0..1. */
  dimM: number;
  /** Right dim-ramp alpha, 0..1. */
  dimR: number;
}

export interface StripConfig {
  /** Left edge of the strip area, px. */
  x: number;
  /** Right inset of the strip area, px. */
  right: number;
  /** Left edge fade width, px. */
  fade: number;
  /** Right edge fade width, px. */
  fadeR: number;
  /** Horizontal gap between cards, px. */
  gap: number;
}

export interface PanelConfig {
  x: number;
  y: number;
  textW: number;
  scale: number;
  logo: number;
  /** Logo left offset, px — may be negative. */
  logoX: number;
  logoGap: number;
  /** Computed panel-title font size, px. */
  title: number;
  eyebrow: number;
  quote: number;
  quoteW: number;
  /** Quote rotation, deg — may be negative. */
  qRot: number;
  /** Quote skew, deg — may be negative. */
  qSkew: number;
  gap1: number;
  gap2: number;
  gap3: number;
  ruleW: number;
  swooshW: number;
  swooshOp: number;
}

export interface BranchLabel {
  panelTitle: string;
  short: string;
  quote: string;
}

/** One tilted polaroid card in a film strip. */
export interface PolaroidCard {
  /** Registration id of the attendee the card shows — the renderer loads its portrait. */
  attendeeId: number;
  name: string;
  /** Initials fallback text for a missing portrait. */
  ini: string;
  /** Card width, px. */
  width: number;
  /** Top/bottom mat padding, px. */
  mat: number;
  /** Bottom mat padding, px. */
  matBottom: number;
  /** Caption top padding, px. */
  capPad: number;
  /** Photo area height, px — clamped to the available row height. */
  photoHeight: number;
  /** Card tilt, deg — may be negative. */
  rotation: number;
  /** Vertical offset within the row, px — may be negative (the mockup lets cards float above the strip). */
  marginTop: number;
  /** Paper gradient. */
  paper: string;
  /** Photo-area placeholder gradient (initials fallback). */
  bg: string;
  /** Soft-light veil strength, 0..1. */
  veil: number;
  /** Tape left offset, px. */
  tapeX: number;
  /** Tape width, px. */
  tapeW: number;
  /** Tape rotation, deg — may be negative. */
  tapeR: number;
  /** Tape opacity — 0 hides the tape. */
  tapeOp: number;
  /** Initials font size, px. */
  initialsSize: number;
  /** Name caption font size, px. */
  nameSize: number;
  /** Branch-short caption font size, px. */
  subSize: number;
  /** Branch-short caption value. */
  branchShort: string;
  /** Floaty-bob animation duration, s. */
  floatDur: number;
  /** Floaty-bob animation delay, s. */
  floatDelay: number;
}

export interface PolaroidRow {
  /** Top edge of the strip within the wall, px. */
  top: number;
  /** Drift animation shorthand, e.g. "driftL 42s linear infinite". */
  anim: string;
  /** One horizontal drift pass, s. */
  duration: number;
  /** Two identical halves, each wide enough for a seamless loop. */
  items: PolaroidCard[];
}

export interface SpotlightGeometry {
  textX: number;
  textY: number;
  textW: number;
  eyebrow: number;
  name: number;
  meta: number;
  quote: number;
  cardX: number;
  cardY: number;
  cardW: number;
  mat: number;
  matB: number;
  photoH: number;
  capPad: number;
  ini: number;
  capName: number;
  capMeta: number;
  tapeX: number;
  tapeW: number;
}

export interface ConfettiPiece {
  /** Horizontal start, % of wall width. */
  x: number;
  /** Width, px. */
  w: number;
  /** Height, px. */
  h: number;
  /** Color. */
  c: string;
  /** Horizontal drift, px — may be negative. */
  dx: number;
  /** Total rotation over the fall, deg. */
  spin: number;
  /** Fall duration, s. */
  dur: number;
  /** Delay, s. */
  d: number;
}

export interface AmbientSpark {
  x: number;
  y: number;
  r: number;
  c: string;
  dur: number;
  d: number;
}

export interface AmbientEmber {
  x: number;
  b: number;
  r: number;
  dur: number;
  d: number;
}

export interface DoodleSparkle {
  href: string;
  x: number;
  y: number;
  s: number;
  fill: string;
  op: number;
  dur: number;
  delay: number;
}

export interface DoodleArrow {
  d: string;
  w: number;
  dashes: string;
  op: number;
  dur: number;
}

export interface DoodleRule {
  d: string;
  stroke: string;
  w: number;
  op: number;
}

export interface Decor {
  sparks: AmbientSpark[];
  embers: AmbientEmber[];
  sparkles: DoodleSparkle[];
  arrows: DoodleArrow[];
  rules: DoodleRule[];
  graphicOp: number;
}

export interface LayoutTree {
  wall: WallDims;
  backdrop: BackdropValues;
  strip: StripConfig;
  panel: PanelConfig;
  branch: BranchLabel;
  rows: PolaroidRow[];
  spot: SpotlightGeometry;
  confetti: ConfettiPiece[];
  decor: Decor;
}

/** First letters of the first two words, e.g. "Ravi Kumar" → "RK". */
function initials(fullName: string): string {
  return fullName
    .split(" ")
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("");
}

/**
 * Build the cards of one film strip.
 *
 * `k` is the mockup's deterministic pseudo-index (`i + rowIdx * 5 + bi * 5`)
 * minus the branch term — the branch already decides which attendees appear,
 * so the branch offset would only reshuffle geometry within one branch.
 */
function buildCards(
  rowIdx: number,
  base: number,
  rowH: number,
  padY: number,
  params: LedWallParams,
  attendees: PresentAttendee[],
): PolaroidCard[] {
  // allowance also covers the floaty bob (-6px peak) and rotation's
  // bounding-box growth
  const minMt = (rowIdx === 0 ? -(padY - 4) : -(params.stripGap - 4)) + 10;
  return attendees.map((attendee, i) => {
    const k = i + rowIdx * 5;
    const width = Math.max(
      1,
      Math.min(Math.round((WIDTHS[k % WIDTHS.length] / 214) * base), rowH / 1.24),
    );
    const paddingBudget = Math.max(0, (rowH - 1) / 3);
    const mat = Math.min(Math.round(width * 0.05), paddingBudget);
    const matBottom = Math.min(Math.round(width * 0.045), paddingBudget);
    const capPad = Math.min(Math.round(width * 0.05), paddingBudget);
    const nameSize = Math.round(width * 0.118);
    const subSize = Math.max(9, Math.round(width * 0.049));
    const captionBudget = nameSize * 1.05 + 3 + subSize * 1.2;
    const maxPhoto = Math.max(0, rowH - mat - matBottom - capPad - captionBudget);
    return {
      attendeeId: attendee.id,
      name: attendee.fullName,
      ini: initials(attendee.fullName),
      width,
      mat,
      matBottom,
      capPad,
      photoHeight: Math.max(0, Math.min(width * CROPS[k % CROPS.length], maxPhoto)),
      rotation:
        ((rnd(k + 1, params.tiltSeed) - 0.5) * 2 * params.tiltSpread +
          TILT[k % TILT.length] * 0.3) *
        params.tilt,
      marginTop: Math.max(
        minMt,
        Math.round(
          (OFFSET[k % OFFSET.length] * (rowH / 290) +
            (rnd(k + 7, params.tiltSeed + 3) - 0.5) * 36) *
            params.dropJitter,
        ),
      ),
      paper: PAPER[k % PAPER.length],
      bg: BG[k % BG.length],
      veil: 0.1 + ((k * 7) % 5) * 0.045,
      tapeOp: k % 3 === 1 ? 0 : 0.5 + (k % 3) * 0.18,
      tapeX: 14 + (k % 4) * 24,
      tapeW: 46 + (k % 3) * 16,
      tapeR: (k % 2 ? -6 : 7) + (k % 3),
      initialsSize: Math.round(width * 0.25),
      subSize,
      branchShort: getBranchInfo(attendee.branch).short,
      nameSize,
      floatDelay: scatter(k, 9),
      floatDur: 7 + (k % 4),
    };
  });
}

/**
 * Compute the full geometry tree for one wall frame.
 *
 * The wall IS the window (mockup comment): it fills whatever viewport it is
 * given, with a 600×360 floor — no aspect ratio to choose, the layout adapts
 * to whatever shape the display hands us.
 */
export function computeLayout(
  params: LedWallParams,
  viewport: { w: number; h: number },
  branch: BranchInfo,
  attendees: PresentAttendee[],
): LayoutTree {
  const W = Math.max(600, viewport.w);
  const H = Math.max(360, viewport.h);
  const rowCount = Math.max(1, Math.floor(params.rows));

  const padY = Math.round(H * 0.035);
  const stripTopPad = Math.max(0, params.stripTopPad);
  // Guard: keep rowH positive even for out-of-range params (the controls bound
  // rows ≤ 3 and stripGap ≤ 70, but the guarantee "no negative sizes" holds
  // regardless).
  const rowH = Math.max(
    1,
    (H - stripTopPad - padY - params.stripGap * (rowCount - 1)) / rowCount,
  );
  const base = Math.max(0, Math.min(rowH / 1.24, 250) * params.printScale);

  const rows: PolaroidRow[] = Array.from({ length: rowCount }, (_, i) => {
    const half = buildCards(i, base, rowH, padY, params, attendees);
    const halfWidth = half.reduce((sum, card) => sum + card.width + params.stripGap, 0);
    const repeatCount = half.length === 0 ? 0 : Math.max(1, Math.ceil(W / Math.max(1, halfWidth)));
    const repeatedHalf = Array.from({ length: repeatCount }, () => half).flat();
    const items = repeatedHalf.concat(repeatedHalf);
    const duration = Math.max(
      8,
      Math.round(
        repeatedHalf.reduce((s, c) => s + c.width + params.stripGap, 0) /
          Math.max(1, params.speed),
      ),
    );
    return {
      top: Math.round(stripTopPad + i * (rowH + params.stripGap)),
      anim: (i % 2 ? "driftR " : "driftL ") + duration + "s linear infinite",
      duration,
      items,
    };
  });

  const dim = params.dim / 100;
  const longest = branch.panelTitle
    .toUpperCase()
    .split(/\s+/)
    .reduce((m, w) => Math.max(m, w.length), 1);

  const cardW = Math.round(Math.min(H * 0.72, W * 0.32));
  const panel: PanelConfig = {
    x: params.panelX,
    y: params.panelY,
    textW: params.panelTextW,
    scale: params.panelScale,
    logo: params.logo,
    logoX: params.logoX,
    logoGap: params.logoGap,
    title: Math.max(
      20,
      Math.round(
        Math.min(58, (params.panelTextW * 0.95) / (longest * 0.685)) *
          params.titleAdj,
      ),
    ),
    eyebrow: params.eyebrow,
    quote: params.quoteSize,
    quoteW: params.quoteW,
    qRot: params.qRot,
    qSkew: params.qSkew,
    gap1: params.gap1,
    gap2: params.gap2,
    gap3: params.gap3,
    ruleW: params.ruleW,
    swooshW: params.swooshW,
    swooshOp: params.swooshOp,
  };
  let titleLines = 1;
  let titleLineWidth = 0;
  for (const word of branch.panelTitle.toUpperCase().split(/\s+/)) {
    const wordWidth = word.length * panel.title * 0.685;
    if (titleLineWidth > 0 && titleLineWidth + wordWidth > panel.textW) {
      titleLines += 1;
      titleLineWidth = wordWidth;
    } else {
      titleLineWidth += wordWidth;
    }
  }
  const tbb =
    panel.y +
    (panel.logo +
      panel.logoGap +
      panel.title * titleLines +
      panel.gap1 +
      panel.eyebrow +
      panel.gap2 +
      panel.quote +
      panel.gap3) *
      panel.scale;
  const swB = tbb + 34 * panel.scale;
  const typeBlock = {
    x: panel.x,
    y: panel.y,
    r: panel.x + panel.textW * panel.scale,
    b: swB,
  };
  const doodleScale = Math.max(0, params.doodleScale);
  const safeX = params.stripX + params.fade * 0.2;
  const decor: Decor = {
    sparks:
      params.decor === 0
        ? []
        : Array.from({ length: Math.max(0, Math.floor(params.sparkN)) }, (_, i) => ({
            x: Math.round(((i * 4637) % 1000) / 10),
            y: Math.round(((i * 8191) % 1000) / 10),
            r: 1 + ((i * 7) % 3),
            c: i % 5 === 0 ? "#f0a07c" : "#dfe9e6",
            dur: 4 + ((i * 3) % 5),
            d: scatter(i, 6),
          })),
    embers:
      params.decor === 0
        ? []
        : Array.from({ length: Math.max(0, Math.floor(params.emberN)) }, (_, i) => ({
            x: 3 + (i * 4) % 34,
            b: 4 + (i % 5) * 6,
            r: 2 + (i % 2),
            dur: 11 + (i % 5) * 3,
            d: scatter(i, 12),
          })),
    sparkles:
      params.decor !== 2
        ? []
        : (() => {
            const output: DoodleSparkle[] = [];
            const put = (x: number, y: number, size: number, solid: boolean, index: number) => {
              const radius = 30 * size * doodleScale;
              output.push({
                href: solid ? "#spark" : "#spark-o",
                x: Math.round(Math.min(W - radius, Math.max(radius, x))),
                y: Math.round(Math.min(H - radius, Math.max(radius, y))),
                s: size * doodleScale,
                fill: solid ? (index % 2 === 1 ? "#f7d9a8" : "#e0674a") : "none",
                op: 0.6 + (index % 3) * 0.13,
                dur: 5 + (index % 4) * 2,
                delay: scatter(index, 6),
              });
            };
            const SPEC: readonly [number, number, number, boolean][] = [
              [0.07, 0.14, 0.52, false], [0.15, 0.86, 0.62, true],
              [0.28, 0.34, 0.30, true], [0.38, 0.92, 0.44, true],
              [0.44, 0.09, 1.05, true], [0.52, 0.55, 0.38, false],
              [0.58, 0.86, 0.56, true], [0.66, 0.20, 0.72, false],
              [0.73, 0.68, 0.34, true], [0.80, 0.40, 0.90, true],
              [0.88, 0.12, 0.46, false], [0.93, 0.78, 0.64, true],
              [0.34, 0.62, 0.26, true], [0.62, 0.44, 0.24, false],
            ];
            SPEC.forEach(([xRatio, yRatio, size, solid], index) => {
              const x = W * xRatio;
              const y = H * yRatio;
              const radius = 30 * size * doodleScale + 14;
              if (
                x + radius < typeBlock.x || x - radius > typeBlock.r ||
                y + radius < typeBlock.y || y - radius > typeBlock.b
              ) put(x, y, size, solid, index);
            });
            return output;
          })(),
    arrows:
      params.decor !== 2
        ? []
        : (() => {
            const output: DoodleArrow[] = [];
            const sweep = (
              x0: number, y0: number, x1: number, y1: number,
              lift: number, width: number, op: number, dur: number,
            ) => {
              const span = x1 - x0;
              if (span < 140) return;
              output.push({
                d: `M${Math.round(x0)} ${Math.round(y0)}` +
                  `C${Math.round(x0 + span * 0.32)} ${Math.round(y0 - lift)}` +
                  ` ${Math.round(x1 - span * 0.3)} ${Math.round(y1 - lift * 1.1)}` +
                  ` ${Math.round(x1)} ${Math.round(y1)}`,
                w: width, dashes: "11 9", op, dur,
              });
            };
            const base = swB + 12;
            if (H - base > 34) {
              const yEnd = base + (H - base) * 0.3;
              sweep(typeBlock.x + 30, base + (H - base) * 0.58, safeX, yEnd,
                Math.min(40, (yEnd - base) * 0.85), 3, 0.8, 5);
            }
            sweep(W * 0.6, H * 0.14, W * 0.88, H * 0.3, 40, 2.4, 0.5, 8);
            return output;
          })(),
    rules:
      params.decor !== 2 || H - swB <= 26
        ? []
        : [{
            d: `M${Math.round(typeBlock.x)} ${Math.round(swB + 14)}h${Math.round(Math.min(132, typeBlock.r - typeBlock.x))}`,
            stroke: "#e0674a", w: 2, op: 0.4,
          }],
    graphicOp: params.decor === 2 ? params.doodleOp : 0,
  };

  return {
    wall: { w: W, h: H },
    backdrop: {
      zoom: params.zoom,
      x: params.bgX,
      y: params.bgY,
      op: params.bgOp / 100,
      feather: params.feather,
      feather2: Math.round(params.feather + (100 - params.feather) * 0.55),
      vig: params.vig / 100,
      blur: params.blur,
      dimL: Math.min(1, dim + 0.3),
      dimM: dim,
      dimR: dim * 0.7,
    },
    strip: {
      x: params.stripX,
      right: params.stripRight,
      fade: params.fade,
      fadeR: params.fadeR,
      gap: params.stripGap,
    },
    panel,
    branch: {
      panelTitle: branch.panelTitle,
      short: branch.short,
      quote: branch.quote,
    },
    rows,
    spot: {
      textX: Math.round(W * 0.055),
      textY: Math.round(H * 0.1),
      textW: Math.round(W * 0.44),
      eyebrow: Math.max(13, Math.round(H * 0.028)),
      name: Math.round(H * 0.115),
      meta: Math.max(12, Math.round(H * 0.03)),
      quote: Math.round(H * 0.062),
      cardX: Math.round(W * 0.6),
      cardY: Math.round(H * 0.1),
      cardW,
      mat: Math.round(cardW * 0.055),
      matB: Math.round(cardW * 0.05),
      photoH: Math.round(cardW * 1.02),
      capPad: Math.round(cardW * 0.05),
      ini: Math.round(cardW * 0.3),
      capName: Math.round(cardW * 0.13),
      capMeta: Math.max(10, Math.round(cardW * 0.045)),
      tapeX: Math.round(cardW * 0.42),
      tapeW: Math.round(cardW * 0.34),
    },
    confetti: Array.from({ length: 46 }, (_, i) => ({
      x: Math.round(((i * 3931) % 1000) / 10),
      w: 7 + (i % 3) * 4,
      h: 11 + (i % 4) * 5,
      c: CONF[i % CONF.length],
      dx: Math.round((rnd(i + 2, 9) - 0.5) * 160),
      spin: Math.round(360 + rnd(i + 5, 3) * 900),
      dur: 2.6 + rnd(i + 1, 7) * 1.8,
      d: rnd(i + 3, 11) * 1.6,
    })),
    decor,
  };
}
