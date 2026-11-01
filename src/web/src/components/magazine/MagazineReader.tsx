import { useRef, useState } from "react";
import { useBoundedReader } from "@/hooks/useBoundedReader";
import type { MagazineManifest, MagazinePageAsset } from "@/lib/magazine";

/*
 * CONTRACT: MagazineReader
 *
 * GUARANTEES:
 * - Renders manifest pages in manifest order, excluding the cover page (the handoff target).
 * - At most 3 full-size page images are mounted at any time: the active page and at most one
 *   neighbor on each side (via useBoundedReader).
 * - Non-mounted pages retain placeholder elements sized to each page's manifest width and
 *   height, preserving scroll geometry.
 * - Contents menu lists manifest contents entries with page numbers and titles.
 * - Contents selection scrolls to the target page, mounts its bounded window, and closes the
 *   contents panel.
 * - Shows a Download PDF action when the manifest provides a download URL.
 * - Missing contents omits the contents menu; the reader remains usable.
 * - Individual page image failure shows a local retry state without disabling navigation to
 *   other pages.
 *
 * EXPECTS:
 * - Receives a validated manifest with pages, cover, optional contents, and optional downloadUrl.
 * - Is rendered as the content section after MagazineIntro in the document flow.
 *
 * DOES NOT:
 * - Know about the intro, scroll animation, or frame preloading.
 * - Fetch metadata — receives it from the parent.
 * - Persist reading progress or update the URL based on active page (deferred).
 */

export interface MagazineReaderProps {
  manifest: MagazineManifest;
}

interface ReaderPageImageProps {
  page: MagazinePageAsset;
  isActive: boolean;
}

function ReaderPageImage({ page, isActive }: ReaderPageImageProps) {
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  if (failed) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-surface px-6 text-center font-body text-sm text-charcoal/70"
        role="alert"
      >
        <div>
          <p className="m-0">This page could not be loaded.</p>
          <button
            type="button"
            className="mt-3 min-h-11 rounded-full bg-terracotta px-5 text-sm font-bold text-white"
            onClick={() => {
              setFailed(false);
              setRetryCount((count) => count + 1);
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <img
      key={retryCount}
      src={page.src}
      alt={page.alt}
      width={page.width}
      height={page.height}
      loading={isActive ? "eager" : "lazy"}
      fetchPriority={isActive ? "high" : undefined}
      decoding="async"
      className="block h-auto w-full"
      onError={() => setFailed(true)}
    />
  );
}

export function MagazineReader({ manifest }: MagazineReaderProps) {
  const pages = manifest.pages.filter(
    (page) => page.id !== manifest.cover.pageId,
  );
  const contents = manifest.contents ?? [];
  const { activeIndex, mountedIndices, jumpToPage, registerPage } =
    useBoundedReader(pages.length);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  function handleContentsClick(startPageId: string) {
    const index = pages.findIndex((page) => page.id === startPageId);
    if (index === -1) return;
    jumpToPage(index);
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <section
      id="magazine-reader"
      aria-label={manifest.title}
      className="reader bg-page"
    >
      <div className="pages-reader relative bg-page px-3.5 pb-[90px] max-[800px]:px-2">
        <div className="reader-toolbar sticky top-[52px] z-10 mx-auto flex h-0 max-w-[760px] justify-end pointer-events-none">
          <div className="pointer-events-auto mt-3.5 flex items-center gap-2">
            {manifest.downloadUrl && (
              <a
                href={manifest.downloadUrl}
                download
                className="inline-flex min-h-[42px] items-center gap-2.5 rounded-full border border-charcoal/20 bg-page/92 px-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-charcoal no-underline shadow-[0_5px_18px_rgba(31,42,51,0.08)] transition hover:border-terracotta hover:text-terracotta"
              >
                Download
              </a>
            )}
            {contents.length > 0 && (
              <details ref={detailsRef} className="contents-menu relative">
                <summary className="inline-flex min-h-[42px] cursor-pointer list-none items-center gap-2.5 rounded-full border border-charcoal/20 bg-page/92 px-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-charcoal shadow-[0_5px_18px_rgba(31,42,51,0.08)] transition hover:border-terracotta hover:text-terracotta">
                  Contents
                </summary>
                <nav
                  className="contents-panel absolute right-0 top-[52px] max-h-[min(72svh,620px)] w-[min(540px,calc(100vw-28px))] overflow-y-auto border border-charcoal/16 bg-page/98 p-[18px] shadow-[0_20px_50px_rgba(31,42,51,0.16)]"
                  aria-label="Magazine contents"
                >
                  <div className="flex items-baseline justify-between gap-4 border-b border-charcoal/14 pb-3 font-heading text-[23px] text-charcoal">
                    <span>Contents</span>
                    <span className="font-body text-[10px] uppercase tracking-[0.1em] text-muted">
                      {manifest.pageCount} pages
                    </span>
                  </div>
                  <ol className="m-0 grid list-none grid-cols-2 gap-x-5 gap-y-0 p-0 pt-2 max-[800px]:grid-cols-1">
                    {contents.map((entry) => {
                      const page = manifest.pages.find(
                        (candidate) => candidate.id === entry.startPageId,
                      );
                      if (!page) return null;
                      return (
                        <li key={entry.id} className="border-b border-charcoal/10">
                          <a
                            href={`#magazine-page-${page.id}`}
                            className="grid min-h-12 grid-cols-[30px_minmax(0,1fr)] items-center gap-2 text-charcoal no-underline transition hover:text-terracotta"
                            onClick={(event) => {
                              event.preventDefault();
                              handleContentsClick(entry.startPageId);
                            }}
                          >
                            <span className="text-[11px] tabular-nums text-terracotta">
                              {String(page.number).padStart(2, "0")}
                            </span>
                            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold leading-[1.25]">
                              {entry.author
                                ? `${entry.title} / ${entry.author}`
                                : entry.title}
                            </span>
                          </a>
                        </li>
                      );
                    })}
                  </ol>
                </nav>
              </details>
            )}
          </div>
        </div>

        <ol className="mx-auto grid max-w-[760px] list-none gap-[18px] p-0 max-[800px]:gap-2.5">
          {pages.map((page, index) => (
            <li
              key={page.id}
              id={`magazine-page-${page.id}`}
              ref={(element) => {
                if (element) registerPage(index, element);
              }}
              className="overflow-hidden bg-page shadow-[0_16px_42px_rgba(31,42,51,0.1)]"
              style={{ aspectRatio: `${page.width} / ${page.height}` }}
            >
              {mountedIndices.has(index) ? (
                <ReaderPageImage page={page} isActive={index === activeIndex} />
              ) : null}
            </li>
          ))}
        </ol>

        <footer className="reader-footer mx-auto flex max-w-[760px] justify-between pt-[30px] font-body text-[11px] text-muted">
          <span>End of magazine</span>
          <a href="#magazine-opening" className="text-charcoal no-underline">
            Back to opening
          </a>
        </footer>
      </div>
    </section>
  );
}
