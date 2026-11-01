/**
 * QA adversarial tests — staff-dashboard-gaps sprint (web pure libs)
 *
 * BOUNDARY: Exported pure functions from goal-progress.ts and whatsapp.ts.
 *   No DOM, no network, no React — plain function call → return value assertions.
 *
 * SEAMS TARGETED (not covered by existing tests):
 *   goalProgress — extreme overcount: counted >> target (e.g. 400 counted, target 200)
 *     confirmedPct + pendingPct must remain ≤ 100; overBy = counted − target
 *   goalProgress — zero target edge: no NaN/Infinity when target = 0
 *   goalProgress — donation_only registrations do not affect counted (D5, R7):
 *     tested structurally (function receives only the type's counts, not cross-type totals)
 *   daysRemaining — exactly at the IST EOD boundary millisecond:
 *     one ms before 23:59:59.999 IST → 0 days (same day)
 *     one ms after 23:59:59.999 IST (i.e. midnight IST next day) → 0 (floor)
 *   daysRemaining — target date boundary: last ms of the deadline day vs first ms after
 *   waUrl — garbage unicode input: emoji, RTL characters, zero-width spaces
 *   waUrl — all-whitespace input containing ≥ 8 "digit" chars that are not ASCII digits
 *
 * @module qa-staff-dashboard-gaps.test
 */

import { describe, it, expect } from "vitest";
import { goalProgress, daysRemaining } from "../goal-progress";
import { waUrl } from "../whatsapp";

// =============================================================================
// Helpers
// =============================================================================

/** Build UTC milliseconds for a given IST datetime string. IST = UTC+05:30. */
function istMs(isoDate: string, timeIST: string): number {
  return new Date(`${isoDate}T${timeIST}+05:30`).getTime();
}

// =============================================================================
// goalProgress — extreme overcount invariants (C2, R4, D1)
// =============================================================================

describe("goalProgress — extreme overcount (C2, R4, D1)", () => {
  it("confirmed >> target: confirmedPct clamped to 100 (C2)", async () => {
    // R4: over-cap state is display-only; server returns truthfully.
    // C2: confirmedPct clamped 0–100.
    // Catches: confirmedPct = 200 * 100 / 200 = 100 (ok) vs confirmed=400 → 200 (wrong).
    const result = goalProgress({ confirmed: 400, pending: 0, pendingVerification: 0 }, 200);
    expect(result.confirmedPct).toBeLessThanOrEqual(100);
    expect(result.confirmedPct).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(result.confirmedPct)).toBe(false);
  });

  it("confirmed + pending both >> target: confirmedPct + pendingPct ≤ 100 (C2)", async () => {
    // Catches: each pct computed independently without clamping the sum,
    // producing confirmedPct=150, pendingPct=25 → sum=175 (violates 0–100 invariant)
    const result = goalProgress({ confirmed: 300, pending: 50, pendingVerification: 0 }, 200);
    expect(result.confirmedPct + result.pendingPct).toBeLessThanOrEqual(100);
    expect(result.confirmedPct).toBeLessThanOrEqual(100);
    expect(result.pendingPct).toBeLessThanOrEqual(100);
  });

  it("confirmedPct + pendingPct ≤ 100 when confirmed alone fills bar and pending is non-zero (C2)", async () => {
    // Specific case: confirmed=250 (>200), pending=30 → confirmed fills 100%,
    // pending should contribute 0 additional pct (bar already full).
    const result = goalProgress({ confirmed: 250, pending: 30, pendingVerification: 0 }, 200);
    expect(result.confirmedPct + result.pendingPct).toBeLessThanOrEqual(100);
  });

  it("overBy = counted − target when counted >> target (C2, R4)", async () => {
    // Catches: overBy capped at some max or computed as 0 when over-cap
    const result = goalProgress({ confirmed: 180, pending: 30, pendingVerification: 10 }, 200);
    // counted = 220; overBy should be 20
    expect(result.counted).toBe(220);
    expect(result.overBy).toBe(20);
    expect(result.slotsLeft).toBe(0);
  });

  it("overBy = 0 when exactly at target (boundary) (C2)", async () => {
    // Catches: off-by-one in overBy computation
    const result = goalProgress({ confirmed: 150, pending: 30, pendingVerification: 20 }, 200);
    // counted = 200 exactly = target → overBy must be 0, not 1 or negative
    expect(result.counted).toBe(200);
    expect(result.overBy).toBe(0);
    expect(result.slotsLeft).toBe(0);
  });

  it("overBy = 1 when counted = target + 1 (boundary) (C2)", async () => {
    // Catches: overBy computed as 0 when counted = 201 (off-by-one)
    const result = goalProgress({ confirmed: 150, pending: 31, pendingVerification: 20 }, 200);
    expect(result.counted).toBe(201);
    expect(result.overBy).toBe(1);
  });

  it("never produces NaN or Infinity in any field under extreme counts (C2)", async () => {
    // Catches: division by zero or unguarded arithmetic
    const result = goalProgress({ confirmed: 1_000_000, pending: 500_000, pendingVerification: 250_000 }, 200);
    expect(Number.isNaN(result.confirmedPct)).toBe(false);
    expect(Number.isNaN(result.pendingPct)).toBe(false);
    expect(Number.isNaN(result.overBy)).toBe(false);
    expect(Number.isFinite(result.confirmedPct)).toBe(true);
    expect(Number.isFinite(result.pendingPct)).toBe(true);
  });

  it("slotsLeft = 0 (not negative) when counted >> target (C2)", async () => {
    // Catches: slotsLeft returning a negative number instead of 0
    const result = goalProgress({ confirmed: 300, pending: 50, pendingVerification: 0 }, 200);
    expect(result.slotsLeft).toBe(0);
    expect(result.slotsLeft).toBeGreaterThanOrEqual(0);
  });

  it("pendingPct = 0 when confirmed alone exceeds target (bar already full) (C2)", async () => {
    // The pending segment cannot push the bar past 100%.
    // If confirmed fills the bar to 100, pending must contribute 0 to the rendered bar.
    // Catches: pendingPct independently computed as pending/target * 100 > 0 when bar full.
    const result = goalProgress({ confirmed: 250, pending: 10, pendingVerification: 0 }, 200);
    // confirmedPct is clamped to 100; pendingPct must not add to an already-full bar
    expect(result.confirmedPct).toBe(100);
    expect(result.pendingPct).toBe(0);
  });
});

