import { describe, expect, it } from "vitest";
import rawDefaults from "../../defaults.json";
import { listElements } from "./elements";
import { applyPositionDelta, currentPositionMm } from "./position";
import type { Layout } from "../core/types";

const defaults = rawDefaults as unknown as Layout;
const refs = listElements(defaults);
const ref = (name: string, source: "static" | "dynamic" = "static") =>
  refs.find((r) => r.name === name && r.source === source)!;

describe("applyPositionDelta", () => {
  it("xy element (sprite_alpha college): moves both x and y", () => {
    const r = ref("college");
    const updated = applyPositionDelta(defaults, r, 1, -2);
    const el = updated.elements.college!;
    if (el.kind !== "sprite_alpha") throw new Error("fixture drift");
    expect(el.x).toBeCloseTo(31.2);
    expect(el.y).toBeCloseTo(58.6);
  });

  it("text_static (center_baseline): moves center_x and baseline together (R7)", () => {
    const r = ref("divider_line");
    // divider_line is a line, use event_line_title for text
    const textRef = ref("event_line_title");
    const updated = applyPositionDelta(defaults, textRef, 3, 0);
    const el = updated.elements.event_line_title!;
    if (el.kind !== "text_static") throw new Error("fixture drift");
    expect(el.center_x).toBeCloseTo(15.5 + 3);
    expect(el.baseline).toBeCloseTo(46.0);
    void r;
  });

  it("line (endpoints): both endpoints translate together, length unchanged (R7 scenario)", () => {
    const r = ref("divider_line");
    const updated = applyPositionDelta(defaults, r, 3, 0);
    const el = updated.elements.divider_line!;
    if (el.kind !== "line") throw new Error("fixture drift");
    expect(el.x1).toBeCloseTo(4.5 + 3);
    expect(el.x2).toBeCloseTo(25.2 + 3);
    expect(el.y1).toBeCloseTo(34.7);
    expect(el.y2).toBeCloseTo(34.7);
  });

  it("y_only (name): dx is ignored even if supplied, since x is never stored (R13)", () => {
    const r = ref("name", "dynamic");
    const updated = applyPositionDelta(defaults, r, 10, -5);
    expect(updated.dynamic.name.baseline).toBeCloseTo(19.1 - 5);
  });

  it("y_only (id_badge): dy moves y", () => {
    const r = ref("id_badge", "dynamic");
    const updated = applyPositionDelta(defaults, r, 10, 1.5);
    expect(updated.dynamic.id_badge.y).toBeCloseTo(8.9 + 1.5);
  });

  it("xy (photo_box, dynamic): moves x and y", () => {
    const r = ref("photo_box", "dynamic");
    const updated = applyPositionDelta(defaults, r, -1, 2);
    expect(updated.dynamic.photo_box.x).toBeCloseTo(29.5 - 1);
    expect(updated.dynamic.photo_box.y).toBeCloseTo(26.2 + 2);
  });

  it("zero delta returns the same Layout reference (no-op short circuit)", () => {
    const r = ref("college");
    expect(applyPositionDelta(defaults, r, 0, 0)).toBe(defaults);
  });
});

describe("currentPositionMm", () => {
  it("xy element reports x/y directly", () => {
    expect(currentPositionMm(defaults, ref("college"))).toEqual({ x: 30.2, y: 60.6 });
  });

  it("text_static reports center_x/baseline", () => {
    expect(currentPositionMm(defaults, ref("event_line_title"))).toEqual({ x: 15.5, y: 46.0 });
  });

  it("line reports the endpoint midpoint", () => {
    const pos = currentPositionMm(defaults, ref("divider_line"));
    expect(pos.y).toBeCloseTo(34.7);
    expect(pos.x).toBeCloseTo((4.5 + 25.2) / 2);
  });
});
