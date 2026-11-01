/**
 * The editor's dev-only "backend": a connect-style middleware
 * ((req, res, next) => void) that reads and writes the same JSON files
 * idcards.py reads — layout.json, defaults.json, per-attendee override
 * files — and serves the committed doodle/logo/font files read-only. It is
 * a dumb, typed read/write pipe: no business logic beyond "which file does
 * this route touch and how do I fail loudly if that goes wrong."
 *
 * Wired into vite.config.ts via server.middlewares.use("/api", ...). Also
 * usable standalone over a bare node:http server (see middleware.test.ts),
 * since it only depends on IncomingMessage/ServerResponse, not Vite.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import { readJsonFile, writeJsonAtomic } from "./fsAtomic";
import { assertSafePathSegment, doodleAssetPath, fontAssetPath, isDoodleKind } from "./assetMap";

export interface EditorServerConfig {
  /** Mailmerge package root (one level above editor/) — idcards.py's cwd, and the base every other path here is resolved from. */
  mailmergeRoot: string;
  /** layout.json — the live template state, the same file idcards.py's load_layout() reads. */
  layoutPath: string;
  /** editor/defaults.json — committed DEFAULT_LAYOUT export, the Reset source of truth. */
  defaultsPath: string;
  /** data/overrides/ — per-attendee override files, <attendee_id>.json. */
  overridesDir: string;
  /** data/attendees.json — local attendee dump (gitignored, real PII), if present. */
  attendeeDumpPath: string;
  /** fixtures/attendees.json — bundled sample manifest, used when attendeeDumpPath is absent. */
  sampleManifestPath: string;
  /** assets/crops — sprite_alpha doodle crops. */
  spriteCropsDir: string;
  /** assets/doodles-production — nostalgia_opaque doodle crops. */
  nostalgiaCropsDir: string;
  /** assets/smriti-logo.png — the fixed logo_alpha asset. */
  logoPath: string;
  /** assets/fonts — bundled .ttf files. */
  fontsDir: string;
  /** tmp/preview.pdf — dev-only rendered preview output, overwritten on every /api/preview call. */
  previewPdfPath: string;
  /** Injectable override for node:child_process.spawn, used by tests to stub out the real `uv run` subprocess. Defaults to the real spawn. */
  spawnRenderProcess?: typeof nodeSpawn;
}

export type Middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

