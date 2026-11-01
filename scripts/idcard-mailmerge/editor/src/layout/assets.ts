/**
 * URL builders for the editor's read-only asset routes (R4/R6.1), and the
 * font-role / color-name lookup tables hand-mirrored from idcards.py so the
 * canvas renders in the real card typeface and palette instead of
 * placeholders. Not executing idcards.py — these are the same fixed name ->
 * file / name -> hex mappings register_fonts() and COLORS declare.
 */

export function doodleAssetUrl(kind: "sprite_alpha" | "nostalgia_opaque", asset: string): string {
  return `/api/asset/doodle/${kind}/${encodeURIComponent(asset)}`;
}

export function logoAssetUrl(): string {
  return "/api/asset/logo";
}

export function fontAssetUrl(filename: string): string {
  return `/api/asset/font/${encodeURIComponent(filename)}`;
}

/** R4 — the per-record attendee photo is loaded by the browser directly from
 * the public CDN by attendee id, not served from local disk. The CDN base URL
 * comes from VITE_PUBLIC_CDN_URL (set it when starting the editor, e.g.
 * `VITE_PUBLIC_CDN_URL=https://cdn.example.org npm run dev`). There is no default:
 * without it photos do not load. */
export function portraitUrl(attendeeId: string): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const base = (env?.VITE_PUBLIC_CDN_URL ?? "").replace(/\/+$/, "");
  return `${base}/portraits/${encodeURIComponent(attendeeId)}.webp`;
}

/** idcards.py register_fonts(): role -> bundled TTF filename. */
export const FONT_FILES: Record<string, string> = {
  regular: "BarlowCondensed-Regular.ttf",
  display: "BarlowCondensed-Bold.ttf",
  heavy: "BarlowCondensed-Black.ttf",
};

/** CSS font-family name the editor registers per role via @font-face (see index.css). */
export const FONT_FAMILIES: Record<string, string> = {
  regular: "SmritiCardRegular",
  display: "SmritiCardDisplay",
  heavy: "SmritiCardHeavy",
};

export function fontFamilyFor(role: string): string {
  return FONT_FAMILIES[role] ?? "sans-serif";
}

/** idcards.py COLORS. */
export const CARD_COLORS: Record<string, string> = {
  background: "#171B1B",
  mint: "#B8DEDA",
  ivory: "#F1E3C9",
  coral: "#C86C52",
  logo_panel: "#C6E2E4",
};

export function resolveColor(name: string): string {
  return CARD_COLORS[name] ?? "#000000";
}