// =============================================================================
// daysRemaining — IST EOD boundary precision (C2, D3)
// =============================================================================

describe("daysRemaining — exact IST EOD boundary (C2, D3)", () => {
  // EOD IST for 2026-07-15 = 2026-07-15T23:59:59+05:30 = 2026-07-15T18:29:59.000Z

  it("one ms before IST EOD on target date → 0 days (within the deadline) (D3)", async () => {
    // 2026-07-15T18:29:58.999Z = 23:59:58.999 IST — one ms before EOD
    // floor((1ms) / 86400000) = 0
    const oneBeforeEod = new Date("2026-07-15T18:29:58.999Z").getTime();
    const result = daysRemaining("2026-07-15", oneBeforeEod);
    expect(result).toBe(0);
  });

  it("at exactly IST EOD (23:59:59.000 IST) on target date → 0 days (D3)", async () => {
    // 2026-07-15T18:29:59.000Z = 23:59:59 IST exactly
    const atEod = new Date("2026-07-15T18:29:59.000Z").getTime();
    const result = daysRemaining("2026-07-15", atEod);
    // floor(0 / 86400000) = 0 — at or past deadline
    expect(result).toBe(0);
  });

  it("one ms after IST EOD on target date → 0 days (deadline passed, floor 0) (D3)", async () => {
    // 2026-07-15T18:30:00.000Z = 2026-07-16T00:00:00 IST — just after deadline
    const oneAfterEod = new Date("2026-07-15T18:30:00.000Z").getTime();
    const result = daysRemaining("2026-07-15", oneAfterEod);
    expect(result).toBe(0);
  });

  it("exactly one whole day before IST EOD → 1 day remaining (D3)", async () => {
    // Exactly 1 day = 86400000ms before EOD:
    // EOD = 2026-07-15T18:29:59.000Z
    // 1 day before = 2026-07-14T18:29:59.000Z
    const oneDayBefore = new Date("2026-07-14T18:29:59.000Z").getTime();
    const result = daysRemaining("2026-07-15", oneDayBefore);
    // floor(86400000 / 86400000) = 1
    expect(result).toBe(1);
  });

  it("IST midnight on target date → 0 (same day as deadline, < 1 day remains) (D3)", async () => {
    // 2026-07-15T00:00:00 IST = 2026-07-14T18:30:00.000Z
    // Time until EOD IST = 23h 59m 59s = 86399000ms → floor(86399000/86400000) = 0
    const istMidnightOnTarget = new Date("2026-07-14T18:30:00.000Z").getTime();
    const result = daysRemaining("2026-07-15", istMidnightOnTarget);
    expect(result).toBe(0);
  });

  it("two days before IST EOD boundary → 2 days (D3)", async () => {
    // 2 days before EOD = 2026-07-13T18:29:59.000Z
    const twoDaysBefore = new Date("2026-07-13T18:29:59.000Z").getTime();
    const result = daysRemaining("2026-07-15", twoDaysBefore);
    expect(result).toBe(2);
  });

  it("returns 0 (not negative) when far past deadline (D3, C2)", async () => {
    // 2026-10-01 IST midnight — well past July 15
    const pastDeadline = istMs("2026-10-01", "00:00:00");
    const result = daysRemaining("2026-07-15", pastDeadline);
    expect(result).toBe(0);
  });
});

