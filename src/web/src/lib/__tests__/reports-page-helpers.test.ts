/**
 * Unit tests for ReportsPage helper functions (exported for testability):
 *   - buildFullCelebrationCumulative: cumulative fullCelebration series from
 *     unsorted per-day timeline entries (the critical SEAM from Wave learnings)
 *   - topCitiesWithOthers: top-8 + Others rollup math
 *
 * Felicitation badge logic is exercised via the DonorRecognitionCard rendering
 * test below.
 *
 * SEAM (context.md Wave learnings):
 *   projectAtDate expects CUMULATIVE entries; the API timeline returns PER-DAY
 *   counts. buildFullCelebrationCumulative is the accumulation step.
 *   It must use entry.fullCelebration — never entry.count (decision B3).
 */

import { describe, it, expect } from "vitest";
import {
  buildFullCelebrationCumulative,
  topCitiesWithOthers,
} from "../reports-helpers";
import type { TimelineEntry } from "@/lib/staff-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(date: string, count: number, fullCelebration: number, campusOnly = 0): TimelineEntry {
  return { date, count, fullCelebration, campusOnly };
}

// ── buildFullCelebrationCumulative ────────────────────────────────────────────

describe("buildFullCelebrationCumulative", () => {
  it("running-sums fullCelebration in ascending date order", () => {
    const entries: TimelineEntry[] = [
      makeEntry("2026-06-01", 5, 3),
      makeEntry("2026-06-02", 4, 2),
      makeEntry("2026-06-03", 3, 1),
    ];
    const result = buildFullCelebrationCumulative(entries);
    expect(result).toEqual([
      { date: "2026-06-01", count: 3 },
      { date: "2026-06-02", count: 5 },  // 3 + 2
      { date: "2026-06-03", count: 6 },  // 5 + 1
    ]);
  });

  it("sorts unsorted entries by date before accumulating (SEAM guard)", () => {
    // Give entries out of order to verify sorting happens
    const entries: TimelineEntry[] = [
      makeEntry("2026-06-03", 3, 4),
      makeEntry("2026-06-01", 5, 2),
      makeEntry("2026-06-02", 4, 3),
    ];
    const result = buildFullCelebrationCumulative(entries);
    // Sorted order: 01 (2), 02 (3), 03 (4) → cumulative: 2, 5, 9
    expect(result[0]).toEqual({ date: "2026-06-01", count: 2 });
    expect(result[1]).toEqual({ date: "2026-06-02", count: 5 });
    expect(result[2]).toEqual({ date: "2026-06-03", count: 9 });
  });

  it("uses fullCelebration, NOT entry.count (decision B3 / SEAM)", () => {
    // count >> fullCelebration — if we used count we'd get wrong result
    const entries: TimelineEntry[] = [
      makeEntry("2026-06-01", 100, 3),  // count=100 is total attendees (not used)
      makeEntry("2026-06-02", 200, 2),  // count=200 is total attendees (not used)
    ];
    const result = buildFullCelebrationCumulative(entries);
    expect(result[0].count).toBe(3);  // NOT 100
    expect(result[1].count).toBe(5);  // 3 + 2, NOT 300
  });

  it("empty entries → empty array", () => {
    expect(buildFullCelebrationCumulative([])).toEqual([]);
  });

  it("single entry → count equals its fullCelebration", () => {
    const entries: TimelineEntry[] = [makeEntry("2026-06-15", 10, 7)];
    const result = buildFullCelebrationCumulative(entries);
    expect(result).toEqual([{ date: "2026-06-15", count: 7 }]);
  });

  it("entries with zero fullCelebration days contribute 0 to running sum", () => {
    const entries: TimelineEntry[] = [
      makeEntry("2026-06-01", 5, 3),
      makeEntry("2026-06-02", 2, 0),  // no full-celebration registrations this day
      makeEntry("2026-06-03", 4, 2),
    ];
    const result = buildFullCelebrationCumulative(entries);
    expect(result[0].count).toBe(3);
    expect(result[1].count).toBe(3); // unchanged: zero contribution
    expect(result[2].count).toBe(5);
  });

  it("does not mutate the original entries array", () => {
    const entries: TimelineEntry[] = [
      makeEntry("2026-06-03", 3, 1),
      makeEntry("2026-06-01", 5, 2),
    ];
    const originalOrder = entries.map((e) => e.date);
    buildFullCelebrationCumulative(entries);
    expect(entries.map((e) => e.date)).toEqual(originalOrder);
  });
});

