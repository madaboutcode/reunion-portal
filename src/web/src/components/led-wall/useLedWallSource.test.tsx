import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLedWallSource } from "./useLedWallSource";
import type { LedWallDataSource, PresentAttendee } from "./types";
import type { WallEvent } from "./wallCore";

const attendee = (id: number): PresentAttendee => ({
  id,
  fullName: `Person ${id}`,
  branch: "Architecture",
  portraitUrl: null,
  thumbnailUrl: null,
  checkedInAt: 1_780_000_000_000 + id,
});

function sourceWithArrival(): { source: LedWallDataSource; deliver: (a: PresentAttendee) => void } {
  let deliver: (attendee: PresentAttendee) => void = () => undefined;
  const source: LedWallDataSource = {
    getSnapshot: () => Promise.resolve([attendee(1)]),
    subscribe: (onArrival) => {
      deliver = onArrival;
      return () => undefined;
    },
  };
  return { source, deliver: (value) => deliver(value) };
}

describe("useLedWallSource", () => {
  afterEach(() => vi.useRealTimers());

  it("dispatches a SNAPSHOT for the initial fetch, and an ARRIVAL — with a monotonic seq — for each live delivery", async () => {
    const { source, deliver } = sourceWithArrival();
    const dispatched: WallEvent[] = [];
    renderHook(() => useLedWallSource(source, (event) => dispatched.push(event)));

    await act(async () => { await Promise.resolve(); });
    expect(dispatched).toEqual([{ type: "SNAPSHOT", attendees: [attendee(1)], asOfSeq: 0 }]);

    act(() => deliver(attendee(2)));
    act(() => deliver(attendee(3)));

    expect(dispatched.slice(1)).toEqual([
      { type: "ARRIVAL", attendee: attendee(2), seq: 1 },
      { type: "ARRIVAL", attendee: attendee(3), seq: 2 },
    ]);
  });

  it("dispatches SNAPSHOT_FAILED with the error message on a rejected fetch", async () => {
    const source: LedWallDataSource = {
      getSnapshot: () => Promise.reject(new Error("network down")),
      subscribe: () => () => undefined,
    };
    const dispatched: WallEvent[] = [];
    renderHook(() => useLedWallSource(source, (event) => dispatched.push(event)));

    await act(async () => { await Promise.resolve(); });
    expect(dispatched).toEqual([{ type: "SNAPSHOT_FAILED", message: "network down" }]);
  });

  it("stamps asOfSeq at request START, not resolution — an arrival mid-flight is stamped newer than the snapshot it races", async () => {
    vi.useFakeTimers();
    const snapshots: Array<(value: PresentAttendee[]) => void> = [];
    let deliver: (a: PresentAttendee) => void = () => undefined;
    const source: LedWallDataSource = {
      getSnapshot: () => new Promise((resolve) => snapshots.push(resolve)),
      subscribe: (onArrival) => {
        deliver = onArrival;
        return () => undefined;
      },
    };
    const dispatched: WallEvent[] = [];
    renderHook(() => useLedWallSource(source, (event) => dispatched.push(event), { syncIntervalMs: 100_000 }));

    // The request is now in flight, sampled at seq 0. An arrival lands before it resolves.
    act(() => deliver(attendee(9)));
    expect(dispatched).toEqual([{ type: "ARRIVAL", attendee: attendee(9), seq: 1 }]);

    await act(async () => {
      snapshots[0]?.([]); // resolves after the arrival — seq is 1 by now, but the sample was taken at 0
      await Promise.resolve();
    });

    expect(dispatched[1]).toEqual({ type: "SNAPSHOT", attendees: [], asOfSeq: 0 });
  });

  it("re-syncs on the configured interval, each with its own SNAPSHOT dispatch", async () => {
    vi.useFakeTimers();
    let call = 0;
    const source: LedWallDataSource = {
      getSnapshot: () => { call += 1; return Promise.resolve(call === 1 ? [] : [attendee(1)]); },
      subscribe: () => () => undefined,
    };
    const dispatched: WallEvent[] = [];
    renderHook(() => useLedWallSource(source, (event) => dispatched.push(event), { syncIntervalMs: 100 }));

    await act(async () => { await Promise.resolve(); });
    expect(dispatched).toEqual([{ type: "SNAPSHOT", attendees: [], asOfSeq: 0 }]);

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(dispatched).toEqual([
      { type: "SNAPSHOT", attendees: [], asOfSeq: 0 },
      { type: "SNAPSHOT", attendees: [attendee(1)], asOfSeq: 0 },
    ]);
  });

  it("FIX A — re-subscribes and re-fetches when the dispatch target changes (e.g. an engine swap)", async () => {
    let getSnapshotCalls = 0;
    let subscribeCalls = 0;
    const source: LedWallDataSource = {
      getSnapshot: () => {
        getSnapshotCalls += 1;
        return Promise.resolve([]);
      },
      subscribe: () => {
        subscribeCalls += 1;
        return () => undefined;
      },
    };
    const dispatchA = vi.fn();
    const dispatchB = vi.fn();
    const { rerender } = renderHook(
      ({ dispatch }: { dispatch: (event: WallEvent) => void }) => useLedWallSource(source, dispatch),
      { initialProps: { dispatch: dispatchA } },
    );

    await act(async () => { await Promise.resolve(); });
    expect(getSnapshotCalls).toBe(1);
    expect(subscribeCalls).toBe(1);

    // Simulates useWallEngine's dispatch identity changing on an engine swap — a genuinely
    // new function reference, not the same dispatchA re-passed.
    rerender({ dispatch: dispatchB });
    await act(async () => { await Promise.resolve(); });

    expect(getSnapshotCalls).toBe(2); // fresh fetch — doesn't wait for the next interval tick
    expect(subscribeCalls).toBe(2); // re-subscribed too
    expect(dispatchA).toHaveBeenCalledTimes(1); // only the pre-swap fetch — the old target stops receiving
    expect(dispatchB).toHaveBeenCalledTimes(1); // the post-swap fetch lands on the new target
  });

  it("re-syncs immediately when the source signals via subscribeResync, beyond the interval schedule", async () => {
    vi.useFakeTimers();
    let call = 0;
    let signalResync: (() => void) | undefined;
    const source: LedWallDataSource = {
      getSnapshot: () => { call += 1; return Promise.resolve(call === 1 ? [] : [attendee(call)]); },
      subscribe: () => () => undefined,
      subscribeResync: (onResyncNeeded) => {
        signalResync = onResyncNeeded;
        return () => { signalResync = undefined; };
      },
    };
    const dispatched: WallEvent[] = [];
    renderHook(() => useLedWallSource(source, (event) => dispatched.push(event), { syncIntervalMs: 100_000 }));

    await act(async () => { await Promise.resolve(); });
    expect(dispatched).toEqual([{ type: "SNAPSHOT", attendees: [], asOfSeq: 0 }]);

    // Fires well before the interval would — proves the resync callback, not the timer, triggered this.
    await act(async () => {
      signalResync?.();
      await Promise.resolve();
    });

    expect(dispatched).toEqual([
      { type: "SNAPSHOT", attendees: [], asOfSeq: 0 },
      { type: "SNAPSHOT", attendees: [attendee(2)], asOfSeq: 0 },
    ]);
  });

  it("a source without subscribeResync behaves exactly as before — no crash, unmount still unsubscribes cleanly", async () => {
    const { source, deliver } = sourceWithArrival();
    expect(source.subscribeResync).toBeUndefined();
    const dispatched: WallEvent[] = [];
    const { unmount } = renderHook(() => useLedWallSource(source, (event) => dispatched.push(event)));

    await act(async () => { await Promise.resolve(); });
    act(() => deliver(attendee(2)));

    expect(dispatched).toEqual([
      { type: "SNAPSHOT", attendees: [attendee(1)], asOfSeq: 0 },
      { type: "ARRIVAL", attendee: attendee(2), seq: 1 },
    ]);

    expect(() => unmount()).not.toThrow();
  });

  it("stops dispatching after unmount — a late-resolving fetch and a late arrival are both dropped", async () => {
    const { source, deliver } = sourceWithArrival();
    let resolveSnapshot: ((value: PresentAttendee[]) => void) | undefined;
    const slowSource: LedWallDataSource = {
      getSnapshot: () => new Promise((resolve) => { resolveSnapshot = resolve; }),
      subscribe: source.subscribe,
    };
    const dispatched: WallEvent[] = [];
    const { unmount } = renderHook(() => useLedWallSource(slowSource, (event) => dispatched.push(event)));

    unmount();
    await act(async () => {
      resolveSnapshot?.([attendee(1)]);
      deliver(attendee(2));
      await Promise.resolve();
    });

    expect(dispatched).toEqual([]);
  });
});
