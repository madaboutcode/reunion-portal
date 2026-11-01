import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LedWallDebugPage from "./LedWallDebugPage";
import { mockSource } from "@/components/led-wall/mockSource";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LedWallDebugPage", () => {
  it("renders the controls' buttons and updates the readout on Add person", async () => {
    vi.useFakeTimers();
    render(<LedWallDebugPage />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole("button", { name: "Add person" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Burst 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload branch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear → idle" })).toBeInTheDocument();

    const presentBefore = mockSource.presentCount();
    act(() => screen.getByRole("button", { name: "Add person" }).click());
    // The mutation is real, even though the queue readout only reconciles on the next sync tick.
    expect(mockSource.presentCount()).toBe(presentBefore + 1);
  });
});
