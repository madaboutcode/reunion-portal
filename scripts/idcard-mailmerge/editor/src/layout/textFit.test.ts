import { describe, expect, it } from "vitest";
import { fitSize } from "./textFit";

/**
 * fitSize is the pure stepping algorithm behind fitFontSizePx, factored out
 * so it's testable without a real canvas (this project's vitest environment
 * is "node" — no DOM, no canvas.getContext). fitFontSizePx itself (the
 * canvas-measuring wrapper, including the fontKerning:"none" fix) is proven
 * against the real editor render instead — see tmp/textfit-spike/.
 */
describe("fitSize", () => {
  it("returns maxSizePx untouched for a degenerate range or a non-positive max width", () => {
    expect(fitSize(20, 10, 0, 0.5, () => 999)).toBe(20);
    expect(fitSize(10, 10, 100, 0.5, () => 999)).toBe(10); // maxSizePx <= minSizePx
  });

  it("shrinks in stepPx increments until widthAtSize(size) fits maxWidthPx", () => {
    const widthAtSize = (size: number) => size * 2; // linear stand-in for a real font's metrics
    // true fit threshold is size <= 12.5 (width 25); stepping by 1 from 20
    // lands on 12 (width 24, first size where width <= 25 on that rung).
    expect(fitSize(20, 10, 25, 1, widthAtSize)).toBe(12);
  });

  it("a finer step lands closer to the true threshold than a coarser one", () => {
    // This is the bug in Table B of the font-metrics spike: idcards.py's
    // _fit_text steps by 0.1pt; the old fitFontSizePx stepped by a flat
    // 0.5px (~0.2pt-equivalent at 7px/mm), landing on the wrong rung and
    // producing a visibly different fitted size/width than the PDF.
    const widthAtSize = (size: number) => size * 2; // threshold at size = 12.5
    const coarse = fitSize(20, 10, 25, 1, widthAtSize);
    const fine = fitSize(20, 10, 25, 0.1, widthAtSize);
    expect(coarse).toBe(12);
    expect(fine).toBeCloseTo(12.5, 5);
    expect(fine).toBeGreaterThan(coarse);
  });

  it("clamps at minSizePx even when the text never fits", () => {
    const alwaysTooWide = () => 1000;
    expect(fitSize(20, 10, 25, 1, alwaysTooWide)).toBe(10);
  });
});
