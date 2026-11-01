# Specification: CreditsReel

## Purpose

Cinematic end-credits section for the Prediction Contest winners page. A continuous
upward credits crawl (movie end-credits style) plays over full-bleed background
photos that are synchronized to the crawl: each maker's credit enters over their
*masked* Mannar Mathayi portrait, and the background crossfades to their real photo
the moment their name crosses the screen midline — the unmasking IS the transition.

Homage: the masked-trio scene from *Mannar Mathayi Speaking* (1995).

## Scope

**MUST:** Continuous looping crawl; scroll-position-driven background sync;
masked→real crossfade per person; intro card, person credits, joke credits, THE END
card; pause on hover/press; data-driven entries; responsive 375px–1280px.

**WILL NOT:** Audio; video backgrounds; server data (all content is static config);
winners/leaderboard content (separate component on the same page).

## Requirements

### Content & Data

R1 — Component accepts an ordered `entries` array. Entry kinds:
  - `intro` — title card (dept line, title, Caveat-style caption)
  - `person` — dept (credit title, may contain Malayalam), name, note, `maskedSrc`,
    `revealSrc`, optional `revealFit: "fitted"` (reveal renders scaled-down inside a
    feathered black vignette instead of full-bleed — for tight close-ups)
  - `joke` — dept + name only (e.g. "Stunts — VAR")
  - `end` — THE END card (ml caption, "THE END", "ശുഭം")

R2 — Every entry declares its background: person entries use `maskedSrc`/`revealSrc`;
intro/joke entries reference a shared still (`gangSrc`); end uses solid near-black.

R3 — Default entries (the real credits) ship as a config in the component folder so
the winners page renders `<CreditsReel />` with no props.

### Crawl

R4 — Credits scroll upward continuously at constant speed; total loop duration is a
single configurable constant (default ~44s). Loops seamlessly back to the intro.

R5 — Press-and-hold (mouse or touch) pauses the crawl; releasing resumes.
Hover does NOT pause (dropped 2026-07-20 — a resting cursor kept freezing the
reel on desktop).

R6 — Vertical spacing between person entries is generous enough that each person's
background sequence (masked → unmask → linger) plays fully before the next entry
takes over. Spacing is a named constant, not incidental margin.

### Background sync

R7 — The entry block nearest the vertical center of the component's viewport owns
the background. Background changes are ~1.8s opacity crossfades — never hard cuts.

R8 — A person entry shows `maskedSrc` while its block midpoint is below the screen
midline, and `revealSrc` once the midpoint has passed it. Derived from geometry
every frame (rAF) — no timers. Pausing the crawl pauses the reveal; scrolling
backwards re-masks.

R9 — The active background has a slow Ken-Burns drift (scale ~1.14 → ~1.02).
The `end` background is static black.

### Visual treatment

R10 — A permanent scrim (dark gradient, heaviest at the bottom) plus vignette sits
between backgrounds and text, guaranteeing text legibility over any photo.

R11 — Typography: dept in warm-orange spaced smallcaps; name in Playfair Display;
note in muted body; Caveat for Malayalam captions. All text carries a soft dark
text-shadow. Malayalam glyphs must render (system fonts acceptable).

R12 — Subtle projector flicker over the whole screen; must stay under ~5% opacity.

### Accessibility

R13 — ~~`prefers-reduced-motion: reduce` → static credits list~~ **Dropped**
(stakeholder decision, 2026-07-20): the crawl always plays. The reel is a
short novelty outro for a known audience; the pause-on-hover/press control
(R5) remains the way to stop motion.

R14 — Credit text is real DOM text, readable by screen readers in document order.
Background images are decorative (`aria-hidden`); the section has an accessible
label ("Credits").

### Performance

R15 — Animations use only compositor properties (transform, opacity). No layout
thrash from the rAF loop (reads only).

R16 — Images lazy-load; the component must not block winners-page LCP. Each asset
≤ ~250KB. Component pauses all work (rAF + CSS animation) when scrolled out of view.

## States

| State | Behavior |
|-------|----------|
| Playing | Crawl runs, background syncs, Ken-Burns drifts |
| Paused (hover/press) | Crawl and reveal freeze in place |
| Off-screen | Everything suspended |
| Asset missing/failed | Entry falls back to `revealSrc` only (no unmask beat); if both fail, dark background — text is always readable regardless |

## Edge Cases

- **Backgrounded tab**: sync is derived from live geometry each frame, so any
  animation throttling self-corrects on resume — no accumulated drift.
- **Very short viewport** (landscape phone): scrim guarantees legibility; crawl
  container has a min-height so entries don't overlap.
- **Two entries equidistant from midline**: nearest wins; ties keep current owner
  (no flicker between backgrounds).
- **Single-person data** (future reuse): sync logic is per-entry, no assumption of
  exactly three people.

## Data Flow

```
Props:
  entries?: CreditEntry[]   // defaults to the real contest credits
  loopSeconds?: number      // crawl speed, default 44

CreditEntry =
  | { kind: "intro"; dept: string; title: string; caption?: string }
  | { kind: "person"; dept: string; name: string; note?: string;
      maskedSrc: string; revealSrc: string }
  | { kind: "joke"; dept: string; name: string }
  | { kind: "end"; caption?: string }

No callbacks, no external state. Purely presentational.
```
