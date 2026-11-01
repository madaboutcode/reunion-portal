/**
 * whatsapp.ts — wa.me URL builder for staff quick-contact links.
 *
 * CONTRACT:
 *   GUARANTEES:
 *     - waUrl(phone) strips all non-digit characters from the input, then
 *         returns "https://wa.me/<digits>" when ≥ 8 digits remain.
 *     - waUrl(phone) returns null when fewer than 8 digits remain after
 *         stripping (R10).
 *     - No prefilled message text is included — staff compose their own
 *         message (decision A5).
 *   EXPECTS: phone is a string (may contain spaces, dashes, parentheses,
 *     plus signs, country code prefixes, etc.).
 *   FAILURE BEHAVIOR: null/undefined/empty input → null.
 */

/** Minimum digit count for a plausible phone number (local or international). */
const MIN_DIGITS = 8;

/**
 * Builds a wa.me deep-link URL for the given phone number string.
 *
 * @param phone - raw phone string from the registration record (any format)
 * @returns wa.me URL string, or null when the input has fewer than 8 digits
 *
 * @example
 * waUrl("+91 98765-43210") // → "https://wa.me/919876543210"
 * waUrl("04712 345678")    // → "https://wa.me/04712345678"
 * waUrl("1234567")         // → null  (only 7 digits)
 * waUrl(null)              // → null
 */
export function waUrl(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < MIN_DIGITS) return null;
  return `https://wa.me/${digits}`;
}
