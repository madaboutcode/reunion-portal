export interface PolaroidImageRef {
  id: number;
  sheetIndex: number;
  col: number;
  row: number;
  title?: string;
}

export interface PolaroidSheetMeta {
  sheetIndex: number;
  cols?: number;
  rows?: number;
  cellWidth?: number;
  cellHeight?: number;
  sprite1x: string;
  sprite2x: string;
}

export interface PolaroidManifest {
  totalImages: number;
  sheetCount: number;
  cellWidth: number;
  cellHeight: number;
  sheets: PolaroidSheetMeta[];
  images: PolaroidImageRef[];
}

export interface PolaroidSpriteStyle {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: "no-repeat";
}

export const POLAROID_CURSOR_STORAGE_KEY = "smriti_polaroid_cursor";
export const POLAROID_FALLBACK_GRADIENT =
  "linear-gradient(135deg, #D4EAEC 0%, #B9DFE2 50%, #C0D0D2 100%)";

export const POLAROID_MANIFEST: PolaroidManifest = {
  totalImages: 35,
  sheetCount: 4,
  cellWidth: 200,
  cellHeight: 150,
  sheets: [
    { sheetIndex: 0, sprite1x: "/assets/polaroids/polaroid-sprite-0.webp", sprite2x: "/assets/polaroids/polaroid-sprite-0-2x.webp" },
    { sheetIndex: 1, sprite1x: "/assets/polaroids/polaroid-sprite-1.webp", sprite2x: "/assets/polaroids/polaroid-sprite-1-2x.webp" },
    { sheetIndex: 2, sprite1x: "/assets/polaroids/polaroid-sprite-2.webp", sprite2x: "/assets/polaroids/polaroid-sprite-2-2x.webp" },
    { sheetIndex: 3, sprite1x: "/assets/polaroids/polaroid-sprite-3.webp", sprite2x: "/assets/polaroids/polaroid-sprite-3-2x.webp" },
  ],
  images: [
    { id: 0, sheetIndex: 0, col: 0, row: 0, title: "Placeholder photo 1" },
    { id: 4, sheetIndex: 0, col: 1, row: 0, title: "Placeholder photo 5" },
    { id: 8, sheetIndex: 0, col: 2, row: 0, title: "Placeholder photo 9" },
    { id: 12, sheetIndex: 0, col: 0, row: 1, title: "Placeholder photo 13" },
    { id: 16, sheetIndex: 0, col: 1, row: 1, title: "Placeholder photo 17" },
    { id: 20, sheetIndex: 0, col: 2, row: 1, title: "Placeholder photo 21" },
    { id: 24, sheetIndex: 0, col: 0, row: 2, title: "Placeholder photo 25" },
    { id: 28, sheetIndex: 0, col: 1, row: 2, title: "Placeholder photo 29" },
    { id: 32, sheetIndex: 0, col: 2, row: 2, title: "Placeholder photo 33" },
    { id: 1, sheetIndex: 1, col: 0, row: 0, title: "Placeholder photo 2" },
    { id: 5, sheetIndex: 1, col: 1, row: 0, title: "Placeholder photo 6" },
    { id: 9, sheetIndex: 1, col: 2, row: 0, title: "Placeholder photo 10" },
    { id: 13, sheetIndex: 1, col: 0, row: 1, title: "Placeholder photo 14" },
    { id: 17, sheetIndex: 1, col: 1, row: 1, title: "Placeholder photo 18" },
    { id: 21, sheetIndex: 1, col: 2, row: 1, title: "Placeholder photo 22" },
    { id: 25, sheetIndex: 1, col: 0, row: 2, title: "Placeholder photo 26" },
    { id: 29, sheetIndex: 1, col: 1, row: 2, title: "Placeholder photo 30" },
    { id: 33, sheetIndex: 1, col: 2, row: 2, title: "Placeholder photo 34" },
    { id: 2, sheetIndex: 2, col: 0, row: 0, title: "Placeholder photo 3" },
    { id: 6, sheetIndex: 2, col: 1, row: 0, title: "Placeholder photo 7" },
    { id: 10, sheetIndex: 2, col: 2, row: 0, title: "Placeholder photo 11" },
    { id: 14, sheetIndex: 2, col: 0, row: 1, title: "Placeholder photo 15" },
    { id: 18, sheetIndex: 2, col: 1, row: 1, title: "Placeholder photo 19" },
    { id: 22, sheetIndex: 2, col: 2, row: 1, title: "Placeholder photo 23" },
    { id: 26, sheetIndex: 2, col: 0, row: 2, title: "Placeholder photo 27" },
    { id: 30, sheetIndex: 2, col: 1, row: 2, title: "Placeholder photo 31" },
    { id: 34, sheetIndex: 2, col: 2, row: 2, title: "Placeholder photo 35" },
    { id: 3, sheetIndex: 3, col: 0, row: 0, title: "Placeholder photo 4" },
    { id: 7, sheetIndex: 3, col: 1, row: 0, title: "Placeholder photo 8" },
    { id: 11, sheetIndex: 3, col: 2, row: 0, title: "Placeholder photo 12" },
    { id: 15, sheetIndex: 3, col: 0, row: 1, title: "Placeholder photo 16" },
    { id: 19, sheetIndex: 3, col: 1, row: 1, title: "Placeholder photo 20" },
    { id: 23, sheetIndex: 3, col: 2, row: 1, title: "Placeholder photo 24" },
    { id: 27, sheetIndex: 3, col: 0, row: 2, title: "Placeholder photo 28" },
    { id: 31, sheetIndex: 3, col: 1, row: 2, title: "Placeholder photo 32" },
  ],
};