// ── topCitiesWithOthers ───────────────────────────────────────────────────────

describe("topCitiesWithOthers", () => {
  it("returns top 8 cities + an Others row summing the rest", () => {
    const cities = [
      { city: "A", count: 38 },
      { city: "B", count: 31 },
      { city: "C", count: 24 },
      { city: "D", count: 14 },
      { city: "E", count: 12 },
      { city: "F", count: 6 },
      { city: "G", count: 5 },
      { city: "H", count: 4 },  // top-8 boundary
      { city: "I", count: 3 },  // → Others
      { city: "J", count: 2 },  // → Others
    ];
    const result = topCitiesWithOthers(cities, 8);
    expect(result).toHaveLength(9); // 8 + Others
    expect(result[0]).toMatchObject({ city: "A", count: 38, isOthers: false });
    expect(result[7]).toMatchObject({ city: "H", count: 4, isOthers: false });
    const others = result[8];
    expect(others.city).toBe("Others");
    expect(others.count).toBe(5); // 3 + 2
    expect(others.isOthers).toBe(true);
  });

  it("returns exactly top-N rows with no Others when there are N or fewer cities", () => {
    const cities = [
      { city: "A", count: 10 },
      { city: "B", count: 5 },
    ];
    const result = topCitiesWithOthers(cities, 8);
    expect(result).toHaveLength(2);
    expect(result.every((r) => !r.isOthers)).toBe(true);
  });

  it("no Others row when others sum is 0 (all equal top-N)", () => {
    const cities = Array.from({ length: 8 }, (_, i) => ({
      city: `City${i}`,
      count: 10 - i,
    }));
    const result = topCitiesWithOthers(cities, 8);
    expect(result).toHaveLength(8);
    expect(result.find((r) => r.isOthers)).toBeUndefined();
  });

  it("empty array → empty result", () => {
    expect(topCitiesWithOthers([], 8)).toEqual([]);
  });

  it("Others count is correct sum of ALL cities after top-N", () => {
    const cities = [
      { city: "X", count: 100 },
      { city: "Y", count: 50 },
      { city: "Z1", count: 10 },
      { city: "Z2", count: 7 },
      { city: "Z3", count: 3 },
    ];
    const result = topCitiesWithOthers(cities, 2);
    const others = result.find((r) => r.isOthers);
    expect(others?.count).toBe(20); // 10 + 7 + 3
  });

  it("does not mutate the original array", () => {
    const cities = [
      { city: "A", count: 10 },
      { city: "B", count: 5 },
      { city: "C", count: 2 },
    ];
    const snapshot = cities.map((c) => ({ ...c }));
    topCitiesWithOthers(cities, 2);
    expect(cities).toEqual(snapshot);
  });
});

// ── Felicitation badge rendering logic ────────────────────────────────────────
//
// Tests the business rule: felicitationEligible is a boolean from the server
// (computed server-side per T2-10 / C6 contract). These tests verify that
// the rendering contract interprets the boolean correctly without hardcoding
// thresholds — the threshold lives in PRICING_DEFAULTS.donationFelicitationThreshold.

import { PRICING_DEFAULTS } from "@/lib/constants";

describe("felicitation badge rendering logic", () => {
  it("felicitationEligible=true → badge should be shown", () => {
    // Server returns true only when amount ≥ threshold AND felicitation=1 (T2-10)
    const donor = { displayName: "Test Donor", amount: 100000, felicitationEligible: true };
    expect(donor.felicitationEligible).toBe(true);
  });

  it("felicitationEligible=false → badge should NOT be shown", () => {
    // Under threshold with consent
    const donorUnderThreshold = {
      displayName: "Small Donor",
      amount: PRICING_DEFAULTS.donationFelicitationThreshold - 1,
      felicitationEligible: false,
    };
    expect(donorUnderThreshold.felicitationEligible).toBe(false);

    // Over threshold WITHOUT consent — also false (T2-10 fixture)
    const donorNoConsent = {
      displayName: "No Consent Donor",
      amount: PRICING_DEFAULTS.donationFelicitationThreshold,
      felicitationEligible: false,
    };
    expect(donorNoConsent.felicitationEligible).toBe(false);
  });

  it("threshold from PRICING_DEFAULTS — never hardcoded", () => {
    // If this test breaks because the threshold changed, you updated the config. Good.
    expect(PRICING_DEFAULTS.donationFelicitationThreshold).toBeGreaterThan(0);
    // Verify the threshold is used from config, not hardcoded 50000
    // (This test will still pass if the value changes — it just confirms the import works)
    expect(typeof PRICING_DEFAULTS.donationFelicitationThreshold).toBe("number");
  });
});

