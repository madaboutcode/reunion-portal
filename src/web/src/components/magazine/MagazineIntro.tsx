import { useEffect, useRef, useState } from "react";
import type { MagazineCover, SelectedIntro } from "@/lib/magazine";
import {
  computeBlurPx,
  computeCoverOpacity,
  computeFrameIndex,
  computeMobileCopyOffset,
  computeMobileCopyProgress,
  computeMobileFrameScale,
  computeMobileFrameTop,
  computeScrollProgress,
  computeSequenceOpacity,
  computeSequenceScale,
} from "@/lib/magazine-scroll";
import { useIntroPreloader, type IntroPreloadState } from "@/hooks/useIntroPreloader";

/*
 * CONTRACT: MagazineIntro
 *
 * GUARANTEES:
 * - Preloads frames in batches of 4 with a determinate loading screen showing progress and Skip.
 * - Runs the intro whenever valid intro metadata is provided, regardless of prefers-reduced-motion,
 *   Save-Data, connection type, or device memory.
 * - Shows the mobile prelude above the frame at rest (viewport <= 800px) and removes it by 20%
 *   scroll progress.
 * - Shows the full desktop quote overlaid on the landscape frame (viewport > 800px).
 * - The cover crossfades in over the final blurred frame during the last ~25% of scroll travel.
 * - The section height is 225svh with valid intro, 100svh when skipped or no intro.
 * - Multiple scroll events before paint produce one scheduled visual update (RAF coalescing).
 * - Keeps the last frame visible until the latest requested frame has decoded.
 * - Stale frame decodes never overwrite a newer scroll target.
 * - On Skip: stops scheduling new frame batches, clears owned timers and RAF, makes late image
 *   callbacks inert, and shows the cover.
 * - On frame failure: shows the cover with "Some frames were unavailable."
 * - On 8-second timeout: shows the cover with "Taking longer than expected."
 * - On missing intro: shows the cover immediately without requesting frames.
 * - On unmount: removes all scroll/resize listeners, cancels RAF, makes late image callbacks inert.
 * - Cover image failure shows "Retry cover" inline without blocking the reader below.
 *
 * EXPECTS:
 * - Receives a validated manifest cover and an optional SelectedIntro computed once by the parent.
 * - Is rendered as the first content section after SiteNav.
 *
 * DOES NOT:
 * - Fetch metadata — receives it from the parent.
 * - Know about the reader, pages, or contents.
 * - Suppress the intro based on browser hints or preferences.
 * - Network-cancel in-flight image requests — it makes late callbacks inert instead.
 */

export interface MagazineIntroProps {
  selectedIntro: SelectedIntro | null;
  cover: MagazineCover;
}

const NO_FRAMES: string[] = [];

function applyIntroVisual(
  section: HTMLElement,
  selectedIntro: SelectedIntro,
  preload: IntroPreloadState,
  requestFrame: (index: number) => void,
) {
  const rect = section.getBoundingClientRect();
  const progress = computeScrollProgress(
    rect.top,
    section.offsetHeight,
    window.innerHeight,
  );

  const coverOpacity = computeCoverOpacity(progress);
  const mobileCopyProgress = computeMobileCopyProgress(progress);

  section.classList.toggle("is-scrolling", progress > 0.01);
  section.style.setProperty("--opening-progress", progress.toFixed(3));
  section.style.setProperty("--cover-opacity", coverOpacity.toFixed(3));
  section.style.setProperty(
    "--sequence-opacity",
    computeSequenceOpacity(progress).toFixed(3),
  );
  section.style.setProperty(
    "--sequence-blur",
    `${computeBlurPx(progress).toFixed(2)}px`,
  );
  section.style.setProperty(
    "--sequence-scale",
    computeSequenceScale(progress).toFixed(3),
  );
  section.style.setProperty(
    "--mobile-copy-progress",
    mobileCopyProgress.toFixed(3),
  );
  section.style.setProperty(
    "--mobile-copy-offset",
    `${computeMobileCopyOffset(mobileCopyProgress).toFixed(2)}svh`,
  );
  section.style.setProperty(
    "--mobile-frame-top",
    `${computeMobileFrameTop(mobileCopyProgress).toFixed(2)}%`,
  );
  section.style.setProperty(
    "--mobile-frame-scale",
    computeMobileFrameScale(mobileCopyProgress).toFixed(3),
  );

  if (preload.status === "ready") {
    const frameIndex = computeFrameIndex(progress, selectedIntro.frameCount);
    requestFrame(frameIndex);
  }
}

function applyRestingIntroVisual(section: HTMLElement) {
  section.style.setProperty("--opening-progress", "1");
  section.style.setProperty("--cover-opacity", "1");
  section.style.setProperty("--sequence-opacity", "0");
  section.style.setProperty("--sequence-blur", "9px");
  section.style.setProperty("--sequence-scale", "1.045");
  section.style.setProperty("--mobile-copy-progress", "1");
  section.style.setProperty("--mobile-copy-offset", "-42svh");
  section.style.setProperty("--mobile-frame-top", "50%");
  section.style.setProperty("--mobile-frame-scale", "1");
}

