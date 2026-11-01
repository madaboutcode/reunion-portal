/**
 * Real HTTP round-trip tests over the actual middleware — a real
 * node:http server, real fetch() calls, real files on a real temp
 * directory. No mocking of req/res. This is the class of test whose
 * absence let bugs ship silently in Batch A: proving bytes actually landed
 * on disk, not just that a handler function returned the right in-memory
 * value.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess, spawn as SpawnFn } from "node:child_process";
import { createEditorMiddleware, type EditorServerConfig } from "./middleware";

/**
 * Stubs config.spawnRenderProcess so tests never shell out to the real `uv
 * run idcards.py render` — that's slow, needs a real .venv, and isn't what
 * these tests are proving. Each stub is a fake ChildProcess: an EventEmitter
 * with a `.stderr` sub-emitter and a no-op `.kill`, that asynchronously
 * fires `close` (or never does, for the timeout path a real test doesn't
 * exercise here since 30s is too slow for a unit test).
 */
function stubSpawn(opts: { exitCode?: number; stderr?: string; onSpawn?: (args: string[]) => void }): typeof SpawnFn {
  return ((_command: unknown, args: unknown) => {
    opts.onSpawn?.(args as string[]);
    const child = new EventEmitter() as unknown as ChildProcess;
    (child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
    (child as unknown as { kill: () => void }).kill = () => {};
    setImmediate(() => {
      if (opts.stderr) (child.stderr as unknown as EventEmitter).emit("data", Buffer.from(opts.stderr));
      child.emit("close", opts.exitCode ?? 0);
    });
    return child;
  }) as unknown as typeof SpawnFn;
}

let root: string;
let config: EditorServerConfig;
let server: Server;
let baseUrl: string;

const SAMPLE_DEFAULTS = {
  version: 1,
  elements: {
    college: { z: 10, kind: "sprite_alpha", asset: "college", x: 30.2, y: 60.6, w: 21.4, h: 16.6 },
  },
  dynamic: {
    photo_box: { x: 29.5, y: 26.2, w: 21.5, h: 34.0, corner_radius: 3.0 },
  },
};

const SAMPLE_MANIFEST = {
  schema_version: 1,
  cards: [
    { name: "TEST NAME", branch: "TEST BRANCH", photo_path: "portraits/0001.webp", attendee_id: "0001" },
    { name: "SECOND NAME", branch: "SECOND BRANCH", photo_path: "portraits/0002.webp", attendee_id: "0002" },
  ],
};

// A minimal valid 1x1 PNG, so "real non-empty bytes" checks aren't just an empty placeholder.
const FAKE_PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
    "01f15c4890000000a4944415478da6360000002000155273de5000000004945" +
    "4e44ae426082",
  "hex",
);
const FAKE_TTF_BYTES = Buffer.from("not a real ttf but real non-empty bytes on disk", "utf-8");

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "idcard-editor-middleware-test-"));

  await mkdir(path.join(root, "data", "overrides"), { recursive: true });
  await mkdir(path.join(root, "assets", "crops"), { recursive: true });
  await mkdir(path.join(root, "assets", "doodles-production"), { recursive: true });
  await mkdir(path.join(root, "assets", "fonts"), { recursive: true });

  await writeFile(path.join(root, "editor-defaults.json"), JSON.stringify(SAMPLE_DEFAULTS, null, 2));
  await writeFile(path.join(root, "fixtures-attendees.json"), JSON.stringify(SAMPLE_MANIFEST, null, 2));
  await writeFile(path.join(root, "assets", "crops", "college.png"), FAKE_PNG_BYTES);
  await writeFile(path.join(root, "assets", "doodles-production", "friends.png"), FAKE_PNG_BYTES);
  await writeFile(path.join(root, "assets", "logo.png"), FAKE_PNG_BYTES);
  await writeFile(path.join(root, "assets", "fonts", "BarlowCondensed-Regular.ttf"), FAKE_TTF_BYTES);

  config = {
    mailmergeRoot: root,
    layoutPath: path.join(root, "layout.json"), // deliberately absent — GET must create it
    defaultsPath: path.join(root, "editor-defaults.json"),
    overridesDir: path.join(root, "data", "overrides"),
    attendeeDumpPath: path.join(root, "data", "attendees.json"), // absent initially -> bundled-sample branch
    sampleManifestPath: path.join(root, "fixtures-attendees.json"),
    spriteCropsDir: path.join(root, "assets", "crops"),
    nostalgiaCropsDir: path.join(root, "assets", "doodles-production"),
    logoPath: path.join(root, "assets", "logo.png"),
    fontsDir: path.join(root, "assets", "fonts"),
    previewPdfPath: path.join(root, "tmp", "preview.pdf"),
  };

  const middleware = createEditorMiddleware(config);
  server = createServer((req, res) => {
    middleware(req, res, () => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `No route: ${req.method} ${req.url}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind to a port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await rm(root, { recursive: true, force: true });
});

afterEach(() => {
  config.spawnRenderProcess = undefined;
});

describe("GET /api/layout — creates from defaults on first read", () => {
  it("returns the defaults content and materializes layout.json on disk", async () => {
    const res = await fetch(`${baseUrl}/api/layout`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(SAMPLE_DEFAULTS);

    const onDisk = JSON.parse(await readFile(config.layoutPath, "utf-8"));
    expect(onDisk).toEqual(SAMPLE_DEFAULTS);
  });
});

describe("PUT /api/layout -> GET /api/layout round trip", () => {
  it("byte-equals what was PUT, both in the response and on disk", async () => {
    const edited = {
      ...SAMPLE_DEFAULTS,
      elements: {
        ...SAMPLE_DEFAULTS.elements,
        college: { ...SAMPLE_DEFAULTS.elements.college, x: 12.5, opacity: 0.5 },
      },
    };

    const putRes = await fetch(`${baseUrl}/api/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(edited),
    });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody).toEqual(edited);

    const getRes = await fetch(`${baseUrl}/api/layout`);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody).toEqual(edited);

    const onDiskRaw = await readFile(config.layoutPath, "utf-8");
    expect(JSON.parse(onDiskRaw)).toEqual(edited);
    console.log("PUT /api/layout on-disk bytes after round trip:\n" + onDiskRaw);
  });
});

