/**
 * The per-kind editable-control table. This is the one place that decides
 * "what can the inspector panel show, and how does dragging move this
 * element" for every element kind the template and per-ID editors handle.
 * Pure lookups over plain data — no DOM, no fs.
 */

import type { FieldMapKind } from "./types";

/** Which axis a drag gesture is allowed to move: both, vertical-only, or none. */
export type DragAxis = "xy" | "y" | "none";

/** How an element's position is stored/moved — used by the canvas drag handler to pick the right update path. */
export type PositionModel = "xy" | "center_baseline" | "endpoints" | "y_only";

export interface FieldMapEntry {
  opacity: boolean;
  scale: boolean;
  rotation: boolean;
  /** Static text's "size" control (R12.1): pins max_size/min_size to one value via applySize(). */
  size: boolean;
  dragAxis: DragAxis;
}

const FIELD_MAP: Record<FieldMapKind, FieldMapEntry> = {
  // Doodle kinds and the logo: opacity, uniform scale, rotation around center, free xy drag.
  sprite_alpha: { opacity: true, scale: true, rotation: true, size: false, dragAxis: "xy" },
  nostalgia_opaque: { opacity: true, scale: true, rotation: true, size: false, dragAxis: "xy" },
  logo_alpha: { opacity: true, scale: true, rotation: true, size: false, dragAxis: "xy" },
  // Static event text: opacity + pinned size, free xy drag (moves center_x/baseline together).
  text_static: { opacity: true, scale: false, rotation: false, size: true, dragAxis: "xy" },
  // Photo box (template mode only — per-ID mode pans the crop instead, see docs/specs/layout-editor.spec.md R19).
  photo_box: { opacity: false, scale: true, rotation: false, size: false, dragAxis: "xy" },
  // Dynamic text base position: vertical-only, no opacity/scale/rotation/size controls.
  name: { opacity: false, scale: false, rotation: false, size: false, dragAxis: "y" },
  branch: { opacity: false, scale: false, rotation: false, size: false, dragAxis: "y" },
  // Divider line: opacity, both endpoints translate together on drag.
  line: { opacity: true, scale: false, rotation: false, size: false, dragAxis: "xy" },
  // ID badge: vertical-only, no other controls (x is always centered by the renderer, never stored).
  id_badge: { opacity: false, scale: false, rotation: false, size: false, dragAxis: "y" },
};

const POSITION_MODEL: Record<FieldMapKind, PositionModel> = {
  sprite_alpha: "xy",
  nostalgia_opaque: "xy",
  logo_alpha: "xy",
  photo_box: "xy",
  text_static: "center_baseline",
  line: "endpoints",
  name: "y_only",
  branch: "y_only",
  id_badge: "y_only",
};

/** Returns exactly the controls and drag axis allowed for the given element kind. Returns a fresh copy — never a shared reference. */
export function editableFields(kind: FieldMapKind): FieldMapEntry {
  const entry = FIELD_MAP[kind];
  if (entry === undefined) {
    throw new Error(`editableFields: unknown kind ${JSON.stringify(kind)}`);
  }
  return { ...entry };
}

/** Returns how the given element kind's position is represented/moved. */
export function positionModel(kind: FieldMapKind): PositionModel {
  const model = POSITION_MODEL[kind];
  if (model === undefined) {
    throw new Error(`positionModel: unknown kind ${JSON.stringify(kind)}`);
  }
  return model;
}

/**
 * The size-pin rule (R12.1): writes `size` to BOTH max_size and min_size on
 * a NEW element, never mutating the input. Works on any element shape that
 * carries a max_size/min_size auto-fit range (text_static, and the dynamic
 * name/branch/id_badge elements).
 */
export function applySize<T extends { max_size: number; min_size: number }>(elem: T, size: number): T {
  if (!Number.isFinite(size)) {
    throw new Error(`applySize: size must be a finite number, got ${size}`);
  }
  return { ...elem, max_size: size, min_size: size };
}
