import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import MagazinePage from "./MagazinePage";

vi.mock("@/components/SiteNav", () => ({ SiteNav: () => null }));
vi.mock("@/components/SiteFooter", () => ({ SiteFooter: () => null }));

const CDN = "https://cdn.example.test";

function response(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 503,
    json: async () => body,
  };
}

function indexResponse() {
  return response({
    schemaVersion: 1,
    issues: [
      {
        id: "magazine-2026",
        slug: "magazine-2026",
        title: "PAGES",
        coverUrl: `${CDN}/magazines/magazine-2026/pages/page-001.webp`,
        manifestUrl: `${CDN}/magazines/magazine-2026/manifest.json`,
        isDefault: true,
      },
    ],
  });
}

interface ManifestOverrides {
  contents?: unknown[];
  intro?: unknown;
  omitIntro?: boolean;
  omitDownloadUrl?: boolean;
}

function manifest(overrides: ManifestOverrides = {}) {
  const base = {
    schemaVersion: 1,
    id: "magazine-2026",
    slug: "magazine-2026",
    title: "PAGES",
    subtitle: "The chapters we write...",
    edition: "20th year reunion",
    pageCount: 2,
    pages: [1, 2].map((number) => ({
      id: `page-${String(number).padStart(3, "0")}`,
      number,
      src: `${CDN}/magazines/magazine-2026/pages/page-${String(number).padStart(3, "0")}.webp`,
      width: 1191,
      height: 1684,
      alt: `PAGES souvenir magazine, reading page ${number} of 2`,
    })),
    cover: {
      pageId: "page-001",
      src: `${CDN}/magazines/magazine-2026/pages/page-001.webp`,
      width: 1191,
      height: 1684,
      alt: "PAGES souvenir magazine cover",
    },
    contents:
      overrides.contents ??
      [
        {
          id: "contents-page-002",
          title: "Messages",
          startPageId: "page-002",
        },
      ],
  } as Record<string, unknown>;

  if (!overrides.omitDownloadUrl) {
    base.downloadUrl = `${CDN}/magazine-2026/pages-magazine-2026.pdf`;
  }

  if (!overrides.omitIntro) {
    base.intro = overrides.intro ?? {
      frameRate: 15,
      duration: 0.1,
      frameCount: 1,
      width: 960,
      height: 540,
      eyebrow: "From the editor's desk",
      quote: "A roller coaster of memories and emotions.",
      credit: "Gita Specimen · EEE 2006",
      frames: [
        {
          id: "frame-001",
          number: 1,
          src: `${CDN}/magazines/magazine-2026/intro-frames/frame-001.webp`,
          width: 960,
          height: 540,
          alt: "PAGES magazine opening frame 1 of 1",
        },
      ],
    };
  }

  return base;
}

