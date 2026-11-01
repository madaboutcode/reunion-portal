import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/Input";
import { DeskResultCard } from "@/components/registration-desk/DeskResultCard";
import type { DeskSearchResult } from "@/lib/staff-types";

export interface DeskSearchPanelProps {
  /** Lives in the parent (RegistrationDeskPage) so it survives opening/closing the detail overlay. */
  query: string;
  onQueryChange: (value: string) => void;
  /** Fired after the debounce, or immediately when Enter is pressed in the search input. */
  onSubmit: (query: string) => void;
  loading: boolean;
  error: string | null;
  results: DeskSearchResult[] | null;
  thumbsBaseUrl: string;
  photosVersion: number;
  onSelectResult: (regCode: string) => void;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 450;

/** Ribbon landing search zone (registration-desk-ui plan, mockup .search-zone + .result-space). */
export function DeskSearchPanel({
  query,
  onQueryChange,
  onSubmit,
  loading,
  error,
  results,
  thumbsBaseUrl,
  photosVersion,
  onSelectResult,
}: DeskSearchPanelProps) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    timerRef.current = window.setTimeout(() => onSubmit(trimmed), DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    // onSubmit is a stable useCallback in the parent; re-running only on query change
    // keeps the debounce timer from restarting on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function runNow() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const trimmed = query.trim();
    if (trimmed.length >= MIN_QUERY_LENGTH) onSubmit(trimmed);
  }

  const idle = query.trim().length < MIN_QUERY_LENGTH;

  return (
    <div className="mx-auto mt-4 w-full animate-[desk-panel-in_0.45s_cubic-bezier(0.22,1,0.36,1)_both] sm:w-[72%]">
      <div className="rounded-[22px] border border-border-warm bg-page/80 p-4 text-left shadow-[0_14px_34px_rgba(80,60,40,0.12)] backdrop-blur-sm transition-shadow duration-300 focus-within:shadow-[0_18px_40px_rgba(80,60,40,0.18)] focus-within:ring-2 focus-within:ring-soft-aqua/60">
        <div className="mb-2.5 flex items-center justify-between gap-3 text-xs font-bold text-charcoal">
          <strong>Attendee search</strong>
          <span className="text-[11px] font-semibold text-charcoal">Name or SMRT pass ID</span>
        </div>
        <div className="relative">
          {query.length === 0 && !loading && (
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-soft-aqua-deep" aria-hidden="true">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
              </svg>
            </span>
          )}
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") runNow();
            }}
            placeholder="Search the guest list…"
            aria-label="Attendee name or registration code"
            className="h-14 border-border-warm bg-surface px-12 text-center text-[16px] placeholder:text-soft-aqua-deep/70 placeholder:font-medium sm:text-[15px]"
          />
          {loading && (
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-soft-aqua-deep" aria-hidden="true">
              <svg className="h-5 w-5 animate-[desk-search-spin_0.9s_linear_infinite]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-3.5-7.1" />
              </svg>
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-charcoal/80">Search starts automatically after a short pause — press Enter to search now. A scanned pass link opens the attendee directly.</p>
      </div>

      <section className="mt-2 min-h-[255px] text-left" aria-label="Search results" aria-live="polite">
        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-terracotta/40 bg-terracotta-light px-4 py-3 text-sm text-terracotta-deep">
            {error}
          </p>
        )}
        {loading && <p role="status" className="px-1 py-8 text-sm text-muted">Looking through the guest list…</p>}
        {!loading && !error && idle && (
          <div className="px-1 py-8">
            <div className="mb-4 h-[3px] w-[46px] bg-terracotta" aria-hidden="true" />
            <h2 className="font-heading text-[23px] text-charcoal">Ready for the next arrival</h2>
            <p className="mt-1.5 max-w-[390px] text-[13px] leading-relaxed text-muted">
              Type at least two characters. Matching registrations show their check-in state before you open them.
            </p>
          </div>
        )}
        {!loading && !idle && results && results.length > 0 && (
          <>
            <p
              key={`count-${results.length}-${results[0]?.id ?? 0}`}
              className="animate-[desk-result-in_0.32s_cubic-bezier(0.22,1,0.36,1)_both] px-0.5 pb-1 pt-4 text-[11px] font-bold uppercase tracking-[0.11em] text-charcoal/80"
            >
              {results.length} {results.length === 1 ? "match" : "matches"}
            </p>
            {results.map((result, index) => (
              <div
                key={result.id}
                style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                className="animate-[desk-result-in_0.42s_cubic-bezier(0.22,1,0.36,1)_both]"
              >
                <DeskResultCard
                  result={result}
                  thumbsBaseUrl={thumbsBaseUrl}
                  photosVersion={photosVersion}
                  onSelect={() => onSelectResult(result.regCode)}
                />
              </div>
            ))}
          </>
        )}
        {!loading && !idle && results && results.length === 0 && (
          <p className="px-1 py-9 text-center text-sm text-muted">No registration found. Check the name or full pass ID.</p>
        )}
      </section>
    </div>
  );
}
