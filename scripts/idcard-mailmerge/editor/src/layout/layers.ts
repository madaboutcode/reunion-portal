/**
 * The template editor's three fixed layers (R8) and which kind belongs to
 * which. Pure lookup, no DOM/fs — mirrors the spec's layer table exactly:
 *   text        — the three event lines, name, branch, ID badge, divider line
 *   doodles     — every decorative image (sprite_alpha, nostalgia_opaque)
 *   photo_logo  — photo box, logo
 */

import type { FieldMapKind } from "../core/types";

export type Layer = "text" | "doodles" | "photo_logo";

export const LAYERS: readonly Layer[] = ["text", "doodles", "photo_logo"];

export function layerForKind(kind: FieldMapKind): Layer {
  switch (kind) {
    case "sprite_alpha":
    case "nostalgia_opaque":
      return "doodles";
    case "photo_box":
    case "logo_alpha":
      return "photo_logo";
    case "text_static":
    case "line":
    case "name":
    case "branch":
    case "id_badge":
      return "text";
    default: {
      const exhaustive: never = kind;
      throw new Error(`layerForKind: unhandled kind ${JSON.stringify(exhaustive)}`);
    }
  }
}
