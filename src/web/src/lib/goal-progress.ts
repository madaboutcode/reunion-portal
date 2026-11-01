/**
 * goal-progress.ts — Pure derivation functions for event-goal tracking.
 *
 * CONTRACT:
 *   GUARANTEES:
 *     - goalProgress(counts, target) → { counted, confirmedPct, pendingPct,
 *         slotsLeft, overBy }; counted = confirmed + pending + pendingVerification;
 *         confirmedPct and pendingPct clamped to [0, 100] and sum ≤ 100;
 *         overBy > 0 iff counted > target (zero otherwise).
 *     - daysRemaining(targetDateISO, nowMs) → whole days until target date
 *         EOD IST (UTC+05:30 23:59:59), floored at 0. Never negative.
 *     - paceNeeded(gap, daysLeft) → ceil(gap / (daysLeft / 7)), registrations
 *         per week; 0 when gap ≤ 0 or daysLeft = 0. Gap basis for the full-
 *         celebration goal is fullCelebrationTarget only (decision A1) —
 *         campus counts are excluded.
 *     - projectAtDate(timeline, nowMs, targetDateISO) → linear projection from
 *         trailing-14-day average daily rate applied to daysRemaining;
 *         series-agnostic (projects whatever entries it's given, T2-5);
 *         never NaN, never negative.
 *   EXPECTS: all counts ≥ 0; timeline entries { date: ISO "YYYY-MM-DD", count }
 *     sorted or unsorted (sorts internally).
 *   FAILURE BEHAVIOR: zero/empty inputs → zeros, never NaN/Infinity.
 */

// ── IST EOD helpers ──────────────────────────────────────────────────────────

/** IST offset in milliseconds (UTC+05:30). */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Returns the Unix timestamp (ms) for EOD IST (23:59:59.999) of the given
 * ISO date string "YYYY-MM-DD", interpreted in the Asia/Kolkata timezone.
 */
function eodIstMs(dateISO: string): number {
  // Parse the date as a UTC midnight value, then shift to IST midnight, then
  // add 23h 59m 59s 999ms to reach EOD IST.
  const utcMidnight = new Date(dateISO + "T00:00:00.000Z").getTime();
  // IST midnight = UTC midnight − IST offset
  const istMidnight = utcMidnight - IST_OFFSET_MS;
  // EOD IST = IST midnight + 23:59:59.999
  return istMidnight + 23 * 3600_000 + 59 * 60_000 + 59 * 1000 + 999;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface GoalCounts {
  confirmed: number;
  pending: number;
  pendingVerification: number;
}

export interface GoalProgressResult {
  /** confirmed + pending + pendingVerification */
  counted: number;
  /** Percentage of target that is confirmed (0–100). */
  confirmedPct: number;
  /** Percentage of target that is pending (0–100); confirmedPct + pendingPct ≤ 100. */
  pendingPct: number;
  /** max(0, target - counted) */
  slotsLeft: number;
  /** max(0, counted - target); > 0 when over-cap */
  overBy: number;
}

export interface TimelineEntry {
  /** ISO date string "YYYY-MM-DD" */
  date: string;
  count: number;
}

// ── goalProgress ─────────────────────────────────────────────────────────────

/**
 * Derives display-ready progress from raw counts and a target.
 *
 * @param counts - { confirmed, pending, pendingVerification } all ≥ 0
 * @param target - the goal target number (e.g. EVENT_GOALS.fullCelebrationTarget)
 */
export function goalProgress(counts: GoalCounts, target: number): GoalProgressResult {
  const { confirmed, pending, pendingVerification } = counts;
  const counted = confirmed + pending + pendingVerification;

  if (target <= 0 || counted <= 0) {
    return { counted, confirmedPct: 0, pendingPct: 0, slotsLeft: Math.max(0, target), overBy: 0 };
  }

  const confirmedPct = Math.min(100, Math.round((confirmed / target) * 100));
  // Pending must not push past 100 when added to confirmed
  const pendingRaw = Math.round(((pending + pendingVerification) / target) * 100);
  const pendingPct = Math.min(pendingRaw, Math.max(0, 100 - confirmedPct));

  const overBy = Math.max(0, counted - target);
  const slotsLeft = Math.max(0, target - counted);

  return { counted, confirmedPct, pendingPct, slotsLeft, overBy };
}

// ── daysRemaining ────────────────────────────────────────────────────────────

/**
 * Whole days remaining until EOD IST of targetDateISO, relative to nowMs.
 * Floored at 0 — never returns a negative number.
 *
 * @param targetDateISO - "YYYY-MM-DD" (IST semantics)
 * @param nowMs - current time in Unix milliseconds (injected for testability)
 */
export function daysRemaining(targetDateISO: string, nowMs: number): number {
  const deadline = eodIstMs(targetDateISO);
  const diffMs = deadline - nowMs;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / 86_400_000);
}

// ── paceNeeded ───────────────────────────────────────────────────────────────

/**
 * Registrations per week needed to close the gap before the deadline.
 *
 * Gap basis: full-celebration goal ONLY (decision A1). Campus counts must be
 * excluded by the caller — pass gap = max(0, fullCelebrationTarget − fullCounted).
 *
 * @param gap - remaining registrations needed (≥ 0)
 * @param daysLeft - days remaining (≥ 0)
 */
export function paceNeeded(gap: number, daysLeft: number): number {
  if (gap <= 0 || daysLeft <= 0) return 0;
  return Math.ceil(gap / (daysLeft / 7));
}

// ── projectAtDate ────────────────────────────────────────────────────────────

/**
 * Linear projection of cumulative count at targetDateISO, computed from the
 * trailing-14-day average daily rate (decision B7).
 *
 * Series-agnostic: projects whatever timeline entries it is given (T2-5).
 * Callers must pass the correct sub-series (e.g. fullCelebration entries only).
 *
 * @param timeline - { date: "YYYY-MM-DD", count }[] (any order; cumulative)
 * @param nowMs - current time in Unix milliseconds
 * @param targetDateISO - "YYYY-MM-DD"
 */
export function projectAtDate(
  timeline: TimelineEntry[],
  nowMs: number,
  targetDateISO: string,
): number {
  if (timeline.length === 0) return 0;

  // Sort ascending by date
  const sorted = [...timeline].sort((a, b) => a.date.localeCompare(b.date));

  // Current cumulative count: last entry in the sorted series
  const latestCount = sorted[sorted.length - 1].count;

  // Trailing-14-day window: find the count 14 days ago
  const windowMs = 14 * 86_400_000;
  const cutoffMs = nowMs - windowMs;
  // cutoffDate is UTC-anchored (toISOString() emits UTC). This is intentional —
  // consistent with server timeline bucketing which also uses toISOString().slice(0,10).
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

  // Find the last entry at or before cutoffDate to get the count at window start
  let windowStartCount = 0;
  for (const entry of sorted) {
    if (entry.date <= cutoffDate) {
      windowStartCount = entry.count;
    } else {
      break;
    }
  }

  const gained14d = latestCount - windowStartCount;
  const dailyRate = Math.max(0, gained14d / 14);

  const daysLeft = daysRemaining(targetDateISO, nowMs);
  const projected = latestCount + dailyRate * daysLeft;

  // Never negative, never NaN
  return Math.max(0, isFinite(projected) ? Math.round(projected) : 0);
}
