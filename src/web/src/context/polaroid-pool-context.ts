import { createContext } from "react";
import type { PolaroidManifest } from "@/lib/polaroid-sprites";
import type { PolaroidPool, PolaroidSheet } from "@/lib/polaroid-pool";

export interface PolaroidPoolContextValue {
  pool: PolaroidPool | null;
  manifest: PolaroidManifest | null;
  sheets: readonly PolaroidSheet[];
  ready: boolean;
}

export const PolaroidPoolContext = createContext<PolaroidPoolContextValue>({
  pool: null,
  manifest: null,
  sheets: [],
  ready: false,
});