import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { Link } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useToast } from "@/components/ui/Toast";
import {
  importBankStatement,
  fetchBankTransactions,
  fetchBankTransactionSummary,
  updateBankTransactionComment,
} from "@/lib/staff-api";
import type { BankTransaction, BankTransactionParams, BankTransactionSummary } from "@/lib/staff-types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { FilterPills } from "@/components/ui/FilterPills";
import { formatRegCodeForDisplay, parseBankDescription } from "@smriti/shared";

// ── Helpers ────────────────────────────────────────────────────────────────

type FilterKey = "all" | "credit" | "debit" | "reconciled" | "unreconciled";

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "credit", label: "Credits" },
  { key: "debit", label: "Debits" },
  { key: "reconciled", label: "Reconciled" },
  { key: "unreconciled", label: "Unreconciled" },
];

type DatePresetKey = "allTime" | "thisMonth" | "lastMonth" | "last7Days" | "custom";

const DATE_PRESET_OPTIONS: { key: DatePresetKey; label: string }[] = [
  { key: "allTime", label: "All Time" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "last7Days", label: "Last 7 Days" },
  { key: "custom", label: "Custom" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

function presetToDateRange(preset: DatePresetKey): { fromDate?: string; toDate?: string } {
  const today = new Date();
  switch (preset) {
    case "thisMonth": {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      return { fromDate: iso(from), toDate: iso(today) };
    }
    case "lastMonth": {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const to = new Date(today.getFullYear(), today.getMonth(), 0);
      return { fromDate: iso(from), toDate: iso(to) };
    }
    case "last7Days": {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return { fromDate: iso(from), toDate: iso(today) };
    }
    default:
      return {};
  }
}

const LIMIT = 50;

function filterToParams(filter: FilterKey): BankTransactionParams {
  switch (filter) {
    case "credit":
      return { type: "credit" };
    case "debit":
      return { type: "debit" };
    case "reconciled":
      return { reconciled: true };
    case "unreconciled":
      return { reconciled: false };
    default:
      return {};
  }
}

function formatINR(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(paise / 100);
}

function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// PaymentRecord.amount is stored in whole rupees (not paise) — see RegistrationDetailPage.
function formatRupees(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(amount);
}

function isReconciled(tx: BankTransaction): boolean {
  return tx.linkedPayments.length > 0;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function BankTransactionsPage() {
  useDocumentTitle("Bank Transactions");
  const toast = useToast();

  const [filter, setFilter] = useState<FilterKey>("all");
  const [datePreset, setDatePreset] = useState<DatePresetKey>("allTime");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [page, setPage] = useState(1);

  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<BankTransactionSummary | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [commentSaved, setCommentSaved] = useState(false);

  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dateRangeParams: { fromDate?: string; toDate?: string } =
    datePreset === "custom"
      ? { fromDate: customFrom || undefined, toDate: customTo || undefined }
      : presetToDateRange(datePreset);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const [data, summaryData] = await Promise.all([
        fetchBankTransactions({
          ...filterToParams(filter),
          ...dateRangeParams,
          page,
          limit: LIMIT,
        }),
        fetchBankTransactionSummary(dateRangeParams),
      ]);
      setTransactions(data.transactions);
      setTotal(data.total);
      setSummary(summaryData);
    } catch {
      toast.error("Failed to load bank transactions.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, page, dateRangeParams.fromDate, dateRangeParams.toDate]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  function changeFilter(key: string) {
    setFilter(key as FilterKey);
    setPage(1);
    setExpandedId(null);
  }

  function changeDatePreset(key: string) {
    setDatePreset(key as DatePresetKey);
    setPage(1);
    setExpandedId(null);
  }

  // ── Import ─────────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    if (!/\.(?:txt|xls)$/i.test(file.name)) {
      toast.error("Please upload a .txt or .xls file.");
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const result = await importBankStatement(text);
      setImportResult({ imported: result.imported, skipped: result.skipped });
      setShowImportModal(false);
      setPage(1);
      if (filter === "all") {
        await loadTransactions();
      } else {
        setFilter("all");
      }
    } catch {
      toast.error("Failed to import statement. Please check the file and try again.");
    } finally {
      setImporting(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  // ── Expand / comment ──────────────────────────────────────────────────

  function toggleExpand(tx: BankTransaction) {
    if (expandedId === tx.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(tx.id);
    setCommentDraft(tx.comment ?? "");
  }

  async function handleCommentBlur(tx: BankTransaction) {
    const next = commentDraft.trim();
    const prev = (tx.comment ?? "").trim();
    if (next === prev) return;

    setSavingComment(true);
    setCommentSaved(false);
    try {
      await updateBankTransactionComment(tx.id, next === "" ? null : next);
      setTransactions((prevList) =>
        prevList.map((t) => (t.id === tx.id ? { ...t, comment: next === "" ? null : next } : t)),
      );
      setCommentSaved(true);
      setTimeout(() => setCommentSaved(false), 2000);
    } catch {
      toast.error("Failed to save comment.");
      setCommentDraft(tx.comment ?? "");
    } finally {
      setSavingComment(false);
    }
  }

  // ── Pagination ────────────────────────────────────────────────────────

  const from = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const to = Math.min(page * LIMIT, total);
  const hasPrev = page > 1;
  const hasNext = page * LIMIT < total;

  const [showImportModal, setShowImportModal] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-2xl font-bold text-charcoal">Bank Transactions</h1>
        <Button variant="secondary" size="sm" onClick={() => setShowImportModal(true)}>
          Import Statement
        </Button>
      </div>

      {importResult && (
        <div className="mb-4 text-sm text-charcoal rounded-lg bg-green-50 border border-green-200 px-4 py-2.5">
          Imported {importResult.imported} new transactions ({importResult.skipped} already
          existed).
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          <div className="rounded-xl border border-border/40 bg-white px-4 py-3">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Total Credits</div>
            <div className="text-lg font-bold text-green-700">{formatINR(summary.totalCreditPaise)}</div>
          </div>
          <div className="rounded-xl border border-border/40 bg-white px-4 py-3">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Total Debits</div>
            <div className="text-lg font-bold text-terracotta">{formatINR(summary.totalDebitPaise)}</div>
          </div>
          <div className="rounded-xl border border-border/40 bg-white px-4 py-3">
            <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Balance</div>
            <div className="text-lg font-bold text-charcoal">{formatINR(summary.latestBalancePaise)}</div>
            <div className="text-[10px] text-muted mt-0.5">{summary.transactionCount} transactions</div>
          </div>
        </div>
      )}

      {/* Import modal overlay */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !importing && setShowImportModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-heading text-lg font-semibold text-charcoal mb-4">
              Import Bank Statement
            </h2>
            <div
              className={[
                "rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors cursor-pointer",
                dragActive
                  ? "border-terracotta bg-terracotta-light/40"
                  : "border-border bg-[#FAFAF8] hover:border-terracotta/60",
              ].join(" ")}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => { onDrop(e); }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.xls"
                className="hidden"
                onChange={(e) => { onFileInputChange(e); }}
              />
              {importing ? (
                <p className="text-sm text-muted">Importing statement…</p>
              ) : (
                <>
                  <p className="text-base font-semibold text-charcoal">
                    Drop a .txt or .xls file here
                  </p>
                  <p className="text-sm text-muted mt-1">or click to browse</p>
                </>
              )}
            </div>
            <div className="flex justify-end mt-4">
              <Button
                variant="secondary"
                size="sm"
                disabled={importing}
                onClick={() => setShowImportModal(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterPills options={FILTER_OPTIONS} activeKey={filter} onChange={changeFilter} />
        <div className="hidden sm:block w-px h-5 bg-border/60" />
        <FilterPills options={DATE_PRESET_OPTIONS} activeKey={datePreset} onChange={changeDatePreset} />
        {datePreset === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                setPage(1);
              }}
              className="h-8 px-2 text-xs rounded-lg border border-border bg-white text-charcoal outline-none focus:border-soft-aqua"
            />
            <span className="text-xs text-muted">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => {
                setCustomTo(e.target.value);
                setPage(1);
              }}
              className="h-8 px-2 text-xs rounded-lg border border-border bg-white text-charcoal outline-none focus:border-soft-aqua"
            />
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border/40 bg-white">
        <div className="px-5 py-4">
          {loading ? (
            <p className="text-sm text-muted py-2">Loading…</p>
          ) : transactions.length === 0 ? (
            <p className="text-sm text-muted py-2">No transactions found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left text-xs text-muted uppercase tracking-wider py-2 pr-3">
                      Date
                    </th>
                    <th className="text-left text-xs text-muted uppercase tracking-wider py-2 pr-3">
                      Sender
                    </th>
                    <th className="text-right text-xs text-muted uppercase tracking-wider py-2 pr-3">
                      Amount
                    </th>
                    <th className="text-left text-xs text-muted uppercase tracking-wider py-2 pr-3">
                      Status
                    </th>
                    <th className="text-left text-xs text-muted uppercase tracking-wider py-2">
                      Linked To
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {transactions.map((tx) => {
                    const expanded = expandedId === tx.id;
                    const reconciled = isReconciled(tx);
                    const amountPaise = tx.txnType === "credit" ? tx.creditPaise : tx.debitPaise;
                    const parsed = parseBankDescription(tx.description);

                    return (
                      <Fragment key={tx.id}>
                        <tr
                          className="cursor-pointer hover:bg-[#FAFAF8]"
                          onClick={() => toggleExpand(tx)}
                        >
                          <td className="py-2 pr-3 whitespace-nowrap text-charcoal">
                            <span className="inline-block w-3 text-muted">
                              {expanded ? "▾" : "▸"}
                            </span>{" "}
                            {tx.txnDate}
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-charcoal">
                                {parsed.name ?? truncate(tx.description, 40)}
                              </span>
                              <span className="text-[10px] font-semibold text-muted bg-border/40 px-1.5 py-0.5 rounded">
                                {parsed.type}
                              </span>
                              {parsed.remark && (
                                <span className="text-[10px] text-muted/80 bg-soft-aqua/20 px-1.5 py-0.5 rounded truncate max-w-[160px]">
                                  {parsed.remark}
                                </span>
                              )}
                            </div>
                          </td>
                          <td
                            className={[
                              "py-2 pr-3 text-right whitespace-nowrap font-medium",
                              tx.txnType === "credit" ? "text-green-700" : "text-terracotta",
                            ].join(" ")}
                          >
                            {tx.txnType === "credit" ? "+" : "−"}
                            {formatINR(amountPaise)}
                          </td>
                          <td className="py-2 pr-3">
                            {reconciled ? (
                              <Badge variant="success">Reconciled</Badge>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td className="py-2 text-charcoal">
                            {reconciled
                              ? tx.linkedPayments.map((p) => p.fullName).join(", ")
                              : <span className="text-muted">—</span>}
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={5} className="p-0">
                              <div className="bg-[#FAFAF8] border-y border-border/50 px-4 py-4 space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                  <div className="sm:col-span-2">
                                    <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                                      Full Description
                                    </div>
                                    <div className="text-charcoal">{tx.description}</div>
                                  </div>
                                  <div>
                                    <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                                      Ref No.
                                    </div>
                                    <div className="text-charcoal font-mono text-xs">
                                      {tx.refNo ?? "—"}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                                      Branch Code
                                    </div>
                                    <div className="text-charcoal font-mono text-xs">
                                      {tx.branchCode ?? "—"}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                                      Value Date
                                    </div>
                                    <div className="text-charcoal">{tx.valueDate}</div>
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                                    Comment
                                  </label>
                                  <textarea
                                    value={commentDraft}
                                    onChange={(e) => setCommentDraft(e.target.value)}
                                    placeholder="Add a note…"
                                    disabled={savingComment}
                                    rows={2}
                                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-charcoal placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-soft-aqua/50 focus:border-soft-aqua disabled:opacity-50 resize-y"
                                  />
                                  <div className="flex items-center gap-2 mt-1.5">
                                    {commentDraft.trim() !== (tx.comment ?? "").trim() && (
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        disabled={savingComment}
                                        onClick={() => handleCommentBlur(tx)}
                                      >
                                        {savingComment ? "Saving…" : "Save"}
                                      </Button>
                                    )}
                                    {commentSaved && commentDraft.trim() === (tx.comment ?? "").trim() && (
                                      <span className="text-xs text-green-600">Saved</span>
                                    )}
                                  </div>
                                </div>

                                <div>
                                  <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                                    Linked Payments
                                  </div>
                                  {tx.linkedPayments.length === 0 ? (
                                    <p className="text-sm text-muted">No payments linked.</p>
                                  ) : (
                                    <div className="space-y-1.5">
                                      {tx.linkedPayments.map((p) => (
                                        <div
                                          key={p.linkId}
                                          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                                        >
                                          <Link
                                            to={`/staff/registrations/${p.registrationId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:underline font-medium"
                                          >
                                            {p.fullName}
                                          </Link>
                                          <span className="text-terracotta font-mono text-xs">
                                            {formatRegCodeForDisplay(p.regCode)}
                                          </span>
                                          <span className="text-charcoal">
                                            {formatRupees(p.amount)}
                                          </span>
                                          <Badge variant="info">{p.status}</Badge>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && total > 0 && (
            <div className="flex items-center justify-between pt-4 mt-2 border-t border-border/50">
              <span className="text-xs text-muted">
                Showing {from}-{to} of {total}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasPrev}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasNext}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