describe("GET /api/defaults", () => {
  it("returns defaults.json contents, independent of any layout.json edits", async () => {
    const res = await fetch(`${baseUrl}/api/defaults`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SAMPLE_DEFAULTS);
  });
});

describe("GET /api/manifest — source naming", () => {
  it("names bundled-sample when no local attendee dump exists", async () => {
    const res = await fetch(`${baseUrl}/api/manifest`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; cards: unknown[] };
    expect(body.source).toBe("bundled-sample");
    expect(body.cards).toEqual(SAMPLE_MANIFEST.cards);
  });

  it("names local-dump once a local attendee dump file exists", async () => {
    const localDump = { schema_version: 1, cards: [{ name: "LOCAL", branch: "LOCAL BRANCH", photo_path: "portraits/9999.webp", attendee_id: "9999" }] };
    await writeFile(config.attendeeDumpPath, JSON.stringify(localDump));
    try {
      const res = await fetch(`${baseUrl}/api/manifest`);
      const body = (await res.json()) as { source: string; cards: unknown[] };
      expect(body.source).toBe("local-dump");
      expect(body.cards).toEqual(localDump.cards);
    } finally {
      await rm(config.attendeeDumpPath, { force: true });
    }
  });

  it("returns a 5xx (not a silent bundled-sample fallback) when the local dump exists but is unreadable", async () => {
    // root runs bypass file permissions entirely, so chmod 0o000 is a
    // no-op and this positive assertion can't hold — skip it there. The
    // negative-witness tests above already cover the sample-fallback path.
    if (process.getuid?.() === 0) return;

    const localDump = { schema_version: 1, cards: [{ name: "UNREADABLE", branch: "X", photo_path: "portraits/0001.webp", attendee_id: "0001" }] };
    await writeFile(config.attendeeDumpPath, JSON.stringify(localDump));
    await chmod(config.attendeeDumpPath, 0o000);
    try {
      const res = await fetch(`${baseUrl}/api/manifest`);
      expect(res.status).toBeGreaterThanOrEqual(500);
      const body = (await res.json()) as { source?: string };
      expect(body.source).not.toBe("bundled-sample");
    } finally {
      await chmod(config.attendeeDumpPath, 0o644);
      await rm(config.attendeeDumpPath, { force: true });
    }
  });
});

