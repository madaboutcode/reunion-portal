/**
 * Pure index math for prev/next record keyboard navigation in the per-ID
 * editor. No DOM, no React — just the clamping/edge rules, so they can be
 * unit-tested directly.
 */

/**
 * The record index to move to when stepping `direction` (+1 next, -1 prev)
 * from `current` over a list of `count` records. Returns null when the move
 * is a no-op:
 *  - empty list, or
 *  - already at the clamping end (no wrap-around — predictable at the edges).
 * When nothing is selected yet (`current` < 0), stepping forward lands on the
 * first record and backward on the last.
 */
export function nextRecordIndex(count: number, current: number, direction: 1 | -1): number | null {
  if (count === 0) return null;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  const next = current + direction;
  if (next < 0 || next >= count) return null;
  return next;
}