describe("MagazinePage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("renders reader pages from the CDN manifest, excluding downloadUrl checks handled elsewhere", async () => {
    fetchMock
      .mockResolvedValueOnce(indexResponse())
      .mockResolvedValueOnce(response(manifest()));

    render(
      <MemoryRouter>
        <MagazinePage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getAllByAltText(/PAGES souvenir magazine, reading page/),
      ).toHaveLength(1),
    );

    const pages = screen.getAllByAltText(/PAGES souvenir magazine, reading page/);
    expect(pages[0]).toHaveAttribute(
      "src",
      `${CDN}/magazines/magazine-2026/pages/page-002.webp`,
    );
    expect(pages[0]).toHaveAttribute("loading", "eager");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${CDN}/magazines/index.json`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("shows 'Magazine unavailable' with a Retry action on metadata failure", async () => {
    fetchMock.mockRejectedValueOnce(
      new Error("Could not load magazine metadata."),
    );

    render(
      <MemoryRouter>
        <MagazinePage />
      </MemoryRouter>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Magazine unavailable");
    expect(alert).toHaveTextContent("Could not load magazine metadata.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    // No reader or intro content ever renders on a metadata failure.
    expect(screen.queryByRole("region", { name: "PAGES" })).not.toBeInTheDocument();
  });

  it("reveals the cover without requesting intro frames when the manifest has no intro", async () => {
    fetchMock
      .mockResolvedValueOnce(indexResponse())
      .mockResolvedValueOnce(response(manifest({ omitIntro: true })));

    render(
      <MemoryRouter>
        <MagazinePage />
      </MemoryRouter>,
    );

    const coverImage = await screen.findByAltText("PAGES souvenir magazine cover");
    expect(coverImage).toHaveAttribute(
      "src",
      `${CDN}/magazines/magazine-2026/pages/page-001.webp`,
    );

    // Loading screen never appears — no intro means no frames requested.
    expect(
      screen.queryByText("Opening the souvenir magazine..."),
    ).not.toBeInTheDocument();

    // No intro-frame URL was ever fetched.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("intro-frames");
    }
  });

  it("omits the contents menu when the manifest has no contents", async () => {
    fetchMock
      .mockResolvedValueOnce(indexResponse())
      .mockResolvedValueOnce(response(manifest({ contents: [] })));

    render(
      <MemoryRouter>
        <MagazinePage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getAllByAltText(/PAGES souvenir magazine, reading page/),
      ).toHaveLength(1),
    );

    expect(
      screen.queryByRole("button", { name: "Contents" }),
    ).not.toBeInTheDocument();
  });

  it("shows the download action when the manifest provides a downloadUrl", async () => {
    fetchMock
      .mockResolvedValueOnce(indexResponse())
      .mockResolvedValueOnce(response(manifest()));

    render(
      <MemoryRouter>
        <MagazinePage />
      </MemoryRouter>,
    );

    const link = await screen.findByRole("link", { name: "Download" });
    expect(link).toHaveAttribute(
      "href",
      `${CDN}/magazine-2026/pages-magazine-2026.pdf`,
    );
  });

  it("hides the download action when the manifest has no downloadUrl", async () => {
    fetchMock
      .mockResolvedValueOnce(indexResponse())
      .mockResolvedValueOnce(response(manifest({ omitDownloadUrl: true })));

    render(
      <MemoryRouter>
        <MagazinePage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getAllByAltText(/PAGES souvenir magazine, reading page/),
      ).toHaveLength(1),
    );

    expect(
      screen.queryByRole("link", { name: "Download" }),
    ).not.toBeInTheDocument();
  });

  it("does not repeat the cover page as the first reader item", async () => {
    fetchMock
      .mockResolvedValueOnce(indexResponse())
      .mockResolvedValueOnce(response(manifest()));

    render(
      <MemoryRouter>
        <MagazinePage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getAllByAltText(/PAGES souvenir magazine, reading page/),
      ).toHaveLength(1),
    );

    // The cover image renders once (inside the intro's cover layer), not
    // again as a reader page.
    const coverImages = screen.getAllByAltText("PAGES souvenir magazine cover");
    expect(coverImages).toHaveLength(1);
  });

  it("shows the loading screen with Skip button when the manifest has an intro", async () => {
    fetchMock
      .mockResolvedValueOnce(indexResponse())
      .mockResolvedValueOnce(response(manifest()));

    render(
      <MemoryRouter>
        <MagazinePage />
      </MemoryRouter>,
    );

    const skipButton = await screen.findByRole("button", { name: /skip intro/i });
    expect(skipButton).toBeInTheDocument();
    expect(
      screen.getByText("Opening the souvenir magazine..."),
    ).toBeInTheDocument();
  });

  it("shows the cover after the 8-second loading timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    fetchMock
      .mockResolvedValueOnce(indexResponse())
      .mockResolvedValueOnce(response(manifest()));

    render(
      <MemoryRouter>
        <MagazinePage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /skip intro/i })).toBeInTheDocument(),
    );

    await vi.advanceTimersByTimeAsync(8000);

    await waitFor(() =>
      expect(
        screen.getByText("Taking longer than expected. Showing the cover."),
      ).toBeInTheDocument(),
    );

    vi.useRealTimers();
  });
});
