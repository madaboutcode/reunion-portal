import { useState } from "react";
import { Link } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  regenerateThumbnails,
  syncPublicThumbnails,
  reconcileStatuses,
  type RegenerateThumbnailsResponse,
  type SyncPublicThumbsResponse,
  type ReconcileStatusesResponse,
} from "@/lib/staff-api";

export default function StaffToolsPage() {
  useDocumentTitle("Staff Tools");

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RegenerateThumbnailsResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const [syncRunning, setSyncRunning] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncPublicThumbsResponse | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [reconcileRunning, setReconcileRunning] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconcileStatusesResponse | null>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  async function handleRegenerate() {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await regenerateThumbnails();
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setRunning(false);
    }
  }

  async function handleSyncPublicThumbs() {
    setSyncRunning(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await syncPublicThumbnails();
      setSyncResult(res);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSyncRunning(false);
    }
  }

  async function handleReconcileStatuses(dryRun: boolean) {
    setReconcileRunning(true);
    setReconcileResult(null);
    setReconcileError(null);
    try {
      const res = await reconcileStatuses(dryRun);
      setReconcileResult(res);
    } catch (err) {
      setReconcileError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setReconcileRunning(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="font-heading text-2xl font-bold text-charcoal mb-6">
        Staff Tools
      </h1>

      {/* Quick Links */}
      <section className="border border-charcoal/10 rounded-lg p-5 mb-4">
        <h2 className="font-heading text-lg font-semibold text-charcoal mb-3">
          Reports
        </h2>
        <Link
          to="/staff/daily-report"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-charcoal text-white hover:bg-charcoal/90 min-h-[44px] no-underline"
        >
          Daily Report
        </Link>
      </section>

      {/* Archive */}
      <section className="border border-charcoal/10 rounded-lg p-5 mb-4">
        <h2 className="font-heading text-lg font-semibold text-charcoal mb-1">
          Archived Registrations
        </h2>
        <p className="text-sm text-muted mb-4">
          View registrations that were removed from the active list. Data is preserved as a read-only snapshot.
        </p>
        <Link
          to="/staff/archived"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-charcoal text-white hover:bg-charcoal/90 min-h-[44px] no-underline"
        >
          View Archived Registrations
        </Link>
      </section>

      <section className="border border-charcoal/10 rounded-lg p-5">
        <h2 className="font-heading text-lg font-semibold text-charcoal mb-1">
          Regenerate Missing Thumbnails
        </h2>
        <p className="text-sm text-muted mb-4">
          Finds registrations with a photo but no thumbnail and regenerates them
          using Cloudflare Images.
        </p>

        <button
          type="button"
          onClick={handleRegenerate}
          disabled={running}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-charcoal text-white hover:bg-charcoal/90 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
        >
          {running ? "Processing…" : "Regenerate Thumbnails"}
        </button>

        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-4 space-y-3">
            <div className="flex gap-4 text-sm">
              <span className="text-muted">
                Found: <strong className="text-charcoal">{result.total}</strong>
              </span>
              <span className="text-muted">
                Succeeded:{" "}
                <strong className="text-green-700">{result.succeeded}</strong>
              </span>
              {result.failed > 0 && (
                <span className="text-muted">
                  Failed:{" "}
                  <strong className="text-red-700">{result.failed}</strong>
                </span>
              )}
            </div>

            {result.total === 0 && (
              <p className="text-sm text-muted">
                All registrations already have thumbnails.
              </p>
            )}

            {result.errors.length > 0 && (
              <div className="border border-red-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-red-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-red-800">
                        Reg Code
                      </th>
                      <th className="text-left px-3 py-2 text-red-800">
                        Error
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e) => (
                      <tr key={e.id} className="border-t border-red-100">
                        <td className="px-3 py-2 font-mono text-xs">
                          {e.regCode}
                        </td>
                        <td className="px-3 py-2 text-red-700">{e.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="border border-charcoal/10 rounded-lg p-5 mt-4">
        <h2 className="font-heading text-lg font-semibold text-charcoal mb-1">
          Sync Thumbnails to CDN
        </h2>
        <p className="text-sm text-muted mb-4">
          Copies all existing thumbnails from the private bucket to the public
          CDN bucket. Run this once after deployment to populate the CDN.
        </p>

        <button
          type="button"
          onClick={handleSyncPublicThumbs}
          disabled={syncRunning}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-terracotta text-white hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
        >
          {syncRunning ? "Syncing…" : "Sync to CDN"}
        </button>

        {syncError && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
            {syncError}
          </div>
        )}

        {syncResult && (
          <div className="mt-4 space-y-3">
            <div className="flex gap-4 text-sm">
              <span className="text-muted">
                Total: <strong className="text-charcoal">{syncResult.total}</strong>
              </span>
              <span className="text-muted">
                Synced: <strong className="text-green-700">{syncResult.succeeded}</strong>
              </span>
              {syncResult.failed > 0 && (
                <span className="text-muted">
                  Failed: <strong className="text-red-700">{syncResult.failed}</strong>
                </span>
              )}
            </div>

            {syncResult.total === 0 && (
              <p className="text-sm text-muted">No thumbnails found to sync.</p>
            )}

            {syncResult.errors.length > 0 && (
              <div className="border border-red-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-red-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-red-800">ID</th>
                      <th className="text-left px-3 py-2 text-red-800">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncResult.errors.map((e) => (
                      <tr key={e.id} className="border-t border-red-100">
                        <td className="px-3 py-2 font-mono text-xs">{e.id}</td>
                        <td className="px-3 py-2 text-red-700">{e.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="border border-charcoal/10 rounded-lg p-5 mt-4">
        <h2 className="font-heading text-lg font-semibold text-charcoal mb-1">
          Reconcile Registration Statuses
        </h2>
        <p className="text-sm text-muted mb-4">
          Scans all registrations and fixes any whose status doesn't match
          their payment state. Safe to run anytime — only updates mismatched
          records.
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => handleReconcileStatuses(true)}
            disabled={reconcileRunning}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-charcoal text-white hover:bg-charcoal/90 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            {reconcileRunning ? "Scanning..." : "Scan (Dry Run)"}
          </button>
          <button
            type="button"
            onClick={() => handleReconcileStatuses(false)}
            disabled={reconcileRunning}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-terracotta text-white hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            {reconcileRunning ? "Fixing..." : "Fix Now"}
          </button>
        </div>

        {reconcileError && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
            {reconcileError}
          </div>
        )}

        {reconcileResult && (
          <div className="mt-4 space-y-3">
            <div className="flex gap-4 text-sm">
              <span className="text-muted">
                Scanned: <strong className="text-charcoal">{reconcileResult.total}</strong>
              </span>
              <span className="text-muted">
                {reconcileResult.dryRun ? "Would fix" : "Fixed"}:{" "}
                <strong className={reconcileResult.fixed > 0 ? "text-terracotta" : "text-green-700"}>
                  {reconcileResult.fixed}
                </strong>
              </span>
            </div>

            {reconcileResult.dryRun && reconcileResult.fixed > 0 && (
              <p className="text-sm text-terracotta font-medium">
                Dry run — no changes applied. Click "Fix Now" to apply.
              </p>
            )}

            {reconcileResult.fixed === 0 && (
              <p className="text-sm text-muted">
                All registration statuses are correct.
              </p>
            )}

            {reconcileResult.fixes.length > 0 && (
              <div className="border border-charcoal/10 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-charcoal/5">
                    <tr>
                      <th className="text-left px-3 py-2 text-charcoal">Reg Code</th>
                      <th className="text-left px-3 py-2 text-charcoal">From</th>
                      <th className="text-left px-3 py-2 text-charcoal">To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconcileResult.fixes.map((f) => (
                      <tr key={f.id} className="border-t border-charcoal/10">
                        <td className="px-3 py-2 font-mono text-xs">{f.regCode}</td>
                        <td className="px-3 py-2 text-red-600">{f.from}</td>
                        <td className="px-3 py-2 text-green-700">{f.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
