import { describe, expect, it } from "vitest";
import rawDefaults from "../../defaults.json";
import { crossesSafeArea } from "./safeArea";
import { CARD_HEIGHT_MM, CARD_WIDTH_MM, SAFE_AREA_INSET_MM } from "./constants";
import type { Layout } from "./types";

const defaults = rawDefaults as unknown as Layout;

describe("crossesSafeArea — real element from defaults.json", () => {
  it("the logo element (x=4.5 y=52.3 w=27.5 h=27.5) is within the 2mm safe area", () => {
    const logo = defaults.elements.logo;
    if (logo?.kind !== "logo_alpha") throw new Error("fixture drift: logo is no longer logo_alpha");
    // Sanity: confirm this fixture is actually inside bounds before trusting the assertion below.
    expect(logo.x).toBeGreaterThanOrEqual(SAFE_AREA_INSET_MM);
    expect(logo.y).toBeGreaterThanOrEqual(SAFE_AREA_INSET_MM);
    expect(logo.x + logo.w).toBeLessThanOrEqual(CARD_WIDTH_MM - SAFE_AREA_INSET_MM);
    expect(logo.y + logo.h).toBeLessThanOrEqual(CARD_HEIGHT_MM - SAFE_AREA_INSET_MM);

    expect(crossesSafeArea({ x: logo.x, y: logo.y, w: logo.w, h: logo.h })).toBe(false);
  });

  it("every box-shaped static element (doodles + logo) in the real template is currently within the safe area", () => {
    // text_static (center_x/baseline, not a w/h box) and line (two endpoints)
    // use a different bbox derivation that lives in the renderer, not here —
    // this loop covers the kinds that are already plain x/y/w/h boxes.
    for (const [name, elem] of Object.entries(defaults.elements)) {
      if (elem.kind !== "sprite_alpha" && elem.kind !== "nostalgia_opaque" && elem.kind !== "logo_alpha") continue;
      const bbox = { x: elem.x, y: elem.y, w: elem.w, h: elem.h };
      expect(crossesSafeArea(bbox), `${name} unexpectedly crosses the safe area`).toBe(false);
    }
  });
});

describe("crossesSafeArea — deliberately out-of-bounds bbox", () => {
  it("x=1mm (inside the 2mm margin) crosses on the left edge (R15 scenario)", () => {
    expect(crossesSafeArea({ x: 1, y: 10, w: 5, h: 5 })).toBe(true);
  });

  it("crosses on the right edge when x+w exceeds card width minus inset", () => {
    expect(crossesSafeArea({ x: CARD_WIDTH_MM - SAFE_AREA_INSET_MM - 1, y: 10, w: 5, h: 5 })).toBe(true);
  });

  it("crosses on the bottom edge when y < inset", () => {
    expect(crossesSafeArea({ x: 10, y: 0.5, w: 5, h: 5 })).toBe(true);
  });

  it("crosses on the top edge when y+h exceeds card height minus inset", () => {
    expect(crossesSafeArea({ x: 10, y: CARD_HEIGHT_MM - SAFE_AREA_INSET_MM - 1, w: 5, h: 5 })).toBe(true);
  });

  it("a bbox exactly touching the inset boundary is safe (inclusive bound)", () => {
    expect(
      crossesSafeArea({
        x: SAFE_AREA_INSET_MM,
        y: SAFE_AREA_INSET_MM,
        w: CARD_WIDTH_MM - 2 * SAFE_AREA_INSET_MM,
        h: CARD_HEIGHT_MM - 2 * SAFE_AREA_INSET_MM,
      }),
    ).toBe(false);
  });

  it("respects a custom inset argument", () => {
    expect(crossesSafeArea({ x: 3, y: 10, w: 5, h: 5 }, 5)).toBe(true);
    expect(crossesSafeArea({ x: 3, y: 10, w: 5, h: 5 }, 1)).toBe(false);
  });
});
