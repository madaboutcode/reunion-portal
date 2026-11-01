/*
 * CONTRACT: Magazine scroll-to-visual calculations
 *
 * GUARANTEES:
 * - Every function is pure: same inputs always produce the same output.
 * - No DOM reads, no side effects, no global state.
 * - All progress-based functions clamp their result to a fixed range.
 *
 * DOES NOT:
 * - Read scroll position from the DOM.
 * - Set CSS properties.
 * - Know about React, hooks, or components.
 */

export function clamp(value: number, min = 0, max = 1): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function computeScrollProgress(
  sectionTop: number,
  sectionHeight: number,
  viewportHeight: number,
): number {
  const travel = Math.max(1, sectionHeight - viewportHeight);
  return clamp(-sectionTop / travel);
}

export function computeFrameIndex(progress: number, frameCount: number): number {
  const movementProgress = clamp(progress / 0.72);
  return Math.min(frameCount - 1, Math.round(movementProgress * (frameCount - 1)));
}

export function computeCoverOpacity(progress: number): number {
  return clamp((progress - 0.68) / 0.25);
}

export function computeSequenceOpacity(progress: number): number {
  return 1 - computeCoverOpacity(progress);
}

export function computeBlurPx(progress: number): number {
  return clamp((progress - 0.56) / 0.18) * 9;
}

export function computeSequenceScale(progress: number): number {
  return 1 + clamp((progress - 0.56) / 0.18) * 0.045;
}

export function computeMobileCopyProgress(progress: number): number {
  return clamp(progress / 0.2);
}

export function computeMobileCopyOffset(mobileCopyProgress: number): number {
  return -mobileCopyProgress * 42;
}

export function computeMobileFrameTop(mobileCopyProgress: number): number {
  return 76.5 - mobileCopyProgress * 26.5;
}

export function computeMobileFrameScale(mobileCopyProgress: number): number {
  return 0.68 + mobileCopyProgress * 0.32;
}
