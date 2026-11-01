import { describe, expect, it } from "vitest";
import rawDefaults from "../../defaults.json";
import { applySize, editableFields, positionModel } from "./fieldMap";
import type { Layout } from "./types";

// Cast through unknown: defaults.json is untyped JSON: import; this is the
// same shape core/types.ts describes, verified against the real file below.
const defaults = rawDefaults as unknown as Layout;

describe("editableFields — real defaults.json elements", () => {
  it("doodle (sprite_alpha) — college — gets opacity/scale/rotation/xy-drag", () => {
    const college = defaults.elements.college;
    expect(college?.kind).toBe("sprite_alpha");
    const fields = editableFields("sprite_alpha");
    expect(fields).toEqual({ opacity: true, scale: true, rotation: true, size: false, dragAxis: "xy" });
  });

  it("doodle (nostalgia_opaque) — friends — same table row as sprite_alpha", () => {
    const friends = defaults.elements.friends;
    expect(friends?.kind).toBe("nostalgia_opaque");
    expect(editableFields("nostalgia_opaque")).toEqual(editableFields("sprite_alpha"));
  });

  it("logo_alpha — logo — opacity/scale/rotation/xy-drag, no size", () => {
    const logo = defaults.elements.logo;
    expect(logo?.kind).toBe("logo_alpha");
    expect(editableFields("logo_alpha")).toEqual({ opacity: true, scale: true, rotation: true, size: false, dragAxis: "xy" });
  });

  it("text_static — event_line_title — opacity + pinned size, no scale/rotation", () => {
    const title = defaults.elements.event_line_title;
    expect(title?.kind).toBe("text_static");
    expect(editableFields("text_static")).toEqual({ opacity: true, scale: false, rotation: false, size: true, dragAxis: "xy" });
  });

  it("line — divider_line — opacity, no scale/rotation/size", () => {
    const divider = defaults.elements.divider_line;
    expect(divider?.kind).toBe("line");
    expect(editableFields("line")).toEqual({ opacity: true, scale: false, rotation: false, size: false, dragAxis: "xy" });
  });

  it("photo_box (dynamic) — scale + xy drag, no opacity/rotation", () => {
    expect(defaults.dynamic.photo_box).toBeDefined();
    expect(editableFields("photo_box")).toEqual({ opacity: false, scale: true, rotation: false, size: false, dragAxis: "xy" });
  });

  it("name / branch (dynamic) — y-only drag, no other controls", () => {
    expect(defaults.dynamic.name).toBeDefined();
    expect(defaults.dynamic.branch).toBeDefined();
    expect(editableFields("name")).toEqual({ opacity: false, scale: false, rotation: false, size: false, dragAxis: "y" });
    expect(editableFields("branch")).toEqual(editableFields("name"));
  });

  it("id_badge (dynamic) — y-only drag, no other controls", () => {
    expect(defaults.dynamic.id_badge).toBeDefined();
    expect(editableFields("id_badge")).toEqual({ opacity: false, scale: false, rotation: false, size: false, dragAxis: "y" });
  });

  it("returns a fresh object each call (caller mutation can't leak back)", () => {
    const a = editableFields("logo_alpha");
    a.opacity = false;
    const b = editableFields("logo_alpha");
    expect(b.opacity).toBe(true);
  });
});

describe("positionModel", () => {
  it.each([
    ["sprite_alpha", "xy"],
    ["nostalgia_opaque", "xy"],
    ["logo_alpha", "xy"],
    ["photo_box", "xy"],
    ["text_static", "center_baseline"],
    ["line", "endpoints"],
    ["name", "y_only"],
    ["branch", "y_only"],
    ["id_badge", "y_only"],
  ] as const)("%s -> %s", (kind, expected) => {
    expect(positionModel(kind)).toBe(expected);
  });
});

describe("applySize — real text_static element", () => {
  it("applySize(element, 14) pins both max_size and min_size to 14 (R12.1)", () => {
    const title = defaults.elements.event_line_title;
    if (title?.kind !== "text_static") throw new Error("fixture drift: event_line_title is no longer text_static");
    expect(title.max_size).not.toBe(title.min_size); // sanity: real element starts as a genuine 12-15 range
    const result = applySize(title, 14);
    expect(result.max_size).toBe(14);
    expect(result.min_size).toBe(14);
  });

  it("does not mutate the input element", () => {
    const title = defaults.elements.event_line_title;
    if (title?.kind !== "text_static") throw new Error("fixture drift: event_line_title is no longer text_static");
    const originalMax = title.max_size;
    const originalMin = title.min_size;
    applySize(title, 99);
    expect(title.max_size).toBe(originalMax);
    expect(title.min_size).toBe(originalMin);
  });

  it("preserves every other field on the element (spread, not a fresh object)", () => {
    const title = defaults.elements.event_line_title;
    if (title?.kind !== "text_static") throw new Error("fixture drift: event_line_title is no longer text_static");
    const result = applySize(title, 14);
    expect(result.text).toBe(title.text);
    expect(result.font).toBe(title.font);
    expect(result.center_x).toBe(title.center_x);
    expect(result.baseline).toBe(title.baseline);
  });

  it("throws on a non-finite size", () => {
    const title = defaults.elements.event_line_title;
    if (title?.kind !== "text_static") throw new Error("fixture drift");
    expect(() => applySize(title, NaN)).toThrow();
  });
});
