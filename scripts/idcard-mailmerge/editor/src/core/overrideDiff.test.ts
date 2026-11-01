import { describe, expect, it } from "vitest";
import { diffOverride, mergeOverride } from "./overrideDiff";
import { OVERRIDE_DEFAULTS } from "./constants";
import type { OverrideFields, SparseOverride } from "./types";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("diffOverride", () => {
  it("an unedited record (identical to defaults) diffs to an empty object", () => {
    const recordEdits = clone(OVERRIDE_DEFAULTS);
    expect(diffOverride(recordEdits, OVERRIDE_DEFAULTS)).toEqual({});
  });

  it("editing only photo.zoom produces a photo section with just zoom — no name/branch (R20 spec case)", () => {
    const recordEdits: OverrideFields = clone(OVERRIDE_DEFAULTS);
    recordEdits.photo.zoom = 1.4;
    const result = diffOverride(recordEdits, OVERRIDE_DEFAULTS);
    expect(result).toEqual({ photo: { zoom: 1.4 } });
    expect(result.name).toBeUndefined();
    expect(result.branch).toBeUndefined();
  });

  it("editing pan_x and pan_y but not zoom includes only those two fields", () => {
    const recordEdits: OverrideFields = clone(OVERRIDE_DEFAULTS);
    recordEdits.photo.pan_x = 0.8;
    recordEdits.photo.pan_y = 0.1;
    expect(diffOverride(recordEdits, OVERRIDE_DEFAULTS)).toEqual({ photo: { pan_x: 0.8, pan_y: 0.1 } });
  });

  it("a non-zero name.baseline_dy produces a name section", () => {
    const recordEdits: OverrideFields = clone(OVERRIDE_DEFAULTS);
    recordEdits.name.baseline_dy = 1.5;
    expect(diffOverride(recordEdits, OVERRIDE_DEFAULTS)).toEqual({ name: { baseline_dy: 1.5 } });
  });

  it("a set size_override (even without a baseline nudge) produces a branch section", () => {
    const recordEdits: OverrideFields = clone(OVERRIDE_DEFAULTS);
    recordEdits.branch.size_override = 7;
    expect(diffOverride(recordEdits, OVERRIDE_DEFAULTS)).toEqual({ branch: { size_override: 7 } });
  });

  it("a name.text replacement produces a name section with just text", () => {
    const recordEdits: OverrideFields = clone(OVERRIDE_DEFAULTS);
    recordEdits.name.text = "PRAVEEN NAIR";
    const result = diffOverride(recordEdits, OVERRIDE_DEFAULTS);
    expect(result).toEqual({ name: { text: "PRAVEEN NAIR" } });
    expect(result.branch).toBeUndefined();
  });

  it("name.text combines with a name.baseline_dy nudge in one sparse name section", () => {
    const recordEdits: OverrideFields = clone(OVERRIDE_DEFAULTS);
    recordEdits.name.text = "A. KUMAR";
    recordEdits.name.baseline_dy = 1.0;
    expect(diffOverride(recordEdits, OVERRIDE_DEFAULTS)).toEqual({ name: { baseline_dy: 1.0, text: "A. KUMAR" } });
  });

  it("clearing name.text back to null (default) drops it from the diff", () => {
    const recordEdits: OverrideFields = clone(OVERRIDE_DEFAULTS);
    recordEdits.name.text = null;
    expect(diffOverride(recordEdits, OVERRIDE_DEFAULTS)).toEqual({});
  });

  it("edits across all three sections all appear, each sparse to its own differing fields", () => {
    const recordEdits: OverrideFields = clone(OVERRIDE_DEFAULTS);
    recordEdits.photo.zoom = 2.0;
    recordEdits.name.baseline_dy = -0.5;
    recordEdits.branch.size_override = 6.5;
    expect(diffOverride(recordEdits, OVERRIDE_DEFAULTS)).toEqual({
      photo: { zoom: 2.0 },
      name: { baseline_dy: -0.5 },
      branch: { size_override: 6.5 },
    });
  });
});

describe("mergeOverride / diffOverride round-trip", () => {
  it("an unedited load re-produces the same (empty) sparse file", () => {
    const sparse: SparseOverride = {};
    const merged = mergeOverride(sparse, OVERRIDE_DEFAULTS);
    expect(diffOverride(merged, OVERRIDE_DEFAULTS)).toEqual(sparse);
  });

  it("a sparse file with only photo.zoom set round-trips to the exact same sparse shape", () => {
    const sparse: SparseOverride = { photo: { zoom: 1.7 } };
    const merged = mergeOverride(sparse, OVERRIDE_DEFAULTS);
    // Merged form is fully populated (defaults filled in for the untouched fields).
    expect(merged).toEqual({
      photo: { pan_x: OVERRIDE_DEFAULTS.photo.pan_x, pan_y: OVERRIDE_DEFAULTS.photo.pan_y, zoom: 1.7 },
      name: OVERRIDE_DEFAULTS.name,
      branch: OVERRIDE_DEFAULTS.branch,
    });
    // Diffing the merged form against the same defaults reproduces the original sparse file exactly.
    expect(diffOverride(merged, OVERRIDE_DEFAULTS)).toEqual(sparse);
  });

  it("a sparse file touching name and branch round-trips exactly", () => {
    const sparse: SparseOverride = {
      name: { baseline_dy: 2.0 },
      branch: { size_override: 6.0 },
    };
    const merged = mergeOverride(sparse, OVERRIDE_DEFAULTS);
    expect(diffOverride(merged, OVERRIDE_DEFAULTS)).toEqual(sparse);
  });
});
