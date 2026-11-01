import { useState } from "react";
import type { MockLedWallSource } from "./mockSource";
import type { WallState } from "./wallCore";

interface LedWallControlsProps {
  source: MockLedWallSource;
  queueCount: number;
  state: WallState;
}

/**
 * SPIKE debug overlay — action buttons, per-branch sliders, and the raw
 * engine state readout, all in one surface. Dev tool only, not a designed
 * surface.
 *
 * The action buttons call `inject()`/`removeRandom()`/`replaceBranch()`/
 * `clear()` on the mock source — `inject()` triggers a spotlight, the rest
 * are silent. The sliders call `setBranchCount()`, which is also silent: a
 * slider drag only changes the wall on its next periodic re-sync, with no
 * spotlight.
 */
export function LedWallControls({ source, queueCount, state }: LedWallControlsProps) {
  const [presentCount, setPresentCount] = useState(() => source.presentCount());
  const [summaries, setSummaries] = useState(() => source.branchSummaries());

  const refresh = () => {
    setPresentCount(source.presentCount());
    setSummaries(source.branchSummaries());
  };

  return (
    <div className="fixed top-4 right-4 z-[110] w-80 max-h-[calc(100vh-32px)] overflow-y-auto rounded-lg bg-black/80 p-3 font-mono text-[11px] text-white/90 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className="rounded border border-white/30 bg-white/10 px-2 py-1 hover:bg-white/20"
          onClick={() => { source.inject(); refresh(); }}
        >
          Add person
        </button>
        <button
          type="button"
          className="rounded border border-white/30 bg-white/10 px-2 py-1 hover:bg-white/20"
          onClick={() => {
            source.inject();
            source.inject();
            source.inject();
            refresh();
          }}
        >
          Burst 3
        </button>
        <button
          type="button"
          className="rounded border border-white/30 bg-white/10 px-2 py-1 hover:bg-white/20"
          onClick={() => { source.removeRandom(); refresh(); }}
        >
          Remove person
        </button>
        <button
          type="button"
          className="rounded border border-white/30 bg-white/10 px-2 py-1 hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10"
          disabled={state.branchCursor === null}
          onClick={() => {
            if (state.branchCursor !== null) {
              source.replaceBranch(state.branchCursor);
              refresh();
            }
          }}
        >
          Reload branch
        </button>
        <button
          type="button"
          className="rounded border border-white/30 bg-white/10 px-2 py-1 hover:bg-white/20"
          onClick={() => { source.clear(); refresh(); }}
        >
          Clear → idle
        </button>
      </div>

      <div className="flex gap-4">
        <span>present: {presentCount}</span>
        <span>spotlight queue: {queueCount}</span>
      </div>

      <div className="space-y-1.5 border-t border-white/15 pt-2">
        {summaries.map(({ branch, total, present }) => (
          <label key={branch} className="block">
            <span className="flex justify-between text-white/70">
              <span>{branch}</span>
              <span>{present}/{total}</span>
            </span>
            <input
              type="range"
              min={0}
              max={total}
              value={present}
              className="w-full"
              onChange={(event) => {
                source.setBranchCount(branch, Number(event.target.value));
                refresh();
              }}
            />
          </label>
        ))}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t border-white/15 pt-2">
        <dt className="text-white/50">phase</dt>
        <dd>{state.phase}</dd>
        <dt className="text-white/50">branchCursor</dt>
        <dd>{state.branchCursor ?? "null"}</dd>
        <dt className="text-white/50">spotlight</dt>
        <dd>{state.spotlight?.id ?? "null"}</dd>
        <dt className="text-white/50">queue</dt>
        <dd>[{state.queue.map((a) => a.id).join(", ")}]</dd>
        <dt className="text-white/50">queueCount</dt>
        <dd>{queueCount}</dd>
        <dt className="text-white/50">shift</dt>
        <dd>{state.shift ? `${state.shift.kind} swapped:${String(state.shift.swapped)}` : "null"}</dd>
        <dt className="text-white/50">error</dt>
        <dd>{state.error ?? "null"}</dd>
      </dl>
    </div>
  );
}
