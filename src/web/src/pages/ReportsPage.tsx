import { useState, useEffect, useMemo } from "react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { fetchReports } from "@/lib/staff-api";
import type { ReportsResponse, BranchBreakdown, TimelineEntry, RevenueSummary, ContributionAggregate, DonationTotals, GeographyEntry, CountryEntry, DonorRecognition, BudgetProgress, BudgetProgressCategory } from "@/lib/staff-types";
import { BRANCH_SHORT_NAMES, CONTRIBUTION_CAUSE_LABELS, EVENT_GOALS, PRICING_DEFAULTS } from "@/lib/constants";
import { projectAtDate } from "@/lib/goal-progress";
import { buildFullCelebrationCumulative, topCitiesWithOthers } from "@/lib/reports-helpers";

// ── Helpers ────────────────────────────────────────────────────────────────

function branchShort(branch: string): string {
  return (BRANCH_SHORT_NAMES as Record<string, string>)[branch] ?? branch;
}

function formatINR(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

// ── Contributions by cause ─────────────────────────────────────────────────

function ContributionsBySource({
  contributions,
  donations,
}: {
  contributions: ContributionAggregate[];
  donations: DonationTotals;
}) {
  const hasDonations = donations.total > 0;
  const hasContributions = contributions.length > 0;

  if (!hasContributions && !hasDonations) {
    return null;
  }

  return (
    <div
      className="bg-surface border border-border-warm rounded-2xl p-5 mb-6"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider mb-4">
        Contributions by Cause
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-warm">
            <th className="text-left py-2 pr-4 text-xs text-muted font-semibold uppercase tracking-wider">Cause</th>
            <th className="text-center py-2 px-3 text-xs text-muted font-semibold uppercase tracking-wider">Count</th>
            <th className="text-right py-2 pl-3 text-xs text-muted font-semibold uppercase tracking-wider">Total</th>
          </tr>
        </thead>
        <tbody>
          {contributions.map((row) => {
            const label = (CONTRIBUTION_CAUSE_LABELS as Record<string, string>)[row.cause] ?? row.cause;
            return (
              <tr key={row.cause} className="border-b border-border-warm last:border-b-0">
                <td className="py-2.5 pr-4 font-medium text-charcoal">{label}</td>
                <td className="text-center py-2.5 px-3 text-charcoal">{row.count}</td>
                <td className="text-right py-2.5 pl-3 font-semibold text-charcoal">{formatINR(row.total)}</td>
              </tr>
            );
          })}
          {hasDonations && (
            <tr className="border-b border-border-warm last:border-b-0">
              <td className="py-2.5 pr-4 font-medium text-charcoal">Reunion donations</td>
              <td className="text-center py-2.5 px-3 text-charcoal">{donations.count}</td>
              <td className="text-right py-2.5 pl-3 font-semibold text-charcoal">{formatINR(donations.total)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Revenue Summary ────────────────────────────────────────────────────────

function RevenueSummarySection({ revenue }: { revenue: RevenueSummary }) {
  const pct = revenue.expected > 0
    ? Math.round((revenue.collected / revenue.expected) * 100)
    : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* Collected */}
      <div
        className="bg-surface border border-border-warm rounded-2xl p-5"
        style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
      >
        <p className="text-xs text-muted font-semibold uppercase tracking-wider mb-2">Collected</p>
        <p className="text-2xl font-bold text-success">{formatINR(revenue.collected)}</p>
        <p className="text-sm text-muted mt-1">{pct}% of expected</p>
      </div>

      {/* Expected */}
      <div
        className="bg-surface border border-border-warm rounded-2xl p-5"
        style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
      >
        <p className="text-xs text-muted font-semibold uppercase tracking-wider mb-2">Expected</p>
        <p className="text-2xl font-bold text-charcoal">{formatINR(revenue.expected)}</p>
      </div>

      {/* Pending */}
      <div
        className="bg-surface border border-border-warm rounded-2xl p-5"
        style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
      >
        <p className="text-xs text-muted font-semibold uppercase tracking-wider mb-2">Pending</p>
        <p className="text-2xl font-bold text-warning">{formatINR(revenue.pending)}</p>
      </div>
    </div>
  );
}

// ── Budget Progress ────────────────────────────────────────────────────────

function BudgetProgressCard({
  label,
  badgeClass,
  barClass,
  category,
}: {
  label: string;
  badgeClass: string;
  barClass: string;
  category: BudgetProgressCategory;
}) {
  const pct = category.target > 0
    ? Math.round((category.actual / category.target) * 100)
    : 0;

  return (
    <div
      className="bg-surface border border-border-warm rounded-2xl p-5"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider mb-3 ${badgeClass}`}>
        {label}
      </span>
      <p className="text-2xl font-bold text-charcoal">{formatINR(category.actual)}</p>
      <p className="text-sm text-muted mt-1 mb-3">of {formatINR(category.target)}</p>
      <div className="h-1.5 rounded-full bg-border-warm overflow-hidden">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <p className="text-xs text-muted mt-1.5">{pct}%</p>
    </div>
  );
}

function BudgetProgressCards({ budgetProgress }: { budgetProgress: BudgetProgress }) {
  return (
    <div className="mb-6">
      <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider mb-4">
        Budget Progress
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BudgetProgressCard
          label="Event Fees"
          badgeClass="bg-terracotta/10 text-terracotta"
          barClass="bg-terracotta"
          category={budgetProgress.event}
        />
        <BudgetProgressCard
          label="Accommodation"
          badgeClass="bg-soft-aqua-deep/10 text-soft-aqua-deep"
          barClass="bg-soft-aqua-deep"
          category={budgetProgress.accommodation}
        />
      </div>
    </div>
  );
}

// ── Branch Participation Table ─────────────────────────────────────────────

function BranchTable({ rows }: { rows: BranchBreakdown[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      confirmed: acc.confirmed + r.confirmed,
      pendingVerification: acc.pendingVerification + r.pendingVerification,
      pending: acc.pending + r.pending,
      collectedRevenue: acc.collectedRevenue + r.collectedRevenue,
      expectedRevenue: acc.expectedRevenue + r.expectedRevenue,
    }),
    { total: 0, confirmed: 0, pendingVerification: 0, pending: 0, collectedRevenue: 0, expectedRevenue: 0 },
  );

  return (
    <div
      className="bg-surface border border-border-warm rounded-2xl p-5 mb-6"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider mb-4">
        Branch Participation
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-warm">
              <th className="text-left py-2 pr-4 text-xs text-muted font-semibold uppercase tracking-wider">Branch</th>
              <th className="text-center py-2 px-3 text-xs text-muted font-semibold uppercase tracking-wider">Registered</th>
              <th className="text-center py-2 px-3 text-xs text-muted font-semibold uppercase tracking-wider">Confirmed</th>
              <th className="text-center py-2 px-3 text-xs text-muted font-semibold uppercase tracking-wider">Verification</th>
              <th className="text-center py-2 px-3 text-xs text-muted font-semibold uppercase tracking-wider">Pending</th>
              <th className="text-right py-2 px-3 text-xs text-muted font-semibold uppercase tracking-wider">Collected</th>
              <th className="text-right py-2 pl-3 text-xs text-muted font-semibold uppercase tracking-wider">Expected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.branch} className="border-b border-border-warm last:border-b-0">
                <td className="py-2.5 pr-4 font-medium text-charcoal">{branchShort(row.branch)}</td>
                <td className="text-center py-2.5 px-3 font-semibold text-charcoal">{row.total}</td>
                <td className="text-center py-2.5 px-3 font-semibold text-success">{row.confirmed}</td>
                <td className="text-center py-2.5 px-3 font-semibold text-blue-500">{row.pendingVerification}</td>
                <td className="text-center py-2.5 px-3 font-semibold text-warning">{row.pending}</td>
                <td className="text-right py-2.5 px-3 text-charcoal">{formatINR(row.collectedRevenue)}</td>
                <td className="text-right py-2.5 pl-3 text-charcoal">{formatINR(row.expectedRevenue)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border-warm">
              <td className="py-2.5 pr-4 text-xs text-charcoal font-bold uppercase tracking-wider">Total</td>
              <td className="text-center py-2.5 px-3 font-bold text-charcoal">{totals.total}</td>
              <td className="text-center py-2.5 px-3 font-bold text-success">{totals.confirmed}</td>
              <td className="text-center py-2.5 px-3 font-bold text-blue-500">{totals.pendingVerification}</td>
              <td className="text-center py-2.5 px-3 font-bold text-warning">{totals.pending}</td>
              <td className="text-right py-2.5 px-3 font-bold text-charcoal">{formatINR(totals.collectedRevenue)}</td>
              <td className="text-right py-2.5 pl-3 font-bold text-charcoal">{formatINR(totals.expectedRevenue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Registration Timeline ──────────────────────────────────────────────────

type TimelineView = "cumulative" | "weekly" | "calendar";

const VIEW_OPTIONS: { key: TimelineView; label: string }[] = [
  { key: "cumulative", label: "Trend" },
  { key: "weekly", label: "Weekly" },
  { key: "calendar", label: "Calendar" },
];

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Shared data structures ────────────────────────────────────────────────

interface DailyMap {
  map: Map<string, number>;
  total: number;
  maxDaily: number;
}

function buildDailyMap(entries: TimelineEntry[]): DailyMap {
  const map = new Map<string, number>();
  let total = 0;
  let maxDaily = 0;
  for (const e of entries) {
    map.set(e.date, e.count);
    total += e.count;
    if (e.count > maxDaily) maxDaily = e.count;
  }
  return { map, total, maxDaily };
}

interface WeekBucket {
  label: string;
  count: number;
}

function aggregateByWeek(entries: TimelineEntry[]): WeekBucket[] {
  if (entries.length === 0) return [];

  const toMonday = (d: Date) => {
    const copy = new Date(d);
    const day = copy.getDay();
    copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day));
    copy.setHours(0, 0, 0, 0);
    return copy;
  };

  const weekMap = new Map<string, { weekStart: Date; count: number }>();
  for (const entry of entries) {
    const monday = toMonday(parseDate(entry.date));
    const key = toDateKey(monday);
    const existing = weekMap.get(key);
    if (existing) existing.count += entry.count;
    else weekMap.set(key, { weekStart: monday, count: entry.count });
  }

  return Array.from(weekMap.values())
    .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
    .map(({ weekStart, count }) => ({
      label: weekStart.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      count,
    }));
}

// ── Cumulative SVG chart ──────────────────────────────────────────────────

const SVG_W = 600;
const SVG_H = 200; // extended from 180 to accommodate legend + goal overlay
const PAD = { top: 20, right: 60, bottom: 50, left: 40 }; // right expanded for "Goal N" label, bottom for legend

function CumulativeChart({ entries }: { entries: TimelineEntry[] }) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return <p className="text-sm text-muted">No data yet.</p>;

  const fcCumSeries = buildFullCelebrationCumulative(sorted);

  const firstDate = parseDate(sorted[0].date);
  const lastDate = new Date(Math.max(
    parseDate(sorted[sorted.length - 1].date).getTime(),
    Date.now(),
    // Ensure the target date is visible in the chart
    parseDate(EVENT_GOALS.registrationTargetDate).getTime(),
  ));
  const totalMs = lastDate.getTime() - firstDate.getTime() || 1;

  // ── Actual cumulative (Full Event registrations) ─────────────────────────
  const points: { x: number; y: number; date: string; cumulative: number }[] = [];
  let cumulative = 0;
  points.push({
    x: PAD.left,
    y: SVG_H - PAD.bottom,
    date: sorted[0].date,
    cumulative: 0,
  });

  for (const entry of fcCumSeries) {
    cumulative = entry.count;
    const t = (parseDate(entry.date).getTime() - firstDate.getTime()) / totalMs;
    points.push({
      x: PAD.left + t * (SVG_W - PAD.left - PAD.right),
      y: 0,
      date: entry.date,
      cumulative,
    });
  }

  // ── Goal overlay ─────────────────────────────────────────────────────────
  const goalTarget = EVENT_GOALS.fullCelebrationTarget;
  // Scale to whichever is higher so the goal line is always visible
  const maxY = Math.max(cumulative, goalTarget) || 1;

  // Recompute nice gridlines based on goalTarget so the goal value lands on a gridline
  const rawStep = maxY / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const gridStep = Math.ceil(rawStep / magnitude) * magnitude || 1;

  const chartH = SVG_H - PAD.top - PAD.bottom;
  const toY = (val: number) => SVG_H - PAD.bottom - (val / maxY) * chartH;
  const toX = (ms: number) => PAD.left + ((ms - firstDate.getTime()) / totalMs) * (SVG_W - PAD.left - PAD.right);

  for (const p of points) {
    p.y = toY(p.cumulative);
  }

  // ── Goal line y position ──────────────────────────────────────────────────
  const goalY = toY(goalTarget);

  // ── Target date x position ────────────────────────────────────────────────
  const targetDateMs = parseDate(EVENT_GOALS.registrationTargetDate).getTime();
  const targetX = toX(targetDateMs);

  // ── Projection line ───────────────────────────────────────────────────────
  // Project the same Full Event series that the actual line plots.
  const nowMs = Date.now();
  const projected = projectAtDate(fcCumSeries, nowMs, EVENT_GOALS.registrationTargetDate);
  const projectedY = toY(Math.min(projected, maxY)); // clamp projection to chart bounds

  // Today's x position for projection start
  const todayMs = nowMs;
  const todayX = toX(todayMs);
  // Current fullCelebration cumulative (latest entry)
  const fcLatest = fcCumSeries.length > 0 ? fcCumSeries[fcCumSeries.length - 1].count : 0;
  const todayFcY = toY(Math.min(fcLatest, maxY));

  // Gap = max(0, goalTarget − projected)
  const gap = Math.max(0, goalTarget - projected);

  const linePoints = points.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPoints = `${points[0].x},${SVG_H - PAD.bottom} ${linePoints} ${points[points.length - 1].x},${SVG_H - PAD.bottom}`;

  // Month labels on x-axis
  const months: { label: string; x: number }[] = [];
  const startMonth = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  while (startMonth.getTime() <= lastDate.getTime()) {
    const t = (startMonth.getTime() - firstDate.getTime()) / totalMs;
    if (t >= 0 && t <= 1) {
      months.push({
        label: startMonth.toLocaleDateString("en-IN", { month: "short" }),
        x: PAD.left + t * (SVG_W - PAD.left - PAD.right),
      });
    }
    startMonth.setMonth(startMonth.getMonth() + 1);
  }

  const todayInRange = todayMs >= firstDate.getTime() && todayMs <= lastDate.getTime();
  const targetInRange = targetDateMs >= firstDate.getTime() && targetDateMs <= lastDate.getTime();

  // Legend y baseline (just below the bottom axis)
  const legendY = SVG_H - 16;

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Y-axis gridlines */}
      {Array.from({ length: Math.floor(maxY / gridStep) + 1 }, (_, i) => {
        const val = i * gridStep;
        if (val > maxY) return null;
        const y = toY(val);
        return (
          <g key={i}>
            <line x1={PAD.left} y1={y} x2={SVG_W - PAD.right} y2={y} stroke="rgba(200,180,150,0.3)" strokeWidth="1" />
            <text x={PAD.left - 6} y={y + 3} textAnchor="end" fontSize="10" fill="rgba(100,90,80,0.6)">{val}</text>
          </g>
        );
      })}

      {/* Goal line — horizontal dashed green */}
      <line
        x1={PAD.left}
        y1={goalY}
        x2={SVG_W - PAD.right}
        y2={goalY}
        stroke="#2E7D32"
        strokeWidth="1.5"
        strokeDasharray="6 3"
      />
      <text x={SVG_W - PAD.right + 4} y={goalY + 4} fontSize="10" fontWeight="600" fill="#2E7D32">
        Goal {goalTarget}
      </text>

      {/* Target date vertical marker */}
      {targetInRange && (
        <g>
          <line
            x1={targetX}
            y1={PAD.top}
            x2={targetX}
            y2={SVG_H - PAD.bottom}
            stroke="#B45309"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <text x={targetX + 2} y={PAD.top + 10} fontSize="9" fill="#B45309">
            {EVENT_GOALS.registrationTargetDate.slice(5).replace("-", "/")}
          </text>
        </g>
      )}

      {/* Projection line from today → target date (only while deadline is still ahead) */}
      {todayInRange && targetInRange && projected > 0 && nowMs < targetDateMs && (
        <line
          x1={todayX}
          y1={todayFcY}
          x2={targetX}
          y2={projectedY}
          stroke="#D76B51"
          strokeWidth="1.5"
          strokeDasharray="5 4"
          strokeLinecap="round"
        />
      )}

      {/* Gap-shading rect: translucent red fill between projection endpoint and goal line,
          at the target-date x position. Visible only while the deadline is ahead (sketch-level). */}
      {gap > 0 && targetInRange && nowMs < targetDateMs && projectedY > goalY && (
        <rect
          x={targetX - 4}
          y={goalY}
          width={8}
          height={projectedY - goalY}
          fill="rgba(185,28,28,0.12)"
          stroke="rgba(185,28,28,0.25)"
          strokeWidth="1"
          rx="2"
        />
      )}

      {/* Gap label (gap at current pace: ~N) — only while deadline is still ahead */}
      {gap > 0 && targetInRange && nowMs < targetDateMs && (
        <text
          x={PAD.left + (SVG_W - PAD.left - PAD.right) * 0.5}
          y={Math.max(PAD.top + 10, goalY - 6)}
          textAnchor="middle"
          fontSize="10"
          fill="#B91C1C"
        >
          gap at current pace: ~{gap}
        </text>
      )}

      {/* Area fill */}
      <polygon points={areaPoints} fill="rgba(215,107,81,0.12)" />

      {/* Line */}
      <polyline points={linePoints} fill="none" stroke="#D76B51" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Data points */}
      {points.slice(1).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#D76B51" stroke="white" strokeWidth="1.5" />
      ))}

      {/* Latest value label */}
      {points.length > 1 && (
        <text
          x={points[points.length - 1].x}
          y={points[points.length - 1].y - 10}
          textAnchor="middle"
          fontSize="11"
          fontWeight="bold"
          fill="#1F2A33"
        >
          {cumulative}
        </text>
      )}

      {/* X-axis */}
      <line x1={PAD.left} y1={SVG_H - PAD.bottom} x2={SVG_W - PAD.right} y2={SVG_H - PAD.bottom} stroke="rgba(200,180,150,0.4)" strokeWidth="1" />
      {months.map((m, i) => (
        <text key={i} x={m.x} y={SVG_H - PAD.bottom + 12} textAnchor="middle" fontSize="10" fill="rgba(100,90,80,0.6)">{m.label}</text>
      ))}

      {/* Today marker */}
      {todayInRange && (
        <g>
          <line x1={todayX} y1={PAD.top} x2={todayX} y2={SVG_H - PAD.bottom} stroke="rgba(31,42,51,0.2)" strokeWidth="1" strokeDasharray="4 3" />
          <text x={todayX} y={SVG_H - PAD.bottom + 24} textAnchor="middle" fontSize="9" fontWeight="600" fill="#1F2A33">Today</text>
        </g>
      )}

      {/* Legend */}
      <rect x={PAD.left} y={legendY - 4} width="12" height="3" fill="#D76B51" rx="1" />
      <text x={PAD.left + 16} y={legendY} fontSize="10" fill="#4B5563">Actual Full Event</text>
      <line x1={PAD.left + 120} y1={legendY - 2} x2={PAD.left + 134} y2={legendY - 2} stroke="#D76B51" strokeWidth="1.5" strokeDasharray="4 2" />
      <text x={PAD.left + 138} y={legendY} fontSize="10" fill="#4B5563">Projected pace</text>
      <line x1={PAD.left + 238} y1={legendY - 2} x2={PAD.left + 252} y2={legendY - 2} stroke="#2E7D32" strokeWidth="1.5" strokeDasharray="5 2" />
      <text x={PAD.left + 256} y={legendY} fontSize="10" fill="#4B5563">Goal ({goalTarget})</text>
    </svg>
  );
}

// ── Geography card ────────────────────────────────────────────────────────

function GeographyCard({
  cities,
  countries,
}: {
  cities: GeographyEntry[];
  countries: CountryEntry[];
}) {
  const hasCities = cities.length > 0;
  const hasCountries = countries.length > 0;

  // Design C8: always render the card frame — empty state shows "No data yet"
  if (!hasCities && !hasCountries) {
    return (
      <div
        className="bg-surface border border-border-warm rounded-2xl p-5"
        style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
      >
        <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider mb-4">
          Geography
        </p>
        <p className="text-sm text-muted">No data yet.</p>
      </div>
    );
  }

  const cityRows = topCitiesWithOthers(cities, 8);
  const maxCountryCount = countries.length > 0 ? countries[0].count : 1;

  return (
    <div
      className="bg-surface border border-border-warm rounded-2xl p-5"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider mb-4">
        Geography
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Cities */}
        <div>
          <p className="text-xs font-semibold text-charcoal mb-2">Top Cities</p>
          {hasCities ? (
            <table className="w-full text-sm">
              <tbody>
                {cityRows.map((row) => (
                  <tr key={row.city}>
                    <td className={`py-1 pr-4 ${row.isOthers ? "text-muted italic" : "text-charcoal"}`}>
                      {row.city}
                    </td>
                    <td className={`py-1 font-semibold text-right ${row.isOthers ? "text-muted" : "text-charcoal"}`}>
                      {row.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted">No data yet.</p>
          )}
        </div>

        {/* By Country */}
        <div>
          <p className="text-xs font-semibold text-charcoal mb-2">By Country</p>
          {hasCountries ? (
            <table className="w-full text-sm">
              <tbody>
                {countries.map((row) => {
                  const pct = Math.round((row.count / maxCountryCount) * 100);
                  return (
                    <tr key={row.country}>
                      <td className="py-1 pr-3 text-charcoal whitespace-nowrap">{row.country}</td>
                      <td className="py-1 pr-3 font-semibold text-charcoal text-right whitespace-nowrap">{row.count}</td>
                      <td className="py-1 w-24">
                        <div className="h-1.5 rounded-full bg-border-warm overflow-hidden">
                          <div
                            className="h-full rounded-full bg-terracotta"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted">No data yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Donor Recognition card ────────────────────────────────────────────────

function DonorRecognitionCard({ donorRecognition }: { donorRecognition: DonorRecognition }) {
  const { publicDonors, nonPublicCount, nonPublicTotal } = donorRecognition;
  const hasPublic = publicDonors.length > 0;
  const hasNonPublic = nonPublicCount > 0;

  // Design C8: always render the card frame — empty state shows "No data yet"
  if (!hasPublic && !hasNonPublic) {
    return (
      <div
        className="bg-surface border border-border-warm rounded-2xl p-5"
        style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
      >
        <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider mb-4">
          Donor Recognition
        </p>
        <p className="text-sm text-muted">No data yet.</p>
      </div>
    );
  }

  // Felicitation threshold from config (never hardcoded)
  const felicitationThreshold = PRICING_DEFAULTS.donationFelicitationThreshold;

  return (
    <div
      className="bg-surface border border-border-warm rounded-2xl p-5"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider mb-4">
        Donor Recognition
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-warm">
            <th className="text-left py-2 pr-4 text-xs text-muted font-semibold uppercase tracking-wider">Display Name</th>
            <th className="text-right py-2 px-3 text-xs text-muted font-semibold uppercase tracking-wider">Amount</th>
            <th className="text-left py-2 pl-3 text-xs text-muted font-semibold uppercase tracking-wider">Felicitation</th>
          </tr>
        </thead>
        <tbody>
          {/* Public donors, sorted amount DESC (server order) */}
          {publicDonors.map((donor, i) => (
            <tr key={i} className="border-b border-border-warm last:border-b-0">
              <td className="py-2.5 pr-4 text-charcoal">{donor.displayName}</td>
              <td className="py-2.5 px-3 font-semibold text-charcoal text-right">{formatINR(donor.amount)}</td>
              <td className="py-2.5 pl-3">
                {donor.felicitationEligible ? (
                  <span className="text-amber-700 font-semibold text-xs">★ Eligible</span>
                ) : (
                  <span className="text-muted text-xs">—</span>
                )}
              </td>
            </tr>
          ))}

          {/* Non-public aggregate row */}
          {hasNonPublic && (
            <tr className="border-b border-border-warm last:border-b-0 opacity-60">
              <td className="py-2.5 pr-4 text-muted italic">
                (declined public acknowledgement) × {nonPublicCount}
              </td>
              <td className="py-2.5 px-3 text-muted text-right">{formatINR(nonPublicTotal)}</td>
              <td className="py-2.5 pl-3 text-muted text-xs">—</td>
            </tr>
          )}
        </tbody>
      </table>
      {/* Footnote */}
      <p className="text-xs text-muted mt-3 pt-3 border-t border-border-warm">
        Felicitation = ≥{formatINR(felicitationThreshold)} + felicitation consent given
      </p>
    </div>
  );
}

// ── Weekly bar chart ──────────────────────────────────────────────────────

const BAR_HEIGHT = 140;

function WeeklyBars({ entries }: { entries: TimelineEntry[] }) {
  const weeks = aggregateByWeek(entries);
  if (weeks.length === 0) return <p className="text-sm text-muted">No data yet.</p>;

  const maxCount = Math.max(...weeks.map((w) => w.count), 1);

  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height: `${BAR_HEIGHT + 36}px` }}>
        {weeks.map((week, i) => {
          const barH = Math.max((week.count / maxCount) * BAR_HEIGHT, 4);
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end min-w-0" style={{ height: `${BAR_HEIGHT + 36}px` }}>
              <span className="text-[10px] font-semibold text-charcoal mb-1">{week.count}</span>
              <div className="w-full rounded-t-md bg-terracotta" style={{ height: `${barH}px` }} />
              <span className="text-[10px] text-muted mt-1.5 whitespace-nowrap">{week.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Calendar heatmap ──────────────────────────────────────────────────────

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;

function heatColor(count: number, max: number): string {
  if (count === 0) return "rgba(200,180,150,0.15)";
  const intensity = Math.min(count / max, 1);
  // Interpolate from light terracotta to full terracotta
  const alpha = 0.2 + intensity * 0.8;
  return `rgba(215,107,81,${alpha})`;
}

interface MonthGrid {
  year: number;
  month: number;
  label: string;
  weeks: (({ day: number; key: string; count: number } | null)[])[];
}

function buildMonthGrids(daily: DailyMap): MonthGrid[] {
  // Always show May through August — the registration window
  const grids: MonthGrid[] = [];
  const current = new Date(2026, 4, 1); // May 2026
  const end = new Date(2026, 7, 31); // August 2026

  while (current.getTime() <= end.getTime()) {
    const year = current.getFullYear();
    const month = current.getMonth();
    const label = current.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const weeks: MonthGrid["weeks"] = [];
    let currentWeek: MonthGrid["weeks"][0] = Array(7).fill(null);

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const dow = d.getDay(); // Sunday = 0

      const key = toDateKey(d);
      currentWeek[dow] = { day, key, count: daily.map.get(key) ?? 0 };

      if (dow === 6 || day === daysInMonth) { // Saturday = end of week
        weeks.push(currentWeek);
        currentWeek = Array(7).fill(null);
      }
    }

    grids.push({ year, month, label, weeks });
    current.setMonth(current.getMonth() + 1);
  }

  return grids;
}

function CalendarView({ daily }: { daily: DailyMap }) {
  const grids = useMemo(() => buildMonthGrids(daily), [daily]);
  if (grids.length === 0) return <p className="text-sm text-muted">No data yet.</p>;

  const maxDaily = daily.maxDaily || 1;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
      {grids.map((grid) => (
        <div key={`${grid.year}-${grid.month}`}>
          <p className="text-xs font-semibold text-charcoal mb-2">{grid.label}</p>
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((d, i) => (
              <span key={i} className="text-[10px] text-muted text-center">{d}</span>
            ))}
          </div>
          {/* Day cells */}
          {grid.weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1 mb-1">
              {week.map((cell, ci) =>
                cell ? (
                  <div
                    key={ci}
                    className="aspect-square rounded relative cursor-default"
                    style={{ backgroundColor: heatColor(cell.count, maxDaily) }}
                    title={`${new Date(grid.year, grid.month, cell.day).toLocaleDateString("en-IN", { month: "short", day: "numeric" })} — ${cell.count} registration${cell.count !== 1 ? "s" : ""}`}
                  >
                    <span className={`absolute inset-0 flex items-center justify-center text-[11px] font-medium ${
                      cell.count > 0 ? "font-bold text-white" : "text-muted/40"
                    }`}>
                      {cell.count > 0 ? cell.count : cell.day}
                    </span>
                  </div>
                ) : (
                  <div key={ci} className="aspect-square" />
                ),
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Timeline container ────────────────────────────────────────────────────

function TimelineChart({ entries }: { entries: TimelineEntry[] }) {
  const [view, setView] = useState<TimelineView>("cumulative");
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  const daily = useMemo(() => buildDailyMap(entries), [entries]);

  return (
    <div
      className="bg-surface border border-border-warm rounded-2xl p-5"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-baseline gap-3">
          <p className="font-heading text-sm font-bold text-charcoal uppercase tracking-wider">
            Registration Timeline
          </p>
          <span className="text-sm text-muted">
            <span className="font-semibold text-charcoal">{total}</span> total
          </span>
        </div>
        <div className="flex gap-1">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setView(opt.key)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                view === opt.key
                  ? "bg-charcoal text-white"
                  : "text-muted hover:text-charcoal"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {view === "cumulative" && <CumulativeChart entries={entries} />}
      {view === "weekly" && <WeeklyBars entries={entries} />}
      {view === "calendar" && <CalendarView daily={daily} />}
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-surface border border-border-warm rounded-2xl h-[100px]" />
        <div className="bg-surface border border-border-warm rounded-2xl h-[100px]" />
        <div className="bg-surface border border-border-warm rounded-2xl h-[100px]" />
      </div>
      <div className="bg-surface border border-border-warm rounded-2xl h-[300px] mb-6" />
      <div className="bg-surface border border-border-warm rounded-2xl h-[240px]" />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

/**
 * ReportsPage — analytics for the reunion committee.
 *
 * GUARANTEES:
 * - Shows revenue summary (collected / expected / pending) as hero numbers.
 * - Shows branch participation table sorted by total DESC (API order).
 * - Shows registration timeline as a CSS bar chart.
 * - Shows loading skeleton while fetching.
 *
 * EXPECTS:
 * - Must be rendered inside StaffLayout (auth already verified).
 * - GET /api/staff/reports returns ReportsResponse.
 */
export function ReportsPage() {
  useDocumentTitle("Reports");

  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    fetchReports()
      .then((result) => {
        if (!alive) return;
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, []);

  return (
    <div>
      <h1 className="font-heading text-2xl font-bold text-charcoal mb-6">Reports</h1>
      {loading ? (
        <PageSkeleton />
      ) : data ? (
        <>
          <RevenueSummarySection revenue={data.revenue} />
          <BudgetProgressCards budgetProgress={data.budgetProgress} />
          <ContributionsBySource contributions={data.contributions} donations={data.donations} />
          <BranchTable rows={data.branchBreakdown} />
          <TimelineChart entries={data.timeline} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <GeographyCard cities={data.geography.cities} countries={data.geography.countries} />
            <DonorRecognitionCard donorRecognition={data.donorRecognition} />
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">Failed to load reports data.</p>
      )}
    </div>
  );
}
