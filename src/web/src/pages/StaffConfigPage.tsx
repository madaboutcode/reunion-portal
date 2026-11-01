import { useCallback, useEffect, useMemo, useState } from "react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/http";
import { fetchFeatureFlagConfig, updateFeatureFlagConfig } from "@/lib/staff-api";
import type { AdminConfigResponse, AdminFeatureFlag, FeatureFlagAuditEntry } from "@/lib/staff-types";
import { formatRelativeDate } from "@/lib/format-date";

// ── Helpers ──────────────────────────────────────────────────────────────

function exposureLabel(exposure: string): string {
  return exposure === "admin_only" ? "Admin only" : "Public";
}

function enforcementLabel(enforcement: string): string {
  if (enforcement === "ui") return "UI only";
  if (enforcement === "server") return "Server only";
  return "Server + UI";
}

/** Groups flags by their catalog `group`, preserving first-appearance order
 *  from the API response (which mirrors FEATURE_FLAG_CATALOG's own order —
 *  the single source of truth for group membership and ordering). */
function groupFlags(flags: AdminFeatureFlag[]): Array<[string, AdminFeatureFlag[]]> {
  const groups = new Map<string, AdminFeatureFlag[]>();
  for (const flag of flags) {
    const bucket = groups.get(flag.group);
    if (bucket) {
      bucket.push(flag);
    } else {
      groups.set(flag.group, [flag]);
    }
  }
  return Array.from(groups.entries());
}

function isConfigUnavailable(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}

// ── FlagSwitch — 44px touch target, green/gray track ───────────────────────

interface FlagSwitchProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}

function FlagSwitch({ checked, onChange, label, disabled }: FlagSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onChange}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange();
        }
      }}
      className={[
        "relative flex items-center justify-center w-11 h-11 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 rounded-full",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "relative w-11 h-6 rounded-full transition-colors duration-200",
          "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]",
          checked ? "bg-green-500" : "bg-gray-300",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white",
            "shadow-[0_1px_4px_rgba(0,0,0,0.2)]",
            "transition-all duration-200",
            checked ? "left-[23px]" : "left-[3px]",
          ].join(" ")}
        />
      </span>
    </button>
  );
}

// ── FlagRow ──────────────────────────────────────────────────────────────

interface FlagRowProps {
  flag: AdminFeatureFlag;
  effectiveValue: boolean;
  dirty: boolean;
  disabled?: boolean;
  onToggle: (key: string) => void;
}

function FlagRow({ flag, effectiveValue, dirty, disabled, onToggle }: FlagRowProps) {
  return (
    <div
      className={[
        "flex items-start gap-4 px-5 py-4 border-b border-border-warm last:border-b-0",
        dirty ? "bg-soft-aqua-light/30" : "",
      ].join(" ")}
      data-testid="flag-row"
      data-dirty={dirty || undefined}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {dirty && (
            <span
              role="img"
              aria-label="Unsaved change"
              className="w-1.5 h-1.5 rounded-full bg-terracotta shrink-0"
            />
          )}
          <span className="font-semibold text-charcoal text-sm">{flag.label}</span>
        </div>
        <p className="text-xs text-muted mt-0.5">{flag.description}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[11px] px-2 py-px rounded-[10px] bg-gray-100 text-gray-600 font-medium">
            {exposureLabel(flag.exposure)}
          </span>
          <span className="text-[11px] px-2 py-px rounded-[10px] bg-soft-aqua-light text-[#2A7A80] font-medium">
            {enforcementLabel(flag.enforcement)}
          </span>
          <span className="text-[10px] font-mono text-muted/70">{flag.key}</span>
        </div>
        {flag.enforcement === "ui" && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2 max-w-md">
            This flag controls navigation/UI only — the underlying feature remains directly accessible.
          </p>
        )}
      </div>
      <FlagSwitch
        checked={effectiveValue}
        onChange={() => onToggle(flag.key)}
        label={flag.label}
        disabled={disabled}
      />
    </div>
  );
}

// ── Loading skeleton ─────────────────────────────────────────────────────

function ConfigSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-surface border border-border-warm animate-pulse h-[160px]" />
      ))}
    </div>
  );
}

// ── Audit history ────────────────────────────────────────────────────────

