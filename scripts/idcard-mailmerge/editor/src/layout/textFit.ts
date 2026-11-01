/**
 * Browser-only text auto-fit for the canvas preview — mirrors idcards.py's
 * _fit_text loop (shrink from max toward min until the text's measured
 * width fits), so the on-screen approximation (R6.2) doesn't visibly
 * overflow its box the way a fixed max-size render would. Not exact (canvas
 * measureText vs. ReportLab's font metrics differ slightly) — that's the
 * approximation R6.2 explicitly allows.
 */

let sharedCtx: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D {
  if (sharedCtx) return sharedCtx;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("textFit: 2d canvas context unavailable");
  sharedCtx = ctx;
  return ctx;
}

function measuredWidthPx(ctx: CanvasRenderingContext2D, text: string, fontFamily: string, sizePx: number, letterSpacingPx: number): number {
  ctx.font = `${sizePx}px ${fontFamily}`;
  // ReportLab's stringWidth (idcards.py) has no font-level kerning pair
  // adjustment — match that here, or the fit decision (and the width used
  // to center the text) diverges from what the PDF actually draws.
  ctx.fontKerning = "none";
  const base = ctx.measureText(text).width;
  return base + Math.max(0, text.length - 1) * letterSpacingPx;
}

/** Pure stepping algorithm behind fitFontSizePx, split out so it's
 * unit-testable without a real canvas: shrink from maxSizePx toward
 * minSizePx in stepPx increments until widthAtSize(size) <= maxWidthPx. */
export function fitSize(maxSizePx: number, minSizePx: number, maxWidthPx: number, stepPx: number, widthAtSize: (sizePx: number) => number): number {
  if (maxWidthPx <= 0 || maxSizePx <= minSizePx) return maxSizePx;
  let size = maxSizePx;
  while (size > minSizePx) {
    if (widthAtSize(size) <= maxWidthPx) break;
    size -= stepPx;
  }
  return Math.max(size, minSizePx);
}

/** Returns the largest size in [minSizePx, maxSizePx] at which text fits
 * maxWidthPx, stepping down in stepPx increments — pass the px-equivalent
 * of idcards.py's 0.1pt _fit_text step so the two loops land on the same
 * rung instead of a coarser approximation drifting off by half a step. */
export function fitFontSizePx(text: string, fontFamily: string, maxSizePx: number, minSizePx: number, maxWidthPx: number, letterSpacingPx = 0, stepPx = 0.5): number {
  if (text.length === 0) return maxSizePx;
  const ctx = getMeasureContext();
  return fitSize(maxSizePx, minSizePx, maxWidthPx, stepPx, (size) => measuredWidthPx(ctx, text, fontFamily, size, letterSpacingPx));
}
