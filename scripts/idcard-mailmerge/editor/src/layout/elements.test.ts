import { describe, expect, it } from "vitest";
import rawDefaults from "../../defaults.json";
import { bboxFor, getElement, listElements, updateElement, ptToMm } from "./elements";
import type { DynamicElements, Layout, SpriteAlphaElement } from "../core/types";

const defaults = rawDefaults as unknown as Layout;

describe("listElements", () => {
  const refs = listElements(defaults);

  it("includes every static element plus the four fixed dynamic fields", () => {
    const staticCount = Object.keys(defaults.elements).length;
    expect(refs).toHaveLength(staticCount + 4);
    for (const name of ["photo_box", "name", "branch", "id_badge"]) {
      expect(refs.some((r) => r.name === name && r.source === "dynamic")).toBe(true);
    }
  });

  it("sorts dynamic fields after every static element (renderer draws dynamic last)", () => {
    const lastStaticIndex = refs.map((r) => r.source).lastIndexOf("static");
    const firstDynamicIndex = refs.map((r) => r.source).indexOf("dynamic");
    expect(firstDynamicIndex).toBeGreaterThan(lastStaticIndex);
  });

  it("sorts the logo topmost among static elements regardless of its z", () => {
    const staticRefs = refs.filter((r) => r.source === "static");
    const logoIndex = staticRefs.findIndex((r) => r.name === "logo");
    expect(logoIndex).toBe(staticRefs.length - 1);
  });

  it("assigns each ref the correct layer", () => {
    const college = refs.find((r) => r.name === "college");
    expect(college?.layer).toBe("doodles");
    const photoBox = refs.find((r) => r.name === "photo_box");
    expect(photoBox?.layer).toBe("photo_logo");
    const name = refs.find((r) => r.name === "name" && r.source === "dynamic");
    expect(name?.layer).toBe("text");
  });
});

describe("bboxFor — real defaults.json elements", () => {
  it("sprite_alpha (college): bbox is exactly x/y/w/h", () => {
    const ref = listElements(defaults).find((r) => r.name === "college")!;
    expect(bboxFor(defaults, ref)).toEqual({ x: 30.2, y: 60.6, w: 21.4, h: 16.6 });
  });

  it("line (divider_line): bbox spans the endpoints", () => {
    const ref = listElements(defaults).find((r) => r.name === "divider_line")!;
    const bbox = bboxFor(defaults, ref);
    expect(bbox.x).toBeCloseTo(4.5);
    expect(bbox.y).toBeCloseTo(34.7);
    expect(bbox.w).toBeCloseTo(20.7);
    expect(bbox.h).toBeCloseTo(0);
  });

  it("text_static (event_line_title): x/w from center_x+max_width, y from baseline", () => {
    const ref = listElements(defaults).find((r) => r.name === "event_line_title")!;
    const bbox = bboxFor(defaults, ref);
    expect(bbox.x).toBeCloseTo(15.5 - 22.5 / 2);
    expect(bbox.w).toBeCloseTo(22.5);
    expect(bbox.y).toBeCloseTo(46.0);
    expect(bbox.h).toBeCloseTo(ptToMm(15.0));
  });

  it("photo_box (dynamic): bbox is exactly x/y/w/h", () => {
    const ref = listElements(defaults).find((r) => r.name === "photo_box")!;
    expect(bboxFor(defaults, ref)).toEqual({ x: 29.5, y: 26.2, w: 21.5, h: 34.0 });
  });

  it("id_badge (dynamic): x is derived as centered, never stored", () => {
    const ref = listElements(defaults).find((r) => r.name === "id_badge")!;
    const bbox = bboxFor(defaults, ref);
    expect(bbox.x).toBeCloseTo((54.0 - 15.5) / 2);
    expect(bbox.y).toBeCloseTo(8.9);
  });
});

describe("getElement / updateElement", () => {
  it("updateElement returns a new Layout, never mutating the input", () => {
    const ref = listElements(defaults).find((r) => r.name === "college")!;
    const before = getElement(defaults, ref) as { x: number };
    const beforeX = before.x;
    const updated = updateElement(defaults, ref, (el) => ({ ...(el as SpriteAlphaElement), x: 99 }));
    expect((getElement(defaults, ref) as { x: number }).x).toBe(beforeX); // input untouched
    const after = getElement(updated, ref) as { x: number };
    expect(after.x).toBe(99);
    expect(updated).not.toBe(defaults);
  });

  it("updateElement on a dynamic field only replaces that one field", () => {
    const ref = listElements(defaults).find((r) => r.name === "name" && r.source === "dynamic")!;
    const updated = updateElement(defaults, ref, (el) => ({ ...(el as DynamicElements["name"]), baseline: 25 }));
    expect(updated.dynamic.name.baseline).toBe(25);
    expect(updated.dynamic.branch).toBe(defaults.dynamic.branch); // untouched sibling, same reference
  });
});
