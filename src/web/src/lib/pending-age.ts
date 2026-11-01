/**
 * pending-age.ts — Pure functions for pending-payment age display.
 *
 * CONTRACT:
 *   GUARANTEES:
 *     - pendingAgeDays(createdAtMs, nowMs) → non-negative whole days; future
 *         createdAt (clock skew where createdAt > nowMs) → 0.
 *     - pendingAgeLabel(days) → "<1d" when days === 0, else "{n}d".
 *     - isStalePending(days, amberDays) → true iff days > amberDays (strict
 *         greater-than; decision A11, R9).
 *   EXPECTS: createdAtMs and nowMs are Unix milliseconds. Callers supply nowMs
 *     from an injected clock — never call Date.now() here.
 *   FAILURE BEHAVIOR: null/undefined createdAtMs → pendingAgeDays returns null;
 *     downstream callers render "—" for null labels.
 *
 *   LIMITATION (T2-13): only future-createdAt (server clock ahead of client)
 *     is guarded → 0. Multi-day client-clock skew (client clock significantly
 *     ahead or behind actual wall time) will produce incorrect age values. This
 *     is accepted risk for V1 — the staff dashboard is used on devices with
 *     correct system clocks in practice, and the cost of a wrong amber flag is
 *     low (visual indicator only, no enforcement). A server-side age field
 *     would be required to eliminate this limitation entirely.
 */

/**
 * Whole days a registration has been in pending status.
 *
 * @param createdAtMs - timestamp when the registration entered pending (Unix ms)
 * @param nowMs - current time in Unix milliseconds (injected for testability)
 * @returns non-negative integer days, or null if createdAtMs is null/undefined
 */
export function pendingAgeDays(createdAtMs: number | null | undefined, nowMs: number): number | null {
  if (createdAtMs == null) return null;
  const diffMs = nowMs - createdAtMs;
  if (diffMs < 0) return 0; // clock skew: createdAt is in the future
  return Math.floor(diffMs / 86_400_000);
}

/**
 * Human-readable label for a pending age in days.
 *
 * @param days - result of pendingAgeDays (null → caller renders "—")
 */
export function pendingAgeLabel(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return "<1d";
  return `${days}d`;
}

/**
 * Returns true when the pending age exceeds the amber threshold.
 * Strict greater-than (decision A11): exactly amberDays is NOT stale.
 *
 * @param days - result of pendingAgeDays
 * @param amberDays - EVENT_GOALS.pendingAgeAmberDays (typically 3)
 */
export function isStalePending(days: number | null, amberDays: number): boolean {
  if (days === null) return false;
  return days > amberDays;
}
