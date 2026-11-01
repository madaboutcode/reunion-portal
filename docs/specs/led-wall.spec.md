# Specification: LED Wall

## Purpose

A fullscreen ambient display for venue screens that shows the attendees who are present
(checked in) as drifting polaroid film-strips grouped by branch, and celebrates each new
arrival one at a time with a spotlight moment.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)
- Child interface: [`interfaces/led-wall-data-source.ispec.md`](interfaces/led-wall-data-source.ispec.md)

## Scope

**MUST:**

- Rotation mode (ambient branch loop) and spotlight mode (arrival), matching the
  "LED Wall Polaroid Board" mockup's look and animation.
- Present-only attendees, grouped by branch.
- Transparent portrait photos from the public CDN, with initials fallback.
- A data-source boundary so a live check-in stream can replace the dummy provider later.
- The full design-tool controls panel (hidden, `/`-toggled).
- Empty states (zero-present branch skipped; total-zero idle state).
- Viewport-filling adaptive layout.
- A dev-gated `/debug/led-wall` page with an "inject a random present person" trigger.
- A browser-fullscreen toggle with unmodified `f`/`F` on both wall routes, using the
  modern unprefixed Fullscreen API (see R19).

**WILL NOT:**

- The live event transport (SSE / WebSocket / polling) — defined later, consumed via the
  data-source boundary.
- WebKit-prefixed fullscreen APIs (`webkitRequestFullscreen` / `webkitExitFullscreen`) —
  the toggle supports only the modern unprefixed Fullscreen API.
- The check-in mutation itself, payment data, donation data, contact data, or any private
  registration detail (see Dependencies).
- Mobile / touch layout — this is an ambient display, not a hand-held page.

## Requirements

### Modes

R1 — On load with present attendees, the wall plays the rotation loop: a branch is
selected, its present attendees render as tilted polaroids in drifting film-strips, and
the left panel shows the logo, the branch's panel title, "2006 BATCH REUNION", and the
branch's quote. The wall advances to the next branch on the dwell timer (default 22s,
tunable in the Timing controls).

  Scenario: Given present attendees across several branches, when the wall loads, then it
  shows one branch's attendees and the branch panel, and advances to the next branch on
  the dwell timer.

R2 — When an arrival is delivered (see R8), the wall transitions to spotlight: the new
attendee's polaroid settles in, "Look who's here" appears with the attendee's name and
meta line, confetti falls, the card holds (default ~9.5s, tunable), then the wall hands
back to rotation at the point it left.

  Scenario: Given a new present attendee arrives mid-rotation, when the arrival is
  delivered, then the spotlight shows that attendee, and rotation resumes afterward.

R3 — Rotation and spotlight share the same wall surface, card rendering, and transition
animation; switching modes does not restart the wall's background decor or the rotation
cursor.

  Scenario: Given the wall is mid-rotation when an arrival spotlights, when the spotlight
  hands back, then rotation resumes on the branch it left, not from the first branch.

### Data & photos

R4 — The wall renders only present attendees: registrations with `checked_in_at` set.
Donation-only records never appear.

  Scenario: Given a confirmed-but-not-checked-in registration and a checked-in
  registration, when the wall renders, then only the checked-in person appears.

R5 — Each card's photo is the transparent portrait at
`https://cdn.example.org/portraits/{registrationId}.webp`, supplied by the data source
(see `interfaces/led-wall-data-source.ispec.md` R-DS1.1). The host is the `cdnUrl` value in
`site.config.json` for the environment; `cdn.example.org` is a placeholder.

  Scenario: Given a present attendee with id 1179, when their card renders, then the card
  image requests `https://cdn.example.org/portraits/1179.webp`.

R5.1 — When an attendee has no portrait (the source supplies `null`), the card shows
initials on a colored gradient in place of the photo, without an error.

  Scenario: Given a present attendee with no portrait, when their card renders, then the
  card shows their initials, not a broken image.