export function MagazineIntro({ selectedIntro, cover }: MagazineIntroProps) {
  const [frameUrls] = useState(() =>
    selectedIntro ? selectedIntro.frames.map((frame) => frame.src) : NO_FRAMES,
  );
  const { state: preload, skip } = useIntroPreloader(frameUrls);
  const preloadRef = useRef(preload);
  preloadRef.current = preload;

  const sectionRef = useRef<HTMLElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameDecoderRef = useRef<HTMLImageElement | null>(null);
  const targetFrameIndexRef = useRef(-1);
  const displayedFrameIndexRef = useRef(-1);
  const decodeInFlightRef = useRef(false);
  const presenterGenerationRef = useRef(0);
  const presenterDisposedRef = useRef(false);
  const requestFrameRef = useRef<(index: number) => void>(() => undefined);
  const rafRef = useRef<number | null>(null);

  const [coverFailed, setCoverFailed] = useState(false);
  const [coverRetryCount, setCoverRetryCount] = useState(0);
  const [firstFramePresented, setFirstFramePresented] = useState(false);
  const [presentationFailed, setPresentationFailed] = useState(false);

  async function presentLatestFrame() {
    if (decodeInFlightRef.current || presenterDisposedRef.current) return;

    const preloadState = preloadRef.current;
    const frameIndex = targetFrameIndexRef.current;
    if (
      preloadState.status !== "ready" ||
      !frameCanvasRef.current ||
      !frameDecoderRef.current ||
      frameIndex < 0 ||
      frameIndex === displayedFrameIndexRef.current
    ) {
      return;
    }

    const frame = preloadState.frames[frameIndex];
    if (!frame) {
      setPresentationFailed(true);
      return;
    }

    const canvas = frameCanvasRef.current;
    const decoder = frameDecoderRef.current;

    decodeInFlightRef.current = true;
    const generation = presenterGenerationRef.current;
    let decoded = false;
    decoder.src = frame.src;

    try {
      await decoder.decode();
      decoded = true;
    } catch {
      // Decode failure is handled below, after checking whether this request
      // became stale while it was in flight.
    } finally {
      if (generation === presenterGenerationRef.current) {
        decodeInFlightRef.current = false;
      }
    }

    if (
      presenterDisposedRef.current ||
      generation !== presenterGenerationRef.current
    ) {
      return;
    }

    // A fast scroll may make this decode stale. Keep the existing canvas pixels
    // and decode only the latest requested frame instead of painting old work.
    if (targetFrameIndexRef.current !== frameIndex) {
      void presentLatestFrame();
      return;
    }

    if (!decoded) {
      setPresentationFailed(true);
      return;
    }

    if (
      canvas.width !== decoder.naturalWidth ||
      canvas.height !== decoder.naturalHeight
    ) {
      canvas.width = decoder.naturalWidth;
      canvas.height = decoder.naturalHeight;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      setPresentationFailed(true);
      return;
    }

    context.drawImage(decoder, 0, 0, canvas.width, canvas.height);
    const isFirstFrame = displayedFrameIndexRef.current === -1;
    displayedFrameIndexRef.current = frameIndex;
    if (isFirstFrame) setFirstFramePresented(true);

    if (targetFrameIndexRef.current !== frameIndex) {
      void presentLatestFrame();
    }
  }

  function requestFrame(frameIndex: number) {
    targetFrameIndexRef.current = frameIndex;
    void presentLatestFrame();
  }

  requestFrameRef.current = requestFrame;

  useEffect(() => {
    presenterDisposedRef.current = false;
    return () => {
      presenterDisposedRef.current = true;
      presenterGenerationRef.current += 1;
      decodeInFlightRef.current = false;
    };
  }, []);

  const skippedLike =
    preload.status === "skipped" ||
    preload.status === "failed" ||
    preload.status === "timed-out" ||
    presentationFailed;
  const introActive = selectedIntro !== null && !skippedLike;
  const showLoadingScreen =
    selectedIntro !== null &&
    (preload.status === "idle" ||
      preload.status === "loading" ||
      (preload.status === "ready" && !firstFramePresented && !presentationFailed));

  // Attach/detach scroll+resize listeners only when the intro transitions
  // between active and resting — not on every preload progress tick.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    if (!introActive || !selectedIntro) {
      applyRestingIntroVisual(section);
      return;
    }

    function scheduleUpdate() {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const currentSection = sectionRef.current;
        if (!currentSection || !selectedIntro) return;
        applyIntroVisual(
          currentSection,
          selectedIntro,
          preloadRef.current,
          (frameIndex) => requestFrameRef.current(frameIndex),
        );
      });
    }

    applyIntroVisual(
      section,
      selectedIntro,
      preloadRef.current,
      (frameIndex) => requestFrameRef.current(frameIndex),
    );
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [introActive, selectedIntro]);

  // The first frame must appear as soon as preload finishes, without waiting
  // for the next scroll/resize event.
  useEffect(() => {
    if (!introActive || !selectedIntro) return;
    if (preloadRef.current.status !== "ready") return;
    const section = sectionRef.current;
    if (!section) return;
    applyIntroVisual(
      section,
      selectedIntro,
      preloadRef.current,
      (frameIndex) => requestFrameRef.current(frameIndex),
    );
  }, [introActive, selectedIntro, preload.status]);

  const statusLabel = "Loading intro frames";
  let percent = 0;
  if (preload.status === "loading") {
    percent =
      preload.total === 0
        ? 0
        : Math.round((preload.loaded / preload.total) * 100);
  } else if (preload.status === "ready") {
    percent = 100;
  }

  return (
    <>
      {selectedIntro !== null && (
        <div
          className={`magazine-loading-screen font-body text-charcoal ${
            showLoadingScreen ? "" : "is-hidden"
          }`}
          role="status"
          aria-live="polite"
          aria-hidden={!showLoadingScreen}
        >
          <div className="w-full max-w-[420px]">
            <div className="mb-[72px] flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em]">
              <span
                className="grid h-[30px] w-[30px] place-items-center rounded-full bg-soft-aqua font-heading text-base font-bold"
                aria-hidden="true"
              >
                S
              </span>
              <span>Smriti / Pages</span>
            </div>
            <p className="mb-3 font-accent text-[22px] text-terracotta">
              Opening the souvenir magazine...
            </p>
            <h2 className="max-w-[370px] font-heading text-[clamp(38px,6vw,58px)] font-normal leading-[0.98] tracking-[-0.05em]">
              Preparing the first scroll.
            </h2>
            <div className="mt-[42px] flex justify-between text-[11px] text-muted">
              <span>{statusLabel}</span>
              <span>{percent}%</span>
            </div>
            <div
              className="mt-3 h-0.5 overflow-hidden bg-charcoal/10"
              aria-hidden="true"
            >
              <span
                className="block h-full bg-terracotta transition-[width] duration-200 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <button
              type="button"
              className="mt-7 min-h-11 rounded-full border border-charcoal/20 px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-charcoal transition hover:border-terracotta hover:text-terracotta"
              onClick={skip}
            >
              Skip intro
            </button>
          </div>
        </div>
      )}

      <section
        ref={sectionRef}
        id="magazine-opening"
        aria-label="Magazine opening animation"
        className={`magazine-intro-section relative bg-page ${
          introActive ? "h-[225svh]" : "h-[100svh]"
        }`}
      >
        <div className="magazine-intro-stage bg-page">
          <canvas
            ref={frameCanvasRef}
            aria-hidden="true"
            className="magazine-intro-frame"
          />
          <img
            ref={frameDecoderRef}
            alt=""
            aria-hidden="true"
            decoding="async"
            className="hidden"
          />

          <div className="magazine-intro-cover">
            {coverFailed ? (
              <div
                className="flex flex-col items-center gap-3 px-6 text-center font-body text-sm text-charcoal/70"
                role="alert"
              >
                <span>The cover could not be loaded.</span>
                <button
                  type="button"
                  className="min-h-11 rounded-full bg-terracotta px-5 text-sm font-bold text-white"
                  onClick={() => {
                    setCoverFailed(false);
                    setCoverRetryCount((count) => count + 1);
                  }}
                >
                  Retry cover
                </button>
              </div>
            ) : (
              <img
                key={coverRetryCount}
                src={cover.src}
                alt={cover.alt}
                className="magazine-intro-cover-image"
                onError={() => setCoverFailed(true)}
              />
            )}
          </div>

          {selectedIntro !== null && (
            <div className="magazine-intro-copy">
              <p className="m-0 font-accent text-2xl text-terracotta">
                {selectedIntro.eyebrow}
              </p>
              <blockquote className="magazine-intro-quote font-heading text-charcoal">
                &ldquo;{selectedIntro.quote}&rdquo;
              </blockquote>
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-charcoal/64">
                {selectedIntro.credit}
              </p>
              <div
                className="mt-7 inline-flex items-center gap-2.5 text-[10px] font-semibold uppercase tracking-[0.17em] text-charcoal"
                aria-label="Scroll to open the magazine"
              >
                <span className="magazine-intro-scroll-cue-track" aria-hidden="true">
                  <span className="magazine-intro-scroll-cue-dot" />
                </span>
                <span>Scroll to open</span>
              </div>
            </div>
          )}

          {(preload.status === "failed" ||
            preload.status === "timed-out" ||
            presentationFailed) && (
            <p
              className="absolute inset-x-0 bottom-10 z-[6] px-6 text-center font-body text-xs text-charcoal/70"
              role="status"
            >
              {presentationFailed && preload.status === "ready"
                ? "Some frames were unavailable. Showing the cover."
                : preload.status === "failed" || preload.status === "timed-out"
                  ? preload.message
                  : ""}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
