/**
 * Applies a position delta (mm, already in layout-y-up terms — callers do
 * the screen/layout y-flip via core/geometry.ts before calling this) to
 * whichever fields the element's positionModel says represent its position
 * (R7: drag/nudge move position only, never width/height; for the divider
 * line both endpoints translate together; for text, center_x + baseline
 * move together). editableFields' dragAxis gates which axes are writable at
 * all (R7, R13) — e.g. name/branch/id_badge are y-only because their x is
 * never stored (always centered by the renderer).
 */

import type { DynamicElements, Layout, StaticElement } from "../core/types";
import { editableFields, positionModel } from "../core/fieldMap";
import { getElement, updateElement, type ElementRef, type DynamicName } from "./elements";

export function applyPositionDelta(layout: Layout, ref: ElementRef, dxMm: number, dyMm: number): Layout {
  const axis = editableFields(ref.kind).dragAxis;
  if (axis === "none") return layout;
  const dx = axis === "xy" ? dxMm : 0;
  const dy = dyMm;
  if (dx === 0 && dy === 0) return layout;

  const model = positionModel(ref.kind);
  return updateElement(layout, ref, (el) => {
    switch (model) {
      case "xy": {
        const e = el as Extract<StaticElement, { x: number; y: number }> | DynamicElements["photo_box"];
        return { ...e, x: e.x + dx, y: e.y + dy };
      }
      case "center_baseline": {
        const e = el as Extract<StaticElement, { kind: "text_static" }>;
        return { ...e, center_x: e.center_x + dx, baseline: e.baseline + dy };
      }
      case "endpoints": {
        const e = el as Extract<StaticElement, { kind: "line" }>;
        return { ...e, x1: e.x1 + dx, x2: e.x2 + dx, y1: e.y1 + dy, y2: e.y2 + dy };
      }
      case "y_only": {
        if (ref.name === "id_badge") {
          const e = el as DynamicElements["id_badge"];
          return { ...e, y: e.y + dy };
        }
        const e = el as DynamicElements["name"] | DynamicElements["branch"];
        return { ...e, baseline: e.baseline + dy };
      }
      default: {
        const exhaustive: never = model;
        throw new Error(`applyPositionDelta: unhandled positionModel ${JSON.stringify(exhaustive)}`);
      }
    }
  });
}

/** Current position "handle" (mm) for the element a ref points to — the
 * single x/y pair drag math anchors on. Line/text report their center point
 * (endpoints/center_baseline both move as one xy pair per R7). */
export function currentPositionMm(layout: Layout, ref: ElementRef): { x: number; y: number } {
  const el = getElement(layout, ref);
  const model = positionModel(ref.kind);
  switch (model) {
    case "xy": {
      const e = el as Extract<StaticElement, { x: number; y: number }> | DynamicElements["photo_box"];
      return { x: e.x, y: e.y };
    }
    case "center_baseline": {
      const e = el as Extract<StaticElement, { kind: "text_static" }>;
      return { x: e.center_x, y: e.baseline };
    }
    case "endpoints": {
      const e = el as Extract<StaticElement, { kind: "line" }>;
      return { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
    }
    case "y_only": {
      if (ref.name === "id_badge") {
        const e = el as DynamicElements["id_badge"];
        return { x: 0, y: e.y };
      }
      const e = el as DynamicElements["name"] | DynamicElements["branch"];
      return { x: 0, y: e.baseline };
    }
    default: {
      const exhaustive: never = model;
      throw new Error(`currentPositionMm: unhandled positionModel ${JSON.stringify(exhaustive)}`);
    }
  }
}

export type { ElementRef, DynamicName };