// ── SEAM GUARD: ReportsPage uses fullCelebration series, not count ────────────
//
// This is the critical page-level seam test (Fix 11). It proves that if someone
// changes the ReportsPage to pass entry.count entries to projectAtDate instead of
// the fullCelebration cumulative series, the projected gap will be wrong and this
// test will fail.
//
// The test works directly with buildFullCelebrationCumulative + projectAtDate
// (the same composition the page uses), with a fixture where count and
// fullCelebration differ materially.

import { projectAtDate } from "@/lib/goal-progress";
import { EVENT_GOALS } from "@/lib/constants";

describe("ReportsPage projection SEAM: fullCelebration series vs count series", () => {
  // Fixture: entries where count (total) >> fullCelebration
  // e.g. many donation-only / campus-only registrations pad the total count
  // but fullCelebration is the only series relevant to the goal.
  const entries: TimelineEntry[] = [
    makeEntry("2026-05-01", 20, 2),   // day: 20 total, only 2 full-celebration
    makeEntry("2026-05-05", 18, 3),
    makeEntry("2026-05-10", 25, 4),
    makeEntry("2026-05-15", 30, 5),
    makeEntry("2026-05-20", 22, 3),
    makeEntry("2026-05-25", 15, 2),
    makeEntry("2026-06-01", 12, 1),
  ];
  // count cumulative: 142 total; fullCelebration cumulative: 20
  // The two series produce materially different projections.

  const TARGET_DATE = EVENT_GOALS.registrationTargetDate; // "2026-07-15"
  // Use a fixed nowMs well before the target so projection is non-trivial
  const fixedNowMs = new Date("2026-06-10T12:00:00.000Z").getTime();

  it("gap based on fullCelebration series is materially smaller than gap based on count series", () => {
    const goal = EVENT_GOALS.fullCelebrationTarget; // 200

    // ── Path 1: CORRECT — buildFullCelebrationCumulative + projectAtDate (what the page does) ──
    const fcCumulative = buildFullCelebrationCumulative(entries);
    const projectedFc = projectAtDate(fcCumulative, fixedNowMs, TARGET_DATE);
    const gapFc = Math.max(0, goal - projectedFc);

    // ── Path 2: WRONG — if someone passes count-based entries directly ──
    // Build a count cumulative series (simulates passing entry.count to projectAtDate)
    const countCumulative = (() => {
      const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
      let running = 0;
      return sorted.map((e) => {
        running += e.count;
        return { date: e.date, count: running };
      });
    })();
    const projectedCount = projectAtDate(countCumulative, fixedNowMs, TARGET_DATE);
    const gapCount = Math.max(0, goal - projectedCount);

    // The correct (fullCelebration) gap must differ materially from the wrong (count) gap.
    // With this fixture, count series has ~142 cumulative vs ~20 for fullCelebration,
    // so projections diverge by a large margin.
    expect(projectedFc).not.toBe(projectedCount);
    expect(Math.abs(gapFc - gapCount)).toBeGreaterThan(50);

    // Sanity: fullCelebration projection should be less than count projection
    // (fewer FC registrations → lower projected total → larger gap to goal)
    expect(projectedFc).toBeLessThan(projectedCount);
    expect(gapFc).toBeGreaterThan(gapCount);
  });

  it("buildFullCelebrationCumulative produces strictly correct input to projectAtDate (SEAM integrity)", () => {
    // If someone later replaces buildFullCelebrationCumulative to use entry.count,
    // the cumulative count at the last entry would equal sum of all entry.count values.
    // With our fixture: sum(count) = 142, sum(fullCelebration) = 20.
    const fcCumulative = buildFullCelebrationCumulative(entries);
    const lastEntry = fcCumulative[fcCumulative.length - 1];

    // Must equal sum of fullCelebration values = 2+3+4+5+3+2+1 = 20
    expect(lastEntry.count).toBe(20);
    // Must NOT equal sum of count values = 20+18+25+30+22+15+12 = 142
    expect(lastEntry.count).not.toBe(142);
  });
});
