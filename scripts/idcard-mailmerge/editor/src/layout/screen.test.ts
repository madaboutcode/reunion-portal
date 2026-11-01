import { describe, expect, it } from "vitest";
import { bboxToScreenRect, screenDeltaToLayoutDeltaMm } from "./screen";
import { CARD_HEIGHT_MM } from "../core/constants";

describe("bboxToScreenRect", () => {
  it("a box touching the top of the card (y+h = cardHeight) sits at screen top = 0", () => {
    const rect = bboxToScreenRect({ x: 0, y: CARD_HEIGHT_MM - 10, w: 10, h: 10 }, CARD_HEIGHT_MM, 7);
    expect(rect.top).toBeCloseTo(0);
    expect(rect.left).toBeCloseTo(0);
    expect(rect.width).toBeCloseTo(70);
    expect(rect.height).toBeCloseTo(70);
  });

  it("a box at the bottom of the card (y = 0) sits at screen bottom", () => {
    const rect = bboxToScreenRect({ x: 0, y: 0, w: 10, h: 10 }, CARD_HEIGHT_MM, 7);
    expect(rect.top).toBeCloseTo((CARD_HEIGHT_MM - 10) * 7);
  });
});

describe("screenDeltaToLayoutDeltaMm — R7.1", () => {
  it("dragging down (positive screen dy) decreases layout y", () => {
    const { dy } = screenDeltaToLayoutDeltaMm(0, 70, 7); // 70px down = 10mm at scale 7
    expect(dy).toBeCloseTo(-10);
  });

  it("x has no flip", () => {
    const { dx } = screenDeltaToLayoutDeltaMm(35, 0, 7);
    expect(dx).toBeCloseTo(5);
  });
});
