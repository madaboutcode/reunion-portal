/**
 * reports-helpers.ts — Pure helpers for ReportsPage analytics.
 *
 * CONTRACT:
 *   GUARANTEES:
 *     - buildFullCelebrationCumulative(entries) → cumulative fullCelebration
 *       series sorted by date, running-summing entry.fullCelebration (never
 *       entry.count). Empty input → empty array. Does not mutate input.
 *     - topCitiesWithOthers(cities, topN) → top-N rows (isOthers=false) +
 *       optional "Others" row (isOthers=true) summing counts beyond topN.
 *       No Others row when the tail sum is 0. Does not mutate input.
 *   EXPECTS:
 *     - entries: TimelineEntry[] with fullCelebration field (additive, B3).
 *     - cities: GeographyEntry[] pre-sorted DESC by count (server order).
 *   FAILURE BEHAVIOR: empty inputs → empty arrays, no NaN/errors.
 */

import type { TimelineEntry, GeographyEntry } from "./staff-types";

// ── buildFullCelebrationCumulative ────────────────────────────────────────────
//
// The critical SEAM between the per-day API response and projectAtDate, which
// expects CUMULATIVE entries (context.md Wave learnings). Uses fullCelebration
// field — never entry.count, which is total attendees (decision B3).

export function buildFullCelebrationCumulative(
  entries: TimelineEntry[],
): { date: string; count: number }[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const result: { date: string; count: number }[] = [];
  let running = 0;
  for (const e of sorted) {
    running += e.fullCelebration;
    result.push({ date: e.date, count: running });
  }
  return result;
}

// ── topCitiesWithOthers ───────────────────────────────────────────────────────
//
// Takes the server-sorted (DESC) cities list. Returns top-N individual rows
// plus a single "Others" rollup row when the tail is non-empty (decision B1).

export function topCitiesWithOthers(
  cities: GeographyEntry[],
  topN = 8,
): { city: string; count: number; isOthers: boolean }[] {
  if (cities.length === 0) return [];
  const top = cities.slice(0, topN);
  const rest = cities.slice(topN);
  const othersCount = rest.reduce((s, c) => s + c.count, 0);
  const result = top.map((c) => ({ ...c, isOthers: false }));
  if (othersCount > 0) {
    result.push({ city: "Others", count: othersCount, isOthers: true });
  }
  return result;
}
