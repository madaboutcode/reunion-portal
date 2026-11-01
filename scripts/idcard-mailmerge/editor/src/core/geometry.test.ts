import { describe, expect, it } from "vitest";
import { dragDeltaMmY, mmToPx, pxToMm, screenYToLayoutY } from "./geometry";
import { CARD_HEIGHT_MM } from "./constants";

describe("mmToPx / pxToMm", () => {
  it("are exact inverses within float epsilon", () => {
    const scale = 8.246; // an arbitrary non-round px-per-mm scale
    for (const mmValue of [0, 1, 12.5, 54, 85.6, 0.001, 1234.5678]) {
      const px = mmToPx(mmValue, scale);
      const back = pxToMm(px, scale);
      expect(Math.abs(back - mmValue)).toBeLessThan(1e-9);
    }
  });

  it("scales linearly", () => {
    expect(mmToPx(10, 4)).toBe(40);
    expect(pxToMm(40, 4)).toBe(10);
  });

  it("throws on non-finite mm/px (illegal state, not silent 0)", () => {
    expect(() => mmToPx(NaN, 4)).toThrow();
    expect(() => mmToPx(Infinity, 4)).toThrow();
    expect(() => pxToMm(NaN, 4)).toThrow();
    expect(() => pxToMm(-Infinity, 4)).toThrow();
  });

  it("throws on non-finite or non-positive scale", () => {
    expect(() => mmToPx(10, NaN)).toThrow();
    expect(() => mmToPx(10, 0)).toThrow();
    expect(() => mmToPx(10, -4)).toThrow();
    expect(() => pxToMm(10, 0)).toThrow();
  });
});

describe("screenYToLayoutY", () => {
  it("flips: screen top (0px) maps to the card's top edge in mm", () => {
    const scale = 10;
    expect(screenYToLayoutY(0, CARD_HEIGHT_MM, scale)).toBeCloseTo(CARD_HEIGHT_MM, 9);
  });

  it("flips: screen bottom maps to layout y = 0", () => {
    const scale = 10;
    const screenBottomPx = CARD_HEIGHT_MM * scale;
    expect(screenYToLayoutY(screenBottomPx, CARD_HEIGHT_MM, scale)).toBeCloseTo(0, 9);
  });

  it("throws on non-finite inputs", () => {
    expect(() => screenYToLayoutY(NaN, CARD_HEIGHT_MM, 10)).toThrow();
    expect(() => screenYToLayoutY(0, Infinity, 10)).toThrow();
  });
});

describe("dragDeltaMmY (R7.1 spec case)", () => {
  it("dragging down a screen distance corresponding to 10mm moves stored y from 50 to 40", () => {
    const scale = 12.3; // spec must hold at any scale
    const storedY = 50;
    const deltaScreenPx = mmToPx(10, scale); // "a screen distance corresponding to 10mm"
    const deltaMm = dragDeltaMmY(deltaScreenPx, scale);
    expect(deltaMm).toBeCloseTo(-10, 9);
    expect(storedY + deltaMm).toBeCloseTo(40, 9);
  });

  it("dragging up (negative screen delta) increases stored y", () => {
    const scale = 5;
    const deltaMm = dragDeltaMmY(-mmToPx(3, scale), scale);
    expect(deltaMm).toBeCloseTo(3, 9);
  });
});
