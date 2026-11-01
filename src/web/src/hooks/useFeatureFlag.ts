import { useEffect, useState } from "react";
import { staffClient } from "@/lib/http";

/**
 * Reads a runtime feature flag from GET /api/feature-flags/:name
 * (admin-authenticated — see src/server/src/routes/feature-flags.routes.ts).
 *
 * GUARANTEES:
 * - Fails closed: any error (network, 401/403, unknown flag) reads as
 *   `enabled: false`. Only a real enabled row yields `enabled: true`.
 * - `loading` is true until the fetch settles (or immediately false when
 *   `skip` is set — no request is made in that case).
 *
 * EXPECTS: callers pass `skip: true` when the flag cannot apply (e.g. dev
 * builds, non-admin sessions) so no unauthenticated request is fired.
 */

export interface UseFeatureFlagResult {
  enabled: boolean;
  loading: boolean;
}

interface FeatureFlagResponse {
  name: string;
  enabled: boolean;
}

export function useFeatureFlag(
  name: string,
  options: { skip?: boolean } = {},
): UseFeatureFlagResult {
  const skip = options.skip ?? false;
  const [result, setResult] = useState<UseFeatureFlagResult>({
    enabled: false,
    loading: !skip,
  });

  useEffect(() => {
    if (skip) {
      setResult({ enabled: false, loading: false });
      return;
    }
    let cancelled = false;
    setResult({ enabled: false, loading: true });
    staffClient<FeatureFlagResponse>(`/api/feature-flags/${name}`)
      .then((res) => {
        if (!cancelled) setResult({ enabled: res.enabled === true, loading: false });
      })
      .catch(() => {
        // Fail closed — any error reads as disabled.
        if (!cancelled) setResult({ enabled: false, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [name, skip]);

  return result;
}
