/**
 * Pure mm<->px conversion and the screen/layout y-flip.
 *
 * The printed card's coordinate origin is bottom-left, y increasing upward
 * (ReportLab/PDF convention — see idcards.py: elements are stored in mm from
 * that origin). The on-screen canvas is top-left, y increasing downward.
 * Every function here is a plain number-in, number-out transform; it knows
 * nothing about DOM elements, files, or HTTP.
 */

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number, got ${value}`);
  }
}

function assertPositiveScale(scale: number): void {
  assertFinite(scale, "scale");
  if (scale <= 0) {
    throw new Error(`scale must be > 0, got ${scale}`);
  }
}

/** Millimeters to on-screen pixels at the given scale (px per mm). */
export function mmToPx(mm: number, scale: number): number {
  assertFinite(mm, "mm");
  assertPositiveScale(scale);
  return mm * scale;
}

/** On-screen pixels to millimeters at the given scale (px per mm) — the exact inverse of mmToPx. */
export function pxToMm(px: number, scale: number): number {
  assertFinite(px, "px");
  assertPositiveScale(scale);
  return px / scale;
}

/**
 * Converts a screen-space y coordinate (px, measured from the top of the
 * canvas) into the stored layout y (mm, measured from the bottom of the
 * card) — the y-flip. screenY = 0 (top of canvas) maps to layoutY =
 * cardHeightMm (top of the card, the highest stored y); screenY at the
 * bottom of the canvas maps to layoutY = 0.
 */
export function screenYToLayoutY(screenY: number, cardHeightMm: number, scale: number): number {
  assertFinite(screenY, "screenY");
  assertFinite(cardHeightMm, "cardHeightMm");
  return cardHeightMm - pxToMm(screenY, scale);
}

/**
 * The change in stored layout y (mm) produced by dragging a screen-space
 * distance of deltaScreenPx px in the downward direction. Because of the
 * y-flip, dragging down (positive deltaScreenPx) DECREASES stored y.
 */
export function dragDeltaMmY(deltaScreenPx: number, scale: number): number {
  return -pxToMm(deltaScreenPx, scale);
}
