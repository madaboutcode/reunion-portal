# Specification: ID Card Layout Editor

## Purpose

A local, browser-based tool for visually positioning the elements of the Smriti 2026 ID card template and tuning per-attendee exceptions, producing the JSON files the card renderer reads when it builds the actual PDF. The editor itself does not render PDFs or generate cards — it only edits the shared template layout file and per-attendee override files.

## Contents

- [Scope](#scope)
- [Domain Language](#domain-language)
- [Requirements](#requirements)
  - [Data & Files](#data--files)
  - [Template Editor — Canvas](#template-editor--canvas)
  - [Template Editor — Layers & Selection](#template-editor--layers--selection)
  - [Template Editor — Inspector Panel](#template-editor--inspector-panel)
  - [Template Editor — Keyboard Nudge](#template-editor--keyboard-nudge)
  - [Template Editor — Safe-Area Guidance](#template-editor--safe-area-guidance)
  - [Template Editor — Save & Reset](#template-editor--save--reset)
  - [Per-ID Editor](#per-id-editor)
  - [Renderer Changes Required](#renderer-changes-required)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** the template editor (all card elements, applies to every card), the per-ID editor (only the fields that legitimately vary per record), the interaction model (drag, inspector panel, layers, keyboard nudge), safe-area guidance, and the schema additions needed so editor-set values (opacity, rotation) actually affect the printed card.

**Does not cover:** PDF rendering or print-fidelity guarantees (owned by the existing card renderer, already implemented and tested — see Dependencies), sourcing or producing the attendee JSON dump (assumed to already exist locally), photo capture/upload, undo/redo, multi-element selection, resizing via on-canvas drag handles.

## Domain Language

- **Template** — the shared layout, applied identically to every card.
- **Element** — one drawn thing on the card: a doodle image, the logo, a line, a static text line, or one of the four dynamic fields (photo, name, branch, ID badge).
- **Override** — a sparse, per-attendee-ID file holding only the fields that differ from the template for that one record.
- **Layer** — one of three fixed groups (`text`, `doodles`, `photo_logo`) used to control which elements are clickable at a time in the template editor.
- **attendee_id** — the 4-digit ID printed on the card; equivalent to "reg id" for this tool.

## Requirements

### Data & Files

R1 — The editor reads and writes the shared template layout file, the same file the card renderer already reads when generating a PDF.
Scenario: Given the template layout file has the college element's x position set to 30.2mm, when the template editor loads, then the college element is drawn at x=30.2mm on canvas.

R2 — The editor reads and writes per-attendee override files, matching the per-attendee override schema the card renderer already consumes (`photo`, `name`, `branch` sections).
Scenario: Given an override file for attendee "0042" contains `{"photo": {"zoom": 1.4}}`, when the per-ID editor loads record "0042", then the photo zoom control shows 1.4 while the name and branch controls show template defaults.

R3 — The per-ID editor's record picker is sourced from a local attendee data dump if it exists, else from the bundled sample manifest — both using the same schema the card renderer already validates (`schema_version`, `cards[]` with `name`, `branch`, `photo_path`, `attendee_id`).
Scenario: Given no local attendee data dump exists, when the per-ID editor loads, then the record picker is populated from the bundled sample manifest instead.

R4 — The editor serves the actual committed doodle, logo, and font files as read-only static files (no image processing). The per-record attendee photo is loaded by the browser directly from the public CDN by attendee id (`<VITE_PUBLIC_CDN_URL>/portraits/{id}.webp`), not served from local disk.
Scenario: Given the "friends" doodle image file exists on disk, when the template editor loads, then that exact image file is requested and displayed for the "friends" element.
Scenario: Given the per-ID editor loads record "1001", when the photo box renders, then the browser requests `<VITE_PUBLIC_CDN_URL>/portraits/1001.webp` and displays it (a browser `<img>` request is served by the CDN; no local photo file is required).

R5 — Nothing is written to the template layout file or an override file until the user explicitly clicks Save in the relevant editor. There is no autosave during drag or inspector changes, and no undo/redo — reloading the page discards unsaved changes back to the last saved file.
Scenario: Given the user has dragged an element to a new position but not clicked Save, when the page is reloaded, then the element appears at its last-saved position, not the dragged one.

### Template Editor — Canvas

R6 — The template editor renders every static and dynamic element from the template layout as positioned, draggable nodes on a to-scale canvas (54mm × 85.6mm card, mm-to-pixel via a fixed scale factor).
Scenario: Given the photo box is defined as x=29.5mm, y=26.2mm, w=21.5mm, h=34.0mm, when the template editor loads, then a box proportional to 21.5mm × 34.0mm is drawn at the matching canvas position.

R6.1 — Static text elements are rendered using the actual bundled card fonts, and image elements use the actual committed artwork — not placeholder shapes — so the mockup is visually representative.
Scenario: Given the "SMRITI 2026" title element uses the card's display font, when the template editor loads, then that text renders in the same typeface used on the printed card, not a generic system font.

R6.2 — The canvas is not required to be pixel-identical to the actual printed card (auto-fit text sizing is approximated, not matched exactly). The authoritative visual check remains generating a real proof card outside this tool.
Scenario: Given a name that is long enough to trigger auto-fit shrinking on the real card, when it is shown in the editor, then it renders at an approximately, not necessarily exactly, matching size.

R7 — Dragging an element on the canvas moves only its position (`x`/`y`; for the divider line, both endpoints translated together; for text, its horizontal center and its baseline). Width and height are never changed by dragging — there are no resize handles on canvas.
Scenario: Given the divider line has endpoints (4.5, 34.7) and (25.2, 34.7), when it is dragged 3mm to the right, then both endpoints shift to (7.5, 34.7) and (28.2, 34.7), and its length is unchanged.

R7.1 — Screen-down drag motion decreases the element's stored vertical position (the printed page's coordinate origin is bottom-up; the on-screen canvas is top-down) — dragging an element toward the bottom of the visible card decreases its vertical value toward zero.
Scenario: Given an element at a vertical position of 50mm on the 85.6mm-tall canvas, when it is dragged down by a screen distance corresponding to 10mm, then its stored vertical position becomes 40mm.

### Template Editor — Layers & Selection

R8 — Every element belongs to exactly one of three fixed layers: `text` (the three event lines, name, branch, ID badge, divider line), `doodles` (every decorative image), or `photo_logo` (photo box, logo).
Scenario: Given the college artwork belongs to the `doodles` layer, when the `doodles` layer is active, then the college element is clickable and draggable; when the `text` layer is active instead, it is not.

R9 — A layer switcher above the canvas lets the user pick one active layer. Only elements in the active layer receive pointer events (clickable/draggable); elements in the other two layers remain visible for context but do not intercept clicks.
Scenario: Given the `text` layer is active and a doodle visually overlaps the "SMRITI 2026" text, when the user clicks on that overlapping area, then the text element is selected, not the doodle.

R10 — A list panel shows the names of every element in the active layer; clicking a name selects that element exactly as clicking it on canvas would — covering cases where two elements in the same active layer overlap on screen.
Scenario: Given two doodle elements overlap on screen while the `doodles` layer is active, when the user clicks the underlying element's name in the layer list, then that element (not the one drawn on top of it) becomes selected.

R11 — Selecting an element, by canvas click or list click, highlights it and populates the inspector panel with its current properties.
Scenario: Given no element is selected, when the user selects the logo element, then the inspector panel shows the logo's current opacity, zoom, and rotation values.

### Template Editor — Inspector Panel

R12 — The inspector panel exposes controls scoped to the selected element's kind, per this table:

| Element kind | Opacity | Scale/Zoom | Rotation |
|---|---|---|---|
| Doodle / logo image | yes (0–100%) | yes (uniform %, updates stored width/height) | yes (degrees, around center) |
| Static event text line | yes (0–100%) | yes (one fixed font size — see R12.1) | no |
| Photo box | no | yes (updates stored width/height) | no |
| Name / branch (base position) | no | no | no |
| Divider line | yes (0–100%) | no | no |
| ID badge | no | no | no |

Scenario: Given a doodle element is selected, when the user changes its opacity slider to 60%, then the element visibly fades on canvas and its stored opacity value becomes 0.6.

R12.1 — Setting "size" on a static text line writes the same value as both the maximum and minimum of its auto-fit range, pinning it to one fixed size instead of a shrink range.
Scenario: Given the "SMRITI 2026" text element has an auto-fit range of 12–15pt, when the user sets size to 14 in the inspector, then both the minimum and maximum of its range become 14.

R12.2 — Opacity and rotation are optional per-element properties, defaulting to fully opaque and unrotated when absent, so every element that predates this capability keeps rendering exactly as it does today.
Scenario: Given an element has no stored opacity or rotation value, when it is drawn, then it renders fully opaque and unrotated, identical to its appearance before this capability existed.

R12.3 — Rotation is applied around the element's own center point, in degrees, positive clockwise.
Scenario: Given a doodle 10mm wide and 10mm tall centered at (20mm, 20mm), when its rotation is set to 90 degrees, then it visibly rotates in place around its own center rather than around a corner or the page origin.

### Template Editor — Keyboard Nudge

R13 — With an element selected, arrow keys move it by 0.5mm per press; Shift+arrow moves it by 2mm per press. Left/Right adjust the horizontal position; Up/Down adjust the vertical position, in the direction established by R7.1.
Scenario: Given a selected element at a horizontal position of 10mm, when the user presses the Right arrow key once, then its horizontal position becomes 10.5mm; when Shift+Right is then pressed once, it becomes 12.5mm.

### Template Editor — Safe-Area Guidance

R14 — The canvas always shows the same 2mm safe-area boundary the renderer enforces when generating the final PDF, as a dashed guide rectangle matching the guide already shown in the renderer's own proof output.
Scenario: Given the template editor is open, when the canvas renders, then a dashed rectangle appears 2mm in from all four edges of the 54mm × 85.6mm card, regardless of which elements are present.

R15 — An element whose bounding box crosses the safe-area boundary is visually flagged (e.g., a red outline). This is advisory only — it does not block dragging, inspector edits, or Save. The real failure, if any, happens later when the renderer actually generates the card.
Scenario: Given an element is dragged to a horizontal position of 1mm (inside the 2mm margin), when the drag ends, then the element's outline renders red and the Save button remains enabled.

### Template Editor — Save & Reset

R16 — A Save button writes the current in-memory layout state to the template layout file in full, replacing the file on disk.
Scenario: Given the user has repositioned three elements, when they click Save, then the template layout file on disk reflects all three new positions and nothing else changes.

R17 — A "Reset to defaults" action, after a confirmation prompt, overwrites the template layout file with the tool's built-in starting positions — the same layout the card renders with before any edits are made.
Scenario: Given the template layout has been heavily edited from its starting values, when the user clicks "Reset to defaults" and confirms, then every element's position, size, opacity, and rotation reverts to the tool's original shipped values.

### Per-ID Editor

R18 — A record picker (sourced per R3) lets the user choose one attendee ID. Selecting a record loads that record's photo, name, and branch, and its existing override, if any.
Scenario: Given the manifest contains a record with attendee ID "0042", when the user selects "0042" from the record picker, then that record's photo, name, and branch load into the per-ID editor.

R18.1 — The ← and → arrow keys step to the previous / next record in manifest order (same effect as picking it from the record picker), clamping at the ends without wrapping. The shortcut is suppressed while a text input is focused (so it does not hijack caret movement) and while any modifier key is held (Up/Down remain reserved for the canvas baseline nudge, R13). When no record is selected yet, → selects the first record and ← the last.
Scenario: Given record "0042" is selected and is not the last record, when the user presses →, then the next record in manifest order loads exactly as if picked from the record picker; pressing → again on the last record does nothing.

R19 — The per-ID editor **reuses the template editor's canvas / selection / inspector shell** in an "override" mode (not a separate 3-control panel). The `text` and `photo_logo` layers stay selectable; `doodles` are context-only. Only three fields are persistable per record; anything else the operator happens to move has no override field and is not saved. The editable fields:
- **Photo** — drag inside the photo box to pan (each axis 0.0–1.0), plus a zoom control (1.0–2.5). (Photo uses a per-ID drag config: drag pans the crop, it does not move the box.)
- **Name** — drag, or arrow-key nudge at R13's increments, to adjust its vertical offset from the template baseline (`baseline_dy`); plus a font-size input (blank = use the template's size); plus a **display-name text input**, prefilled with the record's manifest name, that replaces it for this record (`text`). It is persisted only when it differs from the manifest name; leaving it unchanged — or clearing it, which snaps back to the manifest name — saves no `text`. The renderer upper-cases the replacement exactly as it does the manifest name.
- **Branch** — same controls as Name, minus the display-name text input (branch has no text override).

Scenario: Given record "0042" has manifest name "PRAVEEN KUMAR NAIR", when the operator changes the prefilled display-name input to "PRAVEEN NAIR" and saves, then the override file's `name` section contains `"text": "PRAVEEN NAIR"` and the rendered card shows PRAVEEN NAIR; restoring the input to the original "PRAVEEN KUMAR NAIR" (or clearing it) drops `text` from the saved section.

Scenario: Given record "0042" has no existing override, when the per-ID editor loads it, then the photo pan/zoom and text controls all show the template's default values, with no nudge or size override applied.

R19.1 — Photo pan dragging is proportional: dragging the photo image within its fixed-size box by a screen distance equal to the box's full width or height moves that axis's pan value by 1.0, clamped to [0.0, 1.0].
Scenario: Given the photo box is 21.5mm wide, when the photo is dragged left by a screen distance equal to half the box's width, then its horizontal pan value increases by 0.5, clamped so it never exceeds 1.0.

R20 — A Save button writes the photo, name, and branch sections for the selected attendee ID to that record's override file, replacing the file. A section left at its template default is omitted rather than written with default values, so the override file stays sparse.
Scenario: Given the user adjusts only the photo zoom for record "0042" and leaves name and branch untouched, when they click Save, then the resulting override file for "0042" contains a photo section but no name or branch section.

R21 — A "Clear override for this record" action, after a confirmation prompt, deletes that record's override file if it exists, reverting the card to pure template defaults.
Scenario: Given an override file exists for record "0042", when the user clicks "Clear override for this record" and confirms, then the file is deleted and the per-ID editor for "0042" shows template defaults again.

### Renderer Changes Required

R22 — The card renderer must read and apply opacity and rotation on every static element where present in the template layout, defaulting to fully opaque and unrotated when absent, so an editor-set value has a real effect on the printed card. This extends the layout-driven rendering already in place for position and size.
Scenario: Given a layout element has 50% opacity and 15 degrees of rotation set, when the renderer generates a card, then that element appears at 50% opacity, rotated 15 degrees clockwise around its own center, in the output PDF.

R23 — The renderer's existing regression tests continue to pass unmodified after opacity/rotation support is added, since no default layout value changes as part of that work.
Scenario: Given the renderer's regression tests all pass before opacity/rotation support is added, when that support is added with no default layout value changed, then the same tests still pass without modification.

## States

| State | Template editor | Per-ID editor |
|---|---|---|
| No manifest found | N/A | Record picker shows an empty/error state naming the missing source |
| Loading | Canvas shows nothing until the layout and assets finish loading | Same, scoped to the selected record's photo |
| Element selected | Inspector populated, keyboard nudge active | N/A — each control is always live once a record is picked |
| Nothing selected | Inspector empty/disabled | N/A |
| Unsaved changes | Save button enabled; no other indicator (no autosave, no undo, per R5) | Same |
| Out-of-safe-area | Red outline on the offending element | N/A — the per-ID editor has no safe-area guide |

## Data Flow

**Reads:** the template layout file, the local attendee data dump or bundled sample manifest, per-attendee override files, the committed doodle/logo image files, the attendee photo file referenced by the manifest, the bundled card fonts.

**Writes:** the template layout file (template Save/Reset), per-attendee override files (per-ID Save/Clear).

**Never touches:** any PDF output, the renderer's drawing logic, or any other part of the card-generation process.

## Edge Cases

- Reloading the editor mid-edit with unsaved changes discards them back to the last saved file on disk (R5).
- An override section that already matches the template default is still valid to load; the editor shows the override's stated values, not the template's, when a section is present.
- Two elements in the same active layer with visually identical position are both individually selectable via the list panel (R10) even though only the topmost is directly clickable on canvas.
- A manifest record whose photo file is missing or fails to load shows a broken-image placeholder in the per-ID editor rather than blocking the record picker.

## Dependencies

- The existing card renderer (`idcards.py`): `load_layout()`, `load_override()`, `DEFAULT_LAYOUT`, `OVERRIDABLE_DYNAMIC_FIELDS`, and the layout-driven `_draw_static`/`_draw_dynamic` rendering — already implemented and covered by the renderer's regression tests (8/8 passing).
- Renderer support for `opacity`/`rotation` (R22/R23) — not yet implemented; required before editor-set opacity/rotation values have any effect on a real render.
- Standalone Node/React (Vite) app under `scripts/idcard-mailmerge/editor/`, with its own `package.json` — not part of the portal's main npm workspace.
- The editor's file I/O ("backend") is a dev-only Vite middleware plugin in `vite.config.ts` (`server.middlewares.use`) that reads/writes the JSON files via `fs` on Save — not a standalone server, and not the browser File System Access API. Works in any browser over `http://localhost`, with HMR while developing.
- Attendee manifest (`data/attendees.json`, gitignored — real names + photos are PII): dumped from live prod D1 (`registrations WHERE status='confirmed'` → `attendee_id` = registration `id`) by `scripts/idcard-mailmerge/dump_attendees.py`. `photo_path` is relative (`portraits/{id}.webp`) for the renderer; the editor loads the same photo from the CDN by id.
