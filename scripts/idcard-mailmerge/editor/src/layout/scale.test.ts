import { describe, expect, it } from "vitest";
import { applyScalePercent, scalePercentOf } from "./scale";

describe("scale round-trip", () => {
  const baseline = { w: 20, h: 10 };

  it("100% leaves size unchanged", () => {
    const el = { w: 20, h: 10, x: 5, y: 5 };
    expect(applyScalePercent(el, baseline, 100)).toEqual({ w: 20, h: 10, x: 5, y: 5 });
  });

  it("150% scales both axes uniformly, x/y untouched (R7 — scale never repositions)", () => {
    const el = { w: 20, h: 10, x: 5, y: 5 };
    const result = applyScalePercent(el, baseline, 150);
    expect(result.w).toBeCloseTo(30);
    expect(result.h).toBeCloseTo(15);
    expect(result.x).toBe(5);
    expect(result.y).toBe(5);
  });

  it("scalePercentOf is the inverse of applyScalePercent", () => {
    const el = { w: 20, h: 10, x: 0, y: 0 };
    const scaled = applyScalePercent(el, baseline, 137);
    expect(scalePercentOf(scaled, baseline)).toBe(137);
  });
});
