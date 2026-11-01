import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/api");

import { getDeskRoster } from "@/lib/api";
import type {
  DeskRosterDeltaResponse,
  DeskRosterEntry,
  DeskRosterEvent,
  DeskRosterFullResponse,
} from "@/lib/api";
import { LiveLedWallSource } from "./liveSource";
import type { PresentAttendee } from "./types";

const mockedGetDeskRoster = vi.mocked(getDeskRoster);

const NOW = 1_780_000_000_000;

function entry(id: number, overrides: Partial<DeskRosterEntry> = {}): DeskRosterEntry {
  return {
    registrationId: id,
    name: `Person ${id}`,
    branch: "Computer Science & Engineering",
    checkedInAt: NOW + id,
    portraitUrl: `https://cdn/p/${id}.webp`,
    thumbnailUrl: `https://cdn/${id}.jpg`,
    ...overrides,
  };
}

function full(seq: number, entries: DeskRosterEntry[]): DeskRosterFullResponse {
  return { now: NOW, seq, count: entries.length, entries };
}

function delta(seq: number, events: DeskRosterEvent[]): DeskRosterDeltaResponse {
  return { now: NOW, seq, events };
}

function arrival(seq: number, id: number, overrides: Partial<DeskRosterEntry> = {}): DeskRosterEvent {
  return { type: "arrival", seq, ...entry(id, overrides) };
}

function departure(seq: number, id: number): DeskRosterEvent {
  return { type: "departure", seq, registrationId: id };
}

