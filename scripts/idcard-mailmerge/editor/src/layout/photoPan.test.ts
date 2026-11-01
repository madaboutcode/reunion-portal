import { describe, expect, it } from "vitest";
import { applyPhotoPanDelta } from "./photoPan";

describe("applyPhotoPanDelta", () => {
  it("dragging left by half the box width increases pan_x by 0.5 (R19.1)", () => {
    const result = applyPhotoPanDelta({ pan_x: 0.3, pan_y: 0.22 }, -10.75, 0, 21.5, 34.0);
    expect(result.pan_x).toBeCloseTo(0.8, 10);
    expect(result.pan_y).toBeCloseTo(0.22, 10);
  });

  it("dragging right decreases pan_x proportionally", () => {
    const result = applyPhotoPanDelta({ pan_x: 0.8, pan_y: 0.22 }, 10.75, 0, 21.5, 34.0);
    expect(result.pan_x).toBeCloseTo(0.3, 10);
  });

  it("clamps pan_x so it never exceeds 1.0 even when the drag overshoots (R19.1)", () => {
    const result = applyPhotoPanDelta({ pan_x: 0.8, pan_y: 0.22 }, -21.5, 0, 21.5, 34.0);
    expect(result.pan_x).toBe(1.0);
  });

  it("clamps pan_x so it never goes below 0.0", () => {
    const result = applyPhotoPanDelta({ pan_x: 0.2, pan_y: 0.22 }, 21.5, 0, 21.5, 34.0);
    expect(result.pan_x).toBe(0.0);
  });

  it("dragging up by the full box height increases pan_y by 1.0, mirroring the x-axis rule", () => {
    const result = applyPhotoPanDelta({ pan_x: 0.5, pan_y: 0.1 }, 0, -34.0, 21.5, 34.0);
    expect(result.pan_y).toBeCloseTo(1.0, 10);
  });

  it("clamps pan_y so it never goes below 0.0", () => {
    const result = applyPhotoPanDelta({ pan_x: 0.5, pan_y: 0.1 }, 0, 34.0, 21.5, 34.0);
    expect(result.pan_y).toBe(0.0);
  });

  it("throws if the box has non-positive dimensions", () => {
    expect(() => applyPhotoPanDelta({ pan_x: 0.5, pan_y: 0.5 }, 1, 1, 0, 34)).toThrow();
    expect(() => applyPhotoPanDelta({ pan_x: 0.5, pan_y: 0.5 }, 1, 1, 21.5, -1)).toThrow();
  });
});
