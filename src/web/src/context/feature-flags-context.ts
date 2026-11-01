import { createContext } from "react";
import { getPublicFailureValues } from "@smriti/shared";
import type { PublicFeatureFlagKey } from "@smriti/shared";

export interface FeatureFlagsContextValue {
  values: Record<PublicFeatureFlagKey, boolean>;
  ready: boolean;
  refresh(): Promise<void>;
}

export const initialFeatureFlagValues = getPublicFailureValues();

export const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  values: initialFeatureFlagValues,
  ready: false,
  refresh: () => Promise.resolve(),
});
