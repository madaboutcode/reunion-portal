import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { DataTable, type Column } from "@/components/ui/Table";
import { Pagination } from "@/components/ui/Pagination";
import { SearchInput } from "@/components/ui/SearchInput";
import { fetchArchivedRegistrations } from "@/lib/staff-api";
import type { ArchivedRegistration } from "@/lib/staff-types";
import { formatDateTime } from "@/lib/format-date";
import { formatRegCodeForDisplay } from "@/lib/constants";
import { Button } from "@/components/ui/Button";

const PAGE_LIMIT = 25;

// ── Columns ────────────────────────────────────────────────────────────────

const COLUMNS: Column<ArchivedRegistration>[] = [
  {
    key: "regCode",
    header: "Reg Code",
    render: (item) => (
      <span className="font-mono text-xs text-terracotta font-semibold">
        {formatRegCodeForDisplay(item.regCode)}
      </span>
    ),
    width: "120px",
  },
  {
    key: "fullName",
    header: "Name",
    render: (item) => (
      <span className="font-medium text-charcoal">{item.fullName}</span>
    ),
  },
  {
    key: "email",
    header: "Email",
    render: (item) => (
      <span className="text-sm text-muted">{item.email}</span>
    ),
  },
  {
    key: "archivedBy",
    header: "Archived By",
    render: (item) => (
      <span className="text-sm text-charcoal">{item.archivedBy}</span>
    ),
    width: "160px",
  },
  {
    key: "archivedAt",
    header: "Archived At",
    render: (item) => (
      <span className="text-sm text-muted whitespace-nowrap">
        {formatDateTime(item.archivedAt)}
      </span>
    ),
    width: "180px",
  },
];

// ── Page ──────────────────────────────────────────────────────────────────

export default function ArchivedRegistrationsPage() {
  useDocumentTitle("Archived Registrations");
  const navigate = useNavigate();

  const [rows, setRows] = useState<ArchivedRegistration[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchArchivedRegistrations({ search: search || undefined, page, limit: PAGE_LIMIT })
      .then((res) => {
        setRows(res.data);
        setTotal(res.totalItems);
      })
      .catch(() => setError("Failed to load archived registrations."))
      .finally(() => setLoading(false));
  }, [search, page]);

  useEffect(() => {
    load();
  }, [load]);

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div className="py-2">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/staff/tools")}>
          ← Back to Tools
        </Button>
        <h1 className="font-heading text-xl font-bold text-charcoal">
          Archived Registrations
        </h1>
        {!loading && (
          <span className="text-sm text-muted">
            {total} total
          </span>
        )}
      </div>

      {/* Search */}
      <div className="mb-4 max-w-sm">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder="Search by name, email, or reg code…"
          debounceMs={400}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {error}{" "}
          <button
            type="button"
            className="underline font-medium"
            onClick={load}
          >
            Retry
          </button>
        </div>
      )}

      {/* Table */}
      <DataTable<ArchivedRegistration>
        columns={COLUMNS}
        data={rows}
        onRowClick={(item) => navigate(`/staff/archived/${item.id}`)}
        emptyMessage={
          loading
            ? "Loading…"
            : search
            ? "No archived registrations match your search."
            : "No archived registrations."
        }
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4">
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </div>
      )}
    </div>
  );
}
