import {
  getSheetMeta,
  POLAROID_CURSOR_STORAGE_KEY,
  type PolaroidImageRef,
  type PolaroidManifest,
  type PolaroidSheetMeta,
} from "@/lib/polaroid-sprites";

export interface PolaroidSheet {
  sheetIndex: number;
  meta: PolaroidSheetMeta;
  cells: PolaroidImageRef[];
}

export interface PolaroidPoolState {
  screenClaimedIds: ReadonlySet<number>;
  slotClaims: ReadonlyMap<string, PolaroidImageRef>;
  cursor: number;
}

function sortCells(a: PolaroidImageRef, b: PolaroidImageRef): number {
  if (a.row !== b.row) return a.row - b.row;
  return a.col - b.col;
}

export function buildPolaroidSheets(
  manifest: PolaroidManifest,
): PolaroidSheet[] {
  return manifest.sheets
    .map((s) => getSheetMeta(manifest, s.sheetIndex))
    .filter((meta): meta is PolaroidSheetMeta => meta !== undefined)
    .map((meta) => ({
      sheetIndex: meta.sheetIndex,
      meta,
      cells: manifest.images
        .filter((img) => img.sheetIndex === meta.sheetIndex)
        .sort(sortCells),
    }));
}

function buildSequentialImages(manifest: PolaroidManifest): PolaroidImageRef[] {
  const sheets = buildPolaroidSheets(manifest);
  const all: PolaroidImageRef[] = [];
  for (const sheet of sheets) {
    for (const cell of sheet.cells) {
      all.push(cell);
    }
  }
  return all;
}

function loadCursor(): number {
  try {
    const raw = localStorage.getItem(POLAROID_CURSOR_STORAGE_KEY);
    if (raw === null) return 0;
    const val = parseInt(raw, 10);
    return Number.isFinite(val) && val >= 0 ? val : 0;
  } catch {
    return 0;
  }
}

function saveCursor(cursor: number): void {
  try {
    localStorage.setItem(POLAROID_CURSOR_STORAGE_KEY, String(cursor));
  } catch {
    // storage full or unavailable — ignore
  }
}

/**
 * Atomic polaroid allocator with a single sequential cursor across all sheets.
 *
 * GUARANTEES:
 * - claim(slotId) is synchronous and idempotent per slotId
 * - No two claims on the same screen share an image id (until resetScreen)
 * - Global cursor walks sequentially through all images, wraps at end
 * - Cursor persisted to localStorage so returning visitors see fresh photos
 *
 * EXPECTS:
 * - resetScreen() on route change before new claims matter
 */
export class PolaroidPool {
  private readonly manifest: PolaroidManifest;

  private readonly sheets: PolaroidSheet[];

  private readonly allImages: PolaroidImageRef[];

  private readonly screenClaimedIds = new Set<number>();

  private readonly slotClaims = new Map<string, PolaroidImageRef>();

  private cursor: number;

  constructor(manifest: PolaroidManifest) {
    this.manifest = manifest;
    this.sheets = buildPolaroidSheets(manifest);
    this.allImages = buildSequentialImages(manifest);
    const saved = loadCursor();
    this.cursor = this.allImages.length > 0 ? saved % this.allImages.length : 0;
  }

  getManifest(): PolaroidManifest {
    return this.manifest;
  }

  getSheets(): readonly PolaroidSheet[] {
    return this.sheets;
  }

  resetScreen(): void {
    this.screenClaimedIds.clear();
    this.slotClaims.clear();
  }

  getState(): PolaroidPoolState {
    return {
      screenClaimedIds: new Set(this.screenClaimedIds),
      slotClaims: new Map(this.slotClaims),
      cursor: this.cursor,
    };
  }

  claim(slotId: string): PolaroidImageRef | null {
    const existing = this.slotClaims.get(slotId);
    if (existing) return existing;

    const total = this.allImages.length;
    if (total === 0) return null;

    for (let attempt = 0; attempt < total; attempt++) {
      const candidate = this.allImages[this.cursor % total];
      this.cursor = (this.cursor + 1) % total;

      if (!candidate || this.screenClaimedIds.has(candidate.id)) continue;

      this.screenClaimedIds.add(candidate.id);
      this.slotClaims.set(slotId, candidate);
      saveCursor(this.cursor);
      return candidate;
    }

    return null;
  }
}

export function assertScreenClaimsUnique(pool: PolaroidPool): void {
  const ids = [...pool.getState().slotClaims.values()].map((ref) => ref.id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw new Error(
      `PolaroidPool: duplicate image ids on screen: ${ids.join(", ")}`,
    );
  }
}
