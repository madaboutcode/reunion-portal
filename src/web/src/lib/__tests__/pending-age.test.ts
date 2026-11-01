/**
 * Unit tests for pending-age.ts
 *
 * Covers every GUARANTEE in the CONTRACT block:
 *   - pendingAgeDays: whole days, future-createdAt → 0, null input → null
 *   - pendingAgeLabel: "<1d" for 0 days (T2-8/A11), "{n}d" otherwise, null → null
 *   - isStalePending: strict greater-than threshold, null → false
 */

import { describe, it, expect } from "vitest";
import { pendingAgeDays, pendingAgeLabel, isStalePending } from "../pending-age";

// ── pendingAgeDays ────────────────────────────────────────────────────────────

describe("pendingAgeDays", () => {
  it("returns 0 for a registration created right now", () => {
    const nowMs = Date.now();
    expect(pendingAgeDays(nowMs, nowMs)).toBe(0);
  });

  it("returns correct whole days for a 3-day-old registration", () => {
    const nowMs = 1_000_000_000_000;
    const createdAtMs = nowMs - 3 * 86_400_000;
    expect(pendingAgeDays(createdAtMs, nowMs)).toBe(3);
  });

  it("floors to whole days (1 day + 23h → 1, not 2)", () => {
    const nowMs = 1_000_000_000_000;
    const createdAtMs = nowMs - (1 * 86_400_000 + 23 * 3_600_000);
    expect(pendingAgeDays(createdAtMs, nowMs)).toBe(1);
  });

  it("future createdAt (clock skew) → 0, never negative (T2-13 guard)", () => {
    const nowMs = 1_000_000_000_000;
    const createdAtMs = nowMs + 86_400_000; // created 1 day in the future
    expect(pendingAgeDays(createdAtMs, nowMs)).toBe(0);
  });

  it("returns null for null createdAtMs", () => {
    expect(pendingAgeDays(null, Date.now())).toBeNull();
  });

  it("returns null for undefined createdAtMs", () => {
    expect(pendingAgeDays(undefined, Date.now())).toBeNull();
  });
});

// ── pendingAgeLabel ───────────────────────────────────────────────────────────

describe("pendingAgeLabel", () => {
  it("returns '<1d' for 0 days (decision A11)", () => {
    expect(pendingAgeLabel(0)).toBe("<1d");
  });

  it("returns '1d' for 1 day", () => {
    expect(pendingAgeLabel(1)).toBe("1d");
  });

  it("returns '3d' for 3 days", () => {
    expect(pendingAgeLabel(3)).toBe("3d");
  });

  it("returns '14d' for 14 days", () => {
    expect(pendingAgeLabel(14)).toBe("14d");
  });

  it("returns null for null input (caller renders '—')", () => {
    expect(pendingAgeLabel(null)).toBeNull();
  });
});

// ── isStalePending ────────────────────────────────────────────────────────────

describe("isStalePending", () => {
  it("returns false when days === amberDays (strict greater-than, decision A11)", () => {
    expect(isStalePending(3, 3)).toBe(false);
  });

  it("returns true when days > amberDays", () => {
    expect(isStalePending(4, 3)).toBe(true);
  });

  it("returns false when days < amberDays", () => {
    expect(isStalePending(2, 3)).toBe(false);
  });

  it("returns false for null days", () => {
    expect(isStalePending(null, 3)).toBe(false);
  });

  it("returns false for 0 days against threshold 3", () => {
    expect(isStalePending(0, 3)).toBe(false);
  });
});
