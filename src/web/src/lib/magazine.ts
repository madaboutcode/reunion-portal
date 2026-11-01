/*
 * CONTRACT: Magazine CDN adapter
 *
 * GUARANTEES:
 * - Resolves the default issue through the CDN index, not a local issue list.
 * - Returns only a manifest with valid page IDs, dimensions, CDN URLs, and cover references.
 * - Rejects unsupported or malformed metadata before a reader can render pages.
 * - Parses and validates an optional intro.mobile sequence with the same playback fields as the parent intro.
 * - selectIntro() selects mobile or desktop intro and resolves the displayed quote (mobile.quote ?? intro.quote).
 *
 * EXPECTS:
 * - The CDN index and manifest allow browser reads from the deployed site origin.
 * - Published issue assets use absolute URLs on the configured CDN (cdnUrl in site.config.json).
 *
 * FAILURE BEHAVIOR:
 * - Network, HTTP, schema, and reference errors reject with an actionable Error.
 *
 * DOES NOT:
 * - Fall back to local page assets.
 * - Persist reader progress or issue metadata.
 */

export const MAGAZINE_CDN_ORIGIN: string = __CDN_URL__;
export const MAGAZINE_INDEX_URL = `${MAGAZINE_CDN_ORIGIN}/magazines/index.json`;

export interface MagazinePageAsset {
  id: string;
  number: number;
  src: string;
  width: number;
  height: number;
  alt: string;
}

export interface MagazineCover {
  pageId: string;
  src: string;
  width: number;
  height: number;
  alt: string;
}

export interface MagazineContentsEntry {
  id: string;
  title: string;
  author?: string;
  startPageId: string;
  type?: string;
}

export interface MagazineIntroFrame {
  id: string;
  number: number;
  src: string;
  width: number;
  height: number;
  alt: string;
}

export interface MagazineIntroMobile {
  frameRate: number;
  duration: number;
  frameCount: number;
  width: number;
  height: number;
  quote?: string;
  frames: MagazineIntroFrame[];
}

export interface MagazineIntro {
  frameRate: number;
  duration: number;
  frameCount: number;
  width: number;
  height: number;
  eyebrow: string;
  quote: string;
  credit: string;
  frames: MagazineIntroFrame[];
  mobile?: MagazineIntroMobile;
}

export interface SelectedIntro {
  frames: MagazineIntroFrame[];
  frameCount: number;
  width: number;
  height: number;
  eyebrow: string;
  quote: string;
  credit: string;
  isMobile: boolean;
}

export interface MagazineManifest {
  schemaVersion: 1;
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  edition?: string;
  publishedAt?: string;
  locale?: string;
  pageCount: number;
  pages: MagazinePageAsset[];
  cover: MagazineCover;
  contents?: MagazineContentsEntry[];
  downloadUrl?: string;
  intro?: MagazineIntro;
}

interface MagazineIssueIndexEntry {
  id: string;
  slug: string;
  title: string;
  coverUrl: string;
  manifestUrl: string;
  isDefault?: boolean;
}

interface MagazineIndex {
  schemaVersion: 1;
  issues: MagazineIssueIndexEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Magazine metadata is missing ${key}.`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Magazine metadata has an invalid ${key}.`);
  }
  return value;
}

function requireCdnUrl(value: string, field: string): string {
  const url = new URL(value);
  if (url.origin !== MAGAZINE_CDN_ORIGIN) {
    throw new Error(`Magazine metadata has a non-CDN ${field} URL.`);
  }
  return value;
}

function parseIndex(value: unknown): MagazineIndex {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.issues)
  ) {
    throw new Error("Magazine index is invalid or unsupported.");
  }

  const issues = value.issues.map((issue): MagazineIssueIndexEntry => {
    if (!isRecord(issue))
      throw new Error("Magazine index contains an invalid issue.");
    const coverUrl = requireCdnUrl(requireString(issue, "coverUrl"), "cover");
    const manifestUrl = requireCdnUrl(
      requireString(issue, "manifestUrl"),
      "manifest",
    );
    return {
      id: requireString(issue, "id"),
      slug: requireString(issue, "slug"),
      title: requireString(issue, "title"),
      coverUrl,
      manifestUrl,
      isDefault: issue.isDefault === true,
    };
  });

  if (issues.filter((issue) => issue.isDefault).length !== 1) {
    throw new Error("Magazine index must contain exactly one default issue.");
  }

  return { schemaVersion: 1, issues };
}

function parsePage(value: unknown): MagazinePageAsset {
  if (!isRecord(value))
    throw new Error("Magazine metadata contains an invalid page.");
  return {
    id: requireString(value, "id"),
    number: requireNumber(value, "number"),
    src: requireCdnUrl(requireString(value, "src"), "page"),
    width: requireNumber(value, "width"),
    height: requireNumber(value, "height"),
    alt: requireString(value, "alt"),
  };
}

function parseContents(value: unknown): MagazineContentsEntry[] {
  if (!Array.isArray(value)) throw new Error("Magazine contents are invalid.");
  return value.map((entry) => {
    if (!isRecord(entry))
      throw new Error("Magazine contents contain an invalid entry.");
    const result: MagazineContentsEntry = {
      id: requireString(entry, "id"),
      title: requireString(entry, "title"),
      startPageId: requireString(entry, "startPageId"),
    };
    if (entry.author !== undefined)
      result.author = requireString(entry, "author");
    if (entry.type !== undefined) result.type = requireString(entry, "type");
    return result;
  });
}

