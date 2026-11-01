/**
 * Per-ID photo pan math (R19.1): dragging the photo image inside its
 * fixed-size box pans the crop proportionally to the box's own size — a
 * drag distance equal to the box's full width/height moves that axis's pan
 * value by 1.0, clamped to [0, 1].
 *
 * Direct-manipulation convention: the visible image follows the pointer,
 * like a crop tool. idcards.py's _cover_crop slides its crop window right
 * across the resized image as pan_x grows (`left = round(excess_w *
 * pan_x)`), which reveals more of the image's right side — i.e. the visible
 * content shifts LEFT. So dragging the photo left (negative dx) must
 * increase pan_x; the same logic mirrored on the vertical axis means
 * dragging up (negative dy) increases pan_y. dx/dy and boxWidth/boxHeight
 * must be in the same unit (both px, or both mm) — the result is a plain
 * ratio, so the unit itself doesn't matter.
 */

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface PanValue {
  pan_x: number;
  pan_y: number;
}

export function applyPhotoPanDelta(base: PanValue, dx: number, dy: number, boxWidth: number, boxHeight: number): PanValue {
  if (boxWidth <= 0 || boxHeight <= 0) {
    throw new Error(`applyPhotoPanDelta: box dimensions must be > 0, got ${boxWidth}x${boxHeight}`);
  }
  return {
    pan_x: clamp01(base.pan_x - dx / boxWidth),
    pan_y: clamp01(base.pan_y - dy / boxHeight),
  };
}