describe("LiveLedWallSource", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedGetDeskRoster.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps every field, including the registrationId→id and name→fullName renames", async () => {
    mockedGetDeskRoster.mockResolvedValueOnce(
      full(100, [entry(1, { name: "Asha Nair", branch: "Computer Science & Engineering" })]),
    );

    const source = new LiveLedWallSource(10);
    const snapshot = await source.getSnapshot();

    expect(snapshot).toEqual<PresentAttendee[]>([
      {
        id: 1,
        fullName: "Asha Nair",
        branch: "Computer Science & Engineering",
        portraitUrl: "https://cdn/p/1.webp",
        thumbnailUrl: "https://cdn/1.jpg",
        checkedInAt: NOW + 1,
      },
    ]);
  });

  it("adopts the snapshot's seq as the poll cursor — the mechanism that keeps a re-delivered arrival from ever reaching the client", async () => {
    // A person the snapshot already reported can only be re-delivered as a delta arrival if the
    // server includes it in a `since=<cursor>` response. Once the cursor is adopted at the
    // snapshot's seq, the server never re-sends anything at or before it — that's what this
    // asserts, at the transport level: the poll's `since` argument.
    mockedGetDeskRoster.mockResolvedValueOnce(full(100, [entry(5, { name: "Nikhil Babu" })]));
    mockedGetDeskRoster.mockResolvedValueOnce(delta(100, []));

    const source = new LiveLedWallSource(10);
    await source.getSnapshot();
    await vi.advanceTimersByTimeAsync(10);

    expect(mockedGetDeskRoster).toHaveBeenNthCalledWith(2, 100);
  });

  it("delivers an arrival to every subscriber exactly once, in seq order", async () => {
    mockedGetDeskRoster.mockResolvedValueOnce(full(100, []));
    // Raw array order deliberately reversed relative to seq — the source must sort.
    mockedGetDeskRoster.mockResolvedValueOnce(
      delta(105, [arrival(105, 2, { name: "B" }), arrival(103, 1, { name: "A" })]),
    );

    const source = new LiveLedWallSource(10);
    await source.getSnapshot();

    const seenByFirst: number[] = [];
    const seenBySecond: number[] = [];
    source.subscribe((a) => seenByFirst.push(a.id));
    source.subscribe((a) => seenBySecond.push(a.id));

    await vi.advanceTimersByTimeAsync(10);

    expect(seenByFirst).toEqual([1, 2]);
    expect(seenBySecond).toEqual([1, 2]);
  });

  it("collapses arrival-then-departure for the same id in one batch: no arrival is emitted, but resync still fires", async () => {
    mockedGetDeskRoster.mockResolvedValueOnce(full(100, []));
    mockedGetDeskRoster.mockResolvedValueOnce(
      delta(111, [arrival(110, 8, { name: "Sara Thomas" }), departure(111, 8)]),
    );

    const source = new LiveLedWallSource(10);
    await source.getSnapshot();

    const arrivals: number[] = [];
    let resyncCount = 0;
    source.subscribe((a) => arrivals.push(a.id));
    source.subscribeResync(() => {
      resyncCount += 1;
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(arrivals).toEqual([]);
    expect(resyncCount).toBe(1); // G4 — the departure in the batch still triggers a resync
  });

  it("collapses departure-then-arrival for the same id in one batch: the arrival IS emitted, AND resync fires (G4 is independent of collapse)", async () => {
    mockedGetDeskRoster.mockResolvedValueOnce(full(100, []));
    mockedGetDeskRoster.mockResolvedValueOnce(
      delta(111, [departure(110, 8), arrival(111, 8, { name: "Sara Thomas" })]),
    );

    const source = new LiveLedWallSource(10);
    await source.getSnapshot();

    const arrivals: number[] = [];
    let resyncCount = 0;
    source.subscribe((a) => arrivals.push(a.id));
    source.subscribeResync(() => {
      resyncCount += 1;
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(arrivals).toEqual([8]);
    // The arrival supersedes the departure for collapse (G5), but the departure still occurred in
    // the raw batch — G4's resync trigger looks at the raw batch, not survivors, so it still fires.
    expect(resyncCount).toBe(1);
  });

  it("fires subscribeResync exactly once per batch, even with two departures in it", async () => {
    mockedGetDeskRoster.mockResolvedValueOnce(full(100, [entry(5), entry(6), entry(7)]));
    mockedGetDeskRoster.mockResolvedValueOnce(delta(103, [departure(102, 5), departure(103, 6)]));

    const source = new LiveLedWallSource(10);
    await source.getSnapshot();

    let resyncCount = 0;
    source.subscribeResync(() => {
      resyncCount += 1;
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(resyncCount).toBe(1);
  });

  it("a departure for an id the source never mapped still fires resync, without throwing", async () => {
    mockedGetDeskRoster.mockResolvedValueOnce(full(100, [entry(6)]));
    mockedGetDeskRoster.mockResolvedValueOnce(delta(102, [departure(102, 999)]));

    const source = new LiveLedWallSource(10);
    await source.getSnapshot();

    let resyncCount = 0;
    source.subscribeResync(() => {
      resyncCount += 1;
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(resyncCount).toBe(1);
  });

  it("swallows a failed poll and retries from the same cursor on the next tick", async () => {
    mockedGetDeskRoster.mockResolvedValueOnce(full(100, [entry(1)]));
    mockedGetDeskRoster.mockRejectedValueOnce(new Error("boom"));
    mockedGetDeskRoster.mockResolvedValueOnce(delta(100, []));

    const source = new LiveLedWallSource(10);
    await source.getSnapshot();

    await vi.advanceTimersByTimeAsync(10); // the failed poll — swallowed, no state changes
    await vi.advanceTimersByTimeAsync(10); // the retry

    expect(mockedGetDeskRoster).toHaveBeenNthCalledWith(2, 100); // the failed attempt still asked since=100
    expect(mockedGetDeskRoster).toHaveBeenNthCalledWith(3, 100); // cursor never advanced, so the retry repeats it
  });

  it("resolves the cursor monotonically when a full-mode request and a delta poll race out of order (G2)", async () => {
    // This is the exact race G2 defends against: `useLedWallSource`'s own periodic
    // `getSnapshot()` (full mode) and this source's internal poll timer (delta mode) are two
    // independent request streams that both write into `this.cursor`.
    mockedGetDeskRoster.mockResolvedValueOnce(full(100, []));
    const source = new LiveLedWallSource(10);
    await source.getSnapshot(); // adopts cursor 100, starts the poll timer

    let resolveFull!: (value: DeskRosterFullResponse) => void;
    let resolveDelta!: (value: DeskRosterDeltaResponse) => void;
    mockedGetDeskRoster.mockImplementationOnce(() => new Promise((resolve) => (resolveFull = resolve)));
    mockedGetDeskRoster.mockImplementationOnce(() => new Promise((resolve) => (resolveDelta = resolve)));

    // A second full-mode request in flight (as the wall's own 60s re-sync would issue) …
    const secondSnapshot = source.getSnapshot();
    // … racing the next delta poll tick, both now pending.
    await vi.advanceTimersByTimeAsync(10);

    // The delta resolves first, reporting the newer seq.
    resolveDelta(delta(110, []));
    await vi.advanceTimersByTimeAsync(0);
    // The slower full-mode response resolves after, reporting a seq the delta already passed.
    resolveFull(full(104, []));
    await secondSnapshot;

    mockedGetDeskRoster.mockResolvedValueOnce(delta(110, []));
    await vi.advanceTimersByTimeAsync(10);

    expect(mockedGetDeskRoster).toHaveBeenLastCalledWith(110); // not 104 — Math.max held the higher seq
  });

  it("stops polling once the last subscriber unsubscribes", async () => {
    mockedGetDeskRoster.mockResolvedValueOnce(full(100, []));
    const source = new LiveLedWallSource(10);
    await source.getSnapshot();

    const unsubscribeArrival = source.subscribe(() => undefined);
    const unsubscribeResync = source.subscribeResync(() => undefined);

    mockedGetDeskRoster.mockResolvedValue(delta(100, []));
    await vi.advanceTimersByTimeAsync(10);
    const callsWhilePolling = mockedGetDeskRoster.mock.calls.length;

    unsubscribeArrival();
    unsubscribeResync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockedGetDeskRoster.mock.calls.length).toBe(callsWhilePolling); // no further polls after the last unsubscribe
  });
});
