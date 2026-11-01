/**
 * LED wall — the interpreter hook.
 *
 * The ONLY timer site in the whole feature: every `setTimeout` the wall ever
 * runs is scheduled here, in response to a `WallEffect` the pure core
 * (`wallCore.ts`) emitted. Everything else — `LedWall`, `useLedWallSource` —
 * only ever calls `dispatch`.
 *
 * Effect contract this hook MUST honor exactly (see the "Effect contract for
 * the shell" block at the top of `wallCore.ts` — the core's correctness,
 * e.g. feature spec R9's "re-sync doesn't reset the dwell timer", rests on
 * this):
 * - `"cancel"` clears the pending timer for that key, if any.
 * - `"schedule"` is an idempotent *ensure* — if a timer for that key is
 *   already pending, it is left running untouched, not reset. A caller that
 *   wants a restart emits `cancel` before `schedule` for the same key (the
 *   core already does this for `PARAMS_CHANGED`); this hook just has to
 *   apply effects in the order the core returns them.
 * - When a scheduled timer fires, its key is removed from the pending map
 *   BEFORE the event is dispatched — so a reducer throw can't leave a
 *   zombie entry, and the key becomes schedulable again immediately.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { WallEngine } from "./engine";
import type { WallEffect, WallEffectKey, WallEvent, WallState } from "./wallCore";
import type { LedWallParams } from "./types";

export interface UseWallEngineResult {
  state: WallState;
  dispatch: (event: WallEvent) => void;
}

export function useWallEngine(engine: WallEngine, params: LedWallParams): UseWallEngineResult {
  const [state, setState] = useState<WallState>(() => engine.init(params)[0]);

  // Refs, not closed-over render values: dispatch (and the timers it schedules) must
  // always transition from the CURRENT state/params, never a stale one captured at
  // the render that scheduled a given timer.
  const stateRef = useRef(state);
  stateRef.current = state;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const timersRef = useRef(new Map<WallEffectKey, ReturnType<typeof setTimeout>>());
  // Broken circular reference (dispatch needs runEffects; a fired timer needs to call
  // the current dispatch) via one level of indirection, rather than fighting useCallback
  // dependency ordering.
  const dispatchRef = useRef<(event: WallEvent) => void>(() => {});

  const runEffects = useCallback((effects: readonly WallEffect[]) => {
    for (const effect of effects) {
      if (effect.type === "cancel") {
        const timer = timersRef.current.get(effect.key);
        if (timer !== undefined) {
          clearTimeout(timer);
          timersRef.current.delete(effect.key);
        }
        continue;
      }
      if (timersRef.current.has(effect.key)) continue; // idempotent ensure — already pending, leave it running
      const timer = setTimeout(() => {
        timersRef.current.delete(effect.key); // delete-before-dispatch: no zombie entry, key is schedulable again
        dispatchRef.current(effect.event);
      }, effect.afterMs);
      timersRef.current.set(effect.key, timer);
    }
  }, []);

  const dispatch = useCallback(
    (event: WallEvent) => {
      const [next, effects] = engine.transition(stateRef.current, event, paramsRef.current);
      stateRef.current = next;
      setState(next);
      runEffects(effects);
    },
    [engine, runEffects],
  );
  dispatchRef.current = dispatch;

  useEffect(() => {
    // Re-seed on mount (and if the engine identity itself changes — e.g. the debug
    // panel swapping candidates). Cleanup clears every tracked timer unconditionally,
    // which is what makes StrictMode's mount→cleanup→mount dance safe: the discarded
    // first mount's timers never survive into the second.
    const [initialState, effects] = engine.init(paramsRef.current);
    stateRef.current = initialState;
    setState(initialState);
    runEffects(effects);
    const timers = timersRef.current; // the same live Map for the whole hook lifetime — not a snapshot
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [engine, runEffects]);

  return { state, dispatch };
}
