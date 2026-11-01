/**
 * The inspector's "Scale" control (R12: doodle/logo/photo-box — uniform %,
 * updates stored width/height). Percent is relative to the element's size
 * at the moment the layout was loaded (or last Reset) — the editor tracks
 * that baseline size per element in React state (App.tsx), not here; this
 * module is the pure "given a baseline w/h and a percent, what's the new
 * w/h" arithmetic, anchored at the element's existing x/y (R7: dragging/
 * scaling never repositions — x/y stay put, only w/h change).
 */

export interface SizeMm {
  w: number;
  h: number;
}

export function scalePercentOf(current: SizeMm, baseline: SizeMm): number {
  if (baseline.w === 0) return 100;
  return Math.round((current.w / baseline.w) * 100);
}

export function applyScalePercent<T extends SizeMm>(elem: T, baseline: SizeMm, percent: number): T {
  const factor = percent / 100;
  return { ...elem, w: baseline.w * factor, h: baseline.h * factor };
}
