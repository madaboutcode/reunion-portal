/**
 * Locks buildEditorServerConfig's write-target paths to outside editor/.
 * This is a regression guard: it exists so a future edit that accidentally
 * points a WRITE target (layout.json, overrides, attendee dump) inside
 * editor/ fails a test instead of silently shipping — the file-adapter is
 * only trustworthy to idcards.py if it reads/writes the real mailmerge
 * root, not a copy inside the editor package.
 */

import { describe, expect, it } from "vitest";
import path from "node:path";
import { buildEditorServerConfig } from "./serverConfig";

const editorRoot = "/abs/path/to/scripts/idcard-mailmerge/editor";
const mailmergeRoot = path.resolve(editorRoot, "..");

describe("buildEditorServerConfig", () => {
  const config = buildEditorServerConfig(editorRoot);

  it.each([
    ["layoutPath", config.layoutPath],
    ["overridesDir", config.overridesDir],
    ["attendeeDumpPath", config.attendeeDumpPath],
    ["previewPdfPath", config.previewPdfPath],
  ])("write target %s resolves outside editor/ and under mailmergeRoot", (_name, target) => {
    expect(target).not.toContain(`${path.sep}editor${path.sep}`);
    expect(target.startsWith(mailmergeRoot)).toBe(true);
  });

  it("defaultsPath is the one path that lives inside editor/ (committed read-only default)", () => {
    expect(config.defaultsPath).toBe(path.join(editorRoot, "defaults.json"));
    expect(config.defaultsPath.endsWith(`${path.sep}editor${path.sep}defaults.json`)).toBe(true);
  });

  it.each([
    ["sampleManifestPath", config.sampleManifestPath],
    ["spriteCropsDir", config.spriteCropsDir],
    ["logoPath", config.logoPath],
  ])("read path %s resolves under mailmergeRoot", (_name, target) => {
    expect(target.startsWith(mailmergeRoot)).toBe(true);
  });
});
