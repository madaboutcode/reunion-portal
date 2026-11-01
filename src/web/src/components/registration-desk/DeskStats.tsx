import { useEffect, useRef, useState } from "react";
import { deskStats } from "@/lib/staff-api";
import type { DeskStatsResponse } from "@/lib/staff-types";

const REFRESH_MS = 30_000;

/**
 * CONTRACT: Live roster counts at the foot of the registration desk page.
 *
 * GUARANTEES:
 *   - On mount it fetches GET /api/staff/desk/stats, then re-fetches on a
 *     REFRESH_MS (30s) interval; the interval is cleared on unmount.
 *   - A refresh error never blanks the panel: the last good figures stay on
 *     screen (a stale count beats an empty one at a live desk). Only the very
 *     first fetch failing — before any data arrives — shows an error line.
 *   - Counts are read-only and carry no registration data (names, contact,
 *     payment) — the endpoint returns only totals + present, by type.
 */
export function DeskStats() {
  const [stats, setStats] = useState<DeskStatsResponse | null>(null);
  const [initialError, setInitialError] = useState(false);
  // Mirrors `stats` for the async callback without making it an effect dep —
  // keeps the interval stable across renders.
  const hasDataRef = useRef(false);

  useEffect(() => {
    let active = true;

    function load() {
      deskStats()
        .then((next) => {
          if (!active) return;
          hasDataRef.current = true;
          setStats(next);
          setInitialError(false);
        })
        .catch(() => {
          if (!active) return;
          // Keep the last good figures; only flag an error if we never had any.
          if (!hasDataRef.current) setInitialError(true);
        });
    }

    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (initialError) {
    return (
      <section className="mx-auto mt-10 w-full max-w-[560px] border-t border-border-warm pt-6 text-center">
        <p className="text-sm text-muted">Live counts are unavailable right now.</p>
      </section>
    );
  }

  if (!stats) {
    return (
      <section className="mx-auto mt-10 w-full max-w-[560px] border-t border-border-warm pt-6 text-center">
        <p className="text-sm text-muted">Loading live counts…</p>
      </section>
    );
  }

  const pct = stats.total > 0 ? Math.round((stats.checkedIn / stats.total) * 100) : 0;

  return (
    <section
      className="mx-auto mt-10 w-full max-w-[560px] border-t border-border-warm pt-7 text-center"
      data-testid="desk-stats"
    >
      <p className="font-accent text-lg text-terracotta">On the day</p>

      <p className="mt-1 font-heading text-4xl font-bold leading-none text-charcoal">
        <span data-testid="desk-stats-checked-in">{stats.checkedIn}</span>
        <span className="text-muted"> / {stats.total}</span>
      </p>
      <p className="mt-1 text-sm text-muted">checked in of all attendees</p>

      {/* Overall progress */}
      <div
        className="mx-auto mt-4 h-2 w-full max-w-[320px] overflow-hidden rounded-full bg-border-warm/60"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Attendees checked in"
      >
        <div className="h-full rounded-full bg-terracotta transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>

      {/* Per-type breakdown */}
      <div className="mx-auto mt-6 grid max-w-[360px] grid-cols-2 gap-3">
        <TypeTile
          label="Full Celebration"
          checkedIn={stats.byType.full_celebration.checkedIn}
          total={stats.byType.full_celebration.total}
        />
        <TypeTile
          label="Campus Celebration"
          checkedIn={stats.byType.campus_only.checkedIn}
          total={stats.byType.campus_only.total}
        />
      </div>
    </section>
  );
}

function TypeTile(props: { label: string; checkedIn: number; total: number }) {
  return (
    <div className="rounded-xl border border-border-warm bg-surface/60 px-4 py-3">
      <p className="font-heading text-2xl font-bold leading-none text-charcoal">
        {props.checkedIn}
        <span className="text-muted"> / {props.total}</span>
      </p>
      <p className="mt-1 text-xs text-muted">{props.label}</p>
    </div>
  );
}
