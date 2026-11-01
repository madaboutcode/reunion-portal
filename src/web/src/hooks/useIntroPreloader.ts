import { useEffect, useRef, useState } from "react";

/*
 * CONTRACT: useIntroPreloader
 *
 * GUARANTEES:
 * - Loads frames in sequential batches of 4 using Image() objects.
 * - Reports determinate progress (loaded count / total count) after each batch.
 * - Stops scheduling new batches when skip is requested.
 * - Starts an 8-second timeout on mount; clears it when preloading completes or is cancelled.
 * - Late image onload/onerror callbacks after skip, timeout, or unmount do not update state.
 * - On unmount: clears the timeout, marks the preloader as disposed so no late callbacks fire.
 *
 * EXPECTS:
 * - Receives an array of frame URLs (may be empty for no-intro manifests).
 *
 * FAILURE BEHAVIOR:
 * - Any frame fails to decode -> returns a failed status with a message; stops further batches.
 * - Timeout fires before completion -> returns a timed-out status.
 *
 * DOES NOT:
 * - Cancel in-flight browser image requests.
 * - Know about scroll, DOM, or presentation.
 * - Handle the "no intro" case beyond returning an immediate ready state for an empty array.
 */

const BATCH_SIZE = 4;
const LOADING_BUDGET_MS = 8000;
const FRAME_FAILURE_MESSAGE = "Some frames were unavailable. Showing the cover.";
const TIMEOUT_MESSAGE = "Taking longer than expected. Showing the cover.";

export type IntroPreloadState =
  | { status: "idle" }
  | { status: "loading"; loaded: number; total: number }
  | { status: "ready"; frames: HTMLImageElement[] }
  | { status: "skipped" }
  | { status: "failed"; message: string }
  | { status: "timed-out"; message: string };

interface UseIntroPreloaderResult {
  state: IntroPreloadState;
  skip: () => void;
}

function preloadFrame(
  url: string,
  index: number,
  cache: HTMLImageElement[],
): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    // Frames are displayed only; no canvas readback requires a CORS image.
    image.decoding = "async";
    image.onload = () => {
      cache[index] = image;
      resolve(true);
    };
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

export function useIntroPreloader(frameUrls: string[]): UseIntroPreloaderResult {
  const [state, setState] = useState<IntroPreloadState>(
    frameUrls.length === 0 ? { status: "ready", frames: [] } : { status: "idle" },
  );
  const disposedRef = useRef(false);
  const skippedRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (frameUrls.length === 0) {
      setState({ status: "ready", frames: [] });
      return;
    }

    const cache: HTMLImageElement[] = [];
    const total = frameUrls.length;

    timeoutRef.current = window.setTimeout(() => {
      if (cancelled || skippedRef.current) return;
      skippedRef.current = true;
      setState({ status: "timed-out", message: TIMEOUT_MESSAGE });
    }, LOADING_BUDGET_MS);

    setState({ status: "loading", loaded: 0, total });

    async function run() {
      let loaded = 0;
      for (let start = 0; start < total; start += BATCH_SIZE) {
        if (cancelled || skippedRef.current) return;

        const batch = frameUrls.slice(start, start + BATCH_SIZE);
        const results = await Promise.all(
          batch.map((url, offset) => preloadFrame(url, start + offset, cache)),
        );

        if (cancelled || skippedRef.current) return;

        if (results.some((ok) => !ok)) {
          skippedRef.current = true;
          if (timeoutRef.current !== null) {
            window.clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          setState({ status: "failed", message: FRAME_FAILURE_MESSAGE });
          return;
        }

        loaded += results.length;
        setState({ status: "loading", loaded, total });
      }

      if (cancelled || skippedRef.current) return;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setState({ status: "ready", frames: cache });
    }

    run();

    return () => {
      cancelled = true;
      disposedRef.current = true;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [frameUrls]);

  function skip() {
    if (skippedRef.current || disposedRef.current) return;
    skippedRef.current = true;
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setState({ status: "skipped" });
  }

  return { state, skip };
}