describe("PUT /api/override/:id -> GET -> DELETE -> GET round trip", () => {
  it("PUT then GET returns the same sparse body; DELETE then GET returns {}", async () => {
    const sparse = { photo: { zoom: 1.4 } };

    const putRes = await fetch(`${baseUrl}/api/override/0042`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sparse),
    });
    expect(putRes.status).toBe(200);

    const getRes = await fetch(`${baseUrl}/api/override/0042`);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual(sparse);

    const onDisk = JSON.parse(await readFile(path.join(config.overridesDir, "0042.json"), "utf-8"));
    expect(onDisk).toEqual(sparse);

    const deleteRes = await fetch(`${baseUrl}/api/override/0042`, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);

    const getAfterDeleteRes = await fetch(`${baseUrl}/api/override/0042`);
    expect(getAfterDeleteRes.status).toBe(200);
    expect(await getAfterDeleteRes.json()).toEqual({});
  });

  it("GET on a record with no override file ever having existed returns {}", async () => {
    const res = await fetch(`${baseUrl}/api/override/1234`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("DELETE on a record with no override file returns 204 (not 404)", async () => {
    const res = await fetch(`${baseUrl}/api/override/9876`, { method: "DELETE" });
    expect(res.status).toBe(204);
  });
});

describe("Real asset bytes", () => {
  it("GET /api/asset/doodle/sprite_alpha/college returns real non-empty PNG bytes", async () => {
    const res = await fetch(`${baseUrl}/api/asset/doodle/sprite_alpha/college`);
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.equals(FAKE_PNG_BYTES)).toBe(true);
  });

  it("GET /api/asset/doodle/nostalgia_opaque/friends returns real non-empty PNG bytes", async () => {
    const res = await fetch(`${baseUrl}/api/asset/doodle/nostalgia_opaque/friends`);
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(FAKE_PNG_BYTES)).toBe(true);
  });

  it("GET /api/asset/logo returns real non-empty bytes", async () => {
    const res = await fetch(`${baseUrl}/api/asset/logo`);
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(FAKE_PNG_BYTES)).toBe(true);
  });

  it("GET /api/asset/font/BarlowCondensed-Regular.ttf returns real non-empty bytes", async () => {
    const res = await fetch(`${baseUrl}/api/asset/font/BarlowCondensed-Regular.ttf`);
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.equals(FAKE_TTF_BYTES)).toBe(true);
  });

  it("404s for an asset name that doesn't exist on disk", async () => {
    const res = await fetch(`${baseUrl}/api/asset/doodle/sprite_alpha/does_not_exist`);
    expect(res.status).toBe(404);
  });

  it("400s for an unknown doodle kind", async () => {
    const res = await fetch(`${baseUrl}/api/asset/doodle/not_a_kind/college`);
    expect(res.status).toBe(400);
  });

  it("400s for a path-traversal attempt in the asset name", async () => {
    const res = await fetch(`${baseUrl}/api/asset/doodle/sprite_alpha/${encodeURIComponent("../../etc/passwd")}`);
    expect(res.status).toBe(400);
  });

  it("400s for a non-.ttf font filename", async () => {
    const res = await fetch(`${baseUrl}/api/asset/font/BarlowCondensed-Regular.otf`);
    expect(res.status).toBe(400);
  });
});

