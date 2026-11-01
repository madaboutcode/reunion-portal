import { useEffect, useRef, useState } from "react";

/*
 * CONTRACT: useBoundedReader
 *
 * GUARANTEES:
 * - Uses IntersectionObserver to track which page element is nearest the viewport.
 * - Returns the active page index and the set of mounted indices (active +/- 1, clamped to page bounds).
 * - Provides jumpToPage(index) that sets the active page, updates the mounted window, and scrolls the
 *   target element into view without smooth scrolling.
 * - During a programmatic jump, suppresses observer updates until the target page is observed.
 * - On unmount: disconnects the IntersectionObserver.
 *
 * EXPECTS:
 * - registerPage(index, element) is called for every page slot as it mounts/unmounts in the DOM.
 * - Page elements exist as stable placeholder elements in the DOM at all times.
 *
 * FAILURE BEHAVIOR:
 * - If IntersectionObserver is unavailable (FALLBACK-OK): mounts all pages (no bounded window).
 *
 * DOES NOT:
 * - Know about image loading, error states, or contents.
 * - Change scroll position except during jumpToPage.
 */

export interface BoundedReaderState {
  activeIndex: number;
  mountedIndices: Set<number>;
  jumpToPage: (index: number) => void;
  registerPage: (index: number, element: HTMLElement | null) => void;
}

function windowAround(active: number, pageCount: number): Set<number> {
  if (pageCount <= 0) return new Set<number>();
  const indices = new Set<number>();
  indices.add(Math.max(0, active - 1));
  indices.add(active);
  indices.add(Math.min(pageCount - 1, active + 1));
  return indices;
}

export function useBoundedReader(pageCount: number): BoundedReaderState {
  const [activeIndex, setActiveIndex] = useState(0);
  const [mountedIndices, setMountedIndices] = useState<Set<number>>(() =>
    windowAround(0, pageCount),
  );

  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementsRef = useRef(new Map<number, HTMLElement>());
  const suppressedRef = useRef(false);
  const jumpTargetRef = useRef<number | null>(null);
  const noObserverFallbackRef = useRef(false);
  const activeIndexRef = useRef(0);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      // FALLBACK-OK: no IntersectionObserver support, mount every page.
      noObserverFallbackRef.current = true;
      setMountedIndices(new Set(Array.from({ length: pageCount }, (_, i) => i)));
      return;
    }
    noObserverFallbackRef.current = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (suppressedRef.current) {
          if (jumpTargetRef.current !== null) {
            const targetEntry = entries.find((entry) => {
              for (const [index, element] of elementsRef.current) {
                if (element === entry.target && index === jumpTargetRef.current) {
                  return entry.isIntersecting;
                }
              }
              return false;
            });
            if (targetEntry) {
              suppressedRef.current = false;
              jumpTargetRef.current = null;
            }
          }
          return;
        }

        const entering = entries.filter((entry) => entry.isIntersecting);
        if (entering.length === 0) return;

        let closest: { index: number; distance: number } | null = null;
        for (const entry of entering) {
          let index: number | undefined;
          for (const [i, element] of elementsRef.current) {
            if (element === entry.target) {
              index = i;
              break;
            }
          }
          if (index === undefined) continue;
          const distance = Math.abs(entry.boundingClientRect.top);
          if (closest === null || distance < closest.distance) {
            closest = { index, distance };
          }
        }

        if (closest !== null && closest.index !== activeIndexRef.current) {
          activeIndexRef.current = closest.index;
          setActiveIndex(closest.index);
          setMountedIndices(windowAround(closest.index, pageCount));
        }
      },
      {
        // Shrink the observation rect to a 10% tall band in the viewport center.
        // This detects "which page is at the center" rather than "how much is visible,"
        // avoiding a dead zone when pages are taller than the viewport (desktop).
        rootMargin: "-45% 0px -45% 0px",
        threshold: 0,
      },
    );

    observerRef.current = observer;

    for (const element of elementsRef.current.values()) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [pageCount]);

  function registerPage(index: number, element: HTMLElement | null) {
    if (element === null) return;
    const previous = elementsRef.current.get(index);
    if (previous === element) return;
    if (previous && observerRef.current) {
      observerRef.current.unobserve(previous);
    }
    elementsRef.current.set(index, element);
    if (observerRef.current) {
      observerRef.current.observe(element);
    }
  }

  function jumpToPage(index: number) {
    const target = Math.max(0, Math.min(pageCount - 1, index));
    activeIndexRef.current = target;
    setActiveIndex(target);
    setMountedIndices(windowAround(target, pageCount));

    if (noObserverFallbackRef.current) return;

    suppressedRef.current = true;
    jumpTargetRef.current = target;

    const element = elementsRef.current.get(target);
    if (element) {
      element.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
    } else {
      // FALLBACK-OK: target element not yet mounted; clear suppression once it registers and observes.
      suppressedRef.current = false;
      jumpTargetRef.current = null;
    }
  }

  return { activeIndex, mountedIndices, jumpToPage, registerPage };
}
