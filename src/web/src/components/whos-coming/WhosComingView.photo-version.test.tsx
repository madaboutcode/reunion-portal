import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchWhosComingPublic: vi.fn() };
});
vi.mock("@/components/SiteNav", () => ({ SiteNav: () => null }));
vi.mock("@/components/SiteFooter", () => ({ SiteFooter: () => null }));
vi.mock("@/components/ui/ScrollReveal", () => ({
  ScrollReveal: ({ children }: { children: ReactNode }) => <>{children}</>,
  ScrollRevealGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { fetchWhosComingPublic } from "@/lib/api";
import PublicWhosComingPage from "@/pages/PublicWhosComingPage";

beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("public Who's Coming photo version propagation", () => {
  it("renders the API photosVersion in the final public avatar URL", async () => {
    vi.mocked(fetchWhosComingPublic).mockResolvedValue({
      people: [{
        id: 42,
        fullName: "Omar M",
        branch: "Computer Science & Engineering",
        city: "Kochi",
        country: "India",
        hasPhoto: true,
        createdAt: 1_752_600_000_000,
      }],
      count: 1,
      thumbsBaseUrl: "https://cdn.example/photos",
      photosVersion: 1_752_600_000_321,
    });

    render(
      <MemoryRouter initialEntries={["/whos-coming"]}>
        <PublicWhosComingPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("img", { name: "Omar M" })).toHaveAttribute(
      "src",
      "https://cdn.example/photos/42.jpg?v=1752600000321",
    );
  });
});