function AuditSection({ audit }: { audit: FeatureFlagAuditEntry[] }) {
  return (
    <Card padding={false} className="mt-6">
      <CardHeader title="Recent Changes" />
      {audit.length === 0 ? (
        <EmptyState message="No changes recorded yet." />
      ) : (
        <div className="divide-y divide-border-warm">
          {audit.map((entry, i) => (
            <div key={i} className="px-5 py-3">
              <p className="text-xs text-muted">
                <span className="font-semibold text-charcoal">{entry.actor}</span>
                {" · "}
                {formatRelativeDate(entry.changedAt)}
              </p>
              <ul className="mt-1 space-y-0.5">
                {entry.changes.map((change, j) => (
                  <li key={j} className="text-xs font-mono text-charcoal">
                    {change.key}: {String(change.from)} → {String(change.to)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function StaffConfigPage() {
  useDocumentTitle("Feature Flags");
  const toast = useToast();

  const [config, setConfig] = useState<AdminConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"unavailable" | "generic" | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, boolean>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchFeatureFlagConfig();
      setConfig(data);
      setPendingChanges(new Map());
    } catch (err) {
      setLoadError(isConfigUnavailable(err) ? "unavailable" : "generic");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flagsByKey = useMemo(() => {
    const map = new Map<string, AdminFeatureFlag>();
    for (const flag of config?.flags ?? []) map.set(flag.key, flag);
    return map;
  }, [config]);

  const handleToggle = useCallback(
    (key: string) => {
      const flag = flagsByKey.get(key);
      if (!flag) return;
      setPendingChanges((prev) => {
        const next = new Map(prev);
        const current = next.has(key) ? next.get(key)! : flag.enabled;
        const newValue = !current;
        if (newValue === flag.enabled) {
          next.delete(key);
        } else {
          next.set(key, newValue);
        }
        return next;
      });
    },
    [flagsByKey],
  );

  const handleSave = useCallback(async () => {
    if (pendingChanges.size === 0) return;
    setSaving(true);
    setSaveError(false);
    try {
      const changes = Array.from(pendingChanges, ([key, enabled]) => ({ key, enabled }));
      const data = await updateFeatureFlagConfig(changes);
      setConfig(data);
      setPendingChanges(new Map());
      toast.success(`Saved ${changes.length} change${changes.length === 1 ? "" : "s"}.`);
    } catch {
      setSaveError(true);
      toast.error("Save failed — your changes are preserved. Try again.");
    } finally {
      setSaving(false);
    }
  }, [pendingChanges, toast]);

  const groups = useMemo(() => groupFlags(config?.flags ?? []), [config]);
  const dirtyCount = pendingChanges.size;

  return (
    <div className={dirtyCount > 0 ? "pb-24" : undefined}>
      <h1 className="font-heading text-2xl font-bold text-charcoal mb-6">Feature Flags</h1>

      {loading ? (
        <ConfigSkeleton />
      ) : loadError ? (
        <Card>
          <EmptyState
            message={
              loadError === "unavailable"
                ? "Configuration is temporarily unavailable."
                : "Could not load configuration."
            }
          />
          <div className="flex justify-center">
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="space-y-6">
            {groups.map(([group, flags]) => (
              <Card key={group} padding={false}>
                <CardHeader title={group} />
                <div>
                  {flags.map((flag) => (
                    <FlagRow
                      key={flag.key}
                      flag={flag}
                      effectiveValue={pendingChanges.get(flag.key) ?? flag.enabled}
                      dirty={pendingChanges.has(flag.key)}
                      disabled={saving}
                      onToggle={handleToggle}
                    />
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <AuditSection audit={config?.audit ?? []} />
        </>
      )}

      {/* ── Save bar — sticky at the bottom while there are unsaved changes ── */}
      {dirtyCount > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-[200] bg-surface border-t border-border-warm shadow-[0_-2px_10px_rgba(80,60,40,0.08)]"
          data-testid="save-bar"
        >
          <div className="max-w-[1320px] mx-auto px-5 py-3 flex items-center gap-4">
            <span className="text-sm font-semibold text-charcoal">
              {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}
            </span>
            {saveError && (
              <span className="text-xs text-terracotta">
                Save failed — your changes are preserved. Try again.
              </span>
            )}
            <Button
              variant="primary"
              size="sm"
              className="ml-auto"
              loading={saving}
              disabled={saving}
              onClick={() => void handleSave()}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
