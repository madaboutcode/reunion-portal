# Interface Spec: LED Wall Data Source

## Purpose

The pluggable boundary between the LED wall component and its data. It defines the shape
of a present attendee, how the wall obtains the initial snapshot, how arrivals are
delivered, how the wall re-syncs, and how the milestone-1 dummy source and debug
injection trigger behave.

## Contents

- [Scope](#scope)
- [Present attendee model](#present-attendee-model)
- [Snapshot](#snapshot)
- [Arrival subscription](#arrival-subscription)
- [Periodic re-sync](#periodic-re-sync)
- [Branch prefetch](#branch-prefetch)
- [Milestone-1 dummy source](#milestone-1-dummy-source)
- [Live source](#live-source)
- [Edge cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**In scope:**

- The `PresentAttendee` data shape.
- The snapshot, arrival-subscription, re-sync, and prefetch behaviors the wall relies on.
- The milestone-1 dummy source (prod-shaped snapshot fixture, no API calls).
- The live source (`LiveLedWallSource`) polling contract against `/api/public/desk-roster`.
- The debug "inject a random present person" trigger.

**Out of scope:**

- The `desk-roster` endpoint's server-side internals (audit-log cursor SQL, eligibility
  and privacy filter) — see the endpoint's own tests and the live-source plan/testplan.
- The check-in mutation itself (see `registration-desk-api.ispec.md`).
- Rendering, layout, and animation (see `../led-wall.spec.md`).

## Present attendee model

R-DS1 — A present attendee has this shape:

```json
{
  "id": 1179,
  "fullName": "Ravi Kumar",
  "branch": "Civil Engineering",
  "portraitUrl": "https://cdn.example.org/portraits/1179.webp",
  "thumbnailUrl": "https://cdn.example.org/1179.jpg",
  "checkedInAt": 1780000000000
}
```

- `id` — the registration id.
- `fullName` — the attendee's display name.
- `branch` — the canonical branch name, one of the `Branch` values from `@smriti/shared`
  (the wall maps it to its catalog for short name, panel title, and quote — see
  `../led-wall.spec.md` R6).
- `portraitUrl` — the transparent portrait cutout, or `null` when the attendee has none.
- `thumbnailUrl` — a fallback JPEG thumbnail (with background), or `null` when the
  attendee has no photo at all. The wall renders the cutout when present, else the
  thumbnail, else initials — a three-tier chain.
- `checkedInAt` — epoch milliseconds the attendee was marked present.

  Scenario: Given a present attendee, when the source serializes them, then the object
  contains exactly these fields and no payment, donation, contact, or private-key data.

R-DS1.1 — The source supplies both photo URLs fully-formed; the wall never constructs CDN
URLs itself. The live source resolves `portraitUrl` as `{PUBLIC_PORTRAITS_URL}/{id}.webp`
and `thumbnailUrl` as `{PUBLIC_THUMBS_URL}/{id}.jpg` server-side (both `null` when the
registration has no `photo_thumb_key`), with no version query parameter. The dummy source
constructs the same shapes for its fixture, including one thumbnail-only attendee and one
no-photo attendee.

  Scenario: Given a dummy-source attendee with a thumbnail but no cutout, when the source
  serializes them, then `portraitUrl` is `null` and `thumbnailUrl` is a JPEG URL.

## Snapshot

R-DS2 — `getSnapshot(): Promise<PresentAttendee[]>` returns all currently-present
attendees, in a stable order.

  Scenario: Given present attendees in several branches, when the wall calls
  `getSnapshot`, then it receives every present attendee exactly once.

R-DS2.1 — Attendees returned by the initial snapshot populate rotation only; they do not
feed the spotlight queue. Spotlight is reserved for arrivals that occur after load.

  Scenario: Given the wall loads with 40 present attendees, when it renders, then it
  plays rotation and does not spotlight any of the 40.

## Arrival subscription

R-DS3 — `subscribe(onArrival): () => void` delivers each new present attendee as a
`PresentAttendee`, in the order the source receives them. The returned function
unsubscribes.

  Scenario: Given three people check in, when the source delivers them, then `onArrival`
  fires three times, once per person, in check-in order.

R-DS3.1 — A live check-in event and the debug injection trigger both arrive through this
single subscription path. The wall cannot tell them apart.

  Scenario: Given an attendee is delivered via `onArrival`, when the wall handles it, then
  it appends them to their branch and enqueues them for spotlight, regardless of the
  event's origin.

## Periodic re-sync

R-DS4 — The wall may call `getSnapshot()` again at any time. The result is the new full
truth of present attendees; the wall reconciles it into the loop without restarting the
currently playing branch.

  Scenario: Given the wall is mid-rotation when a re-sync returns an attendee who is new
  to the current branch, then that attendee joins the branch's strip and playback
  continues.

R-DS4.1 — Re-sync updates rotation data only; it does not feed the spotlight queue.
Arrivals discovered by re-sync were not witnessed live, so they appear in rotation
without a spotlight moment.

  Scenario: Given a connection gap caused an arrival to be missed, when the next re-sync
  returns that attendee, then they appear in rotation and are not spotlighted.

R-DS4.2 — `subscribeResync(onResyncNeeded): () => void` is an OPTIONAL member. A source
that can lose attendees (a live check-in undo) fires it to signal that its snapshot is
stale and the wall should re-sync now rather than wait for the periodic timer; the wall
responds by calling `getSnapshot()` immediately. Sources without removals (the dummy
source) omit it, and the wall behaves exactly as before.

  Scenario: Given the live source detects a departure, when it fires the resync callback,
  then the wall performs an immediate `getSnapshot` and reconciles the removal.

## Branch prefetch

R-DS5 — When the wall primes the next branch ahead of the rotation cursor, the source
returns that branch's attendees before the branch plays. The snapshot source satisfies
this by returning the requested branch's attendees from the already-loaded snapshot,
immediately; a future branch-grained source fetches them in the background.

  Scenario: Given the wall is playing Civil and primes CSE, when the CSE branch comes up
  in the rotation, then its attendees are already available and render without a load
  delay.

## Milestone-1 dummy source

R-DS6 — The dummy source implements `getSnapshot` and `subscribe` against a committed
snapshot fixture: a fixed set of present attendees with fabricated names, real branch
values, and real registration ids (so portraits render as real faces), plus one thumbnail-only
attendee and one no-photo attendee, so all three render tiers (cutout, thumbnail,
initials) appear. No real attendee names are committed. It performs no API calls.

  Scenario: Given the debug page loads with no network, when the dummy source resolves
  `getSnapshot`, then it returns the fixture's present attendees.

R-DS7 — The debug trigger picks a fixture attendee who is not yet present, marks them
present, and delivers them through `onArrival` (and includes them in subsequent
`getSnapshot` results).

  Scenario: Given the debug trigger is fired, when the wall receives the delivery, then
  the new attendee spotlights and thereafter appears in their branch's rotation.

R-DS7.1 — Firing the debug trigger repeatedly keeps injecting distinct present attendees
until the fixture pool is exhausted, then recycles; it never delivers an attendee who is
already present.

  Scenario: Given the trigger is fired once for every fixture attendee, when the wall
  receives each delivery, then no attendee is delivered twice.

## Live source

R-DS8 — The live source (`LiveLedWallSource`) implements this boundary against the public
`GET /api/public/desk-roster` endpoint by HTTP polling. There is no SSE, no WebSocket, and
no `checkin.created` event.

- `getSnapshot()` fetches the full roster (no `since`), maps each `entries[]` row to a
  `PresentAttendee` (`registrationId → id`, `name → fullName`; `branch`, `checkedInAt`,
  and both photo URLs carry through), and adopts the response's `seq` as its delta cursor
  — only after mapping succeeds, and monotonically (`max(cursor, seq)`).
- Arrivals come from a delta poll every 3 s: `GET ...?since=<cursor>` returns audit-log
  events after the cursor; each `arrival` is delivered on the R-DS3 subscription and the
  cursor advances to the response `seq`. The cursor is `system_audit_log.id` — monotonic,
  and it carries removals.
- A person already in a snapshot can never also spotlight: the snapshot's `seq` is the
  poll cursor, so their check-in (audit id ≤ seq) is never returned as a delta. If a
  check-in races the snapshot read and is delivered by both paths, `wallCore` de-dups on
  `(id, checkedInAt)`, which requires the full-mode and delta-mode `checkedInAt` to be
  byte-identical (the endpoint guarantees this).

  Scenario: Given the wall has booted and someone checks in at the desk, when the next
  3 s poll runs, then that person is delivered on the arrival path and spotlights within
  one poll interval, without a page reload.

R-DS8.1 — Departures. An undone check-in is a `departure` event in the delta feed. The
live source never models a departure as an arrival and never inspects its id; any
departure in a batch fires `subscribeResync` (R-DS4.2) exactly once, prompting an
immediate full re-sync that reconciles the removal via R-DS4. A departure for an id the
wall never held is harmless — the re-sync still fires and nothing throws.

  Scenario: Given a checked-in attendee is unmarked at the desk, when the next poll returns
  the departure, then the wall re-syncs and the attendee's card is gone within one poll.

R-DS8.2 — Same-batch collapse. Within one delta batch, events are processed in `seq` order
and the last event per id wins for arrival emission: an arrival then a departure for the
same id emits no arrival; a departure then an arrival emits the arrival. Any departure in
the batch still triggers the re-sync (R-DS8.1) regardless of collapse.

R-DS8.3 — The poll timer does not start until a cursor has been adopted from a successful
snapshot. If the first snapshot fails, nothing polls until a later snapshot succeeds — the
periodic full re-sync (R-DS4) is the recovery path. A failed delta poll is swallowed: the
cursor holds and the next tick retries from the same `since`; it does not surface as the
wall's error state (that is the snapshot's channel).

## Edge cases

- No-cutout attendee with a thumbnail → `portraitUrl: null`, `thumbnailUrl` set; the wall
  renders the thumbnail, not initials.
- No-photo attendee → both URLs `null`; the wall renders initials
  (`../led-wall.spec.md` R5.1). A cutout that 404s falls back to the thumbnail, and a
  thumbnail that 404s falls back to initials, all client-side.
- Departure for an id the wall never held → harmless; the re-sync still fires and nothing
  throws.
- `getSnapshot` resolves empty → the wall shows the idle state (`../led-wall.spec.md`
  R15).
- `onArrival` burst → the wall queues arrivals FIFO and spotlights them one at a time
  (`../led-wall.spec.md` R10).
- Duplicate arrival (same id already present) → the wall ignores the repeat.
- Attendee with a branch not in the wall's catalog → still delivered; the wall renders
  their card but does not add a rotation entry for the unknown branch.
- Snapshot failure (future live source) → the wall keeps its last known data; the next
  successful re-sync reconciles.

## Dependencies

- (see `../led-wall.spec.md` R6) — the branch catalog the wall maps `branch` onto.
- (see `../led-wall.spec.md` R8) — how the wall consumes arrivals.
- `GET /api/public/desk-roster` — the endpoint the live source polls: full snapshot and
  `?since=<seq>` delta modes, `system_audit_log` cursor, server-resolved photo URLs, and
  the eligibility/privacy filter.
- (see `registration-desk-api.ispec.md` R4) — the check-in mutation that produces arrivals
  and, when undone, departures.
