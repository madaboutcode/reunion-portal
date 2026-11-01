/**
 * Turns a Layout into the flat, orderable list of "things the canvas can
 * select and drag" (ElementRef), and the read/write access those refs need
 * — one place that knows how a name resolves to either layout.elements[name]
 * (static) or layout.dynamic[name] (the four fixed dynamic fields), so the
 * canvas/inspector never branch on "static vs dynamic" themselves.
 *
 * Approximate bbox math (mm) for text and dynamic fields is intentional
 * (R6.2 — the canvas is not required to be pixel-identical to the printed
 * card).
 */

import type { DynamicElements, FieldMapKind, Layout, StaticElement, Bbox } from "../core/types";
import { CARD_WIDTH_MM } from "../core/constants";
import { layerForKind, type Layer } from "./layers";

/** idcards.py's canvas font sizes are ReportLab points, but every stored
 * geometry field (x/y/w/h/baseline/center_x) is mm — this is the one unit
 * conversion the editor needs that core/ doesn't already provide. */
const PT_PER_MM = 72 / 25.4;
export function ptToMm(pt: number): number {
  return pt / PT_PER_MM;
}

export type ElementSource = "static" | "dynamic";
export type DynamicName = keyof DynamicElements;

export interface ElementRef {
  name: string;
  kind: FieldMapKind;
  source: ElementSource;
  layer: Layer;
  /** Render/selection order. Dynamic fields always draw after every static
   * element (idcards.py: _draw_static runs to completion, then _draw_dynamic
   * — see _draw_dynamic call site), so they're assigned a z above any static
   * z. Logo is pinned topmost among statics regardless of its own z field
   * (idcards.py _draw_static: "the identity logo are always the final...
   * static layers, in that order, regardless of any z an editor sets"). */
  z: number;
}

const DYNAMIC_Z_BASE = 1_000_000;
const LOGO_Z_BASE = 500_000;

const DYNAMIC_ORDER: DynamicName[] = ["photo_box", "name", "branch", "id_badge"];

function dynamicKind(name: DynamicName): FieldMapKind {
  return name;
}

export function listElements(layout: Layout): ElementRef[] {
  const staticRefs: ElementRef[] = Object.entries(layout.elements).map(([name, el]) => ({
    name,
    kind: el.kind,
    source: "static",
    layer: layerForKind(el.kind),
    z: el.kind === "logo_alpha" ? LOGO_Z_BASE + (el.z ?? 0) : (el.z ?? 0),
  }));
  const dynamicRefs: ElementRef[] = DYNAMIC_ORDER.map((name, i) => ({
    name,
    kind: dynamicKind(name),
    source: "dynamic",
    layer: layerForKind(dynamicKind(name)),
    z: DYNAMIC_Z_BASE + i,
  }));
  return [...staticRefs, ...dynamicRefs].sort((a, b) => a.z - b.z);
}

export function getStaticElement(layout: Layout, name: string): StaticElement {
  const el = layout.elements[name];
  if (el === undefined) {
    throw new Error(`getStaticElement: no element named ${JSON.stringify(name)}`);
  }
  return el;
}

export function getDynamicElement<K extends DynamicName>(layout: Layout, name: K): DynamicElements[K] {
  return layout.dynamic[name];
}

/** Reads the element a ref points to, regardless of source. */
export function getElement(layout: Layout, ref: ElementRef): StaticElement | DynamicElements[DynamicName] {
  return ref.source === "static" ? getStaticElement(layout, ref.name) : getDynamicElement(layout, ref.name as DynamicName);
}

/** Returns a new Layout with the element ref points to replaced by
 * updater(currentElement). Never mutates the input. */
export function updateElement(
  layout: Layout,
  ref: ElementRef,
  updater: (el: StaticElement | DynamicElements[DynamicName]) => StaticElement | DynamicElements[DynamicName],
): Layout {
  if (ref.source === "static") {
    const current = getStaticElement(layout, ref.name);
    return { ...layout, elements: { ...layout.elements, [ref.name]: updater(current) as StaticElement } };
  }
  const name = ref.name as DynamicName;
  const current = getDynamicElement(layout, name);
  return {
    ...layout,
    dynamic: { ...layout.dynamic, [name]: updater(current) },
  };
}

/** Approximate mm bounding box for any element kind — used for on-canvas
 * layout, selection sizing, and the safe-area advisory check (R14/R15). */
export function bboxFor(layout: Layout, ref: ElementRef): Bbox {
  const el = getElement(layout, ref);
  switch (ref.kind) {
    case "sprite_alpha":
    case "nostalgia_opaque":
    case "logo_alpha": {
      const e = el as Extract<StaticElement, { kind: "sprite_alpha" | "nostalgia_opaque" | "logo_alpha" }>;
      return { x: e.x, y: e.y, w: e.w, h: e.h };
    }
    case "photo_box": {
      const e = el as DynamicElements["photo_box"];
      return { x: e.x, y: e.y, w: e.w, h: e.h };
    }
    case "text_static": {
      const e = el as Extract<StaticElement, { kind: "text_static" }>;
      const h = ptToMm(e.max_size);
      return { x: e.center_x - e.max_width / 2, y: e.baseline, w: e.max_width, h };
    }
    case "line": {
      const e = el as Extract<StaticElement, { kind: "line" }>;
      const x = Math.min(e.x1, e.x2);
      const y = Math.min(e.y1, e.y2);
      return { x, y, w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) };
    }
    case "name":
    case "branch": {
      const e = el as DynamicElements["name"] | DynamicElements["branch"];
      const h = ptToMm(e.max_size);
      const margin = e.max_width_margin;
      return { x: margin, y: e.baseline, w: CARD_WIDTH_MM - 2 * margin, h };
    }
    case "id_badge": {
      const e = el as DynamicElements["id_badge"];
      return { x: (CARD_WIDTH_MM - e.w) / 2, y: e.y, w: e.w, h: e.h };
    }
    default: {
      const exhaustive: never = ref.kind;
      throw new Error(`bboxFor: unhandled kind ${JSON.stringify(exhaustive)}`);
    }
  }
}
