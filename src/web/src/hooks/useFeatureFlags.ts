import { useContext } from "react";
import type { PublicFeatureFlagKey } from "@smriti/shared";
import { FeatureFlagsContext, type FeatureFlagsContextValue } from "@/context/feature-flags-context";

/**
 * Reads a public feature flag from the FeatureFlagsProvider context.
 * Fails closed to the flag's catalog failure value until the provider's
 * first fetch settles (see FeatureFlagsProvider CONTRACT).
 */
export function useFeatureFlag(key: PublicFeatureFlagKey): boolean {
  return useContext(FeatureFlagsContext).values[key];
}

export function useFeatureFlags(): Pick<FeatureFlagsContextValue, "ready" | "refresh"> {
  const ctx = useContext(FeatureFlagsContext);
  return { ready: ctx.ready, refresh: ctx.refresh };
}
