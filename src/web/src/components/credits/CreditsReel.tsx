import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_ENTRIES,
  GANG_PORTRAIT_SRC,
  GANG_SRC,
  type CreditEntry,
} from "./credits-data";

export interface CreditsReelProps {
  entries?: CreditEntry[];
  loopSeconds?: number;
  className?: string;
}

// Tuning constants — see tasks/2026-07-20-credits-reel.design.md.
// If a reveal feels rushed, increase spacing or LOOP_SECONDS, not the crossfade.
const LOOP_SECONDS = 50;
const XFADE_MS = 1800;
const KENBURNS_S = 9;
const PERSON_GAP_PX = 300;
const BLOCK_GAP_PX = 120;
// A challenger must beat the current owner by this margin before the
// background switches — ties keep the current owner (no flicker).
const SWITCH_HYSTERESIS_PX = 4;

function CreditBlock({ entry, index }: { entry: CreditEntry; index: number }) {
  const gap = entry.kind === "person" ? PERSON_GAP_PX : BLOCK_GAP_PX;

  return (
    <div
      data-entry={index}
      className="credits-block text-center px-6 credits-text-shadow"
      style={{ marginBottom: gap }}
    >
      {entry.kind === "intro" && (
        <>
          <p className="text-[11px] md:text-xs font-semibold uppercase tracking-[0.28em] text-credits-orange">
            {entry.dept}
          </p>
          <h3 className="font-heading text-4xl md:text-5xl font-bold text-[#F3E9D8] mt-3">
            {entry.title}
          </h3>
          {entry.caption && (
            <p className="font-accent text-2xl md:text-3xl text-[#FFD98C] mt-4">
              {entry.caption}
            </p>
          )}
        </>
      )}
      {entry.kind === "person" && (
        <>
          <p className="text-xs md:text-sm font-semibold uppercase tracking-[0.28em] text-credits-orange">
            {entry.dept}
          </p>
          <h3 className="font-heading text-3xl md:text-5xl font-bold text-[#F3E9D8] mt-2.5">
            {entry.name}
            {entry.branch && (
              <span className="font-body text-[0.4em] font-semibold tracking-[0.22em] text-[#CFC2AB] align-middle ml-3">
                {entry.branch}
              </span>
            )}
          </h3>
          {entry.note && (
            <p className="text-base md:text-lg text-[#CFC2AB] tracking-wide mt-2.5">
              {entry.note}
            </p>
          )}
        </>
      )}
      {entry.kind === "joke" && (
        <>
          <p className="text-[10px] md:text-[11px] font-semibold uppercase tracking-[0.28em] text-credits-orange">
            {entry.dept}
          </p>
          <h3 className="font-heading text-xl md:text-2xl font-bold text-[#CFC2AC] mt-1.5">
            {entry.name}
          </h3>
        </>
      )}
      {entry.kind === "end" && (
        <>
          {entry.caption && (
            <p className="font-accent text-2xl md:text-3xl text-[#FFD98C]">
              {entry.caption}
            </p>
          )}
          <h3 className="font-heading text-5xl md:text-6xl font-bold text-[#F3E9D8] tracking-[0.12em] mt-5">
            THE END
          </h3>
          <p className="font-accent text-3xl text-[#FFD98C] mt-4">ശുഭം</p>
        </>
      )}
    </div>
  );
}

