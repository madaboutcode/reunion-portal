/**
 * Unit tests for whatsapp.ts
 *
 * Covers every GUARANTEE in the CONTRACT block:
 *   - waUrl strips all non-digit characters
 *   - waUrl returns https://wa.me/<digits> when ≥ 8 digits remain
 *   - waUrl returns null when fewer than 8 digits remain
 *   - waUrl returns null for null/undefined/empty input
 */

import { describe, it, expect } from "vitest";
import { waUrl } from "../whatsapp";

describe("waUrl", () => {
  it("strips '+91 98765-43210' format and returns correct wa.me URL", () => {
    expect(waUrl("+91 98765-43210")).toBe("https://wa.me/919876543210");
  });

  it("strips parentheses, spaces, and dashes from a US-format number", () => {
    expect(waUrl("(555) 123-4567")).toBe("https://wa.me/5551234567");
  });

  it("passes a plain digit-only number through unchanged", () => {
    expect(waUrl("919876543210")).toBe("https://wa.me/919876543210");
  });

  it("returns null for fewer than 8 digits (7 digits)", () => {
    expect(waUrl("1234567")).toBeNull();
  });

  it("returns null for exactly 7 digits with formatting", () => {
    expect(waUrl("123-4567")).toBeNull();
  });

  it("returns a URL for exactly 8 digits (minimum threshold)", () => {
    expect(waUrl("12345678")).toBe("https://wa.me/12345678");
  });

  it("returns null for null input", () => {
    expect(waUrl(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(waUrl(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(waUrl("")).toBeNull();
  });

  it("returns null for a string with no digits (only non-digit chars)", () => {
    expect(waUrl("+++---   ()")).toBeNull();
  });

  it("includes no query string or prefilled message text (decision A5)", () => {
    const url = waUrl("+919876543210");
    expect(url).not.toContain("?");
    expect(url).not.toContain("text=");
  });

  it("handles leading zeros in local numbers (≥ 8 digits)", () => {
    // Local number like 04712345678 (11 digits)
    expect(waUrl("04712 345678")).toBe("https://wa.me/04712345678");
  });
});
