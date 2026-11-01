import { useState } from "react";
import { LedWall } from "@/components/led-wall/LedWall";
import { LedWallControls } from "@/components/led-wall/LedWallControls";
import { mockSource } from "@/components/led-wall/mockSource";
import { init } from "@/components/led-wall/wallCore";
import type { WallState } from "@/components/led-wall/wallCore";

export default function LedWallDebugPage() {
  const [queueCount, setQueueCount] = useState(0);
  const [wallState, setWallState] = useState<WallState>(() => init()[0]);
  return (
    <main className="fixed inset-0 overflow-hidden">
      <LedWall
        source={mockSource}
        syncIntervalMs={1000}
        onQueueCountChange={setQueueCount}
        onState={setWallState}
      />
      <LedWallControls source={mockSource} queueCount={queueCount} state={wallState} />
    </main>
  );
}
