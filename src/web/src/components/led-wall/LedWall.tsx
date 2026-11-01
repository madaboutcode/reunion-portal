import { useEffect, useMemo, useState } from "react";
import { Backdrop } from "./Backdrop";
import { getBranchInfo, BRANCH_CATALOG } from "./branchCatalog";
import { DEFAULT_PARAMS } from "./defaults";
import { computeLayout } from "./layout";
import { ControlsPanel } from "./ControlsPanel";
import { RotationLayer } from "./RotationLayer";
import { SpotlightLayer } from "./SpotlightLayer";
import { useFullscreenHotkey } from "./useFullscreenHotkey";
import { useLedWallSource } from "./useLedWallSource";
import { useWallEngine } from "./useWallEngine";
import { defaultEngine } from "./engine";
import type { WallEngine } from "./engine";
import type { WallState } from "./wallCore";
import type { LedWallDataSource, LedWallParams, PresentAttendee } from "./types";
import "./led-wall.css";

export interface LedWallProps {
  source: LedWallDataSource;
  syncIntervalMs?: number;
  onQueueCountChange?: (count: number) => void;
  /** The state-machine candidate driving the wall. Defaults to Candidate A — the production engine. */
  engine?: WallEngine;
  /** Dev-only hook: fires with the latest engine state on every change. Used by the debug panel. */
  onState?: (state: WallState) => void;
  /**
   * Whether to render the tuning ControlsPanel. Defaults to true. Set false on a public
   * venue screen: the panel isn't just hidden, it's unmounted, so its global `/`-key
   * listener (ControlsPanel.tsx) never registers — a stray keyboard/HID event can't
   * summon it over the wall.
   */
  controls?: boolean;
}

function useViewport() {
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return viewport;
}

export function LedWall({ source, syncIntervalMs, onQueueCountChange, engine, onState, controls = true }: LedWallProps) {
  const [params, setParams] = useState<LedWallParams>(() => ({ ...DEFAULT_PARAMS }));
  const { state, dispatch } = useWallEngine(engine ?? defaultEngine, params);
  useLedWallSource(source, dispatch, { syncIntervalMs });
  const viewport = useViewport();
  // R19 — unmodified `f`/`F` toggles browser fullscreen. Mounted here (not on the
  // route pages) so both `/led-wall` and `/debug/led-wall` get it, including the
  // venue screen where the ControlsPanel is unmounted. See led-wall.spec.md R19–R19.3.
  useFullscreenHotkey();

  useEffect(() => {
    onState?.(state);
  }, [state, onState]);

  useEffect(() => {
    dispatch({ type: "PARAMS_CHANGED", params });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispatch identity is stable; only react to a real params change
  }, [params]);

  const groups = useMemo(() => {
    const grouped = new Map<string, PresentAttendee[]>();
    for (const attendee of state.attendees.values()) {
      const existing = grouped.get(attendee.branch);
      if (existing) existing.push(attendee);
      else grouped.set(attendee.branch, [attendee]);
    }
    return grouped;
  }, [state.attendees]);

  const unknownAttendees = useMemo(
    () => [...groups.entries()]
      .filter(([branch]) => !(branch in BRANCH_CATALOG))
      .flatMap(([, branchAttendees]) => branchAttendees),
    [groups],
  );

  // The engine owns the cursor outright now — no hardcoded branch fallback. `null` is a
  // legitimate value (attendees present, all in unrecognized branches) and renders below
  // with no panel, not a silently-wrong default branch.
  const currentBranch = state.branchCursor;
  const currentAttendees = useMemo(
    () => (currentBranch !== null ? [...(groups.get(currentBranch) ?? []), ...unknownAttendees] : unknownAttendees),
    [currentBranch, groups, unknownAttendees],
  );
  const currentBranchInfo = useMemo(() => getBranchInfo(currentBranch ?? ""), [currentBranch]);
  const layout = useMemo(
    () => computeLayout(params, viewport, currentBranchInfo, currentAttendees),
    [params, viewport, currentBranchInfo, currentAttendees],
  );

  // A queued attendee already committed into an in-flight enter-shift is neither in
  // `state.queue` (popped at begin, not at swap) nor counted by `phase === "spotlight"`
  // (that flips at swap too) — without this term the count reads 0 for the whole ~614ms
  // pre-swap window of every spotlight episode's entrance.
  const pendingCommittedSpotlight = state.shift?.kind === "enter" && !state.shift.swapped;
  useEffect(() => {
    onQueueCountChange?.(
      state.queue.length + (state.phase === "spotlight" ? 1 : 0) + (pendingCommittedSpotlight ? 1 : 0),
    );
  }, [state.phase, state.queue.length, pendingCommittedSpotlight, onQueueCountChange]);

  const idle = state.phase === "idle";
  // The panel shows the idle placeholder or a real branch — it's hidden only when there
  // ARE attendees but none of them resolved to a rotation branch (all unrecognized).
  const showPanel = idle || currentBranch !== null;
  // A modifier class is applied only while a shift is actually in flight (`state.shift`
  // is the shell's only signal of that) — applying it unconditionally from `shiftParity`
  // (which never resets) would replay the roll animation once, uselessly, on first paint.
  const shiftClass = state.shift === null ? "" : `led-wall-shift--${state.shiftParity === "A" ? "shiftA" : "shiftB"}`;

  return (
    <div className="led-wall" style={{ width: "100vw", height: "100vh", background: "#0b1826", ["--led-wall-shift-duration" as string]: `${params.outMs * 2}ms` }}>
      {state.phase === "loading" ? (
        <div className="led-wall-status">Loading present attendees…</div>
      ) : (
        <div className="led-wall-stage" style={{ width: `${layout.wall.w}px`, height: `${layout.wall.h}px` }}>
          <Backdrop layout={layout} />
          <div className={`led-wall-shift ${shiftClass}`}>
            <SpotlightLayer layout={layout} attendee={state.spotlight} visible={state.phase === "spotlight"} />
          </div>
          <div className={`led-wall-shift ${shiftClass}`}>
            <RotationLayer layout={layout} attendees={currentAttendees} visible={state.phase !== "spotlight"} idle={idle} showPanel={showPanel} />
          </div>
          {params.guides && <div className="led-wall-guide" />}
        </div>
      )}
      {state.phase !== "loading" && state.error && (
        <div className="led-wall-status">Last snapshot unavailable. Showing the last known wall.</div>
      )}
      {controls && <ControlsPanel params={params} onChange={setParams} onReset={() => setParams({ ...DEFAULT_PARAMS })} />}
    </div>
  );
}
