import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { DataTable, type Column } from "@/components/ui/Table";
import { Pagination } from "@/components/ui/Pagination";
import { FilterPills } from "@/components/ui/FilterPills";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ParticipationPill } from "@/components/ui/ParticipationPill";
import { GoalCard } from "@/components/staff/GoalCard";
import { AddDonorModal } from "@/components/staff/AddDonorModal";
import { fetchDashboardStats, fetchRegistrations, exportCsv } from "@/lib/staff-api";
import type { DashboardStats, StaffRegistrationListItem } from "@/lib/staff-types";
import { BRANCHES, BRANCH_SHORT_NAMES, formatRegCodeForDisplay, EVENT_GOALS } from "@/lib/constants";
import { formatRelativeDate } from "@/lib/format-date";
import { goalProgress, daysRemaining, paceNeeded } from "@/lib/goal-progress";
import { pendingAgeDays, pendingAgeLabel, isStalePending } from "@/lib/pending-age";
import { waUrl } from "@/lib/whatsapp";

// ── Helpers ────────────────────────────────────────────────────────────────

function statusVariant(status: string): BadgeVariant {
  if (status === "confirmed") return "success";
  if (status === "pending_verification") return "info";
  return "warning";
}

function statusLabel(status: string): string {
  if (status === "pending_verification") return "Needs Verification";
  if (status === "confirmed") return "Confirmed";
  return "Pending";
}

// ── Constants ──────────────────────────────────────────────────────────────

function branchShort(branch: string): string {
  return (BRANCH_SHORT_NAMES as Record<string, string>)[branch] ?? branch;
}

const BRANCH_OPTIONS = [
  { value: "", label: "All Branches" },
  ...BRANCHES.map((b) => ({ value: b, label: branchShort(b) })),
];

// ── Pending-age chip ──────────────────────────────────────────────────────

interface PendingAgeChipProps {
  status: string;
  createdAt: number;
  nowMs: number;
}

function PendingAgeChip({ status, createdAt, nowMs }: PendingAgeChipProps) {
  if (status !== "pending") {
    return <span className="text-muted text-xs">—</span>;
  }
  const days = pendingAgeDays(createdAt, nowMs);
  const label = pendingAgeLabel(days);
  if (label === null) {
    return <span className="text-muted text-xs">—</span>;
  }
  const isAmber = isStalePending(days, EVENT_GOALS.pendingAgeAmberDays);
  return (
    <span
      className={[
        "inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold",
        isAmber
          ? "bg-amber-100 text-amber-700"
          : "bg-gray-100 text-gray-500",
      ].join(" ")}
      data-testid="pending-age-chip"
    >
      {label}
    </span>
  );
}

// ── Goal strip (target-date card) ─────────────────────────────────────────

interface TargetDateCardProps {
  nowMs: number;
  fullCelebrationCounts: { confirmed: number; pending: number; pendingVerification: number } | null;
}

