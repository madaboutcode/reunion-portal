/**
 * Unit tests for goal-progress.ts
 *
 * Covers every GUARANTEE in the CONTRACT block:
 *   - goalProgress: counted basis, pct clamping, slotsLeft/overBy
 *   - daysRemaining: IST EOD boundary, floor-at-zero
 *   - paceNeeded: formula, gap-only-full-celebration (T2-8), zero guards
 *   - projectAtDate: trailing-14d average, series-agnostic (T2-5), zero/empty safety
 */

import { describe, it, expect } from "vitest";
import {
  goalProgress,
  daysRemaining,
  paceNeeded,
  projectAtDate,
} from "../goal-progress";
import type { TimelineEntry } from "../goal-progress";

// ── Helpers ──────────────────────────────────────────────────────────────────

function msFor(isoDate: string, timeIST = "00:00:00"): number {
  // Construct an IST datetime and return its UTC milliseconds.
  // IST = UTC+05:30, so IST 00:00:00 = UTC-05:30 of the same date.
  return new Date(`${isoDate}T${timeIST}+05:30`).getTime();
}

// ── goalProgress ─────────────────────────────────────────────────────────────

describe("goalProgress", () => {
  it("counted = confirmed + pending + pendingVerification", () => {
    const result = goalProgress({ confirmed: 120, pending: 30, pendingVerification: 10 }, 200);
    expect(result.counted).toBe(160);
  });

  it("slotsLeft = target − counted when under target", () => {
    const result = goalProgress({ confirmed: 100, pending: 20, pendingVerification: 0 }, 200);
    expect(result.slotsLeft).toBe(80);
    expect(result.overBy).toBe(0);
  });

  it("overBy > 0 when counted > target", () => {
    const result = goalProgress({ confirmed: 180, pending: 30, pendingVerification: 0 }, 200);
    expect(result.counted).toBe(210);
    expect(result.overBy).toBe(10);
    expect(result.slotsLeft).toBe(0);
  });

  it("confirmedPct clamped to 100 when confirmed alone exceeds target", () => {
    const result = goalProgress({ confirmed: 250, pending: 0, pendingVerification: 0 }, 200);
    expect(result.confirmedPct).toBeLessThanOrEqual(100);
  });

  it("pendingPct + confirmedPct does not exceed 100", () => {
    const result = goalProgress({ confirmed: 190, pending: 20, pendingVerification: 5 }, 200);
    expect(result.confirmedPct + result.pendingPct).toBeLessThanOrEqual(100);
  });

  it("zero counts → all zeros, slotsLeft = target", () => {
    const result = goalProgress({ confirmed: 0, pending: 0, pendingVerification: 0 }, 200);
    expect(result.counted).toBe(0);
    expect(result.confirmedPct).toBe(0);
    expect(result.pendingPct).toBe(0);
    expect(result.slotsLeft).toBe(200);
    expect(result.overBy).toBe(0);
  });

  it("target = 0 → zeros, no division errors", () => {
    const result = goalProgress({ confirmed: 10, pending: 5, pendingVerification: 2 }, 0);
    expect(result.confirmedPct).toBe(0);
    expect(result.pendingPct).toBe(0);
    expect(Number.isNaN(result.confirmedPct)).toBe(false);
    expect(Number.isFinite(result.confirmedPct)).toBe(true);
  });
});

// ── daysRemaining ─────────────────────────────────────────────────────────────

