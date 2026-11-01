/**
 * LED wall — the engine seam.
 *
 * `LedWall` takes an engine as a prop, defaulting to the production one
 * (Candidate A / `wallCore.ts`). This is what lets the debug panel swap
 * candidates against the real wall (Layer 2 of the test/comparison plan)
 * while Layer 1's scenario suite drives `wallCore` directly. See
 * `tasks/2026-08-13-led-wall-state-machine.options.md` §3.
 */
import { init, transition } from "./wallCore";
import type { WallEffect, WallEvent, WallState } from "./wallCore";
import type { LedWallParams } from "./types";

export interface WallEngine {
  init(params: LedWallParams): [WallState, WallEffect[]];
  transition(state: WallState, event: WallEvent, params: LedWallParams): [WallState, WallEffect[]];
}

/** Candidate A: the pure reducer in `wallCore.ts`, behind the engine seam. */
export const candidateAEngine: WallEngine = { init, transition };

/** The production default — `LedWall`'s `engine` prop falls back to this. */
export const defaultEngine: WallEngine = candidateAEngine;
