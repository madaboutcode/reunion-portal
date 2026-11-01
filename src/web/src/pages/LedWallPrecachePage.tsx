import { useState } from "react";
import { fetchWallImageManifest } from "@/lib/api";
import { runPool } from "@/lib/pool";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

/**
 * Pre-cache the LED wall's attendee photos onto this device.
 *
 * Run this once on the machine that will drive `/led-wall`, on a good network,
 * before the event. It pulls every eligible-with-photo attendee's portrait and
 * thumbnail from the CDN so the service worker's `CacheFirst` rule (see
 * vite.config.ts `runtimeCaching`) stores them in Cache Storage. At the venue
 * the wall then serves photos from cache — instant, no data, no dependence on
 * a flaky link.
 *
 * The images are fetched no-cors: the wall's own <img> requests are cross-
 * origin no-cors too, so both produce the same opaque cache entry — a match.
 *
 * WHAT THIS CAN AND CANNOT VERIFY: an opaque (no-cors) fetch resolves for a
 * 404 or 500 exactly as it does for a 200 — status is hidden, and the failing
 * response is still cached. So this tool can only detect NETWORK failures
 * (DNS/connection), reported as "network errors". It CANNOT confirm the CDN
 * actually returned the real photo rather than a 404 page. The final cache
 * count is a count of stored entries, not of verified photos. Treat a clean
 * run as "the requests went through", and spot-check the wall itself for a
 * few known attendees before relying on it.
 *
 * This only populates Cache Storage when the service worker is active, i.e. a
 * production build. In `make dev` there is no SW — fetches still warm the
 * browser HTTP cache, but the cache-count verification will report 0/unknown.
 */

// Must match the `cacheName` in vite.config.ts runtimeCaching for the CDN hosts.
const LED_WALL_PHOTO_CACHE = "led-wall-photos";
const CONCURRENCY = 6;

type Phase = "idle" | "loading-manifest" | "downloading" | "done" | "error";

export default function LedWallPrecachePage() {
  useDocumentTitle("LED Wall Pre-cache");

  const [phase, setPhase] = useState<Phase>("idle");
  const [total, setTotal] = useState(0);
  const [requested, setRequested] = useState(0);
  const [networkErrors, setNetworkErrors] = useState(0);
  const [cached, setCached] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  async function countCache(): Promise<number | null> {
    // Feature-detect: no SW / Cache Storage in dev or unsupported browsers.
    // FALLBACK-OK: verification is optional — when Cache Storage is absent the
    // page reports "unknown" rather than failing (see this file's docstring:
    // dev has no SW, so nothing lands in Cache Storage).
    if (!("caches" in window)) return null;
    const has = await caches.has(LED_WALL_PHOTO_CACHE);
    if (!has) return 0;
    const cache = await caches.open(LED_WALL_PHOTO_CACHE);
    const keys = await cache.keys();
    return keys.length;
  }

  async function run(): Promise<void> {
    setPhase("loading-manifest");
    setRequested(0);
    setNetworkErrors(0);
    setCached(null);
    setErrorMessage("");

    let urls: string[];
    try {
      const manifest = await fetchWallImageManifest();
      urls = manifest.images
        .flatMap((image) => [image.portraitUrl, image.thumbnailUrl])
        .filter((url): url is string => url !== null);
    } catch (manifestError: unknown) {
      // The manifest is the whole input — without it there is nothing to do.
      // FALLBACK-OK: report the failure to the operator so they can retry
      // (boundary error surfaced to the user, not swallowed).
      setErrorMessage(
        manifestError instanceof Error ? manifestError.message : "Could not load the image manifest.",
      );
      setPhase("error");
      return;
    }

    setTotal(urls.length);
    setPhase("downloading");

    await runPool(urls, CONCURRENCY, async (url) => {
      try {
        await fetch(url, { mode: "no-cors", cache: "no-cache" });
        setRequested((n) => n + 1);
      } catch {
        // Only a genuine network failure (DNS/connection) rejects a no-cors
        // fetch — a 404/500 resolves opaquely and is invisible here (see
        // docstring). FALLBACK-OK: best-effort warming — a network error is
        // counted and reported, never fatal; the run continues.
        setNetworkErrors((n) => n + 1);
      }
    });

    setCached(await countCache());
    setPhase("done");
  }

  const running = phase === "loading-manifest" || phase === "downloading";
  const attempted = requested + networkErrors;
  const progress = total > 0 ? Math.round((attempted / total) * 100) : 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="font-heading text-2xl text-charcoal">LED Wall — Pre-cache Photos</h1>
        <p className="mt-2 text-sm text-charcoal/70">
          Run this on the device that will show the wall, on a good network, before the event.
          It downloads every attendee photo into this device's cache so the wall is instant and
          works even if the venue network drops.
        </p>
      </div>

      <button
        type="button"
        onClick={() => void run()}
        disabled={running}
        className="min-h-[44px] rounded-lg bg-terracotta px-5 py-3 font-medium text-white disabled:opacity-50"
      >
        {phase === "idle" && "Start pre-caching"}
        {phase === "loading-manifest" && "Loading manifest…"}
        {phase === "downloading" && "Downloading…"}
        {phase === "done" && "Run again"}
        {phase === "error" && "Retry"}
      </button>

      {(phase === "downloading" || phase === "done") && total > 0 && (
        <div className="flex flex-col gap-2">
          <div className="h-3 overflow-hidden rounded-full bg-charcoal/10">
            <div className="h-full bg-soft-aqua transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-sm text-charcoal/70">
            {attempted} / {total} images fetched
            {networkErrors > 0 && ` — ${networkErrors} network errors`}
          </p>
        </div>
      )}

      {phase === "done" && (
        <p className="text-sm text-charcoal/70">
          {cached === null
            ? "Cache verification unavailable (no service worker — expected in dev; build and serve to cache for real)."
            : `Cache Storage now holds ${cached} entr${cached === 1 ? "y" : "ies"}. ` +
              "Note: opaque fetches can't confirm the CDN returned the real photo (not a 404) — spot-check the wall for a few attendees."}
        </p>
      )}

      {phase === "error" && (
        <p className="text-sm text-terracotta">{errorMessage}</p>
      )}
    </main>
  );
}