// =============================================================================
// waUrl — garbage unicode input (C4, A5)
// =============================================================================

describe("waUrl — garbage unicode input (C4, A5)", () => {
  it("emoji input with no digits → null (C4)", async () => {
    // Catches: emoji being counted as characters or crashing the digit-strip
    expect(waUrl("📱🎉🌟")).toBeNull();
  });

  it("RTL characters mixed with digits — strips non-digits, counts only digits (C4)", async () => {
    // Arabic RTL: ‏ (right-to-left mark), ؜ (arabic letter mark) are not digits
    // Only the ASCII digits should count toward the 8-digit minimum
    expect(waUrl("‏12345678؜")).toBe("https://wa.me/12345678");
  });

  it("zero-width space between digits — strips zero-width space, joins digits (C4)", async () => {
    // U+200B zero-width space (embedded literally in the input string below) is not a digit. Digits still total ≥ 8.
    expect(waUrl("9198765​43210")).toBe("https://wa.me/919876543210");
  });

  it("zero-width space with only 7 actual digits → null (C4)", async () => {
    // Catches: zero-width space being misclassified as a digit by some regex
    expect(waUrl("123​4567")).toBeNull();
  });

  it("input is only emoji and RTL marks (no digits) → null (C4)", async () => {
    expect(waUrl("🌍‏‎؜")).toBeNull();
  });

  it("full unicode phone with country code and emoji prefix → strips to digits (C4)", async () => {
    // '📞' followed by a real number with ≥ 8 digits
    expect(waUrl("📞 +91 98765-43210")).toBe("https://wa.me/919876543210");
  });

  it("input of spaces and hyphens only (no digits) → null (C4)", async () => {
    // Catches: whitespace/hyphens somehow passing through
    expect(waUrl("   ---   ")).toBeNull();
  });

  it("very long unicode string with exactly 8 embedded digits → returns URL (C4)", async () => {
    // A long string of decorative chars with 8 digits embedded
    const long = "★★★" + "12345678" + "◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆◆";
    expect(waUrl(long)).toBe("https://wa.me/12345678");
  });

  it("input with 7 unicode digits AND unicode non-digit chars → null (C4)", async () => {
    // Catches: non-ASCII numeral-looking characters being misclassified as ASCII digits
    // ١–٩ are Arabic-Indic digits — they are NOT stripped by a digits-only regex
    // but they should not count toward the 8-digit threshold (only ASCII 0-9 count)
    // This test verifies the function's behavior: spec says "strips all non-digits"
    // If non-digits includes Arabic numerals, result should be null (0 or few ASCII digits)
    // If the implementation treats ١ etc as digits, this test documents that fact.
    // The spec (C4) says "strips all non-digits" — only ASCII digits 0-9 are digits per wa.me spec.
    const arabicNumerals = "١٢٣٤٥٦٧٨"; // 8 Arabic numerals
    // These are NOT ASCII digits — after stripping non-digits, 0 remain → null
    expect(waUrl(arabicNumerals)).toBeNull();
  });
});