function parseIntroFrames(value: unknown): MagazineIntroFrame[] {
  if (!Array.isArray(value)) {
    throw new Error("Magazine intro metadata is invalid.");
  }
  return value.map((frame): MagazineIntroFrame => {
    if (!isRecord(frame))
      throw new Error("Magazine intro contains an invalid frame.");
    return {
      id: requireString(frame, "id"),
      number: requireNumber(frame, "number"),
      src: requireCdnUrl(requireString(frame, "src"), "intro frame"),
      width: requireNumber(frame, "width"),
      height: requireNumber(frame, "height"),
      alt: requireString(frame, "alt"),
    };
  });
}

function requireFrameCount(
  record: Record<string, unknown>,
  frames: MagazineIntroFrame[],
): number {
  const frameCount = requireNumber(record, "frameCount");
  if (frameCount !== frames.length) {
    throw new Error("Magazine intro frame count does not match frames.");
  }
  return frameCount;
}

function parseIntroMobile(value: unknown): MagazineIntroMobile {
  if (!isRecord(value)) {
    throw new Error("Magazine intro mobile metadata is invalid.");
  }
  const frames = parseIntroFrames(value.frames);
  const frameCount = requireFrameCount(value, frames);

  return {
    frameRate: requireNumber(value, "frameRate"),
    duration: requireNumber(value, "duration"),
    frameCount,
    width: requireNumber(value, "width"),
    height: requireNumber(value, "height"),
    quote: typeof value.quote === "string" ? value.quote : undefined,
    frames,
  };
}

function parseIntro(value: unknown): MagazineIntro {
  if (!isRecord(value)) {
    throw new Error("Magazine intro metadata is invalid.");
  }

  const frames = parseIntroFrames(value.frames);
  const frameCount = requireFrameCount(value, frames);

  return {
    frameRate: requireNumber(value, "frameRate"),
    duration: requireNumber(value, "duration"),
    frameCount,
    width: requireNumber(value, "width"),
    height: requireNumber(value, "height"),
    eyebrow: requireString(value, "eyebrow"),
    quote: requireString(value, "quote"),
    credit: requireString(value, "credit"),
    frames,
    mobile: value.mobile === undefined ? undefined : parseIntroMobile(value.mobile),
  };
}

export function selectIntro(
  intro: MagazineIntro | undefined,
  isMobile: boolean,
): SelectedIntro | null {
  if (intro === undefined) return null;

  const mobile = isMobile ? intro.mobile : undefined;
  if (mobile !== undefined) {
    return {
      frames: mobile.frames,
      frameCount: mobile.frameCount,
      width: mobile.width,
      height: mobile.height,
      eyebrow: intro.eyebrow,
      quote: mobile.quote ?? intro.quote,
      credit: intro.credit,
      isMobile: true,
    };
  }

  return {
    frames: intro.frames,
    frameCount: intro.frameCount,
    width: intro.width,
    height: intro.height,
    eyebrow: intro.eyebrow,
    quote: intro.quote,
    credit: intro.credit,
    isMobile: false,
  };
}

function parseManifest(value: unknown): MagazineManifest {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.pages)
  ) {
    throw new Error("Magazine manifest is invalid or unsupported.");
  }

  const pages = value.pages.map(parsePage);
  const pageIds = new Set(pages.map((page) => page.id));
  const pageNumbers = new Set(pages.map((page) => page.number));
  const pageCount = requireNumber(value, "pageCount");
  if (
    pageCount !== pages.length ||
    pageIds.size !== pages.length ||
    pageNumbers.size !== pages.length
  ) {
    throw new Error("Magazine manifest has invalid page references.");
  }

  if (!isRecord(value.cover))
    throw new Error("Magazine manifest has no cover.");
  const cover: MagazineCover = {
    pageId: requireString(value.cover, "pageId"),
    src: requireCdnUrl(requireString(value.cover, "src"), "cover"),
    width: requireNumber(value.cover, "width"),
    height: requireNumber(value.cover, "height"),
    alt: requireString(value.cover, "alt"),
  };
  if (!pageIds.has(cover.pageId))
    throw new Error("Magazine cover references an unknown page.");

  const contents =
    value.contents === undefined ? [] : parseContents(value.contents);
  if (contents.some((entry) => !pageIds.has(entry.startPageId))) {
    throw new Error("Magazine contents reference an unknown page.");
  }

  const downloadUrl =
    value.downloadUrl === undefined
      ? undefined
      : requireCdnUrl(requireString(value, "downloadUrl"), "download");

  return {
    schemaVersion: 1,
    id: requireString(value, "id"),
    slug: requireString(value, "slug"),
    title: requireString(value, "title"),
    subtitle: typeof value.subtitle === "string" ? value.subtitle : undefined,
    edition: typeof value.edition === "string" ? value.edition : undefined,
    publishedAt:
      typeof value.publishedAt === "string" ? value.publishedAt : undefined,
    locale: typeof value.locale === "string" ? value.locale : undefined,
    pageCount,
    pages,
    cover,
    contents,
    downloadUrl,
    intro: value.intro === undefined ? undefined : parseIntro(value.intro),
  };
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, cache: "no-cache" });
  if (!response.ok)
    throw new Error(`Could not load magazine metadata (${response.status}).`);
  return response.json();
}

export async function fetchMagazineManifest(
  signal?: AbortSignal,
): Promise<MagazineManifest> {
  const index = parseIndex(await fetchJson(MAGAZINE_INDEX_URL, signal));
  const issue = index.issues.find((entry) => entry.isDefault);
  if (!issue) throw new Error("Magazine has no default issue.");
  return parseManifest(await fetchJson(issue.manifestUrl, signal));
}