export function CreditsReel({
  entries = DEFAULT_ENTRIES,
  loopSeconds = LOOP_SECONDS,
  className = "",
}: CreditsReelProps) {
  const rootRef = useRef<HTMLElement>(null);
  const crawlRef = useRef<HTMLDivElement>(null);
  const ownerRef = useRef<number>(-1);
  const activeKeyRef = useRef<string | null | undefined>(undefined);
  const failedRef = useRef<Set<string>>(new Set());

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [spacerH, setSpacerH] = useState<number | null>(null);

  const slides = useMemo(() => {
    const seen = new Map<string, boolean>();
    for (const e of entries) {
      if (e.kind === "person") {
        if (!seen.has(e.maskedSrc)) seen.set(e.maskedSrc, false);
        if (!seen.has(e.revealSrc))
          seen.set(e.revealSrc, e.revealFit === "fitted");
      } else if (e.kind !== "end" && !seen.has(GANG_SRC)) {
        seen.set(GANG_SRC, false);
      }
    }
    return [...seen.entries()].map(([src, fitted]) => ({
      src,
      fitted,
      isGang: src === GANG_SRC,
    }));
  }, [entries]);

  // The crawl gap between copies must match the visible height so each loop
  // opens on an empty screen before the intro scrolls in.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSpacerH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // R16 — suspend all work while scrolled out of view.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) =>
      setSuspended(!e.isIntersecting),
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // R7/R8 — scroll position is the clock: every frame, the block nearest the
  // component midline owns the background; a person entry is masked while its
  // midpoint is below the midline, revealed once it crosses. Reads only.
  useEffect(() => {
    if (suspended) return;
    let raf = 0;
    const tick = () => {
      const root = rootRef.current;
      const crawl = crawlRef.current;
      if (root && crawl) {
        const rootRect = root.getBoundingClientRect();
        const centerY = rootRect.top + rootRect.height / 2;
        let bestIdx = -1;
        let bestDist = Infinity;
        let bestMid = 0;
        let ownerDist = Infinity;
        let ownerMid = 0;
        for (const el of crawl.querySelectorAll<HTMLElement>("[data-entry]")) {
          const idx = Number(el.dataset.entry);
          const r = el.getBoundingClientRect();
          const mid = r.top + r.height / 2;
          const d = Math.abs(mid - centerY);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = idx;
            bestMid = mid;
          }
          if (idx === ownerRef.current && d < ownerDist) {
            ownerDist = d;
            ownerMid = mid;
          }
        }
        let ownerIdx = ownerRef.current;
        if (
          ownerIdx < 0 ||
          !Number.isFinite(ownerDist) ||
          (bestIdx !== ownerIdx && bestDist < ownerDist - SWITCH_HYSTERESIS_PX)
        ) {
          ownerIdx = bestIdx;
          ownerMid = bestMid;
        }
        ownerRef.current = ownerIdx;

        const entry = entries[ownerIdx];
        let key: string | null = null;
        if (entry) {
          const failed = failedRef.current;
          if (entry.kind === "person") {
            const masked = failed.has(entry.maskedSrc)
              ? null
              : entry.maskedSrc;
            const reveal = failed.has(entry.revealSrc)
              ? null
              : entry.revealSrc;
            key = ownerMid > centerY ? (masked ?? reveal) : (reveal ?? masked);
          } else if (entry.kind !== "end") {
            key = failed.has(GANG_SRC) ? null : GANG_SRC;
          }
        }
        if (key !== activeKeyRef.current) {
          activeKeyRef.current = key;
          setActiveKey(key);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [entries, suspended]);

  const frozen = paused || suspended;

  return (
    <section
      ref={rootRef}
      aria-label="Credits"
      className={`credits-reel relative h-full w-full overflow-hidden select-none ${
        frozen ? "credits-paused" : ""
      } ${className}`}
      style={
        {
          "--credits-loop": `${loopSeconds}s`,
          "--credits-xfade": `${XFADE_MS}ms`,
          "--credits-kb": `${KENBURNS_S}s`,
        } as React.CSSProperties
      }
      onPointerDown={() => setPaused(true)}
      onPointerUp={() => setPaused(false)}
      onPointerLeave={() => setPaused(false)}
      onPointerCancel={() => setPaused(false)}
    >
      {/* Background slides (decorative) */}
      <div aria-hidden="true">
        {slides.map(({ src, fitted, isGang }) => (
          <div
            key={src}
            className={`credits-slide ${fitted ? "fitted" : ""} ${
              activeKey === src ? "show" : ""
            }`}
          >
            <picture>
              {isGang && (
                <source
                  media="(max-width: 640px)"
                  srcSet={GANG_PORTRAIT_SRC}
                />
              )}
              <img
                src={src}
                alt=""
                loading="lazy"
                draggable={false}
                onError={() => failedRef.current.add(src)}
              />
            </picture>
          </div>
        ))}
      </div>

      {/* R10 — permanent scrim + vignette between backgrounds and text */}
      <div aria-hidden="true" className="credits-scrim absolute inset-0" />
      <div aria-hidden="true" className="credits-vignette absolute inset-0" />

      {/* Crawl — two copies for a seamless loop; copy B hidden from SRs */}
      <div className="absolute inset-0 overflow-hidden">
        <div ref={crawlRef} className="credits-crawl">
          {[false, true].map((isDupe) => (
            <div key={isDupe ? "b" : "a"} aria-hidden={isDupe || undefined}>
              <div style={{ height: spacerH ?? "100vh" }} />
              {entries.map((entry, i) => (
                <CreditBlock key={i} entry={entry} index={i} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* R12 — projector flicker, capped well under 5% opacity */}
      <div
        aria-hidden="true"
        className="credits-flicker absolute inset-0 pointer-events-none"
      />
    </section>
  );
}
