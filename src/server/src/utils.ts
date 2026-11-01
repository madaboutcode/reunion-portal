/**
 * Shared server-side utility helpers.
 */

/**
 * Slugify a filename for safe use in flat R2 storage keys.
 *
 * Rules:
 * - Lowercase the entire name part (before extension).
 * - Replace any character that is not alphanumeric or a hyphen with a hyphen.
 * - Collapse consecutive hyphens into one.
 * - Strip leading and trailing hyphens.
 * - Truncate the name part to at most 30 characters.
 * - Re-attach the original extension (lowercased), if present.
 *
 * Examples:
 *   slugifyFileName("My Receipt (1).PDF")  → "my-receipt-1.pdf"
 *   slugifyFileName("proof.jpg")           → "proof.jpg"
 *   slugifyFileName("A---B___C!.png")      → "a-b-c.png"
 *   slugifyFileName("noextension")         → "noextension"
 */
export function slugifyFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  const hasExt = lastDot > 0 && lastDot < fileName.length - 1;

  const rawName = hasExt ? fileName.slice(0, lastDot) : fileName;
  const ext = hasExt ? fileName.slice(lastDot + 1).toLowerCase() : "";

  const slug = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")  // non-alphanumeric runs → single hyphen
    .replace(/-+/g, "-")           // collapse consecutive hyphens (belt-and-suspenders)
    .replace(/^-|-$/g, "")         // strip leading/trailing hyphens
    .slice(0, 30)
    .replace(/-$/g, "");           // strip trailing hyphen introduced by slice

  return hasExt ? `${slug}.${ext}` : slug;
}
