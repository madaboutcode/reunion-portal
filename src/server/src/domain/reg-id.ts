/**
 * CONTRACT: Registration Code Generation
 *
 * GUARANTEES:
 *   REG_ID_FORMAT  — generateRegCode() returns exactly 16 characters
 *                    (SMRT + 12 chars from Crockford base32), each drawn
 *                    from the Crockford base32 alphabet:
 *                    0123456789ABCDEFGHJKMNPQRSTVWXYZ (excludes I, L, O, U).
 *                    The result is URL-safe, case-insensitive, and human-readable.
 *
 *   REG_ID_UNIQUE  — With 12 characters × 5 bits = 60 bits of entropy the
 *                    collision probability for expected volumes is negligible.
 *                    1 000 consecutive calls produce 1 000 distinct values.
 *
 * EXPECTS:
 *   — Web Crypto API available (Workers runtime or Node 20+).
 *     Throws if crypto.getRandomValues is not available.
 *
 * FAILURE BEHAVIORS:
 *   — Does not swallow errors from the CSPRNG; callers see the original throw.
 */
import { REG_CODE_PREFIX } from '@smriti/shared';


// Crockford base32 alphabet — 32 characters, excludes I, L, O, U.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generate a 16-character registration code (SMRT-prefixed Crockford base32).
 *
 * SMRT prefix + 12 chars from Crockford base32.
 * 12 characters × 5 bits = 60 bits of entropy.
 * We read 8 random bytes (64 bits) and extract 5-bit chunks from the
 * high-order 60 bits, discarding the 4 low-order bits.
 */
export function generateRegCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);

  // Assemble 8 bytes into a 64-bit unsigned value (BigInt, big-endian).
  let bits = 0n;
  for (const byte of bytes) {
    bits = (bits << 8n) | BigInt(byte);
  }

  // Discard the 4 low-order bits; we only need the top 60 bits.
  // After this shift, bits[59..0] hold our entropy.
  bits >>= 4n;

  const MASK_60 = (1n << 60n) - 1n;

  let result = "";
  for (let i = 0; i < 12; i++) {
    // Pull the top 5 bits of the remaining 60-bit window.
    const index = Number((bits >> 55n) & 0x1fn);
    result += ALPHABET[index];
    // Slide the window left by 5 bits, keeping only the lower 60 bits.
    bits = (bits << 5n) & MASK_60;
  }

  return REG_CODE_PREFIX + result;
}
