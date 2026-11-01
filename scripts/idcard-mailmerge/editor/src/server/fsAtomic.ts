/**
 * Small typed fs helpers the dev middleware builds on: atomic JSON writes,
 * and JSON reads that name the offending file on parse failure. Node fs
 * only — never used from core/.
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/**
 * Reads and JSON-parses filePath. Returns undefined if the file doesn't
 * exist (ENOENT) — that is a normal, expected case callers decide how to
 * handle (e.g. "doesn't exist yet" vs "gone, return {}"). Any other read
 * failure, or a parse failure, throws an Error whose message names
 * filePath — callers must not swallow this into a silently-defaulted body.
 */
export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, "utf-8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return undefined;
    throw new Error(`Failed reading ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Invalid JSON at ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Writes value as pretty JSON to targetPath atomically: serialize to a temp
 * file in the same directory, fsync it, then rename over the target.
 * rename(2) on the same filesystem is atomic, so a concurrent reader never
 * observes a partially-written file, and a write failure (caught below)
 * leaves the original target completely untouched — the temp file is
 * cleaned up and the error is rethrown for the caller to report as a 5xx.
 */
export async function writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
  const dir = path.dirname(targetPath);
  await fsp.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.tmp-${randomUUID()}`);
  const body = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const handle = await fsp.open(tempPath, "w");
    try {
      await handle.writeFile(body, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(tempPath, targetPath);
  } catch (err) {
    await fsp.rm(tempPath, { force: true }).catch(() => undefined);
    throw new Error(`Failed writing ${targetPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
