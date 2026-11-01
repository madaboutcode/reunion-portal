import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/staff-api");
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchWhosComingPublic: vi.fn() };
});

import { fetchWhosComingPublic } from "@/lib/api";
import { fetchRegistrations } from "@/lib/staff-api";
import { WhosComingPage } from "./WhosComingPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("staff Who's Coming photo version propagation", () => {
  it("renders the public photosVersion in the final staff avatar URL", async () => {
    vi.mocked(fetchRegistrations).mockResolvedValue({
      data: [{
        id: 42,
        regCode: "SMRT00042",
        fullName: "Omar M",
        email: "omar@example.com",
        whatsapp: "9876543210",
        branch: "Computer Science & Engineering",
        status: "confirmed",
        attendanceIntent: "attending",
        participationType: "full_celebration",
        totalAmount: 8_500,
        photoThumbKey: "registrations/SMRT00042/photo-thumb.jpg",
        createdAt: 1_752_600_000_000,
      }],
      page: 1,
      pageSize: 500,
      totalItems: 1,
      totalPages: 1,
    });
    vi.mocked(fetchWhosComingPublic).mockResolvedValue({
      people: [],
      count: 0,
      thumbsBaseUrl: "https://cdn.example/photos",
      photosVersion: 1_752_600_000_654,
    });

    render(<WhosComingPage />);

    expect(await screen.findByRole("img", { name: "Omar M" })).toHaveAttribute(
      "src",
      "https://cdn.example/photos/42.jpg?v=1752600000654",
    );
  });
});
