/**
 * Advisory safe-area check, mirroring idcards.py's _assert_safe exactly (but
 * advisory only — it blocks nothing; the renderer is still the real gate).
 *
 * idcards.py:
 *   def _assert_safe(name, x, y, w, h):
 *       if x < SAFE_INSET - 0.01 or y < SAFE_INSET - 0.01 \
 *          or x + w > PAGE_W - SAFE_INSET + 0.01 or y + h > PAGE_H - SAFE_INSET + 0.01:
 *           raise CardError(...)
 *
 * The renderer's 0.01mm slack exists to absorb floating-point jitter from
 * its own text-measurement math, not to change what the editor should flag.
 * This module uses the exact inset boundary the spec states (R14/R15: "a
 * bbox is safe iff it lies fully within [inset, dim-inset] on both axes"),
 * with no added slack.
 */

import { CARD_HEIGHT_MM, CARD_WIDTH_MM, SAFE_AREA_INSET_MM } from "./constants";
import type { Bbox } from "./types";

/** Returns true iff the given bbox (mm) violates the safe-area inset on any edge. */
export function crossesSafeArea(bbox: Bbox, inset: number = SAFE_AREA_INSET_MM): boolean {
  const safe =
    bbox.x >= inset &&
    bbox.y >= inset &&
    bbox.x + bbox.w <= CARD_WIDTH_MM - inset &&
    bbox.y + bbox.h <= CARD_HEIGHT_MM - inset;
  return !safe;
}