/** Format an ISO date string "YYYY-MM-DD" as "MMM D" in en-IN locale, e.g. "Jul 15". */
function formatTargetDateShort(isoDate: string): string {
  // Parse as local midnight — display only, no timezone precision needed.
  const d = new Date(isoDate + "T00:00:00");
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function TargetDateCard({ nowMs, fullCelebrationCounts }: TargetDateCardProps) {
  const daysLeft = daysRemaining(EVENT_GOALS.registrationTargetDate, nowMs);
  const fullCounted = fullCelebrationCounts
    ? fullCelebrationCounts.confirmed + fullCelebrationCounts.pending + fullCelebrationCounts.pendingVerification
    : 0;
  const gap = Math.max(0, EVENT_GOALS.fullCelebrationTarget - fullCounted);
  const pace = paceNeeded(gap, daysLeft);
  const targetLabel = formatTargetDateShort(EVENT_GOALS.registrationTargetDate);

  return (
    <div
      className="rounded-2xl bg-surface border border-border-warm p-4 space-y-2"
      style={{ boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Registration Target</p>
      <p className="font-body text-3xl font-bold text-charcoal">{targetLabel}</p>
      <p className="text-sm font-semibold text-charcoal">{daysLeft} days left</p>
      {gap > 0 && (
        <p className="text-xs text-muted">Need ~{pace} registrations / week to reach goal</p>
      )}
      <p className="text-[11px] text-muted">
        Gap: {gap} needed · pace based on confirmed + pending
      </p>
      <p className="text-[11px] text-muted italic">Form stays open after {targetLabel}</p>
    </div>
  );
}

// ── Table columns ──────────────────────────────────────────────────────────

const BASE_COLUMNS: Column<StaffRegistrationListItem>[] = [
  {
    key: "regCode",
    header: "Reg Code",
    render: (r) => (
      <span className="whitespace-nowrap">
        <span className="font-mono text-terracotta font-semibold text-xs">{formatRegCodeForDisplay(r.regCode)}</span>
        <span className="text-[10px] text-muted ml-1.5">#{r.id}</span>
      </span>
    ),
    width: "170px",
  },
  { key: "fullName", header: "Name", render: (r) => r.fullName, className: "whitespace-nowrap" },
  { key: "branch", header: "Branch", render: (r) => branchShort(r.branch), width: "70px" },
];

const TYPE_COLUMN: Column<StaffRegistrationListItem> = {
  key: "type",
  header: "Type",
  render: (r) => <ParticipationPill participationType={r.participationType} />,
  width: "100px",
  className: "whitespace-nowrap",
};

const TAIL_COLUMNS: Column<StaffRegistrationListItem>[] = [
  {
    key: "status",
    header: "Status",
    render: (r) => (
      <Badge variant={statusVariant(r.status)}>{statusLabel(r.status)}</Badge>
    ),
    width: "140px",
    className: "whitespace-nowrap",
  },
  {
    key: "amount",
    header: "Amount",
    render: (r) => `₹${r.totalAmount.toLocaleString("en-IN")}`,
    width: "90px",
    className: "whitespace-nowrap",
  },
  {
    key: "date",
    header: "Registered",
    render: (r) => formatRelativeDate(r.createdAt),
    width: "90px",
    className: "whitespace-nowrap",
  },
];

// ── Stat card ──────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  cardStyle: string;
  numberClass: string;
  onClick: () => void;
  pulse?: boolean;
}

function StatCard({ label, value, cardStyle, numberClass, onClick, pulse = false }: StatCardProps) {
  const isVerify = cardStyle.includes("bg-terracotta");
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-2xl p-4 text-left transition-all hover:opacity-90 active:scale-[0.98] ${cardStyle}`}
      style={isVerify ? undefined : { boxShadow: "0 2px 10px rgba(80,60,40,0.06)" }}
    >
      <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{label}</p>
      <p className={`font-body text-3xl font-bold mt-1 ${numberClass}`}>{value}</p>
      {pulse && (
        <span
          className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-white/20 text-[10px] font-semibold text-white"
          aria-hidden="true"
        >
          Show these →
        </span>
      )}
    </button>
  );
}

function StatCardSkeleton() {
  return <div className="rounded-2xl bg-surface border border-border-warm animate-pulse h-[88px]" />;
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function StaffDashboardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedType = searchParams.get("type");
  const type: "attendee" | "donor" = requestedType === "donor" ? "donor" : "attendee";
  useDocumentTitle(type === "donor" ? "Donor Only" : "Attendees");

  const status = searchParams.get("status") ?? "";
  const search = searchParams.get("search") ?? "";
  const branch = searchParams.get("branch") ?? "";
  const participationType = searchParams.get("participationType") ?? "";
  const page = Number(searchParams.get("page") ?? "1");

  // Capture nowMs once per mount so column identities are stable across renders
  const nowMs = useMemo(() => Date.now(), []);

  // Add donor modal
  const [addDonorOpen, setAddDonorOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Stats
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // List
  const [registrations, setRegistrations] = useState<StaffRegistrationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [listLoading, setListLoading] = useState(true);

  // Export
  const [exporting, setExporting] = useState(false);

  // ── Stats fetch ──────────────────────────────────────────────────────────

  useEffect(() => {
    let alive = true;
    setStatsLoading(true);
    fetchDashboardStats({ type })
      .then(({ stats: s }) => {
        if (!alive) return;
        setStats(s);
        setStatsLoading(false);
      })
      .catch(() => {
        if (alive) setStatsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [type, refreshKey]);

  // ── List fetch ───────────────────────────────────────────────────────────

  useEffect(() => {
    let alive = true;
    setListLoading(true);
    fetchRegistrations({
      type,
      status: status || undefined,
      branch: branch || undefined,
      search: search || undefined,
      participationType: participationType || undefined,
      page,
    })
      .then((data) => {
        if (!alive) return;
        setRegistrations(data.data);
        setTotal(data.totalItems);
        setTotalPages(data.totalPages);
        setListLoading(false);
      })
      .catch(() => {
        if (alive) setListLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [type, status, branch, search, participationType, page, refreshKey]);

  // ── Filter helpers ───────────────────────────────────────────────────────

  function setFilter(key: string, value: string) {
    setSearchParams(
      (prev) => {
        if (value) {
          prev.set(key, value);
        } else {
          prev.delete(key);
        }
        prev.delete("page"); // reset to page 1 on filter change
        return prev;
      },
      { replace: false },
    );
  }

  function setStatus(value: string) {
    setFilter("status", value);
  }

  function setSearch(value: string) {
    setFilter("search", value);
  }

  function setBranch(value: string) {
    setFilter("branch", value);
  }

  function handleStatClick(filterValue: string) {
    setSearchParams(
      (prev) => {
        if (filterValue) {
          prev.set("status", filterValue);
        } else {
          prev.delete("status");
        }
        prev.delete("page");
        return prev;
      },
      { replace: false },
    );
  }

  // ── Export ───────────────────────────────────────────────────────────────

  function setParticipationType(value: string) {
    setFilter("participationType", value);
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportCsv({
        type,
        status: status || undefined,
        branch: branch || undefined,
        search: search || undefined,
        participationType: participationType || undefined,
      });
    } finally {
      setExporting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const pageTitle = type === "donor" ? "Donor Only" : "Attendees";
  const isAttendees = type === "attendee";

  // Pending-age and WA columns — memoized so column identities are stable across renders.
  // nowMs is itself a stable memo ([] deps — captured once at mount), so these columns
  // never recreate after mount; the dep array reflects that stability.
  const PENDING_AGE_COLUMN = useMemo<Column<StaffRegistrationListItem>>(() => ({
    key: "pendingAge",
    header: "Pending Age",
    render: (r) => (
      <PendingAgeChip status={r.status} createdAt={r.createdAt} nowMs={nowMs} />
    ),
    width: "100px",
    className: "whitespace-nowrap",
  }), [nowMs]);

  const WA_COLUMN = useMemo<Column<StaffRegistrationListItem>>(() => ({
    key: "whatsapp",
    header: "WhatsApp",
    render: (r) => {
      const url = waUrl(r.whatsapp);
      if (!url) return <span className="text-muted text-xs">—</span>;
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-100 text-green-800 text-[11px] font-semibold border border-green-200 hover:bg-green-200 transition-colors min-h-[44px] min-w-[44px] justify-center"
          aria-label={`Open WhatsApp for ${r.fullName}`}
          data-testid="wa-link"
        >
          WA ↗
        </a>
      );
    },
    width: "80px",
    className: "whitespace-nowrap",
  }), []);

  const columns: Column<StaffRegistrationListItem>[] = useMemo(() =>
    type === "donor"
      ? [...BASE_COLUMNS, ...TAIL_COLUMNS, WA_COLUMN]
      : [...BASE_COLUMNS, TYPE_COLUMN, ...TAIL_COLUMNS, PENDING_AGE_COLUMN, WA_COLUMN],
    [type, PENDING_AGE_COLUMN, WA_COLUMN],
  );

  return (
    <div>
      {/* ── Page title ── */}
      <h1 className="font-heading text-2xl font-bold text-charcoal mb-6">{pageTitle}</h1>

      {/* ── Goal strip — attendees only ── */}
      {isAttendees && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {statsLoading ? (
            <>
              <div className="rounded-2xl bg-surface border border-border-warm animate-pulse h-[160px]" />
              <div className="rounded-2xl bg-surface border border-border-warm animate-pulse h-[160px]" />
              <div className="rounded-2xl bg-surface border border-border-warm animate-pulse h-[160px]" />
            </>
          ) : stats ? (
            <>
              <GoalCard
                title="Full Celebration"
                target={EVENT_GOALS.fullCelebrationTarget}
                confirmed={stats.byParticipationType.full_celebration.confirmed}
                pending={stats.byParticipationType.full_celebration.pending}
                pendingVerification={stats.byParticipationType.full_celebration.pendingVerification}
              />
              <GoalCard
                title="Campus Only"
                target={EVENT_GOALS.campusOnlyTarget}
                confirmed={stats.byParticipationType.campus_only.confirmed}
                pending={stats.byParticipationType.campus_only.pending}
                pendingVerification={stats.byParticipationType.campus_only.pendingVerification}
                slotsNote={(() => {
                  const { slotsLeft } = goalProgress(
                    stats.byParticipationType.campus_only,
                    EVENT_GOALS.campusOnlyTarget,
                  );
                  return slotsLeft > 0
                    ? `${slotsLeft} slots left — pending registrations hold a slot`
                    : undefined;
                })()}
              />
              <TargetDateCard
                nowMs={nowMs}
                fullCelebrationCounts={stats.byParticipationType.full_celebration}
              />
            </>
          ) : (
            <>
              <div className="rounded-2xl bg-surface border border-border-warm h-[160px]" />
              <div className="rounded-2xl bg-surface border border-border-warm h-[160px]" />
              <div className="rounded-2xl bg-surface border border-border-warm h-[160px]" />
            </>
          )}
        </div>
      )}

      {/* ── Stats section ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
          {statsLoading ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              {isAttendees && <StatCardSkeleton />}
            </>
          ) : stats ? (
            <>
              <StatCard
                label="Needs Verification"
                value={stats.pendingVerification}
                cardStyle="bg-terracotta text-white"
                numberClass="text-white"
                onClick={() => handleStatClick("pending_verification")}
                pulse={stats.pendingVerification > 0}
              />
              <StatCard
                label="Pending Payment"
                value={stats.pending}
                cardStyle="bg-surface border border-border-warm border-l-[3px] border-l-warning"
                numberClass="text-warning"
                onClick={() => handleStatClick("pending")}
              />
              <StatCard
                label="Confirmed"
                value={stats.confirmed}
                cardStyle="bg-surface border border-border-warm border-l-[3px] border-l-success"
                numberClass="text-success"
                onClick={() => handleStatClick("confirmed")}
              />
              <StatCard
                label="Total"
                value={isAttendees
                  ? stats.byParticipationType.full_celebration.total
                    + stats.byParticipationType.campus_only.total
                  : stats.total}
                cardStyle="bg-surface border border-border-warm"
                numberClass="text-charcoal"
                onClick={() => handleStatClick("")}
              />
              {isAttendees && (
                <StatCard
                  label="Donor Only"
                  value={stats.byParticipationType.donation_only.total}
                  cardStyle="bg-surface border border-border-warm border-l-[3px] border-l-terracotta"
                  numberClass="text-terracotta"
                  onClick={() => navigate("/staff/dashboard?type=donor")}
                />
              )}
              <StatCard
                label="Money Collected"
                value={`₹${stats.moneyCollected.toLocaleString("en-IN")}`}
                cardStyle="bg-surface border border-border-warm border-l-[3px] border-l-success"
                numberClass="text-success"
                onClick={() => handleStatClick("")}
              />
            </>
          ) : (
            // Stats failed to load — show empty placeholders so layout doesn't collapse
            <>
              {Array.from({ length: isAttendees ? 6 : 5 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl bg-surface border border-border-warm h-[88px]"
                />
              ))}
            </>
          )}
        </div>

        {/* ── Filters row ── */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search name, email, reg code, phone..."
            className="flex-1 min-w-[200px]"
          />
          <FilterPills
            options={[
              { key: "", label: "All" },
              {
                key: "pending_verification",
                label: "Needs Verification",
                count: stats?.pendingVerification,
              },
              { key: "pending", label: "Pending", count: stats?.pending },
              { key: "confirmed", label: "Confirmed", count: stats?.confirmed },
            ]}
            activeKey={status}
            onChange={setStatus}
          />
          {isAttendees && (
            <FilterPills
              options={[
                { key: "", label: "All types" },
                { key: "full_celebration", label: "Full" },
                { key: "campus_only", label: "Campus" },
              ]}
              activeKey={participationType}
              onChange={setParticipationType}
            />
          )}
          <Select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={BRANCH_OPTIONS}
            placeholder="All Branches"
          />
          {!isAttendees && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setAddDonorOpen(true)}
              className="ml-auto"
            >
              Add Donor
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            loading={exporting}
            className={isAttendees ? "ml-auto" : ""}
          >
            Export CSV
          </Button>
        </div>

        {/* ── Table ── */}
        <div className="relative">
          {listLoading && (
            <div className="absolute inset-0 bg-surface/60 rounded-2xl z-10 pointer-events-none" />
          )}
          <DataTable
            columns={columns}
            data={registrations}
            onRowClick={(r) => navigate(`/staff/registrations/${r.id}?type=${type}`)}
            emptyMessage={
              listLoading ? "Loading..." : "No registrations match your filters."
            }
            header={
              <>
                <span className="font-heading text-sm font-bold text-charcoal">{pageTitle}</span>
                {!listLoading && (
                  <span className="text-xs text-muted">Showing {registrations.length} of {total}</span>
                )}
              </>
            }
          />
        </div>

        {/* ── Pagination ── */}
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={(p) =>
            setSearchParams((prev) => {
              prev.set("page", String(p));
              return prev;
            })
          }
        />

        {/* ── Add Donor Modal ── */}
        <AddDonorModal
          open={addDonorOpen}
          onClose={() => setAddDonorOpen(false)}
          onCreated={() => {
            setAddDonorOpen(false);
            setRefreshKey((k) => k + 1);
          }}
        />
    </div>
  );
}
