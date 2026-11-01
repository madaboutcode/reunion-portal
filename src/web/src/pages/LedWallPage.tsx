import { useMemo } from "react";
import { LedWall } from "@/components/led-wall/LedWall";
import { LiveLedWallSource } from "@/components/led-wall/liveSource";

/**
 * The real public venue screen. No action/inspector overlay, no queue
 * wiring — those are `LedWallDebugPage`'s job (mock source only). The
 * tuning `ControlsPanel` (dwell/spotlight/etc, toggled by `/`) IS enabled
 * here so timing can be adjusted against real check-ins — accepted
 * tradeoff: `/led-wall` is a public, unauthenticated route, so anyone with
 * the URL can press `/` and retune the wall live (committee, 2026-08-14).
 */
export default function LedWallPage() {
  // Memoized: a `new` in the render body would re-subscribe (and re-fetch)
  // on every re-render — see the live-source testplan, trap T6.
  const source = useMemo(() => new LiveLedWallSource(), []);
  return (
    <main className="fixed inset-0 overflow-hidden">
      <LedWall source={source} syncIntervalMs={60000} />
    </main>
  );
}
