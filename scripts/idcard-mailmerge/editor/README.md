# ID Card Layout Editor

A local, browser-based tool for visually positioning the elements of the Smriti 2026
ID card **template**, and tuning **per-attendee** exceptions. It produces the JSON files
the renderer (`../idcards.py`) reads when it builds the actual PDF.

**The editor never renders PDFs or generates cards.** It only edits two things on disk:

- `../layout.json` — the shared template layout, applied to every card.
- `../data/overrides/<attendee_id>.json` — sparse per-attendee overrides (only the
  fields that differ from the template).

`idcards.py` is the single source of truth for the printed card. The editor is a
positioning UI; when you want to see the real output, render with `idcards.py`.

## Run

Standalone dev tool — **not** part of the portal's npm workspace or production build.
Run it from this directory:

```sh
cd portal/scripts/idcard-mailmerge/editor
npm install
npm run dev        # Vite dev server, default http://localhost:5173
```

| Script | Does |
|--------|------|
| `npm run dev` | Start the editor (Vite dev server + the file-API middleware) |
| `npm run build` | Production Vite build (rarely needed — this is a dev tool) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests |

Requires Node 20+ (developed on v24) and npm.

## How it fits

```
             edits                       reads
 editor ───────────────►  layout.json  ◄─────────── idcards.py ──► card PDF
        ───────────────►  data/overrides/<id>.json
```

The editor and `idcards.py` share the same files. Edit and Save in the editor, then
run `idcards.py render …` to produce the real cards. The two are decoupled by the JSON
on disk — the editor does not invoke Python and Python does not know about the editor.

## What's built

- **Template mode** — full canvas editor: to-scale card, three layers, per-kind
  inspector, keyboard nudge, safe-area guidance, Save/Reset. This is complete.
- **Per-ID mode** — a stub (`PerIdPlaceholder`) only. The record picker, photo pan/zoom,
  and sparse-override Save/Clear are **not built yet**.

### Interaction model (template mode)

- **Layers** — `text`, `doodles`, `photo_logo`. The active layer decides which elements
  are clickable, so overlapping elements don't fight for the pointer. A per-layer element
  list gives a click-to-select fallback.
- **Drag** — move only (position). No on-canvas resize handles.
- **Keyboard nudge** — arrow = 0.5 mm, Shift+arrow = 2 mm.
- **Inspector** — opacity / scale / rotation, scoped to what each element kind supports.
- **Safe-area guidance** — advisory, non-blocking; mirrors the renderer's 2 mm inset check.
- **Save / Reset** — explicit Save only (no autosave, no undo). Reset restores the shipped
  defaults. Reloading the page discards unsaved changes.

## Backend (dev-only)

There is no standalone server. A **Vite dev middleware** (`src/server/`) handles file I/O,
wired in `vite.config.ts` via `configureServer`. It only runs under `npm run dev` and is
never in the production bundle. Write paths are locked to the renderer's data files
(`layout.json`, `data/overrides/`) — see `src/server/serverConfig.ts`.

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/layout` | Read the template `layout.json` |
| PUT | `/api/layout` | Save the full template layout |
| GET | `/api/defaults` | Shipped defaults (backs Reset) |
| GET | `/api/manifest` | Record list — local `data/attendees.json` if present, else `fixtures/attendees.json` |
| GET | `/api/override/:id` | Read a per-attendee override |
| PUT | `/api/override/:id` | Save a sparse per-attendee override |
| DELETE | `/api/override/:id` | Clear a per-attendee override |
| GET | `/api/asset/logo`, `/api/asset/doodle/*`, `/api/asset/font/*` | Serve committed logo / doodle / font files, read-only |

Attendee **photos are not served locally** — the browser loads them straight from the
public CDN by id: `<VITE_PUBLIC_CDN_URL>/portraits/{id}.webp`. Start the editor with
`VITE_PUBLIC_CDN_URL=https://cdn.example.org npm run dev`, or `make editor ENV=stg` (or `ENV=prod`), which reads `cdnUrl` for that environment from `site.config.json`.
There is no default; without it photos do not load.

## Architecture

Hexagonal — pure core, thin adapters:

| Dir | Role |
|-----|------|
| `src/core/` | Pure domain: `geometry` (mm↔px + the screen/layout y-flip), `fieldMap`, `overrideDiff`, `safeArea`, `constants` (mirrors `idcards.py` geometry exactly), `types`. Unit-tested. |
| `src/layout/` | Pure view glue: `elements`, `layers`, `position`, `scale`, `screen`, `assets`, `textFit`. Unit-tested. |
| `src/components/` | React UI: `Canvas`, `ElementNode`, `LayerPanel`, `Inspector`, `TopBar`, `BottomBar`, `PerIdPlaceholder`. |
| `src/server/` | Node dev middleware: connect-style router, atomic JSON writes, asset map, locked-path config. |

## Preview fidelity

The canvas is an **approximate** preview rendered client-side with the real bundled fonts
and doodle/logo artwork:

- **Element positions, box sizes, artwork placement, safe-area** match the PDF closely
  (~a pixel).
- **Text** (including auto-fit lines) matches the renderer's ReportLab output closely — the
  canvas mirrors `idcards.py`'s `stringWidth` model (correct `char_space` units in points,
  no kerning, the same 0.1 pt-equivalent fit step). It is still an approximation, not a
  print-fidelity guarantee.

For the definitive output, render with `idcards.py` and inspect the PDF.

## Related

- Spec: [`../docs/specs/layout-editor.spec.md`](../docs/specs/layout-editor.spec.md)
- Design + build plan: not included in this repository (see `docs/specs/layout-editor.spec.md`)
- Renderer: [`../idcards.py`](../idcards.py) and [`../README.md`](../README.md)