async function sendFile(
  res: ServerResponse,
  filePath: string,
  contentType: string,
  extraHeaders?: Record<string, string>,
): Promise<void> {
  let data: Buffer;
  try {
    data = await fsp.readFile(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      sendError(res, 404, `Asset not found: ${filePath}`);
      return;
    }
    sendError(res, 500, `Failed reading ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  res.writeHead(200, { "Content-Type": contentType, "Content-Length": data.length, ...extraHeaders });
  res.end(data);
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function handleGetLayout(res: ServerResponse, config: EditorServerConfig): Promise<void> {
  let layout = await readJsonFile<unknown>(config.layoutPath);
  if (layout === undefined) {
    const defaults = await readJsonFile<unknown>(config.defaultsPath);
    if (defaults === undefined) {
      sendError(res, 500, `Cannot create layout: defaults file missing at ${config.defaultsPath}`);
      return;
    }
    await writeJsonAtomic(config.layoutPath, defaults);
    layout = defaults;
  }
  sendJson(res, 200, layout);
}

async function handlePutLayout(req: IncomingMessage, res: ServerResponse, config: EditorServerConfig): Promise<void> {
  const raw = await readRequestBody(req);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    sendError(res, 400, `Request body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  await writeJsonAtomic(config.layoutPath, value);
  sendJson(res, 200, value);
}

async function handleGetDefaults(res: ServerResponse, config: EditorServerConfig): Promise<void> {
  const defaults = await readJsonFile<unknown>(config.defaultsPath);
  if (defaults === undefined) {
    sendError(res, 500, `defaults.json is missing at ${config.defaultsPath}`);
    return;
  }
  sendJson(res, 200, defaults);
}

interface ManifestRecord {
  name: string;
  branch: string;
  photo_path: string;
  attendee_id: string;
  [key: string]: unknown;
}

interface ManifestFile {
  schema_version?: number;
  cards: ManifestRecord[];
  [key: string]: unknown;
}

/**
 * Picks the manifest source the same way for every route that needs
 * attendee records: the local dump if present, else the bundled sample.
 * readJsonFile only returns undefined for a genuinely absent file (ENOENT);
 * an unreadable or corrupt dump throws and propagates to the caller instead
 * of silently falling back to sample data and misleading the operator into
 * previewing fake attendees.
 */
async function resolveManifest(
  config: EditorServerConfig,
): Promise<{ data: ManifestFile; source: "local-dump" | "bundled-sample"; sourcePath: string }> {
  const dump = await readJsonFile<ManifestFile>(config.attendeeDumpPath);
  if (dump !== undefined) {
    return { data: dump, source: "local-dump", sourcePath: config.attendeeDumpPath };
  }
  const sourcePath = config.sampleManifestPath;
  const data = await readJsonFile<ManifestFile>(sourcePath);
  if (data === undefined) {
    throw new Error(`Manifest source missing: ${sourcePath}`);
  }
  return { data, source: "bundled-sample", sourcePath };
}

async function handleGetManifest(res: ServerResponse, config: EditorServerConfig): Promise<void> {
  const { data, source, sourcePath } = await resolveManifest(config);
  sendJson(res, 200, { source, sourcePath, ...data });
}

function overridePath(config: EditorServerConfig, id: string): string {
  assertSafePathSegment(id);
  return path.join(config.overridesDir, `${id}.json`);
}

async function handleGetOverride(res: ServerResponse, config: EditorServerConfig, id: string): Promise<void> {
  const target = overridePath(config, id);
  const data = await readJsonFile<unknown>(target);
  sendJson(res, 200, data === undefined ? {} : data);
}

async function handlePutOverride(req: IncomingMessage, res: ServerResponse, config: EditorServerConfig, id: string): Promise<void> {
  const target = overridePath(config, id);
  const raw = await readRequestBody(req);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    sendError(res, 400, `Request body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  await writeJsonAtomic(target, value);
  sendJson(res, 200, value);
}

async function handleDeleteOverride(res: ServerResponse, config: EditorServerConfig, id: string): Promise<void> {
  const target = overridePath(config, id);
  await fsp.rm(target, { force: true });
  res.writeHead(204);
  res.end();
}

const PREVIEW_TIMEOUT_MS = 30_000;

/** Fixed path for the single-record manifest built for per-id preview — like previewPdfPath, overwritten on every id-present /api/preview call, never a second output path. */
function singleRecordManifestPath(config: EditorServerConfig): string {
  return path.join(path.dirname(config.previewPdfPath), ".preview-manifest.json");
}

/**
 * idcards.py's render command has no per-record filter flag (checked
 * build_parser — only `manifest --output --assets-dir --layout
 * --overrides-dir`), so a single-record preview means writing a temp
 * manifest containing just that one record and rendering that. The record's
 * photo_path is resolved to an absolute path here (idcards.py resolves a
 * relative photo_path against the *manifest file's* directory — since this
 * temp manifest lives under tmp/, not next to the source manifest, a
 * relative path would resolve wrong).
 */
async function buildSingleRecordManifest(
  config: EditorServerConfig,
  id: string,
): Promise<{ path: string } | { notFound: true } | { error: string }> {
  let resolved: Awaited<ReturnType<typeof resolveManifest>>;
  try {
    resolved = await resolveManifest(config);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  const record = resolved.data.cards.find((c) => c.attendee_id === id);
  if (!record) {
    return { notFound: true };
  }
  const photoPath = path.isAbsolute(record.photo_path)
    ? record.photo_path
    : path.resolve(path.dirname(resolved.sourcePath), record.photo_path);
  const manifest: ManifestFile = {
    schema_version: resolved.data.schema_version ?? 1,
    cards: [{ ...record, photo_path: photoPath }],
  };
  const manifestPath = singleRecordManifestPath(config);
  await writeJsonAtomic(manifestPath, manifest);
  return { path: manifestPath };
}

/**
 * `id` absent (or no body at all) -> unchanged: renders the sample
 * fixtures against whatever layout is currently on disk at
 * config.layoutPath — NOT the request body. `id` present -> renders JUST
 * that one record, with its saved override applied via --overrides-dir.
 * Either way this reads layoutPath/overridesDir as already-saved state; the
 * editor only enables the relevant Preview button once that state is
 * clean, so this handler never writes layout.json or an override file.
 * Output always lands at the same fixed config.previewPdfPath.
 */
async function handlePostPreview(req: IncomingMessage, res: ServerResponse, config: EditorServerConfig): Promise<void> {
  const raw = await readRequestBody(req);
  let id: string | undefined;
  if (raw.trim() !== "") {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch (err) {
      sendError(res, 400, `Request body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (body !== null && typeof body === "object" && "id" in body) {
      const rawId = (body as { id?: unknown }).id;
      if (rawId !== undefined) {
        if (typeof rawId !== "string" || rawId.length === 0) {
          sendError(res, 400, `"id" must be a non-empty string`);
          return;
        }
        id = rawId;
      }
    }
  }

  await fsp.mkdir(path.dirname(config.previewPdfPath), { recursive: true });

  const args = ["run", "idcards.py", "render"];
  if (id === undefined) {
    args.push(config.sampleManifestPath, "--output", config.previewPdfPath, "--layout", config.layoutPath);
  } else {
    const built = await buildSingleRecordManifest(config, id);
    if ("error" in built) {
      sendError(res, 500, built.error);
      return;
    }
    if ("notFound" in built) {
      sendError(res, 404, `Attendee not found in manifest: ${id}`);
      return;
    }
    args.push(
      built.path,
      "--output",
      config.previewPdfPath,
      "--layout",
      config.layoutPath,
      "--overrides-dir",
      config.overridesDir,
    );
  }

  const spawnFn = config.spawnRenderProcess ?? nodeSpawn;
  let stderr = "";
  const outcome = await new Promise<{ code: number } | { timedOut: true } | { spawnError: Error }>((resolve) => {
    const child = spawnFn("uv", args, { cwd: config.mailmergeRoot });

    const timer = setTimeout(() => {
      child.kill();
      resolve({ timedOut: true });
    }, PREVIEW_TIMEOUT_MS);

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ spawnError: err });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1 });
    });
  });

  if ("spawnError" in outcome) {
    sendError(res, 500, `Failed to start render process: ${outcome.spawnError.message}`);
    return;
  }
  if ("timedOut" in outcome) {
    sendError(res, 500, `Render timed out after ${PREVIEW_TIMEOUT_MS / 1000}s`);
    return;
  }
  if (outcome.code !== 0) {
    sendError(res, 500, stderr.trim() || `Render exited with code ${outcome.code}`);
    return;
  }
  sendJson(res, 200, { ok: true });
}