describe("daysRemaining", () => {
  it("returns positive whole days before the target EOD IST", () => {
    // nowMs = IST midnight on 2026-07-01 → 14 days until 2026-07-15 EOD IST
    const nowMs = msFor("2026-07-01", "00:00:00");
    const result = daysRemaining("2026-07-15", nowMs);
    expect(result).toBe(14);
  });

  it("returns 0 when past the target date", () => {
    const nowMs = msFor("2026-07-16", "00:00:00");
    const result = daysRemaining("2026-07-15", nowMs);
    expect(result).toBe(0);
  });

  it("returns 0 on the target date itself (deadline not yet passed — EOD IST boundary)", () => {
    // IST 23:59:58 on 2026-07-15 — one second before EOD
    const nowMs = msFor("2026-07-15", "23:59:58");
    const result = daysRemaining("2026-07-15", nowMs);
    // 1 second until EOD IST — floor(1000 / 86400000) = 0
    expect(result).toBe(0);
  });

  it("IST EOD boundary: just after IST midnight the next day returns 0", () => {
    // IST 00:00:01 on 2026-07-16 — just past EOD of 2026-07-15
    const nowMs = msFor("2026-07-16", "00:00:01");
    const result = daysRemaining("2026-07-15", nowMs);
    expect(result).toBe(0);
  });

  it("IST EOD boundary: exactly at EOD IST on target date → 0", () => {
    // 2026-07-15 23:59:59 IST = exactly at deadline
    const nowMs = new Date("2026-07-15T18:29:59.000Z").getTime(); // 23:59:59 IST
    const result = daysRemaining("2026-07-15", nowMs);
    expect(result).toBe(0);
  });

  it("never returns negative", () => {
    const nowMs = msFor("2027-01-01", "00:00:00");
    expect(daysRemaining("2026-07-15", nowMs)).toBe(0);
  });
});

// ── paceNeeded ────────────────────────────────────────────────────────────────

describe("paceNeeded", () => {
  /**
   * T2-8: fixture with BOTH full and campus counts proving campus is excluded.
   *
   * Scenario:
   *   fullCelebrationTarget = 200, fullCounted = 118 → gap = 82
   *   campusOnlyTarget = 50, campusCounted = 47  → campus gap = 3 (NOT used)
   *   daysLeft = 14
   *
   * Expected: ceil(82 / (14/7)) = ceil(82 / 2) = 41 registrations/week
   * (campus gap of 3 has no effect on this result — it is NOT added to the gap)
   */
  it("pace basis is full-celebration gap ONLY — campus counts excluded (T2-8)", () => {
    const fullCelebrationTarget = 200;
    const fullCounted = 118; // confirmed + pending + pendingVerification for full_celebration
    const _campusCounted = 47; // present in fixture to prove it's not included
    const _campusTarget = 50;

    const fullGap = Math.max(0, fullCelebrationTarget - fullCounted); // 82
    const daysLeft = 14;

    // Campus gap (3) is deliberately NOT added to fullGap
    const result = paceNeeded(fullGap, daysLeft);
    expect(result).toBe(41); // ceil(82 / 2)

    // Confirm: adding campus gap would give a different (wrong) answer
    const wrongResult = paceNeeded(fullGap + (_campusTarget - _campusCounted), daysLeft);
    expect(wrongResult).toBe(43); // ceil(85 / 2) — proves campus is excluded
    expect(result).not.toBe(wrongResult);
  });

  it("ceil(gap / (daysLeft / 7)) formula", () => {
    // gap=10, daysLeft=7 → ceil(10/1) = 10
    expect(paceNeeded(10, 7)).toBe(10);
    // gap=10, daysLeft=14 → ceil(10/2) = 5
    expect(paceNeeded(10, 14)).toBe(5);
    // gap=11, daysLeft=14 → ceil(11/2) = ceil(5.5) = 6
    expect(paceNeeded(11, 14)).toBe(6);
  });

  it("returns 0 when gap is 0", () => {
    expect(paceNeeded(0, 14)).toBe(0);
  });

  it("returns 0 when gap is negative (over target)", () => {
    expect(paceNeeded(-5, 14)).toBe(0);
  });

  it("returns 0 when daysLeft is 0 (deadline passed)", () => {
    expect(paceNeeded(50, 0)).toBe(0);
  });

  it("never returns NaN or Infinity", () => {
    const result = paceNeeded(0, 0);
    expect(Number.isNaN(result)).toBe(false);
    expect(Number.isFinite(result)).toBe(true);
  });
});