R6 — Attendees are grouped by branch using the canonical branch name (the `Branch` values
from `@smriti/shared`). The wall owns a static catalog mapping each canonical branch to a
short name, a panel title, and a quote, as follows:

  | Canonical branch | Short | Panel title | Quote |
  |---|---|---|---|
  | Architecture | Arch | Architecture | Drew the campus better than anyone actually built it. |
  | Chemical Engineering | Chem | Chemical Engineering | Balanced every equation but the canteen bill. |
  | Civil Engineering | Civil | Civil Engineering | Surveyed half of Kerala. Still can't parallel park. |
  | Computer Science & Engineering | CSE | Computer Science | Compiled at 3am. Debugged at the tea shop by five. |
  | Electrical & Electronics Engineering | EEE | Electrical & Electronics | Lit up three continents. Never fixed the hostel fan. |
  | Electronics & Communication Engineering | ECE | Electronics | Twenty years of noise, and the signal still got through. |
  | Mechanical Engineering | ME | Mechanical | Workshop bell at 8:15. Still wakes us up. |
  | Production Engineering | PE | Production | Optimised every process except getting here on time. |

  The short name on a card caption uses the shared `BRANCH_SHORT_NAMES` value; the panel
  title is the mockup's shorter display form (not the canonical long name).

  Scenario: Given a present attendee in "Computer Science & Engineering", when the wall
  renders their card and the branch panel, then the caption shows "CSE" and the panel
  shows "Computer Science" with the quote from the catalog.

### Data source (pluggable boundary)

R7 — The wall renders identically whether its data source is the dummy source or a live
source; the pluggable contract is specified in
`interfaces/led-wall-data-source.ispec.md`.

  Scenario: Given the same present attendees delivered by the dummy source and by a live
  source, when the wall renders each in turn, then the display is the same.

R8 — An arrival is delivered to the wall through the data source's single arrival path
(see `interfaces/led-wall-data-source.ispec.md` R-DS3). On receipt the wall appends the
attendee to their branch's pool and enqueues them for spotlight; a real check-in event
and the debug injection trigger are indistinguishable to the wall.

  Scenario: Given an arrival is delivered, when the wall receives it, then that attendee
  appears in their branch's rotation data and in the spotlight queue, regardless of
  whether the event came from the live stream or the debug trigger.

R9 — When the data source re-syncs (see `interfaces/led-wall-data-source.ispec.md`
R-DS4), the wall reconciles the new snapshot into the loop without restarting the branch
currently playing.

  Scenario: Given the wall is mid-rotation, when a re-sync returns a new present attendee
  for the current branch, then the new attendee joins that branch's strip without
  restarting the current branch's playback.

R10 — The wall never shows two spotlights at once. Arrivals are queued FIFO and shown one
after another.

  Scenario: Given three arrivals land close together, when the wall receives them, then
  they spotlight in arrival order, one at a time.

R11 — Milestone 1 renders through the dummy data source, which is a committed snapshot
fixture of fabricated names with no API calls (see
`interfaces/led-wall-data-source.ispec.md` R-DS6).

  Scenario: Given the debug page loads with no network, when the wall renders, then it
  shows the fixture's present attendees, with portrait images loaded live from the CDN.

### Controls panel

R12 — Pressing `/` toggles the controls panel; when closed it is invisible and a hover
reveals the toggle. The panel exposes all six mockup sections — Wall, Backdrop, Film
strips, Left panel, Decoration, Timing — with their parameters.

  Scenario: Given the wall is showing and the panel is closed, when the user presses `/`,
  then the panel appears; pressing `/` again hides it.

R12.1 — "Copy values" writes the current parameter values as JSON; "Reset" restores the
default parameters.

  Scenario: Given the user has changed several parameters, when they press "Reset", then
  every parameter returns to its default and the display re-renders from those defaults.

R13 — The controls panel is part of the wall component itself, available wherever the
wall renders — not restricted to the debug page.

  Scenario: Given the wall renders on any route, when the user presses `/`, then the
  controls panel opens the same way.

### Empty states

R14 — A branch with zero present attendees is skipped in the rotation order.

  Scenario: Given present attendees only in EEE and CSE, when the wall rotates, then it
  cycles between EEE and CSE and never dwells on an empty branch.

R15 — With zero present attendees total, the wall shows an idle state: logo and
"2006 BATCH REUNION" panel with empty strips, waiting for the first arrival. No blank
screen.

  Scenario: Given no one has checked in, when the wall loads, then it shows the idle
  panel, and the first arrival transitions it into rotation/spotlight.

### Viewport

R16 — The wall fills the browser viewport and adapts its layout (row heights, panel
position, card sizes) to the given shape, with no fixed aspect ratio and no letterboxing.

  Scenario: Given the display browser is 32:9 ultrawide, when the wall renders, then it
  fills that viewport and lays out cards and panel to fit it.

### Debug page

