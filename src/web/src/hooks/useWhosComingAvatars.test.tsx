import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWhosComingAvatars } from "./useWhosComingAvatars";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWhosComingAvatars", () => {
  it("maps photographed people to versioned public CDN URLs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        people: [
          { id: 42, fullName: "Omar M", branch: "CSE", hasPhoto: true, emailHash: "hash-42" },
          { id: 43, fullName: "No Photo", branch: "CSE", hasPhoto: false, emailHash: "hash-43" },
        ],
        count: 2,
        thumbsBaseUrl: "https://cdn.example/photos",
        photosVersion: 1_752_600_000_123,
      }),
    }));

    const { result } = renderHook(() => useWhosComingAvatars());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.getAvatarUrl("hash-42")).toBe(
      "https://cdn.example/photos/42.jpg?v=1752600000123",
    );
    expect(result.current.getAvatarUrl("hash-43")).toBeNull();
  });
});
