/**
 * Element-asset-name -> file-on-disk mapping, mirroring idcards.py's
 * _asset_path (sprite_alpha -> assets/crops/<name>.png) and
 * _nostalgia_asset_path (nostalgia_opaque -> assets/doodles-production/<name>.png).
 * The logo_alpha element has no "asset" field in the layout — it always maps
 * to the single fixed assets/smriti-logo.png, same as idcards.py's
 * assets.logo. This module does not read idcards.py or execute Python; it
 * is a hand-mirrored, read-only path table over already-prepared PNGs.
 */

import path from "node:path";

export type DoodleKind = "sprite_alpha" | "nostalgia_opaque";

export function isDoodleKind(value: string): value is DoodleKind {
  return value === "sprite_alpha" || value === "nostalgia_opaque";
}

/** Rejects a path segment that could escape its directory (traversal, empty, separators). */
export function assertSafePathSegment(segment: string): void {
  if (segment.length === 0 || segment.includes("/") || segment.includes("\\") || segment === "." || segment === "..") {
    throw new Error(`Invalid path segment: ${JSON.stringify(segment)}`);
  }
}

export function doodleAssetPath(kind: DoodleKind, name: string, dirs: { spriteCropsDir: string; nostalgiaCropsDir: string }): string {
  assertSafePathSegment(name);
  const dir = kind === "sprite_alpha" ? dirs.spriteCropsDir : dirs.nostalgiaCropsDir;
  return path.join(dir, `${name}.png`);
}

export function fontAssetPath(filename: string, fontsDir: string): string {
  assertSafePathSegment(filename);
  if (!filename.endsWith(".ttf")) {
    throw new Error(`Only .ttf fonts are served: ${filename}`);
  }
  return path.join(fontsDir, filename);
}
