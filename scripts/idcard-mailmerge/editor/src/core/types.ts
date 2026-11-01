/**
 * Shared plain-data types for the layout editor's pure core.
 *
 * These mirror the JSON shapes idcards.py reads and writes
 * (DEFAULT_LAYOUT / layout.json and the per-attendee override files under
 * data/overrides/<id>.json). Nothing in this file touches the DOM, HTTP, or
 * the filesystem — see core/geometry.ts, core/fieldMap.ts,
 * core/overrideDiff.ts, core/safeArea.ts for the pure functions that operate
 * on these shapes.
 */

/** The "kind" discriminator on a static template element (layout.elements[name].kind). */
export type StaticElementKind = "sprite_alpha" | "nostalgia_opaque" | "logo_alpha" | "text_static" | "line";

/**
 * The per-kind identifier core/fieldMap.ts keys off of. A superset of
 * StaticElementKind: the four dynamic (per-record) elements — photo_box,
 * name, branch, id_badge — don't carry a JSON "kind" field of their own (they
 * are named entries under layout.dynamic), but the editor needs the exact
 * same "what controls does this element get" lookup for them, so field-map
 * treats their fixed names as kinds too.
 */
export type FieldMapKind = StaticElementKind | "photo_box" | "name" | "branch" | "id_badge";

/** Every static element optionally carries opacity/rotation (R12.2 — absent means fully opaque, unrotated). */
export interface OpacityRotation {
  opacity?: number;
  rotation?: number;
}

export interface SpriteAlphaElement extends OpacityRotation {
  kind: "sprite_alpha";
  z?: number;
  asset: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NostalgiaOpaqueElement extends OpacityRotation {
  kind: "nostalgia_opaque";
  z?: number;
  asset: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LogoAlphaElement extends OpacityRotation {
  kind: "logo_alpha";
  z?: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextStaticElement extends OpacityRotation {
  kind: "text_static";
  z?: number;
  text: string;
  font: string;
  max_size: number;
  min_size: number;
  center_x: number;
  baseline: number;
  max_width: number;
  char_space?: number;
  color: string;
}

export interface LineElement extends OpacityRotation {
  kind: "line";
  z?: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export type StaticElement = SpriteAlphaElement | NostalgiaOpaqueElement | LogoAlphaElement | TextStaticElement | LineElement;

export interface PhotoBoxElement {
  x: number;
  y: number;
  w: number;
  h: number;
  corner_radius?: number;
}

export interface DynamicTextElement {
  font: string;
  max_size: number;
  min_size: number;
  baseline: number;
  max_width_margin: number;
  char_space?: number;
  color: string;
}

export interface IdBadgeElement {
  w: number;
  h: number;
  y: number;
  font: string;
  max_size: number;
  min_size: number;
  width_margin: number;
  char_space?: number;
  text_y_offset: number;
}

export interface DynamicElements {
  photo_box: PhotoBoxElement;
  name: DynamicTextElement;
  branch: DynamicTextElement;
  id_badge: IdBadgeElement;
}

/** The full template layout file (layout.json / editor/defaults.json). */
export interface Layout {
  version: number;
  elements: Record<string, StaticElement>;
  dynamic: DynamicElements;
}

/** Per-attendee override fields, fully populated (defaults merged in) — mirrors idcards.py OVERRIDABLE_DYNAMIC_FIELDS. */
export interface PhotoOverrideFields {
  pan_x: number;
  pan_y: number;
  zoom: number;
}

export interface TextOverrideFields {
  baseline_dy: number;
  size_override: number | null;
}

/** The name line additionally supports a text replacement (idcards.py name override "text"): a per-record shortened/edited display name. null = use the manifest name. */
export interface NameOverrideFields extends TextOverrideFields {
  text: string | null;
}

export interface OverrideFields {
  photo: PhotoOverrideFields;
  name: NameOverrideFields;
  branch: TextOverrideFields;
}

/** The sparse on-disk override shape (data/overrides/<id>.json) — only differing sections/fields present. */
export interface SparseOverride {
  photo?: Partial<PhotoOverrideFields>;
  name?: Partial<NameOverrideFields>;
  branch?: Partial<TextOverrideFields>;
}

export interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One record in the attendee manifest (data/attendees.json or fixtures/attendees.json) — mirrors dump_attendees.py's output schema. */
export interface ManifestCard {
  name: string;
  branch: string;
  photo_path: string;
  attendee_id: string;
}

/** GET /api/manifest response — the manifest's own {schema_version, cards[]} plus which source the middleware picked (R3). */
export interface Manifest {
  source: "local-dump" | "bundled-sample";
  sourcePath: string;
  schema_version: number;
  cards: ManifestCard[];
}
