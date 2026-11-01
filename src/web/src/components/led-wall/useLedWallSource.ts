import { useEffect } from "react";
import type { LedWallDataSource } from "./types";
import type { WallEvent } from "./wallCore";

export interface UseLedWallSourceOptions {
  /** Re-sync cadence for a future live source. Milestone 1 uses a slow fallback. */
  syncIntervalMs?: number;
}

/**
 * Bridges the source boundary to the engine — a thin, seq-stamping adapter.
 * Owns no attendee state itself; the core (`wallCore.ts`) is the single
 * owner of rotation truth, dedup, and reconciliation now.
 *
 * GUARANTEES:
 * - `subscribe` arrivals are stamped with a monotonic `seq` and dispatched
 *   as `ARRIVAL` — never touch the snapshot path.
 * - Each `getSnapshot()` request samples `asOfSeq` synchronously, before the
 *   request starts (so any arrival racing the request is stamped newer than
 *   it) — dispatched as `SNAPSHOT` on success, `SNAPSHOT_FAILED` on failure.
 *   The core is what resolves the resulting race (`arrivalSeq` overlay) and
 *   drops an out-of-order response (`lastSnapshotSeq`) — this adapter makes
 *   no ordering assumptions about its own requests.
 * - Re-subscribes and re-fetches whenever the `dispatch` identity changes —
 *   `useWallEngine`'s `dispatch` changes when its `engine` prop does, so
 *   swapping engines (the debug panel) gets a fresh snapshot immediately
 *   instead of sitting on "loading" until the next interval tick.
 * - If the source exposes `subscribeResync`, a resync signal triggers an
 *   extra `sync()` immediately, on top of the interval timer. Sources that
 *   omit it behave exactly as before.
 */
export function useLedWallSource(
  source: LedWallDataSource,
  dispatch: (event: WallEvent) => void,
  { syncIntervalMs = 60_000 }: UseLedWallSourceOptions = {},
): void {
  useEffect(() => {
    let cancelled = false;
    let arrivalSeq = 0;

    const sync = async () => {
      const asOfSeq = arrivalSeq; // sampled synchronously, before the request starts
      try {
        const attendees = await source.getSnapshot();
        if (cancelled) return;
        dispatch({ type: "SNAPSHOT", attendees, asOfSeq });
      } catch (snapshotError: unknown) {
        if (cancelled) return;
        const message = snapshotError instanceof Error ? snapshotError.message : "Snapshot unavailable";
        dispatch({ type: "SNAPSHOT_FAILED", message });
      }
    };

    const unsubscribe = source.subscribe((attendee) => {
      if (cancelled) return;
      arrivalSeq += 1;
      dispatch({ type: "ARRIVAL", attendee, seq: arrivalSeq });
    });
    const unsubscribeResync = source.subscribeResync?.(() => void sync());

    void sync();
    const timer = window.setInterval(() => void sync(), syncIntervalMs);

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeResync?.();
      window.clearInterval(timer);
    };
  }, [source, syncIntervalMs, dispatch]);
}
