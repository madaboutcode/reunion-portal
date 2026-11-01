import { useState, useEffect, useCallback } from "react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { fetchReports, fetchRegistrations, fetchFile } from "@/lib/staff-api";
import type {
  BranchBreakdown,
  ReportsResponse,
  StaffRegistrationListItem,
  RevenueSummary,
} from "@/lib/staff-types";
import { useRef } from "react";

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatCurrency(n: number): string {
  return "₹" + n.toLocaleString("en-IN");
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

// ── Mini Polaroid ─────────────────────────────────────────────────────────

function MiniPolaroid({
  person,
}: {
  person: StaffRegistrationListItem;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!person.photoThumbKey || fetchedRef.current) return;
    fetchedRef.current = true;
    fetchFile(person.photoThumbKey)
      .then(({ url }) => setBlobUrl(url))
      .catch(() => {});
  }, [person.photoThumbKey]);

  return (
    <div
      className="inline-block"
      style={{ width: "100px" }}
    >
      <div
        className="rounded-[2px] px-1.5 pt-1.5 pb-2"
        style={{
          backgroundColor: "#EDE6D6",
          boxShadow: "1px 2px 8px rgba(80,60,40,0.12)",
        }}
      >
        <div
          className="relative w-full overflow-hidden bg-gradient-to-br from-[#B9DFE2] to-[#8fc9cd]"
          style={{ aspectRatio: "1 / 1" }}
        >
          {blobUrl ? (
            <img
              src={blobUrl}
              alt={person.fullName}
              onLoad={() => setLoaded(true)}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span
                className="font-heading text-charcoal font-bold"
                style={{ fontSize: "1.25rem" }}
              >
                {initials(person.fullName)}
              </span>
            </div>
          )}
        </div>
        <p
          className="mt-1 font-semibold text-charcoal truncate"
          style={{ fontSize: "0.5625rem" }}
          title={person.fullName}
        >
          {person.fullName}
        </p>
        <p className="text-muted truncate" style={{ fontSize: "0.5rem" }}>
          {person.branch}
        </p>
      </div>
    </div>
  );
}

// ── Bar Chart ─────────────────────────────────────────────────────────────

