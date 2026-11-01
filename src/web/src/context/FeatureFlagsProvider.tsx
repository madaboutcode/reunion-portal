import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { publicClient } from "@/lib/http";
import type { PublicFeatureFlagKey } from "@smriti/shared";
import {
  FeatureFlagsContext,
  initialFeatureFlagValues,
} from "@/context/feature-flags-context";

/*
 * CONTRACT: FeatureFlagsProvider
 *
 * GUARANTEES:
 * - Fetches public feature flags once on mount from GET /api/config/features
 *   and shares the result across the app via context.
 * - Fails closed: until the first fetch succeeds, every flag reads as its
 *   catalog failure value (from getPublicFailureValues()), and `ready` is
 *   false.
 * - Refetches when the tab becomes visible again (document.visibilitychange),
 *   deduplicating concurrent calls so only one request is in flight at a time.
 * - A refresh() failure after the first successful fetch keeps the last known
 *   good values — it never reverts to failure values once ready.
 *
 * EXPECTS:
 * - Mounted once, inside the router but outside <Routes>, so flags persist
 *   across route changes.
 */

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Record<PublicFeatureFlagKey, boolean>>(
    initialFeatureFlagValues,
  );
  const [ready, setReady] = useState(false);
  const inflightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;

    const promise = (async () => {
      try {
        const data = await publicClient<{ flags: Record<PublicFeatureFlagKey, boolean> }>(
          "/api/config/features",
        );
        setValues(data.flags);
        setReady(true);
      } catch {
        // First failure: retain failure values, stay not-ready.
        // Refresh failure: retain last good values, stay ready.
      } finally {
        inflightRef.current = null;
      }
    })();

    inflightRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [refresh]);

  return (
    <FeatureFlagsContext.Provider value={{ values, ready, refresh }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}
