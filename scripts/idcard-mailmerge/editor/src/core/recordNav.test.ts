import { describe, expect, it } from "vitest";
import { nextRecordIndex } from "./recordNav";

describe("nextRecordIndex", () => {
  it("steps forward and backward within range", () => {
    expect(nextRecordIndex(5, 2, 1)).toBe(3);
    expect(nextRecordIndex(5, 2, -1)).toBe(1);
  });

  it("clamps (no wrap) at the ends", () => {
    expect(nextRecordIndex(5, 4, 1)).toBeNull(); // already last, forward is a no-op
    expect(nextRecordIndex(5, 0, -1)).toBeNull(); // already first, backward is a no-op
  });

  it("lands on first (forward) or last (backward) when nothing is selected", () => {
    expect(nextRecordIndex(5, -1, 1)).toBe(0);
    expect(nextRecordIndex(5, -1, -1)).toBe(4);
  });

  it("is a no-op for an empty list", () => {
    expect(nextRecordIndex(0, -1, 1)).toBeNull();
    expect(nextRecordIndex(0, -1, -1)).toBeNull();
  });

  it("handles a single-record list (both directions are no-ops once selected)", () => {
    expect(nextRecordIndex(1, 0, 1)).toBeNull();
    expect(nextRecordIndex(1, 0, -1)).toBeNull();
    expect(nextRecordIndex(1, -1, 1)).toBe(0);
  });
});
