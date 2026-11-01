/**
 * mm-bbox -> on-screen CSS rect, and screen-drag-delta -> layout-mm-delta.
 * Every actual unit conversion goes through core/geometry.ts (mmToPx,
 * pxToMm, dragDeltaMmY) — this module only adds the one thing core doesn't
 * provide: turning a whole bbox (not a single coordinate) into a top/left
 * CSS rect, which needs the same "cardHeightMm - y" flip screenYToLayoutY
 * uses, applied to the bbox's top edge (y + h, since layout y increases
 * upward — the top of a box is its highest y).
 */

import { mmToPx, pxToMm, dragDeltaMmY } from "../core/geometry";
import type { Bbox } from "../core/types";

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Places a layout-space mm bbox on the top-down screen canvas. */
export function bboxToScreenRect(bbox: Bbox, cardHeightMm: number, scale: number): ScreenRect {
  const topMm = cardHeightMm - (bbox.y + bbox.h);
  return {
    left: mmToPx(bbox.x, scale),
    top: mmToPx(topMm, scale),
    width: mmToPx(bbox.w, scale),
    height: mmToPx(bbox.h, scale),
  };
}

/** Places a single layout-space mm point (e.g. a line endpoint) on the
 * top-down screen canvas — same flip as bboxToScreenRect, for one point
 * instead of a whole box. */
export function pointToScreenPx(x: number, y: number, cardHeightMm: number, scale: number): { left: number; top: number } {
  return { left: mmToPx(x, scale), top: mmToPx(cardHeightMm - y, scale) };
}

/** A screen-space (px, top-down) pointer delta -> a layout-space (mm,
 * bottom-up) position delta. x has no flip; y does (R7.1), via
 * dragDeltaMmY. */
export function screenDeltaToLayoutDeltaMm(dxPx: number, dyPx: number, scale: number): { dx: number; dy: number } {
  return { dx: pxToMm(dxPx, scale), dy: dragDeltaMmY(dyPx, scale) };
}
