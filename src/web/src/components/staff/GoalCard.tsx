/**
 * GoalCard — presentational two-segment goal progress card.
 *
 * CONTRACT
 * ────────────────────────────────────────────────────────────────────────────
 * GUARANTEES:
 *   - Accepts props { title, target, confirmed, pending, pendingVerification,
 *     footnote?, slotsNote? }. Never accepts a `counted` prop — derivation is
 *     internal: counted = confirmed + pending + pendingVerification (D7).
 *   - Renders a two-segment progress bar: confirmed → solid green segment,
 *     (pending + pendingVerification) → lighter amber segment. Each segment
 *     width = count / target × 100%, both clamped so their sum never exceeds
 *     100% of bar width (bar cannot overflow).
 *   - A goal end-marker (thin vertical tick) sits at the 100% position.
 *   - Legend line: green dot + confirmed count, amber dot +
 *     pending/needs-verification count, dash + "goal N".
 *   - Over-cap state (counted > target): the count figure turns red and a
 *     "+N over cap" pill is rendered beside it (R4, D1, D7).
 *   - slotsNote renders only when provided (non-empty string) and only when
 *     NOT over-cap (if over cap the "+N over cap" pill takes that role).
 *   - Zero-state (all counts 0): renders sane output — empty bar, legend
 *     shows "0 confirmed · 0 pending / needs-verification", no crash.
 *   - Tailwind utility classes only; named export; exported props interface.
 *
 * EXPECTS:
 *   - All count props ≥ 0 (natural numbers from server aggregates).
 *   - target > 0 (caller must not pass 0 as target; undefined behaviour).
 *
 * FAILURE BEHAVIOR:
 *   - Missing/undefined counts default to 0 via prop defaults — no crash.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { goalProgress } from "@/lib/goal-progress";

export interface GoalCardProps {
  /** Card heading, e.g. "Full Celebration" */
  title: string;
  /** Numeric goal target, e.g. 200 or 50. Never hardcoded here. */
  target: number;
  /** Confirmed (paid + verified) registrations. */
  confirmed: number;
  /** Pending-payment registrations (slot held, payment not yet uploaded). */
  pending: number;
  /** Needs-verification registrations (payment uploaded, awaiting review). */
  pendingVerification: number;
  /** Optional footnote rendered below the legend in muted text. */
  footnote?: string;
  /**
   * Optional near-cap note, e.g. "3 slots left — pending registrations hold a slot".
   * Rendered in amber below the legend when provided AND NOT over-cap.
   * Suppressed when over-cap (the "+N over cap" pill takes that role).
   */
  slotsNote?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GoalCard({
  title,
  target,
  confirmed = 0,
  pending = 0,
  pendingVerification = 0,
  footnote,
  slotsNote,
}: GoalCardProps) {
  // Derivation is internal — D7 explicitly forbids a `counted` prop.
  // Segment widths come from goalProgress() which guarantees confirmedPct + pendingPct ≤ 100.
  const { counted, confirmedPct, pendingPct, overBy } = goalProgress(
    { confirmed, pending, pendingVerification },
    target,
  );
  const pendingTotal = pending + pendingVerification;
  const isOverCap = overBy > 0;

  return (
    <div
      className="rounded-2xl bg-surface border border-border-warm p-4 space-y-3"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      {/* Title */}
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</p>

      {/* Big count + target */}
      <div className="flex items-baseline gap-2">
        <span
          className={[
            "font-body text-3xl font-bold",
            isOverCap ? "text-red-600" : "text-charcoal",
          ].join(" ")}
          data-testid="goal-count"
        >
          {counted}
        </span>
        <span className="text-lg font-normal text-muted">/ {target}</span>

        {/* Over-cap pill */}
        {isOverCap && (
          <span
            className="ml-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold"
            data-testid="overcap-pill"
          >
            +{overBy} over cap
          </span>
        )}
      </div>

      {/* Two-segment progress bar */}
      <div
        className="relative h-2.5 rounded-full bg-border overflow-hidden"
        role="progressbar"
        aria-valuenow={counted}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-label={`${title} progress: ${counted} of ${target}`}
      >
        {/* Confirmed segment — solid green */}
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-green-500 transition-all"
          style={{ width: `${confirmedPct}%` }}
          data-testid="segment-confirmed"
        />
        {/* Pending + pendingVerification segment — amber, starts right after confirmed */}
        <div
          className="absolute top-0 h-full rounded-r-full bg-amber-300 transition-all"
          style={{ left: `${confirmedPct}%`, width: `${pendingPct}%` }}
          data-testid="segment-pending"
        />
        {/* Goal end-marker tick */}
        <div
          className="absolute right-0 top-0 h-full w-0.5 bg-charcoal/30"
          aria-hidden="true"
          data-testid="goal-marker"
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" aria-hidden="true" />
          {confirmed} confirmed
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-300 shrink-0" aria-hidden="true" />
          {pendingTotal} pending / needs-verification
        </span>
        <span className="flex items-center gap-1 text-muted/70">
          <span className="inline-block w-3 h-px bg-charcoal/40 shrink-0" aria-hidden="true" />
          goal {target}
        </span>
      </div>

      {/* Slots note (near-cap, suppressed when over-cap) */}
      {!isOverCap && slotsNote && (
        <p className="text-xs font-semibold text-amber-600" data-testid="slots-note">
          {slotsNote}
        </p>
      )}

      {/* Optional footnote */}
      {footnote && (
        <p className="text-[11px] text-muted/70" data-testid="footnote">
          {footnote}
        </p>
      )}
    </div>
  );
}
