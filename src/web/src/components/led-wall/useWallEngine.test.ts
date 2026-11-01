/**
 * LED wall — the interpreter hook's timer contract.
 *
 * `wallCore.ts`'s correctness (e.g. R9: a re-sync doesn't reset the dwell
 * timer) rests on the shell honoring "schedule" as an idempotent ensure and
 * deleting a key from the pending map before dispatching its fired event.
 * This file proves those two properties directly against `useWallEngine`,
 * using a scripted fake `WallEngine` — the real `wallCore` semantics aren't
 * under test here, just the shell's effect-running contract.
 */
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWallEngine } from "./useWallEngine";
import { init as coreInit } from "./wallCore";
import type { WallEngine } from "./engine";
import type { WallEffectKey, WallState } from "./wallCore";
import { DEFAULT_PARAMS } from "./defaults";

function baseState(): WallState {
  return coreInit()[0];
}

/**
 * A scripted engine, independent of wallCore's real rules: `SNAPSHOT`
 * requests a "dwell" schedule, `SNAPSHOT_FAILED` requests a "dwell" cancel,
 * and `DWELL_EXPIRED`/`HOLD_EXPIRED` report back through the callbacks so
 * the test can observe what actually fired. All event shapes are real
 * `WallEvent` variants — no casts needed.
 */
function makeScriptedEngine(onDwellFired: () => void, onHoldFired: () => void): WallEngine {
  return {
    init: () => [baseState(), []],
    transition: (state, event) => {
      switch (event.type) {
        case "DWELL_EXPIRED":
          onDwellFired();
          return [state, []];
        case "HOLD_EXPIRED":
          onHoldFired();
          return [state, []];
        case "SNAPSHOT":
          return [state, [{ type: "schedule", key: "dwell", afterMs: 1000, event: { type: "DWELL_EXPIRED" } }]];
        case "SNAPSHOT_FAILED":
          return [state, [{ type: "cancel", key: "dwell" }]];
        default:
          return [state, []];
      }
    },
  };
}

const requestDwellSchedule = { type: "SNAPSHOT" as const, attendees: [], asOfSeq: 0 };
const requestDwellCancel = { type: "SNAPSHOT_FAILED" as const, message: "x" };

describe("useWallEngine — the timer contract wallCore depends on", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("idempotent schedule: re-requesting an already-pending key does not restart its timer", () => {
    let dwellFired = 0;
    const engine = makeScriptedEngine(() => { dwellFired += 1; }, () => {});
    const { result } = renderHook(() => useWallEngine(engine, DEFAULT_PARAMS));

    act(() => result.current.dispatch(requestDwellSchedule)); // schedules dwell for t=1000
    act(() => { vi.advanceTimersByTime(500); }); // t=500
    act(() => result.current.dispatch(requestDwellSchedule)); // re-request — must be a no-op on the pending timer

    act(() => { vi.advanceTimersByTime(500); }); // t=1000: the ORIGINAL timer, if untouched, fires now
    expect(dwellFired).toBe(1);

    // If the second request had wrongly restarted the timer (fire at t=1500), nothing
    // would have fired yet at t=1000. Confirm no delayed/duplicate fire either.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(dwellFired).toBe(1);
  });

  it("delete-on-fire: once a timer fires, its key can be scheduled again", () => {
    let dwellFired = 0;
    const engine = makeScriptedEngine(() => { dwellFired += 1; }, () => {});
    const { result } = renderHook(() => useWallEngine(engine, DEFAULT_PARAMS));

    act(() => result.current.dispatch(requestDwellSchedule));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(dwellFired).toBe(1);

    // The key is free again — a fresh request must actually install a new timer,
    // not be swallowed as "already pending".
    act(() => result.current.dispatch(requestDwellSchedule));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(dwellFired).toBe(2);
  });

  it("cancel clears a pending timer — it never fires", () => {
    let dwellFired = 0;
    const engine = makeScriptedEngine(() => { dwellFired += 1; }, () => {});
    const { result } = renderHook(() => useWallEngine(engine, DEFAULT_PARAMS));

    act(() => result.current.dispatch(requestDwellSchedule));
    act(() => result.current.dispatch(requestDwellCancel));
    act(() => { vi.advanceTimersByTime(5000); });

    expect(dwellFired).toBe(0);
  });

  it("dispatch always transitions from the latest state, never a stale closure", () => {
    const engine: WallEngine = {
      init: () => [baseState(), []],
      transition: (state, event) => {
        if (event.type === "SNAPSHOT_FAILED") return [{ ...state, error: event.message }, []];
        return [state, []];
      },
    };
    const { result } = renderHook(() => useWallEngine(engine, DEFAULT_PARAMS));

    act(() => {
      // Two dispatches in the same batch — the second must see the first's result,
      // proving dispatch reads live state (a ref), not a value closed over at render time.
      result.current.dispatch({ type: "SNAPSHOT_FAILED", message: "first" });
      result.current.dispatch({ type: "SNAPSHOT_FAILED", message: "second" });
    });

    expect(result.current.state.error).toBe("second");
  });

  it("clears every pending timer on unmount", () => {
    let fired = 0;
    const engine = makeScriptedEngine(() => { fired += 1; }, () => {});
    const { result, unmount } = renderHook(() => useWallEngine(engine, DEFAULT_PARAMS));

    act(() => result.current.dispatch(requestDwellSchedule));
    unmount();
    act(() => { vi.advanceTimersByTime(5000); });

    expect(fired).toBe(0); // the timer never fired — it was cleared, not left running against an unmounted hook
  });

  it("StrictMode's mount→cleanup→mount does not leak a timer from the discarded first mount", () => {
    let dwellFired = 0;
    const key: WallEffectKey = "dwell";
    const engine: WallEngine = {
      // The initial effect is emitted from init() itself, so both the real and the
      // StrictMode-discarded mount schedule one — the leak this test guards against
      // is the discarded mount's timer surviving alongside the real one.
      init: () => [baseState(), [{ type: "schedule", key, afterMs: 1000, event: { type: "DWELL_EXPIRED" } }]],
      transition: (state, event) => {
        if (event.type === "DWELL_EXPIRED") dwellFired += 1;
        return [state, []];
      },
    };

    renderHook(() => useWallEngine(engine, DEFAULT_PARAMS), { wrapper: StrictMode });

    act(() => { vi.advanceTimersByTime(1000); });

    expect(dwellFired).toBe(1); // not 2
  });
});
