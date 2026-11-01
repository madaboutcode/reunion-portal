import { useState, useEffect, useCallback, Fragment } from "react";
import { Link } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useToast } from "@/components/ui/Toast";
import { fetchRefunds, completeRefund } from "@/lib/staff-api";
import { ApiError } from "@/lib/http";
import type { RefundRecord } from "@/lib/staff-types";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { FilterPills } from "@/components/ui/FilterPills";
import { formatRegCodeForDisplay } from "@smriti/shared";
import { formatDate } from "@/lib/format-date";

// ── Helpers ────────────────────────────────────────────────────────────────

type FilterKey = "pending" | "completed" | "all";

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All" },
];

function statusVariant(status: string): BadgeVariant {
  return status === "completed" ? "success" : "warning";
}

function statusLabel(status: string): string {
  return status === "completed" ? "Completed" : "Pending";
}

// ── Component ──────────────────────────────────────────────────────────────

export default function RefundsPage() {
  useDocumentTitle("Refunds");
  const toast = useToast();

  const [filter, setFilter] = useState<FilterKey>("pending");
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [bankRef, setBankRef] = useState("");

  const [confirmTarget, setConfirmTarget] = useState<RefundRecord | null>(null);
  const [completing, setCompleting] = useState(false);

  const loadRefunds = useCallback(async () => {
    setLoading(true);
    try {
      const apiFilter = filter === "all" ? undefined : filter;
      const data = await fetchRefunds(apiFilter);
      setRefunds(data.refunds);
    } catch {
      toast.error("Failed to load refunds.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    loadRefunds();
  }, [loadRefunds]);

  function startExpand(refund: RefundRecord) {
    setExpandedId(refund.id);
    setBankRef("");
  }

  function cancelExpand() {
    setExpandedId(null);
    setBankRef("");
  }

  async function handleConfirmComplete() {
    if (!confirmTarget) return;
    setCompleting(true);
    try {
      await completeRefund(confirmTarget.id, bankRef.trim());
      toast.success("Refund marked as completed.");
      setConfirmTarget(null);
      setExpandedId(null);
      setBankRef("");
      await loadRefunds();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Concurrent or stale completion: another operator marked this refund
        // complete first, or this row is stale. The guarded completion batch
        // picks exactly one winner — this operator's attempt was the loser.
        // Expected conflict, not a failure: tell them what happened.
        toast.error("This refund was already completed by another operator.");
      } else {
        // FALLBACK-OK: Luna review finding 2 (2026-08-04) — non-409
        // completion failures (network, 5xx, auth expiry) are not individually
        // reasoned; the pre-existing generic retry message is the safe surface
        // for all of them.
        toast.error("Failed to complete refund. Please try again.");
      }
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div>
      <h1 className="font-heading text-2xl font-bold text-charcoal mb-6">Refunds</h1>

      <div className="mb-4">
        <FilterPills
          options={FILTER_OPTIONS}
          activeKey={filter}
          onChange={(key) => setFilter(key as FilterKey)}
        />
      </div>

      <Card padding={false}>
        <CardHeader title="Refunds" />
        <div className="px-5 pb-4">
          {loading ? (
            <p className="text-sm text-muted py-2">Loading…</p>
          ) : refunds.length === 0 ? (
            <p className="text-sm text-muted py-2">No refunds found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left text-xs text-muted uppercase tracking-wider py-2 pr-3">
                      Name
                    </th>
                    <th className="text-left text-xs text-muted uppercase tracking-wider py-2 pr-3">
                      Reg Code
                    </th>
                    <th className="text-right text-xs text-muted uppercase tracking-wider py-2 pr-3">
                      Amount
                    </th>
                    <th className="text-left text-xs text-muted uppercase tracking-wider py-2 pr-3">
                      Status
                    </th>
                    <th className="text-left text-xs text-muted uppercase tracking-wider py-2 pr-3">
                      Date
                    </th>
                    <th className="text-left text-xs text-muted uppercase tracking-wider py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {refunds.map((refund) => (
                    <Fragment key={refund.id}>
                      <tr>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {refund.registrationId !== null ? (
                            <Link to={`/staff/registrations/${refund.registrationId}`} className="text-blue-600 hover:underline">
                              {refund.fullName}
                            </Link>
                          ) : (
                            // Detached refund — the active registration is
                            // deleted; render the stored identity snapshot
                            // without linking to a dead route.
                            <span className="text-charcoal">
                              {refund.fullName}
                              <span className="ml-1.5 text-[10px] uppercase tracking-wider text-muted">
                                cancelled
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">
                          {refund.registrationId !== null ? (
                            <Link to={`/staff/registrations/${refund.registrationId}`} className="text-terracotta hover:underline">
                              {formatRegCodeForDisplay(refund.regCode)}
                            </Link>
                          ) : (
                            <span className="text-terracotta">{formatRegCodeForDisplay(refund.regCode)}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-charcoal text-right whitespace-nowrap">
                          ₹{refund.amount.toLocaleString("en-IN")}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-col gap-0.5">
                            <Badge variant={statusVariant(refund.status)}>
                              {statusLabel(refund.status)}
                            </Badge>
                            {refund.reason === "cancellation" && (
                              <>
                                <span className="text-[10px] uppercase tracking-wider text-muted">
                                  cancellation
                                </span>
                                {refund.cancellationReason && (
                                  <span className="text-xs text-charcoal" title={refund.cancellationReason}>
                                    {refund.cancellationReason}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted whitespace-nowrap">
                          {formatDate(refund.createdAt)}
                        </td>
                        <td className="py-2">
                          {refund.status === "pending" ? (
                            expandedId === refund.id ? null : (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => startExpand(refund)}
                              >
                                Mark Completed
                              </Button>
                            )
                          ) : (
                            <span className="text-muted text-xs font-mono">
                              {refund.bankReference ?? "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                      {expandedId === refund.id && (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <div className="bg-[#FAFAF8] border-y border-border/50 px-4 py-4">
                              <label className="block text-xs font-semibold text-charcoal mb-1.5">
                                Bank Reference / UTR Number
                              </label>
                              <div className="mb-3">
                                <Input
                                  value={bankRef}
                                  onChange={(e) => setBankRef(e.target.value)}
                                  placeholder="Enter the bank transfer reference used to send the refund…"
                                />
                              </div>
                              <div className="flex gap-3">
                                <Button
                                  variant="primary"
                                  size="sm"
                                  disabled={!bankRef.trim()}
                                  onClick={() => setConfirmTarget(refund)}
                                >
                                  Confirm Completed
                                </Button>
                                <Button variant="secondary" size="sm" onClick={cancelExpand}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmTarget !== null}
        title="Mark Refund Completed"
        message={
          confirmTarget
            ? `Mark ₹${confirmTarget.amount.toLocaleString("en-IN")} refund as completed with reference ${bankRef.trim()}?`
            : ""
        }
        confirmLabel="Confirm"
        onConfirm={handleConfirmComplete}
        onCancel={() => setConfirmTarget(null)}
        loading={completing}
      />
    </div>
  );
}
