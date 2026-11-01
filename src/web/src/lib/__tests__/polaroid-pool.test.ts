import { describe, expect, it, beforeEach } from "vitest";
import type { PolaroidManifest } from "@/lib/polaroid-sprites";
import {
  assertScreenClaimsUnique,
  PolaroidPool,
} from "@/lib/polaroid-pool";

function mockManifest(): PolaroidManifest {
  const images = Array.from({ length: 9 }, (_, id) => ({
    id,
    sheetIndex: 0,
    col: id % 3,
    row: Math.floor(id / 3),
    title: `Image ${id}`,
  }));

  return {
    totalImages: 9,
    sheetCount: 1,
    cellWidth: 200,
    cellHeight: 150,
    sheets: [
      {
        sheetIndex: 0,
        cols: 3,
        rows: 3,
        cellWidth: 200,
        cellHeight: 150,
        sprite1x: "/assets/polaroids/polaroid-sprite-0.webp",
        sprite2x: "/assets/polaroids/polaroid-sprite-0-2x.webp",
      },
    ],
    images,
  };
}

function twoSheetManifest(): PolaroidManifest {
  return {
    totalImages: 6,
    sheetCount: 2,
    cellWidth: 200,
    cellHeight: 150,
    sheets: [
      { sheetIndex: 0, cols: 3, rows: 1, cellWidth: 200, cellHeight: 150, sprite1x: "/a.webp", sprite2x: "/a-2x.webp" },
      { sheetIndex: 1, cols: 3, rows: 1, cellWidth: 200, cellHeight: 150, sprite1x: "/b.webp", sprite2x: "/b-2x.webp" },
    ],
    images: [
      { id: 0, sheetIndex: 0, col: 0, row: 0, title: "A0" },
      { id: 1, sheetIndex: 0, col: 1, row: 0, title: "A1" },
      { id: 2, sheetIndex: 0, col: 2, row: 0, title: "A2" },
      { id: 3, sheetIndex: 1, col: 0, row: 0, title: "B0" },
      { id: 4, sheetIndex: 1, col: 1, row: 0, title: "B1" },
      { id: 5, sheetIndex: 1, col: 2, row: 0, title: "B2" },
    ],
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("PolaroidPool", () => {
  it("claims unique image ids for multiple slots on one screen", () => {
    const pool = new PolaroidPool(mockManifest());

    const a = pool.claim("slot-a");
    const b = pool.claim("slot-b");
    const c = pool.claim("slot-c");
    const d = pool.claim("slot-d");

    const ids = [a, b, c, d].map((ref) => ref?.id);
    expect(new Set(ids).size).toBe(4);
    assertScreenClaimsUnique(pool);
  });

  it("returns the same image for repeated claim on one slot id", () => {
    const pool = new PolaroidPool(mockManifest());

    const first = pool.claim("hero");
    const second = pool.claim("hero");

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(pool.getState().slotClaims.size).toBe(1);
  });

  it("advances global cursor across claims", () => {
    const pool = new PolaroidPool(mockManifest());

    pool.claim("a");
    pool.claim("b");

    expect(pool.getState().cursor).toBe(2);
  });

  it("resetScreen clears claims but keeps cursor position", () => {
    const pool = new PolaroidPool(mockManifest());

    pool.claim("a");
    pool.claim("b");
    const cursorBefore = pool.getState().cursor;

    pool.resetScreen();

    expect(pool.getState().slotClaims.size).toBe(0);
    expect(pool.getState().screenClaimedIds.size).toBe(0);
    expect(pool.getState().cursor).toBe(cursorBefore);
  });

  it("walks sequentially through all images across sheets", () => {
    const pool = new PolaroidPool(twoSheetManifest());
    const ids: number[] = [];

    for (let i = 0; i < 6; i++) {
      const ref = pool.claim(`slot-${i}`);
      ids.push(ref!.id);
    }

    // sequential: sheet 0 cells then sheet 1 cells
    expect(ids).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("wraps around after exhausting all images", () => {
    const pool = new PolaroidPool(twoSheetManifest());

    // claim all 6
    for (let i = 0; i < 6; i++) pool.claim(`first-${i}`);

    pool.resetScreen();

    // next claim wraps back to beginning
    const wrapped = pool.claim("after-wrap");
    expect(wrapped).not.toBeNull();
    expect(wrapped!.id).toBe(0);
  });

  it("persists cursor to localStorage", () => {
    const pool = new PolaroidPool(twoSheetManifest());
    pool.claim("a");
    pool.claim("b");

    const stored = localStorage.getItem("smriti_polaroid_cursor");
    expect(stored).toBe("2");
  });

  it("resumes cursor from localStorage on new pool", () => {
    localStorage.setItem("smriti_polaroid_cursor", "3");
    const pool = new PolaroidPool(twoSheetManifest());

    const ref = pool.claim("first");
    // cursor was at 3 → image at index 3 (id=3, sheet 1 first cell)
    expect(ref!.id).toBe(3);
  });
});