describe("Malformed JSON on disk", () => {
  it("GET /api/layout returns 5xx naming the offending file", async () => {
    await writeFile(config.layoutPath, "{ this is not valid json");
    try {
      const res = await fetch(`${baseUrl}/api/layout`);
      expect(res.status).toBeGreaterThanOrEqual(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain(config.layoutPath);
    } finally {
      // Restore valid content so later tests in this run aren't order-dependent on this corruption.
      await writeFile(config.layoutPath, JSON.stringify(SAMPLE_DEFAULTS, null, 2));
    }
  });

  it("GET /api/override/:id returns 5xx naming the offending file when the override file is corrupt", async () => {
    const target = path.join(config.overridesDir, "corrupt.json");
    await writeFile(target, "not json at all {{{");
    try {
      const res = await fetch(`${baseUrl}/api/override/corrupt`);
      expect(res.status).toBeGreaterThanOrEqual(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain(target);
    } finally {
      await rm(target, { force: true });
    }
  });
});

describe("POST /api/preview", () => {
  it("never writes to layout.json — it renders whatever is already on disk", async () => {
    const sentinel = { ...SAMPLE_DEFAULTS, elements: { ...SAMPLE_DEFAULTS.elements, marker: "untouched-by-preview" } };
    await writeFile(config.layoutPath, JSON.stringify(sentinel, null, 2));
    config.spawnRenderProcess = stubSpawn({ exitCode: 0 });
    try {
      const res = await fetch(`${baseUrl}/api/preview`, { method: "POST" });
      expect(res.status).toBe(200);
      const onDisk = JSON.parse(await readFile(config.layoutPath, "utf-8"));
      expect(onDisk).toEqual(sentinel);
    } finally {
      await writeFile(config.layoutPath, JSON.stringify(SAMPLE_DEFAULTS, null, 2));
    }
  });

  it("a mocked exit-0 close event -> 200 {ok:true}", async () => {
    config.spawnRenderProcess = stubSpawn({ exitCode: 0 });
    const res = await fetch(`${baseUrl}/api/preview`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("a mocked non-zero exit -> 500 with stderr text in the body", async () => {
    config.spawnRenderProcess = stubSpawn({ exitCode: 2, stderr: "ERROR: Photo does not exist: portraits/0001.webp" });
    const res = await fetch(`${baseUrl}/api/preview`, { method: "POST" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Photo does not exist");
  });

  it("405s for a non-POST method", async () => {
    const res = await fetch(`${baseUrl}/api/preview`, { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("with no `id` in the body, renders the sample manifest unchanged — no --overrides-dir flag", async () => {
    let capturedArgs: string[] = [];
    config.spawnRenderProcess = stubSpawn({ exitCode: 0, onSpawn: (args) => (capturedArgs = args) });
    const res = await fetch(`${baseUrl}/api/preview`, { method: "POST" });
    expect(res.status).toBe(200);

    const renderIdx = capturedArgs.indexOf("render");
    expect(capturedArgs[renderIdx + 1]).toBe(config.sampleManifestPath);
    expect(capturedArgs).not.toContain("--overrides-dir");
  });

  it("with `id` in the body, renders a single-record manifest with --overrides-dir", async () => {
    let capturedArgs: string[] = [];
    config.spawnRenderProcess = stubSpawn({ exitCode: 0, onSpawn: (args) => (capturedArgs = args) });
    const res = await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "0002" }),
    });
    expect(res.status).toBe(200);

    const overridesIdx = capturedArgs.indexOf("--overrides-dir");
    expect(overridesIdx).toBeGreaterThan(-1);
    expect(capturedArgs[overridesIdx + 1]).toBe(config.overridesDir);

    const layoutIdx = capturedArgs.indexOf("--layout");
    expect(capturedArgs[layoutIdx + 1]).toBe(config.layoutPath);

    const renderIdx = capturedArgs.indexOf("render");
    const manifestPathArg = capturedArgs[renderIdx + 1];
    if (!manifestPathArg) throw new Error("render command had no manifest argument");
    expect(manifestPathArg).not.toBe(config.sampleManifestPath);

    const manifestOnDisk = JSON.parse(await readFile(manifestPathArg, "utf-8")) as {
      cards: Array<{ attendee_id: string; photo_path: string }>;
    };
    expect(manifestOnDisk.cards).toHaveLength(1);
    const [onlyCard] = manifestOnDisk.cards;
    if (!onlyCard) throw new Error("single-record manifest had no cards");
    expect(onlyCard.attendee_id).toBe("0002");
    // photo_path must be absolute — the temp manifest doesn't live next to
    // fixtures-attendees.json, so a relative path would resolve wrong.
    expect(path.isAbsolute(onlyCard.photo_path)).toBe(true);
    expect(onlyCard.photo_path).toBe(path.resolve(path.dirname(config.sampleManifestPath), "portraits/0002.webp"));
  });

  it("404s when `id` doesn't match any record in the manifest", async () => {
    config.spawnRenderProcess = stubSpawn({ exitCode: 0 });
    const res = await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
  });

  it("400s for a non-string id", async () => {
    const res = await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: 42 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/preview.pdf", () => {
  it("404s before any preview has ever been rendered", async () => {
    await rm(config.previewPdfPath, { force: true });
    const res = await fetch(`${baseUrl}/api/preview.pdf`);
    expect(res.status).toBe(404);
  });

  it("serves real bytes with a no-store header once a preview file exists on disk", async () => {
    const FAKE_PDF_BYTES = Buffer.from("%PDF-1.4\nfake but real non-empty bytes\n%%EOF", "utf-8");
    await mkdir(path.dirname(config.previewPdfPath), { recursive: true });
    await writeFile(config.previewPdfPath, FAKE_PDF_BYTES);
    try {
      const res = await fetch(`${baseUrl}/api/preview.pdf`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.equals(FAKE_PDF_BYTES)).toBe(true);
    } finally {
      await rm(config.previewPdfPath, { force: true });
    }
  });
});

describe("Unroutable requests fall through to next()", () => {
  it("returns the fallback 404 for an unknown /api/* route", async () => {
    const res = await fetch(`${baseUrl}/api/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("returns the fallback 404 for a non-/api/ path", async () => {
    const res = await fetch(`${baseUrl}/some/other/path`);
    expect(res.status).toBe(404);
  });
});