R17 — A dev-gated route `/debug/led-wall` renders the wall fullscreen with a slim debug
strip that provides the "inject a random present person" trigger (simulating a check-in)
and a visible spotlight-queue count.

  Scenario: Given the debug page is open, when the user fires the trigger, then a random
  not-yet-present fixture attendee spotlights and the queue count increments.

R18 — The debug route is unavailable outside dev/debug builds, consistent with the
existing debug-route policy.

  Scenario: Given a production build, when a visitor requests `/debug/led-wall`, then the
  route does not exist.

### Fullscreen

R19 — On `/led-wall` and `/debug/led-wall`, pressing unmodified `f` or `F` toggles
browser fullscreen: when the page is windowed, the wall requests fullscreen on the
document root (so a strip rendered above the wall, such as the debug strip, stays
visible); when the page is fullscreen, it exits fullscreen. Only the modern unprefixed
Fullscreen API is used.

  Scenario: Given the wall is displayed windowed, when the user presses `f`, then the
  page enters browser fullscreen on the document root; when they press `F` again, then
  the page exits fullscreen.

R19.1 — The shortcut does not fire when the event target is an input, textarea, select,
or contenteditable element.

  Scenario: Given focus is in the controls panel's number input, when the user presses
  `f`, then the key types into the field and fullscreen does not toggle.

R19.2 — The shortcut does not fire for auto-repeated keydown events or for shortcuts
modified with Ctrl, Alt, or Meta. The browser's native Escape-to-exit behavior is not
intercepted.

  Scenario: Given the user holds `f` down or presses Ctrl/Alt/Meta+F, when the keydown
  fires, then fullscreen does not toggle.

R19.3 — When the browser does not provide the Fullscreen API, or a fullscreen request is
denied, the wall continues to display with no error state and no unhandled error
surfaces.

  Scenario: Given a browser that lacks the Fullscreen API or denies the fullscreen
  request, when the user presses `f`, then the wall keeps running unchanged.

## States

- **Idle** — zero present attendees; logo + "2006 BATCH REUNION" panel, empty strips.
- **Rotation** — a branch's attendees drifting; advances on the branch dwell timer.
- **Spotlight** — one arrival celebrated; holds, then returns to rotation.
- **Controls open / closed** — the `/`-toggled panel, visible or hover-reveal only.
- **Loading** — while the data source's initial snapshot is unavailable (instant for the
  dummy source; meaningful for the live source).

## Data Flow

- The data source provides a snapshot of present attendees and an arrival path
  (`interfaces/led-wall-data-source.ispec.md`).
- The wall groups present attendees by canonical branch (R6 catalog), renders rotation
  from the current branch's pool, and renders spotlight from the arrival queue.
- The debug injection trigger delivers through the same arrival path as the future live
  stream.
- The wall sends nothing back to the data source and writes nothing: it only displays.

## Edge Cases

- Missing portrait → initials fallback (R5.1).
- Burst arrivals → FIFO spotlight queue (R10).
- Re-sync adds an attendee to the branch currently playing → appended without restarting
  the branch (R9).
- A branch emptied by re-sync (last attendee no longer present) → branch leaves the
  rotation order (R14).
- Zero present → idle (R15).
- A branch with exactly one present attendee → rotation shows a single polaroid; layout
  still fills the strip.
- An attendee whose canonical branch is not in the catalog → their card still renders in
  the strips (caption shows the raw branch name), but their branch is not added to the
  rotation order with a panel/quote.
- A duplicate arrival (same registration id already present) → the wall ignores the
  repeat; it does not spotlight twice or double-list the attendee.
- A re-sync removes an attendee who is currently spotlighting → the in-progress spotlight
  finishes; the removal affects rotation only.
- Live source connection loss (future) → periodic re-sync is the fallback; the wall keeps
  playing its last known snapshot.
- Pressing `f`/`F` while focus is in an editable control → the shortcut is ignored and
  the key types normally (R19.1).
- Fullscreen API unavailable or a fullscreen request denied → the wall stays in windowed
  mode and keeps running; no error UI, no unhandled error (R19.3).

## Dependencies

- (see `interfaces/led-wall-data-source.ispec.md`) — the data-source contract.
- (see `interfaces/attendance-feed.ispec.md` R2.1) — the future `checkin.created` event
  shape, and R2 for its privacy boundary.
- (see `registration-desk.spec.md` R4) — what "present" / check-in means and who is
  eligible.
- (see `glossary.md`) — "check-in", "eligible attendee".
- (see `access-control.spec.md` R6) — public/desk endpoint gates and the debug-route
  policy.
