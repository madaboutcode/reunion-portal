import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api");

import { fetchWallImageManifest } from "@/lib/api";
import type { WallImageManifest } from "@/lib/api";
import { runPool } from "@/lib/pool";
import LedWallPrecachePage from "./LedWallPrecachePage";

const mockedFetchManifest = vi.mocked(fetchWallImageManifest);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("runPool", () => {
  it("processes every item and never exceeds the concurrency limit", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const processed: number[] = [];
    let inFlight = 0;
    let peak = 0;

    await runPool(items, 6, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve(); // yield so workers actually overlap
      processed.push(item);
      inFlight--;
    });

    expect(processed.sort((a, b) => a - b)).toEqual(items);
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1); // it really did run concurrently
  });

  it("handles limit greater than item count without hanging", async () => {
    const seen: number[] = [];
    await runPool([1, 2], 10, async (n) => {
      seen.push(n);
    });
    expect(seen.sort()).toEqual([1, 2]);
  });

  it("does nothing for an empty item list", async () => {
    const task = vi.fn();
    await runPool([], 4, task);
    expect(task).not.toHaveBeenCalled();
  });
});

function manifest(images: WallImageManifest["images"]): WallImageManifest {
  return { count: images.length, images };
}

describe("LedWallPrecachePage", () => {
  it("surfaces a manifest failure as an error and never downloads", async () => {
    mockedFetchManifest.mockReset().mockRejectedValue(new Error("boom: manifest down"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<LedWallPrecachePage />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
      await Promise.resolve();
    });

    expect(screen.getByText("boom: manifest down")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    // Button offers a retry, not a stuck "Downloading…"
    expect(screen.getByRole("button")).toHaveTextContent("Retry");
  });

  it("downloads only non-null URLs from the manifest", async () => {
    mockedFetchManifest.mockReset().mockResolvedValue(
      manifest([
        { id: 1, portraitUrl: "https://cdn.example.test/portraits/1.webp", thumbnailUrl: "https://cdn.example.test/1.jpg" },
        { id: 2, portraitUrl: null, thumbnailUrl: "https://cdn.example.test/2.jpg" },
      ]),
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    render(<LedWallPrecachePage />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // 3 non-null URLs (id 2's null portrait is filtered out), not 4.
    const requested = fetchSpy.mock.calls.map((call) => call[0]);
    expect(requested).toHaveLength(3);
    expect(requested).toContain("https://cdn.example.test/portraits/1.webp");
    expect(requested).not.toContain(null);
    for (const call of fetchSpy.mock.calls) {
      expect(call[1]).toMatchObject({ mode: "no-cors" });
    }
  });
});
