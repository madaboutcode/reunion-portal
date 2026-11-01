/**
 * CONTRACT: Registration-desk client helpers.
 *
 * GUARANTEE: EXTRACTS_PASS_CODE — extractPassCode returns the registration
 *   pass code from either a bare code ("SMRT…") or the scanned pass QR
 *   payload, which the pass PDF encodes as `{APP_BASE_URL}/pass#{code}`
 *   (pass.routes.ts GUARANTEE QR_CODE_URL). It takes everything after the
 *   last "#" when one is present, otherwise the trimmed input. The server
 *   normalizes case/hyphens via its own lookup boundary.
 *
 * EXPECTS: input is a single QR payload or code (may include surrounding
 *   whitespace).
 *
 * FAILURE BEHAVIOR: never throws. An input with no code fragment returns the
 *   trimmed input; the lookup API then rejects a malformed code with 404.
 */

/** Extracts the pass code from a scanned QR payload or a manually entered code. */
export function extractPassCode(raw: string): string {
  const trimmed = raw.trim();
  const hashIndex = trimmed.lastIndexOf("#");
  if (hashIndex >= 0 && hashIndex < trimmed.length - 1) {
    return trimmed.slice(hashIndex + 1);
  }
  return trimmed;
}

/**
 * Normalizes a pass/registration code the SAME way the server lookup boundary
 * does (registration-desk.routes.ts normalizePassCode): strip hyphens, trim,
 * uppercase. The lookup API accepts lowercase/hyphenated codes, so client-side
 * code comparisons (e.g. the detail page's current-record render guard) must
 * compare normalized values or a direct URL like `/registration/smrt-79ww-…`
 * would look up fine and then render blank against the canonical attendee code.
 */
export function normalizePassCode(raw: string): string {
  return raw.replace(/-/g, "").trim().toUpperCase();
}
