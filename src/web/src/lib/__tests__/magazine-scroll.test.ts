import { describe, it, expect } from "vitest";
import {
  clamp,
  computeScrollProgress,
  computeFrameIndex,
  computeCoverOpacity,
  computeSequenceOpacity,
  computeBlurPx,
  computeSequenceScale,
  computeMobileCopyProgress,
  computeMobileCopyOffset,
  computeMobileFrameTop,
  computeMobileFrameScale,
} from "../magazine-scroll";

describe("clamp", () => {
  it("passes through values inside the range", () => {
    expect(clamp(0.5)).toBe(0.5);
  });

  it("clamps below the minimum", () => {
    expect(clamp(-1)).toBe(0);
  });

  it("clamps above the maximum", () => {
    expect(clamp(2)).toBe(1);
  });

  it("honors custom min/max", () => {
    expect(clamp(15, 0, 9)).toBe(9);
    expect(clamp(-5, -2, 9)).toBe(-2);
  });
});

describe("computeScrollProgress", () => {
  it("is 0 when the section top is at the viewport top", () => {
    expect(computeScrollProgress(0, 2000, 800)).toBeCloseTo(0);
  });

  it("is 1 when scrolled through the full travel distance", () => {
    // travel = 2000 - 800 = 1200; sectionTop = -1200 -> progress 1
    expect(computeScrollProgress(-1200, 2000, 800)).toBe(1);
  });

  it("clamps beyond full travel to 1", () => {
    expect(computeScrollProgress(-5000, 2000, 800)).toBe(1);
  });

  it("clamps a positive section top (not yet scrolled into view) to 0", () => {
    expect(computeScrollProgress(500, 2000, 800)).toBe(0);
  });

  it("does not divide by zero when section height <= viewport height", () => {
    // travel = max(1, 800 - 2000) = 1
    expect(computeScrollProgress(-1, 800, 2000)).toBe(1);
    expect(computeScrollProgress(0, 800, 2000)).toBeCloseTo(0);
  });
});

describe("computeFrameIndex", () => {
  it("is 0 at progress 0", () => {
    expect(computeFrameIndex(0, 82)).toBe(0);
  });

  it("FEATURE: is the last frame at 72% progress (movement completion threshold)", () => {
    expect(computeFrameIndex(0.72, 82)).toBe(81);
  });

  it("stays at the last frame beyond 72% progress", () => {
    expect(computeFrameIndex(1, 82)).toBe(81);
  });

  it("is just short of the last frame before 72%", () => {
    // movementProgress = 0.7/0.72 = 0.9722 -> round(0.9722 * 81) = 79
    expect(computeFrameIndex(0.7, 82)).toBe(79);
  });

  it("handles a single-frame sequence", () => {
    expect(computeFrameIndex(0, 1)).toBe(0);
    expect(computeFrameIndex(0.5, 1)).toBe(0);
    expect(computeFrameIndex(1, 1)).toBe(0);
  });

  it("handles an 82-frame sequence across the full range", () => {
    expect(computeFrameIndex(0.36, 82)).toBe(41);
  });
});

describe("computeCoverOpacity", () => {
  it("is 0 before the activation threshold (68%)", () => {
    expect(computeCoverOpacity(0)).toBe(0);
    expect(computeCoverOpacity(0.68)).toBe(0);
  });

  it("FEATURE: reaches full opacity at 93% progress", () => {
    expect(computeCoverOpacity(0.93)).toBe(1);
  });

  it("stays at 1 beyond 93%", () => {
    expect(computeCoverOpacity(1)).toBe(1);
  });

  it("is partial mid-range", () => {
    // (0.8 - 0.68) / 0.25 = 0.48
    expect(computeCoverOpacity(0.8)).toBeCloseTo(0.48);
  });
});

describe("computeSequenceOpacity", () => {
  it("is the inverse of cover opacity", () => {
    expect(computeSequenceOpacity(0)).toBe(1);
    expect(computeSequenceOpacity(0.93)).toBe(0);
    expect(computeSequenceOpacity(1)).toBe(0);
  });
});

describe("computeBlurPx", () => {
  it("is 0 before the activation threshold (56%)", () => {
    expect(computeBlurPx(0)).toBe(0);
    expect(computeBlurPx(0.56)).toBe(0);
  });

  it("FEATURE: reaches max blur (9px) at 74% progress", () => {
    expect(computeBlurPx(0.74)).toBeCloseTo(9);
  });

  it("stays at max beyond 74%", () => {
    expect(computeBlurPx(1)).toBe(9);
  });
});

describe("computeSequenceScale", () => {
  it("is 1 before the activation threshold (56%)", () => {
    expect(computeSequenceScale(0)).toBe(1);
    expect(computeSequenceScale(0.56)).toBe(1);
  });

  it("reaches max scale (1.045) at 74% progress", () => {
    expect(computeSequenceScale(0.74)).toBeCloseTo(1.045);
  });

  it("stays at max beyond 74%", () => {
    expect(computeSequenceScale(1)).toBeCloseTo(1.045);
  });
});

describe("computeMobileCopyProgress", () => {
  it("is 0 at progress 0", () => {
    expect(computeMobileCopyProgress(0)).toBe(0);
  });

  it("FEATURE: is fully exited (1) at 20% progress", () => {
    expect(computeMobileCopyProgress(0.2)).toBe(1);
  });

  it("stays at 1 beyond 20%", () => {
    expect(computeMobileCopyProgress(1)).toBe(1);
  });
});

describe("computeMobileCopyOffset", () => {
  it("is 0 at mobileCopyProgress 0", () => {
    expect(computeMobileCopyOffset(0)).toBeCloseTo(0);
  });

  it("is -42 svh at mobileCopyProgress 1 (full upward exit)", () => {
    expect(computeMobileCopyOffset(1)).toBe(-42);
  });
});

describe("computeMobileFrameTop", () => {
  it("is 76.5% at rest (mobileCopyProgress 0)", () => {
    expect(computeMobileFrameTop(0)).toBe(76.5);
  });

  it("is 50% at full exit (mobileCopyProgress 1)", () => {
    expect(computeMobileFrameTop(1)).toBe(50);
  });
});

describe("computeMobileFrameScale", () => {
  it("is 0.68 at rest (mobileCopyProgress 0)", () => {
    expect(computeMobileFrameScale(0)).toBe(0.68);
  });

  it("is 1 at full exit (mobileCopyProgress 1)", () => {
    expect(computeMobileFrameScale(1)).toBe(1);
  });
});
