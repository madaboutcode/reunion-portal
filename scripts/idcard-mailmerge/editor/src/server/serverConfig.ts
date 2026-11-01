import path from "node:path";
import type { EditorServerConfig } from "./middleware";

/** Builds the file-adapter config from the editor package dir. mailmergeRoot
 * is one level up — the Python renderer's package root, where the live
 * layout.json / data/ / assets/ that idcards.py reads all live. */
export function buildEditorServerConfig(editorRoot: string): EditorServerConfig {
  const mailmergeRoot = path.resolve(editorRoot, "..");
  return {
    mailmergeRoot,
    layoutPath: path.join(mailmergeRoot, "layout.json"),
    defaultsPath: path.join(editorRoot, "defaults.json"),
    overridesDir: path.join(mailmergeRoot, "data", "overrides"),
    attendeeDumpPath: path.join(mailmergeRoot, "data", "attendees.json"),
    sampleManifestPath: path.join(mailmergeRoot, "fixtures", "attendees.json"),
    spriteCropsDir: path.join(mailmergeRoot, "assets", "crops"),
    nostalgiaCropsDir: path.join(mailmergeRoot, "assets", "doodles-production"),
    logoPath: path.join(mailmergeRoot, "assets", "smriti-logo.png"),
    fontsDir: path.join(mailmergeRoot, "assets", "fonts"),
    previewPdfPath: path.join(mailmergeRoot, "tmp", "preview.pdf"),
  };
}
