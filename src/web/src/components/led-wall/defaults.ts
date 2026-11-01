/**
 * LED wall — default parameters.
 *
 * The exact values of the mockup's `DEFAULTS` object. `LedWallParams` is the
 * single source of the parameter list; `ControlsPanel` is generated from it so
 * the panel cannot drift from the geometry engine.
 */
import type { LedWallParams } from "./types";

export const LED_WALL_COLORS = {
  plate: "#0b1826",
  cream: "#f7ecd6",
  coral: "#e0674a",
  aqua: "#9dd0cb",
} as const;

export const DEFAULT_PARAMS: LedWallParams = {
  preset: 0,
  wallW: 1120,
  wallH: 630,
  rows: 2,
  printScale: 0.84,
  speed: 26,
  stripX: 325,
  stripRight: 0,
  fade: 200,
  fadeR: 0,
  stripGap: 14,
  stripTopPad: 56,
  tilt: 0.9,
  tiltSpread: 5.5,
  tiltSeed: 3,
  dropJitter: 1,
  panelX: 32,
  panelY: 38,
  panelScale: 1.18,
  panelTextW: 340,
  logo: 78,
  logoX: 0,
  logoGap: 18,
  titleAdj: 1,
  eyebrow: 14.5,
  quoteSize: 33,
  quoteW: 318,
  qRot: -4.4,
  qSkew: -3,
  gap1: 6,
  gap2: 47,
  gap3: 0,
  ruleW: 322,
  swooshW: 270,
  swooshOp: 0.55,
  zoom: 0.8,
  bgX: -33,
  bgY: 23,
  dim: 42,
  bgOp: 88,
  feather: 52,
  vig: 18,
  blur: 0,
  decor: 2,
  sparkN: 78,
  emberN: 13,
  doodleOp: 0.9,
  doodleScale: 1,
  dwell: 22,
  outMs: 640,
  spotlightHold: 9500,
  guides: false,
};

export interface LedWallControlField {
  key: keyof LedWallParams;
  label: string;
  kind: "number" | "boolean";
  min?: number;
  max?: number;
  step?: number;
}

export interface LedWallControlSection {
  key: string;
  label: string;
  fields: LedWallControlField[];
}