function BranchBarChart({
  branches,
  recent24h,
}: {
  branches: BranchBreakdown[];
  recent24h: Map<string, number>;
}) {
  const maxTotal = Math.max(...branches.map((b) => b.total), 1);

  return (
    <div className="space-y-2">
      {branches.map((b) => {
        const recentCount = recent24h.get(b.branch) ?? 0;
        const overallPct = (b.total / maxTotal) * 100;
        const recentPct = (recentCount / maxTotal) * 100;
        const shortBranch = b.branch
          .replace(/ & /g, " & ")
          .replace(/Engineering/g, "Eng.");

        return (
          <div key={b.branch} className="flex items-center gap-2">
            <div
              className="text-right text-xs text-charcoal font-medium shrink-0 truncate"
              style={{ width: "120px", fontSize: "0.625rem" }}
              title={b.branch}
            >
              {shortBranch}
            </div>
            <div className="flex-1 relative" style={{ height: "20px" }}>
              <div
                className="absolute inset-y-0 left-0 rounded-r-sm"
                style={{
                  width: `${overallPct}%`,
                  backgroundColor: "rgba(185,223,226,0.6)",
                  minWidth: b.total > 0 ? "2px" : "0",
                }}
              />
              {recentCount > 0 && (
                <div
                  className="absolute inset-y-0 left-0 rounded-r-sm"
                  style={{
                    width: `${recentPct}%`,
                    backgroundColor: "#D76B51",
                    minWidth: "2px",
                  }}
                />
              )}
              <div
                className="absolute inset-y-0 flex items-center pl-1.5"
                style={{ fontSize: "0.625rem" }}
              >
                <span className="font-bold text-charcoal">{b.total}</span>
                {recentCount > 0 && (
                  <span className="ml-1 text-[#D76B51] font-bold">
                    +{recentCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Status Table ──────────────────────────────────────────────────────────

function StatusTable({ branches }: { branches: BranchBreakdown[] }) {
  const totals = branches.reduce(
    (acc, b) => ({
      total: acc.total + b.total,
      confirmed: acc.confirmed + b.confirmed,
      pendingVerification:
        acc.pendingVerification + b.pendingVerification,
      pending: acc.pending + b.pending,
    }),
    { total: 0, confirmed: 0, pendingVerification: 0, pending: 0 },
  );

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-charcoal/10">
          <th className="text-left py-1.5 pr-2 font-semibold text-charcoal">
            Branch
          </th>
          <th className="text-right py-1.5 px-2 font-semibold text-charcoal">
            Total
          </th>
          <th className="text-right py-1.5 px-2 font-semibold text-green-700">
            Confirmed
          </th>
          <th className="text-right py-1.5 px-2 font-semibold text-amber-600">
            Verification
          </th>
          <th className="text-right py-1.5 pl-2 font-semibold text-muted">
            Pending
          </th>
        </tr>
      </thead>
      <tbody>
        {branches.map((b) => (
          <tr key={b.branch} className="border-b border-charcoal/5">
            <td
              className="py-1.5 pr-2 text-charcoal truncate"
              style={{ maxWidth: "140px", fontSize: "0.625rem" }}
              title={b.branch}
            >
              {b.branch}
            </td>
            <td className="text-right py-1.5 px-2 font-semibold text-charcoal">
              {b.total}
            </td>
            <td className="text-right py-1.5 px-2 text-green-700">
              {b.confirmed}
            </td>
            <td className="text-right py-1.5 px-2 text-amber-600">
              {b.pendingVerification}
            </td>
            <td className="text-right py-1.5 pl-2 text-muted">
              {b.pending}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-charcoal/20">
          <td className="py-1.5 pr-2 font-bold text-charcoal">Total</td>
          <td className="text-right py-1.5 px-2 font-bold text-charcoal">
            {totals.total}
          </td>
          <td className="text-right py-1.5 px-2 font-bold text-green-700">
            {totals.confirmed}
          </td>
          <td className="text-right py-1.5 px-2 font-bold text-amber-600">
            {totals.pendingVerification}
          </td>
          <td className="text-right py-1.5 pl-2 font-bold text-muted">
            {totals.pending}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

// ── Summary Cards ─────────────────────────────────────────────────────────

function SummaryCards({
  total,
  confirmed,
  pendingVerification,
  revenue,
  recent24hCount,
}: {
  total: number;
  confirmed: number;
  pendingVerification: number;
  revenue: RevenueSummary;
  recent24hCount: number;
}) {
  const cards = [
    { label: "Total Registered", value: String(total), color: "#1F2A33" },
    { label: "Confirmed", value: String(confirmed), color: "#16a34a" },
    {
      label: "Needs Verification",
      value: String(pendingVerification),
      color: "#d97706",
    },
    {
      label: "Last 24 Hours",
      value: `+${recent24hCount}`,
      color: "#D76B51",
    },
    {
      label: "Collected",
      value: formatCurrency(revenue.collected),
      color: "#16a34a",
    },
    {
      label: "Expected",
      value: formatCurrency(revenue.expected),
      color: "#1F2A33",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-lg border border-charcoal/10 px-3 py-2 text-center"
        >
          <p className="text-muted" style={{ fontSize: "0.5625rem" }}>
            {c.label}
          </p>
          <p
            className="font-heading font-bold mt-0.5"
            style={{ color: c.color, fontSize: "1.125rem" }}
          >
            {c.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function DailyReportPage() {
  useDocumentTitle("Daily Report");

  const [reports, setReports] = useState<ReportsResponse | null>(null);
  const [allPeople, setAllPeople] = useState<StaffRegistrationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reportsData, regsPage1] = await Promise.all([
        fetchReports(),
        fetchRegistrations({ type: "attendee", page: 1, limit: 500 }),
      ]);

      let allRegs = [...regsPage1.data];
      let page = 2;
      while (page <= regsPage1.totalPages) {
        const next = await fetchRegistrations({
          type: "attendee",
          page,
          limit: 500,
        });
        allRegs = allRegs.concat(next.data);
        page++;
      }

      setReports(reportsData);
      setAllPeople(allRegs.filter((r) => r.participationType !== "donation_only"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center">
        <p className="text-muted text-sm">Loading report…</p>
      </div>
    );
  }

  if (error || !reports) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center">
        <p className="text-red-600 text-sm">{error ?? "No data"}</p>
      </div>
    );
  }

  const now = Date.now();
  const cutoff24h = now - 24 * 60 * 60 * 1000;

  const recent24h = allPeople.filter((p) => p.createdAt >= cutoff24h);

  const recent24hByBranch = new Map<string, number>();
  for (const p of recent24h) {
    recent24hByBranch.set(
      p.branch,
      (recent24hByBranch.get(p.branch) ?? 0) + 1,
    );
  }

  const branches = [...reports.branchBreakdown].sort(
    (a, b) => b.total - a.total,
  );

  const overallTotals = branches.reduce(
    (acc, b) => ({
      total: acc.total + b.total,
      confirmed: acc.confirmed + b.confirmed,
      pendingVerification:
        acc.pendingVerification + b.pendingVerification,
    }),
    { total: 0, confirmed: 0, pendingVerification: 0 },
  );

  return (
    <div className="bg-white min-h-screen">
      <div className="max-w-xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="text-center mb-5">
          <p className="font-accent text-sm" style={{ color: "#D76B51" }}>
            Smriti 2026
          </p>
          <h1
            className="font-heading text-xl font-bold text-charcoal"
          >
            Daily Report
          </h1>
          <p className="text-muted text-xs mt-0.5">
            {formatDate(new Date())}
          </p>
        </div>

        {/* Summary */}
        <SummaryCards
          total={overallTotals.total}
          confirmed={overallTotals.confirmed}
          pendingVerification={overallTotals.pendingVerification}
          revenue={reports.revenue}
          recent24hCount={recent24h.length}
        />

        {/* Bar chart */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h2
              className="font-heading text-sm font-semibold text-charcoal"
            >
              By Branch
            </h2>
            <div className="flex items-center gap-3 text-[0.5625rem] text-muted">
              <span className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: "rgba(185,223,226,0.6)" }}
                />
                Overall
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: "#D76B51" }}
                />
                Last 24h
              </span>
            </div>
          </div>
          <BranchBarChart
            branches={branches}
            recent24h={recent24hByBranch}
          />
        </div>

        {/* Status table */}
        <div className="mt-6">
          <h2
            className="font-heading text-sm font-semibold text-charcoal mb-2"
          >
            Status Breakdown
          </h2>
          <StatusTable branches={branches} />
        </div>

        {/* Recent registrations */}
        {recent24h.length > 0 && (
          <div className="mt-6">
            <h2
              className="font-heading text-sm font-semibold text-charcoal mb-1"
            >
              New in the Last 24 Hours
            </h2>
            <p
              className="font-accent text-xs mb-3"
              style={{ color: "#D76B51" }}
            >
              {recent24h.length}{" "}
              {recent24h.length === 1
                ? "person joined"
                : "people joined"}
              !
            </p>
            <div className="flex flex-wrap gap-3">
              {recent24h.map((p) => (
                <MiniPolaroid key={p.id} person={p} />
              ))}
            </div>
          </div>
        )}

        {recent24h.length === 0 && (
          <div className="mt-6 text-center py-6">
            <p className="text-muted text-xs">
              No new registrations in the last 24 hours
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 pt-3 border-t border-charcoal/10 text-center">
          <p className="text-muted" style={{ fontSize: "0.5rem" }}>
            Generated {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </div>
    </div>
  );
}
