/**
 * Single source of truth for the card's physical geometry and the
 * per-attendee override defaults. Both mirror fixed constants in
 * idcards.py — see the comment on each for the exact counterpart.
 */

import type { OverrideFields } from "./types";

/** idcards.py: PAGE_W = 54.0 * mm (portrait width). */
export const CARD_WIDTH_MM = 54.0;

/** idcards.py: PAGE_H = 85.6 * mm (portrait height). */
export const CARD_HEIGHT_MM = 85.6;

/** idcards.py: SAFE_INSET = 2.0 * mm. */
export const SAFE_AREA_INSET_MM = 2.0;

/** idcards.py: OVERRIDABLE_DYNAMIC_FIELDS — the values a per-attendee override falls back to when a field is absent. */
export const OVERRIDE_DEFAULTS: OverrideFields = {
  photo: { pan_x: 0.5, pan_y: 0.22, zoom: 1.0 },
  name: { baseline_dy: 0.0, size_override: null, text: null },
  branch: { baseline_dy: 0.0, size_override: null },
};