/** The controls panel is generated from this list, not a second param model. */
export const LED_WALL_CONTROL_SECTIONS: LedWallControlSection[] = [
  {
    key: "wall",
    label: "Wall",
    fields: [
      { key: "preset", label: "Preset", kind: "number", min: 0, max: 5, step: 1 },
      { key: "wallW", label: "Design width", kind: "number", min: 600, max: 3000, step: 10 },
      { key: "wallH", label: "Design height", kind: "number", min: 360, max: 1600, step: 10 },
      { key: "guides", label: "Safe-area guides", kind: "boolean" },
    ],
  },
  {
    key: "backdrop",
    label: "Backdrop",
    fields: [
      { key: "zoom", label: "Zoom", kind: "number", min: 0.5, max: 2.4, step: 0.02 },
      { key: "bgX", label: "X offset", kind: "number", min: -60, max: 60, step: 1 },
      { key: "bgY", label: "Y offset", kind: "number", min: -60, max: 60, step: 1 },
      { key: "feather", label: "Edge feather", kind: "number", min: 20, max: 100, step: 1 },
      { key: "vig", label: "Vignette", kind: "number", min: 0, max: 90, step: 1 },
      { key: "bgOp", label: "Opacity", kind: "number", min: 20, max: 100, step: 1 },
      { key: "dim", label: "Dim ramp", kind: "number", min: 0, max: 90, step: 1 },
      { key: "blur", label: "Softness", kind: "number", min: 0, max: 8, step: 0.5 },
    ],
  },
  {
    key: "strips",
    label: "Film strips",
    fields: [
      { key: "rows", label: "Rows", kind: "number", min: 1, max: 3, step: 1 },
      { key: "printScale", label: "Print size", kind: "number", min: 0.5, max: 1.6, step: 0.02 },
      { key: "speed", label: "Drift speed", kind: "number", min: 8, max: 100, step: 1 },
      { key: "stripX", label: "Left edge", kind: "number", min: 0, max: 900, step: 5 },
      { key: "stripRight", label: "Right inset", kind: "number", min: 0, max: 400, step: 5 },
      { key: "fade", label: "Left fade", kind: "number", min: 0, max: 320, step: 4 },
      { key: "fadeR", label: "Right fade", kind: "number", min: 0, max: 320, step: 4 },
      { key: "stripGap", label: "Print gap", kind: "number", min: 8, max: 70, step: 1 },
      { key: "stripTopPad", label: "top inset", kind: "number", min: 0, max: 240, step: 4 },
      { key: "tilt", label: "Tilt amount", kind: "number", min: 0, max: 2.2, step: 0.05 },
      { key: "tiltSpread", label: "Tilt spread", kind: "number", min: 0, max: 16, step: 0.5 },
      { key: "tiltSeed", label: "Tilt seed", kind: "number", min: 0, max: 999, step: 1 },
      { key: "dropJitter", label: "Vertical jitter", kind: "number", min: 0, max: 3, step: 0.05 },
    ],
  },
  {
    key: "panel",
    label: "Left panel",
    fields: [
      { key: "panelX", label: "X", kind: "number", min: 0, max: 400, step: 2 },
      { key: "panelY", label: "Y", kind: "number", min: 0, max: 400, step: 2 },
      { key: "panelScale", label: "Scale", kind: "number", min: 0.5, max: 1.8, step: 0.02 },
      { key: "panelTextW", label: "Column width", kind: "number", min: 200, max: 620, step: 5 },
      { key: "logo", label: "Logo size", kind: "number", min: 0, max: 200, step: 2 },
      { key: "logoX", label: "Logo X", kind: "number", min: -60, max: 200, step: 2 },
      { key: "logoGap", label: "Logo gap", kind: "number", min: 0, max: 90, step: 1 },
      { key: "titleAdj", label: "Title size", kind: "number", min: 0.6, max: 1.6, step: 0.02 },
      { key: "eyebrow", label: "Eyebrow size", kind: "number", min: 9, max: 30, step: 0.5 },
      { key: "gap1", label: "Title to eyebrow", kind: "number", min: 0, max: 70, step: 1 },
      { key: "ruleW", label: "Eyebrow rule", kind: "number", min: 120, max: 560, step: 5 },
      { key: "quoteSize", label: "Quote size", kind: "number", min: 16, max: 60, step: 1 },
      { key: "quoteW", label: "Quote width", kind: "number", min: 160, max: 560, step: 5 },
      { key: "qRot", label: "Quote tilt", kind: "number", min: -12, max: 12, step: 0.2 },
      { key: "qSkew", label: "Quote slant", kind: "number", min: -18, max: 18, step: 0.5 },
      { key: "gap2", label: "Eyebrow to quote", kind: "number", min: 0, max: 80, step: 1 },
      { key: "gap3", label: "Quote to swoosh", kind: "number", min: 0, max: 80, step: 1 },
      { key: "swooshW", label: "Swoosh width", kind: "number", min: 0, max: 460, step: 5 },
      { key: "swooshOp", label: "Swoosh opacity", kind: "number", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    key: "decor",
    label: "Decoration",
    fields: [
      { key: "decor", label: "Decoration mode", kind: "number", min: 0, max: 2, step: 1 },
      { key: "sparkN", label: "Dust specks", kind: "number", min: 0, max: 160, step: 2 },
      { key: "emberN", label: "Embers", kind: "number", min: 0, max: 40, step: 1 },
      { key: "doodleOp", label: "Doodle opacity", kind: "number", min: 0, max: 1, step: 0.05 },
      { key: "doodleScale", label: "Doodle size", kind: "number", min: 0.4, max: 2.2, step: 0.05 },
    ],
  },
  {
    key: "timing",
    label: "Timing",
    fields: [
      { key: "dwell", label: "Branch dwell", kind: "number", min: 6, max: 60, step: 1 },
      { key: "outMs", label: "Shift duration", kind: "number", min: 200, max: 1600, step: 20 },
      { key: "spotlightHold", label: "Spotlight hold", kind: "number", min: 1000, max: 30000, step: 500 },
    ],
  },
];