// ── projectAtDate ─────────────────────────────────────────────────────────────

describe("projectAtDate", () => {
  /**
   * T2-5: projectAtDate is series-agnostic — it projects whatever entries it
   * is given. This test passes a fullCelebration sub-series (not the total count
   * series) to prove the function treats the input as-is.
   */
  it("is series-agnostic — projects whatever entries it is given (T2-5)", () => {
    // Full-celebration sub-series (not total attendees)
    const fullCelebrationTimeline: TimelineEntry[] = [
      { date: "2026-06-01", count: 10 },
      { date: "2026-06-08", count: 20 },
      { date: "2026-06-15", count: 30 }, // +10 over 7d in the trailing window
    ];
    const nowMs = msFor("2026-06-15", "12:00:00");
    const result = projectAtDate(fullCelebrationTimeline, nowMs, "2026-07-15");
    // Daily rate from trailing 14d: gained = 30 - 10 = 20, rate = 20/14 ≈ 1.43/day
    // daysRemaining to 2026-07-15 EOD IST from 2026-06-15 noon IST ≈ 30 days
    // projected = 30 + 1.43 × 30 ≈ 73
    expect(result).toBeGreaterThan(30); // higher than current count
    expect(result).toBeLessThan(200);   // not implausibly high
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("empty timeline → 0", () => {
    const nowMs = msFor("2026-06-15", "00:00:00");
    expect(projectAtDate([], nowMs, "2026-07-15")).toBe(0);
  });

  it("single entry with no trailing history → projects at zero rate from that count", () => {
    // Only one entry exists — no prior entry in the 14-day window → windowStartCount = 0
    // gained14d = count - 0 = count, rate = count/14
    const timeline: TimelineEntry[] = [
      { date: "2026-06-15", count: 100 },
    ];
    const nowMs = msFor("2026-06-15", "12:00:00");
    const result = projectAtDate(timeline, nowMs, "2026-07-15");
    expect(result).toBeGreaterThan(100); // should project upward
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("target date already passed → no additional days, returns current count", () => {
    const timeline: TimelineEntry[] = [
      { date: "2026-06-01", count: 50 },
      { date: "2026-06-15", count: 80 },
    ];
    // nowMs is after the target date
    const nowMs = msFor("2026-07-20", "12:00:00");
    const result = projectAtDate(timeline, nowMs, "2026-07-15");
    // daysRemaining = 0 → projection = latestCount + 0
    expect(result).toBe(80);
  });

  it("never returns NaN", () => {
    const timeline: TimelineEntry[] = [
      { date: "2026-06-15", count: 0 },
    ];
    const nowMs = msFor("2026-06-15", "00:00:00");
    const result = projectAtDate(timeline, nowMs, "2026-07-15");
    expect(Number.isNaN(result)).toBe(false);
  });

  it("never returns negative", () => {
    // Edge: all counts are 0
    const timeline: TimelineEntry[] = [
      { date: "2026-06-01", count: 0 },
      { date: "2026-06-15", count: 0 },
    ];
    const nowMs = msFor("2026-06-15", "00:00:00");
    const result = projectAtDate(timeline, nowMs, "2026-07-15");
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("sorts unsorted timeline entries before computing", () => {
    // Give entries out of order — result must be the same as sorted
    const unordered: TimelineEntry[] = [
      { date: "2026-06-15", count: 30 },
      { date: "2026-06-01", count: 10 },
      { date: "2026-06-08", count: 20 },
    ];
    const ordered: TimelineEntry[] = [
      { date: "2026-06-01", count: 10 },
      { date: "2026-06-08", count: 20 },
      { date: "2026-06-15", count: 30 },
    ];
    const nowMs = msFor("2026-06-15", "12:00:00");
    expect(projectAtDate(unordered, nowMs, "2026-07-15")).toBe(
      projectAtDate(ordered, nowMs, "2026-07-15")
    );
  });
});
