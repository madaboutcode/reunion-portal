import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api");

import { getDeskRoster } from "@/lib/api";
import type { DeskRosterFullResponse } from "@/lib/api";
import LedWallPage from "./LedWallPage";

const mockedGetDeskRoster = vi.mocked(getDeskRoster);

function emptyRoster(): DeskRosterFullResponse {
  return { now: 0, seq: 0, count: 0, entries: [] };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LedWallPage", () => {
  it("mounts the wall with the tuning ControlsPanel present (controls defaults true)", async () => {
    mockedGetDeskRoster.mockReset().mockResolvedValue(emptyRoster());
    const { container } = render(<LedWallPage />);
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector(".led-wall")).toBeInTheDocument();
    expect(container.querySelector(".led-wall-controls")).toBeInTheDocument();
  });

  it("T6 — memoizes the source: a re-render does not re-subscribe or re-fetch", async () => {
    mockedGetDeskRoster.mockReset().mockResolvedValue(emptyRoster());
    const { rerender } = render(<LedWallPage />);
    await act(async () => { await Promise.resolve(); });

    expect(mockedGetDeskRoster).toHaveBeenCalledTimes(1);

    // Force a re-render of the same mounted instance — a `new LiveLedWallSource()`
    // in the render body would re-subscribe useLedWallSource's effect and issue
    // a second snapshot fetch.
    rerender(<LedWallPage />);
    await act(async () => { await Promise.resolve(); });

    expect(mockedGetDeskRoster).toHaveBeenCalledTimes(1);
  });
});
