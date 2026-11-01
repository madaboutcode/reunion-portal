import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { fetchArchivedDetail } from "@/lib/staff-api";
import type { ArchivedRegistration } from "@/lib/staff-types";
import { formatDateTime } from "@/lib/format-date";
import { formatRegCodeForDisplay } from "@/lib/constants";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";

// ── DetailField ─────────────────────────────────────────────────────────────

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined | null;
}) {
  return (
    <div className="py-1">
      <dt className="text-[10px] text-muted uppercase tracking-wider leading-none">
        {label}
      </dt>
      <dd className="text-sm text-charcoal mt-0.5">
        {value !== undefined && value !== null && value !== ""
          ? String(value)
          : "—"}
      </dd>
    </div>
  );
}

// ── SnapshotViewer ─────────────────────────────────────────────────────────

function SnapshotViewer({ snapshot }: { snapshot: unknown }) {
  const [expanded, setExpanded] = useState(false);

  if (snapshot === undefined || snapshot === null) {
    return <p className="text-sm text-muted py-2">No snapshot data available.</p>;
  }

  const json = JSON.stringify(snapshot, null, 2);

  return (
    <div>
      <pre
        className={[
          "text-xs font-mono text-charcoal bg-gray-50 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed",
          !expanded ? "max-h-64 overflow-y-hidden" : "",
        ].join(" ")}
      >
        {json}
      </pre>
      <button
        type="button"
        className="mt-2 text-xs text-[#2A7A80] hover:underline font-medium"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Show less" : "Show full snapshot"}
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function ArchivedDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [record, setRecord] = useState<ArchivedRegistration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(
    record
      ? `Archived — ${formatRegCodeForDisplay(record.regCode)}`
      : "Archived Registration",
  );

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    fetchArchivedDetail(Number(id))
      .then(setRecord)
      .catch((e: { status?: number }) => {
        setError(
          e?.status === 404
            ? "Archived record not found."
            : "Failed to load archived registration.",
        );
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="py-2">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-9 w-40 bg-gray-200 rounded-lg animate-pulse" />
          <div className="h-5 w-28 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="space-y-4 max-w-2xl">
          <div className="h-40 bg-gray-100 rounded-2xl animate-pulse" />
          <div className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="py-2">
        <div className="flex items-center gap-3 mb-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/staff/archived")}
          >
            ← Back to Archived
          </Button>
        </div>
        <div className="text-center py-16">
          <p className="text-lg font-heading font-bold text-charcoal mb-2">
            {error}
          </p>
          {error !== "Archived record not found." ? (
            <Button variant="secondary" onClick={load} className="mt-4">
              Try Again
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => navigate("/staff/archived")}
              className="mt-4"
            >
              Back to Archived
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!record) return null;

  // ── Full view ─────────────────────────────────────────────────────────────

  return (
    <div className="py-2 max-w-2xl">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/staff/archived")}
        >
          ← Back to Archived
        </Button>
        <span className="font-mono text-terracotta font-semibold text-sm">
          {formatRegCodeForDisplay(record.regCode)}
        </span>
        <h1 className="font-heading text-xl font-bold text-charcoal">
          {record.fullName}
        </h1>
      </div>

      {/* Metadata */}
      <Card padding={false} className="mb-4">
        <CardHeader title="Archive Metadata" />
        <dl className="px-5 pb-4 divide-y divide-border/50">
          <DetailField label="Email" value={record.email} />
          <DetailField
            label="Reg Code"
            value={formatRegCodeForDisplay(record.regCode)}
          />
          <DetailField label="Archived By" value={record.archivedBy} />
          <DetailField
            label="Archived At"
            value={formatDateTime(record.archivedAt)}
          />
        </dl>
      </Card>

      {/* Snapshot */}
      <Card padding={false}>
        <CardHeader title="Registration Snapshot" />
        <div className="px-5 pb-4">
          <SnapshotViewer snapshot={record.snapshot} />
        </div>
      </Card>
    </div>
  );
}
