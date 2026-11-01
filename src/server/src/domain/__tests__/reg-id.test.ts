import { describe, it, expect } from "vitest";
import { generateRegCode } from "../reg-id.js";

/**
 * Tests for generateRegCode().
 *
 * Covers:
 *   REG_ID_FORMAT — length exactly 16 (SMRT + 12 Crockford base32).
 *   REG_ID_UNIQUE — 1 000 calls produce 1 000 distinct IDs.
 *   ANTI-PATTERN  — source file does not use Math.random().
 */

describe("generateRegId", () => {
  it("returns exactly 16 characters (SMRT prefix + 12 base32)", () => {
    const id = generateRegCode();
    expect(id).toHaveLength(16);
  });

  it("format is SMRT followed by 12 Crockford base32 chars (REG_ID_FORMAT)", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateRegCode();
      expect(id).toMatch(/^SMRT[0-9A-HJKMNP-TV-Z]{12}$/);
    }
  });

  it("1 000 calls produce 1 000 unique IDs — zero collisions (REG_ID_UNIQUE)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateRegCode());
    }
    expect(ids.size).toBe(1000);
  });

  it("source file does not use Math.random()", async () => {
    // Grep the implementation source for Math.random to enforce the CSPRNG contract.
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../reg-id.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toContain("Math.random");
  });
});