export function getSheetMeta(
  manifest: PolaroidManifest,
  sheetIndex: number,
): PolaroidSheetMeta | undefined {
  const sheet = manifest.sheets.find((entry) => entry.sheetIndex === sheetIndex);
  if (!sheet) return undefined;

  const sheetImages = manifest.images.filter(
    (image) => image.sheetIndex === sheetIndex,
  );
  if (sheetImages.length === 0) return sheet;

  const cols =
    sheet.cols ??
    Math.max(...sheetImages.map((image) => image.col)) + 1;
  const rows =
    sheet.rows ??
    Math.max(...sheetImages.map((image) => image.row)) + 1;

  return {
    ...sheet,
    cols,
    rows,
    cellWidth: sheet.cellWidth ?? manifest.cellWidth,
    cellHeight: sheet.cellHeight ?? manifest.cellHeight,
  };
}

export function cellToBackgroundPosition(
  col: number,
  row: number,
  cols: number,
  rows: number,
): string {
  const x = cols <= 1 ? 0 : (col / (cols - 1)) * 100;
  const y = rows <= 1 ? 0 : (row / (rows - 1)) * 100;
  return `${x}% ${y}%`;
}

export function imageRefToBackgroundStyle(
  ref: PolaroidImageRef,
  manifest: PolaroidManifest,
  use2x = true,
): PolaroidSpriteStyle | null {
  const sheet = getSheetMeta(manifest, ref.sheetIndex);
  if (!sheet || sheet.cols === undefined || sheet.rows === undefined) return null;

  const backgroundImage = use2x
    ? `image-set(url("${sheet.sprite1x}") 1x, url("${sheet.sprite2x}") 2x)`
    : `url("${sheet.sprite1x}")`;

  return {
    backgroundImage,
    backgroundSize: `${sheet.cols * 100}% ${sheet.rows * 100}%`,
    backgroundPosition: cellToBackgroundPosition(
      ref.col,
      ref.row,
      sheet.cols,
      sheet.rows,
    ),
    backgroundRepeat: "no-repeat",
  };
}

export function preloadPolaroidSheets(
  manifest: PolaroidManifest,
  sheetIndices: number[],
): Promise<void> {
  const urls = sheetIndices
    .map((sheetIndex) => getSheetMeta(manifest, sheetIndex)?.sprite1x)
    .filter((url): url is string => Boolean(url));

  if (urls.length === 0) {
    return Promise.resolve();
  }

  return Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => resolve();
          image.src = url;
        }),
    ),
  ).then(() => undefined);
}