/** Splits and percent-decodes a URL pathname into segments, dropping empty ones. */
function pathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
}

export function createEditorMiddleware(config: EditorServerConfig): Middleware {
  return function editorMiddleware(req, res, next) {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const segments = pathSegments(url.pathname);
        const method = req.method ?? "GET";

        if (segments[0] !== "api") {
          next();
          return;
        }

        if (segments.length === 2 && segments[1] === "layout") {
          if (method === "GET") return await handleGetLayout(res, config);
          if (method === "PUT") return await handlePutLayout(req, res, config);
          return sendError(res, 405, `Method not allowed: ${method} /api/layout`);
        }

        if (segments.length === 2 && segments[1] === "defaults") {
          if (method === "GET") return await handleGetDefaults(res, config);
          return sendError(res, 405, `Method not allowed: ${method} /api/defaults`);
        }

        if (segments.length === 2 && segments[1] === "manifest") {
          if (method === "GET") return await handleGetManifest(res, config);
          return sendError(res, 405, `Method not allowed: ${method} /api/manifest`);
        }

        if (segments.length === 3 && segments[1] === "override") {
          const id = segments[2] as string;
          if (method === "GET") return await handleGetOverride(res, config, id);
          if (method === "PUT") return await handlePutOverride(req, res, config, id);
          if (method === "DELETE") return await handleDeleteOverride(res, config, id);
          return sendError(res, 405, `Method not allowed: ${method} /api/override/${id}`);
        }

        if (segments.length === 3 && segments[1] === "asset" && segments[2] === "logo") {
          if (method !== "GET") return sendError(res, 405, `Method not allowed: ${method} /api/asset/logo`);
          return await sendFile(res, config.logoPath, "image/png");
        }

        if (segments.length === 5 && segments[1] === "asset" && segments[2] === "doodle") {
          if (method !== "GET") return sendError(res, 405, `Method not allowed: ${method} /api/asset/doodle`);
          const kind = segments[3] as string;
          const name = segments[4] as string;
          if (!isDoodleKind(kind)) return sendError(res, 400, `Unknown doodle kind: ${kind}`);
          let assetPath: string;
          try {
            assetPath = doodleAssetPath(kind, name, config);
          } catch (err) {
            return sendError(res, 400, err instanceof Error ? err.message : String(err));
          }
          return await sendFile(res, assetPath, "image/png");
        }

        if (segments.length === 2 && segments[1] === "preview") {
          if (method !== "POST") return sendError(res, 405, `Method not allowed: ${method} /api/preview`);
          return await handlePostPreview(req, res, config);
        }

        if (segments.length === 2 && segments[1] === "preview.pdf") {
          if (method !== "GET") return sendError(res, 405, `Method not allowed: ${method} /api/preview.pdf`);
          return await sendFile(res, config.previewPdfPath, "application/pdf", { "Cache-Control": "no-store" });
        }

        if (segments.length === 4 && segments[1] === "asset" && segments[2] === "font") {
          if (method !== "GET") return sendError(res, 405, `Method not allowed: ${method} /api/asset/font`);
          const filename = segments[3] as string;
          let fontPath: string;
          try {
            fontPath = fontAssetPath(filename, config.fontsDir);
          } catch (err) {
            return sendError(res, 400, err instanceof Error ? err.message : String(err));
          }
          return await sendFile(res, fontPath, "font/ttf");
        }

        next();
      } catch (err) {
        sendError(res, 500, err instanceof Error ? err.message : String(err));
      }
    })();
  };
}
