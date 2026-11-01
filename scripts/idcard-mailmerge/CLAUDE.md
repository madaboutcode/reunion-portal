# ID-Card Mail Merge

Two halves, run from this directory:

- **`idcards.py`** — the renderer (Python, `uv`). The single source of truth for the printed card. Reads a manifest (`fixtures/attendees.json` or `data/attendees.json`), `layout.json` (template), and `data/overrides/<attendee_id>.json` (sparse per-attendee exceptions) and produces the PDF.
- **`editor/`** — a browser layout editor (React/Vite, own `package.json`, not part of the portal's npm workspace). It only edits `layout.json` and `data/overrides/*.json`. **It does not render PDFs.** The one sanctioned exception is the Preview button, which shells out to the real `idcards.py` on demand — see Constraints.

Full docs: `README.md` (renderer) and `editor/README.md` (editor). Read those instead of duplicating them here.

## Commands

Run `make help` for the full list. Common ones:

| Command | Does |
|---|---|
| `make install` | `uv sync` + `cd editor && npm install` |
| `make editor` | Start the layout editor (Vite dev server, http://localhost:5173) |
| `make validate` | Validate a manifest (`MANIFEST=...`, defaults to `fixtures/attendees.json`) |
| `make render` | Render a manifest to `output/attendees.pdf` |
| `make cards` | Render the real batch from `data/attendees.json` (needs `make dump` first) |
| `make proof` | Guided proof PDF + rasterized pages, for visual QA |
| `make dump` | Rebuild `data/` from live prod D1 — needs the deploy token, writes PII |
| `make test` | Renderer unittests + editor vitest |
| `make check` | Editor typecheck (`tsc --noEmit`) |

## Layout

```
idcard-mailmerge/
├── idcards.py            # renderer + CLI — source of truth for the card
├── layout.json            # template layout, editor-writable
├── data/                  # gitignored PII: attendees.json + portraits/*.webp, overrides/
├── fixtures/               # sample manifest (3 records) — safe to commit, no real PII
├── assets/                # logo, fonts, doodle sheets/crops
├── editor/                # React/Vite layout editor — see editor/README.md
├── docs/specs/layout-editor.spec.md   # editor functional spec
```

The original design and handoff notes were planning documents and are not part of this repository.

## Constraints

- **The editor never invokes Python inline, and never renders PDFs as part of normal editing.** The Preview button is the one sanctioned exception: on Save, it POSTs to a dev-only endpoint that spawns `uv run idcards.py render` on the saved layout and opens the result in a new tab. This is dev-only tooling in `editor/src/server/`, gated behind Vite's dev middleware — it never ships in a production bundle and the editor has no other path to Python.
- **`data/` is gitignored PII** (attendee names, IDs, portraits). Never read it into anything that leaves the machine; `fixtures/attendees.json` is the safe, committable stand-in.
- **The layout/override JSON schema is owned by `idcards.py`**, specifically `OVERRIDABLE_DYNAMIC_FIELDS` (photo pan/zoom, name/branch baseline + size override) and `DEFAULT_LAYOUT`. The editor's `core/constants.ts` mirrors the renderer's geometry constants by hand — if you change one side, update the other.
- **The editor's canvas is an approximate preview**, not print-fidelity. Positions and text-fit closely match the renderer, but the definitive output is always a real `idcards.py` render — use the Preview button or `make render`/`make proof` to check real output.

## Design & Documentation

- Component contracts for the editor live in `docs/specs/layout-editor.spec.md` — keep it in sync with behavior changes.

## Testing

- Renderer: `tests/test_idcards.py` (regression on PDF geometry, fonts, IDs, assets).
- Editor: colocated `*.test.ts` files under `editor/src/`, run via `make test` or `cd editor && npm test`.
