import { useContext, useRef } from "react";
import { PolaroidPoolContext } from "@/context/polaroid-pool-context";
import type { PolaroidImageRef, PolaroidManifest } from "@/lib/polaroid-sprites";

/**
 * Synchronously claim a polaroid image for a stable slot id.
 * Safe across any number of PolaroidFrame instances on the same screen.
 */
export function usePolaroidClaim(slotId: string): {
  imageRef: PolaroidImageRef | null;
  ready: boolean;
  manifest: PolaroidManifest | null;
} {
  const { pool, ready, manifest } = useContext(PolaroidPoolContext);
  const imageRef = useRef<PolaroidImageRef | null>(null);

  if (pool && imageRef.current === null) {
    imageRef.current = pool.claim(slotId);
  }

  return {
    imageRef: imageRef.current,
    ready,
    manifest,
  };
}