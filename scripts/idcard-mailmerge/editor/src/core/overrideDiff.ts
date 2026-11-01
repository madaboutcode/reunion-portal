/**
 * Sparse-diff logic for per-attendee override files
 * (data/overrides/<attendee_id>.json). idcards.py reads overrides with
 * `.get(field, default)`, so a field absent from the file behaves exactly
 * like the field present with the default value — the editor exploits that
 * to keep saved override files minimal (R20).
 */

import type { NameOverrideFields, OverrideFields, SparseOverride, TextOverrideFields } from "./types";

/**
 * Returns only the sections/fields of recordEdits that differ from
 * templateDefaults. A section with every field equal to its default is
 * omitted entirely; within a present section, only the differing fields are
 * included (this field-level sparseness is what makes the round-trip with
 * mergeOverride exact — see mergeOverride's doc comment).
 */
export function diffOverride(recordEdits: OverrideFields, templateDefaults: OverrideFields): SparseOverride {
  const result: SparseOverride = {};

  const photo: SparseOverride["photo"] = {};
  if (recordEdits.photo.pan_x !== templateDefaults.photo.pan_x) photo.pan_x = recordEdits.photo.pan_x;
  if (recordEdits.photo.pan_y !== templateDefaults.photo.pan_y) photo.pan_y = recordEdits.photo.pan_y;
  if (recordEdits.photo.zoom !== templateDefaults.photo.zoom) photo.zoom = recordEdits.photo.zoom;
  if (Object.keys(photo).length > 0) result.photo = photo;

  // Name also carries an optional text replacement (shortened display name).
  const name: Partial<NameOverrideFields> = {};
  if (recordEdits.name.baseline_dy !== templateDefaults.name.baseline_dy) name.baseline_dy = recordEdits.name.baseline_dy;
  if (recordEdits.name.size_override !== templateDefaults.name.size_override) name.size_override = recordEdits.name.size_override;
  if (recordEdits.name.text !== templateDefaults.name.text) name.text = recordEdits.name.text;
  if (Object.keys(name).length > 0) result.name = name;

  const branch: Partial<TextOverrideFields> = {};
  if (recordEdits.branch.baseline_dy !== templateDefaults.branch.baseline_dy) branch.baseline_dy = recordEdits.branch.baseline_dy;
  if (recordEdits.branch.size_override !== templateDefaults.branch.size_override) branch.size_override = recordEdits.branch.size_override;
  if (Object.keys(branch).length > 0) result.branch = branch;

  return result;
}

/**
 * The inverse of diffOverride: merges a sparse on-disk override over
 * templateDefaults to produce the fully-populated OverrideFields the editor
 * UI reads. Round-trip guarantee: for any sparse file produced by
 * diffOverride, `diffOverride(mergeOverride(sparse, defaults), defaults)`
 * reproduces that same sparse file byte-for-byte (same keys, same values) —
 * an unedited load-then-save is a no-op.
 */
export function mergeOverride(sparse: SparseOverride, templateDefaults: OverrideFields): OverrideFields {
  return {
    photo: { ...templateDefaults.photo, ...sparse.photo },
    name: { ...templateDefaults.name, ...sparse.name },
    branch: { ...templateDefaults.branch, ...sparse.branch },
  };
}
