import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LedWall } from "./LedWall";
import type { LedWallDataSource, PresentAttendee } from "./types";

const attendee = (id: number, branch: string): PresentAttendee => ({
  id,
  fullName: `Person ${id}`,
  branch,
  portraitUrl: null,
  thumbnailUrl: null,
  checkedInAt: 1_780_000_000_000 + id,
});

function controlledSource(initial: PresentAttendee[]) {
  let snapshot = initial;
  let deliver: (attendee: PresentAttendee) => void = () => undefined;
  const source: LedWallDataSource = {
    getSnapshot: () => Promise.resolve([...snapshot]),
    subscribe: (onArrival) => {
      deliver = onArrival;
      return () => undefined;
    },
  };
  return {
    source,
    setSnapshot: (next: PresentAttendee[]) => { snapshot = next; },
    deliver: (next: PresentAttendee) => deliver(next),
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LedWall", () => {
  it("returns to idle when a re-sync removes the last attendee", async () => {
    vi.useFakeTimers();
    const controlled = controlledSource([attendee(1, "Civil Engineering")]);
    render(<LedWall source={controlled.source} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Civil Engineering")).toBeInTheDocument();

    controlled.setSnapshot([]);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(screen.getByText("WAITING FOR ARRIVALS")).toBeInTheDocument();
  });

  it("keeps the current branch when a re-sync adds an earlier branch", async () => {
    vi.useFakeTimers();
    const controlled = controlledSource([attendee(1, "Civil Engineering")]);
    render(<LedWall source={controlled.source} />);
    await act(async () => { await Promise.resolve(); });

    controlled.setSnapshot([
      attendee(2, "Architecture"),
      attendee(1, "Civil Engineering"),
    ]);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(screen.getByText("Civil Engineering")).toBeInTheDocument();
    expect(screen.queryByText("Architecture")).not.toBeInTheDocument();
  });

  it("renders an unknown-branch attendee without a catalog panel", async () => {
    const controlled = controlledSource([attendee(1, "Time Travel")]);
    render(<LedWall source={controlled.source} />);
    await waitFor(() => expect(screen.getAllByText("Time Travel").length).toBeGreaterThan(0));

    expect(screen.getAllByText("Time Travel").length).toBeGreaterThan(0);
    expect(screen.queryByText("WAITING FOR ARRIVALS")).not.toBeInTheDocument();
    expect(document.querySelector(".led-wall-panel__title")).not.toBeInTheDocument();
  });

  it("integration: idle → arrival → spotlight → rotation, end to end through the real engine + adapter", async () => {
    vi.useFakeTimers();
    // Default timing (defaults.ts): outMs 640 → shift duration 1280ms, swap at 48% ≈ 614ms; spotlightHold 9500ms.
    const SWAP_MS = 614;
    const REMAINDER_MS = 1280 - SWAP_MS;
    const HOLD_MS = 9500;

    const controlled = controlledSource([]);
    render(<LedWall source={controlled.source} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("WAITING FOR ARRIVALS")).toBeInTheDocument();

    // Arrival — commits into the enter-shift immediately (queue was empty, engine idle).
    act(() => controlled.deliver(attendee(1, "Civil Engineering")));
    expect(screen.getByText("WAITING FOR ARRIVALS")).toBeInTheDocument(); // still pre-swap: idle content underneath

    await act(async () => { vi.advanceTimersByTime(SWAP_MS); });
    expect(screen.getAllByText("Person 1").length).toBeGreaterThan(0); // swapped — spotlight now showing
    expect(screen.queryByText("WAITING FOR ARRIVALS")).not.toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(REMAINDER_MS); }); // enter-shift completes; hold begins
    expect(screen.getAllByText("Person 1").length).toBeGreaterThan(0); // still holding

    await act(async () => { vi.advanceTimersByTime(HOLD_MS); }); // hold expires; exit-shift begins
    await act(async () => { vi.advanceTimersByTime(SWAP_MS); }); // exit-swap: back to rotation
    // Person 1 is still on the wall (now in the rotation filmstrip, not the spotlight) — the
    // spotlight-specific copy is what should be gone.
    expect(document.querySelector(".led-wall-spotlight-copy__name")).not.toBeInTheDocument();
    expect(screen.getByText("Civil Engineering")).toBeInTheDocument(); // rotation panel, single present branch

    await act(async () => { vi.advanceTimersByTime(REMAINDER_MS); }); // exit-shift completes — settled, quiescent
    expect(screen.getByText("Civil Engineering")).toBeInTheDocument();
  });

  it("FIX B — counts a committed-but-pre-swap enter-shift attendee in the queue count, not 0", async () => {
    vi.useFakeTimers();
    const controlled = controlledSource([]);
    const counts: number[] = [];
    render(<LedWall source={controlled.source} onQueueCountChange={(count) => counts.push(count)} />);
    await act(async () => { await Promise.resolve(); });

    act(() => controlled.deliver(attendee(1, "Civil Engineering")));
    // Still pre-swap (the enter-shift's swap fires at ~614ms): the arrival is committed into
    // the shift, not sitting in `queue`, and `phase` hasn't flipped to "spotlight" yet either.
    expect(counts.at(-1)).toBe(1);
  });

  it("renders the ControlsPanel by default", async () => {
    const controlled = controlledSource([]);
    render(<LedWall source={controlled.source} />);
    await act(async () => { await Promise.resolve(); });

    expect(document.querySelector(".led-wall-controls")).toBeInTheDocument();
  });

  it("controls=false unmounts the ControlsPanel, so its global `/` listener never registers", async () => {
    const controlled = controlledSource([]);
    render(<LedWall source={controlled.source} controls={false} />);
    await act(async () => { await Promise.resolve(); });

    expect(document.querySelector(".led-wall-controls")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "/" });
    expect(document.querySelector(".led-wall-controls")).not.toBeInTheDocument();
  });
});
