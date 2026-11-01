import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlsPanel } from "./ControlsPanel";
import { DEFAULT_PARAMS } from "./defaults";

const originalClipboard = navigator.clipboard;

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
  vi.useRealTimers();
});

function openPanelAndClickCopy() {
  render(<ControlsPanel params={DEFAULT_PARAMS} onChange={() => undefined} onReset={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: /controls/ }));
  fireEvent.click(screen.getByText("copy values"));
}

describe("ControlsPanel — FIX E: copy only reports success when the write actually happened", () => {
  it("reports success when navigator.clipboard.writeText resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    openPanelAndClickCopy();

    await waitFor(() => expect(screen.getByText("copied")).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(DEFAULT_PARAMS, null, 2));
  });

  it("reports failure, not success, when the Clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });

    openPanelAndClickCopy();

    await waitFor(() => expect(screen.getByText("copy failed")).toBeInTheDocument());
    expect(screen.queryByText("copied")).not.toBeInTheDocument();
  });

  it("reports failure, not success, when writeText rejects (e.g. permission denied)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    openPanelAndClickCopy();

    await waitFor(() => expect(screen.getByText("copy failed")).toBeInTheDocument());
    expect(screen.queryByText("copied")).not.toBeInTheDocument();
  });

  it("the failure state clears back to the idle label after the timeout", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });

    render(<ControlsPanel params={DEFAULT_PARAMS} onChange={() => undefined} onReset={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /controls/ }));
    fireEvent.click(screen.getByText("copy values"));

    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("copy failed")).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(screen.getByText("copy values")).toBeInTheDocument();
  });
});
