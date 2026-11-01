# Interface Specification: Attendance Feed

## Purpose

Defines how checked-in status appears on Who's Coming and how an optional live recent-check-in display receives updates.

## Contents

- [Scope](#scope)
- [Public Who's Coming](#public-whos-coming)
- [Live Feed](#live-feed)
- [Privacy and Availability](#privacy-and-availability)
- [Dependencies](#dependencies)

## Scope

**Covers:** Public checked-in indicators, live-feed event shape, reconnect behavior, and privacy limits.

**Does not cover:** Desk check-in authorization or the check-in mutation itself (see `registration-desk-api.ispec.md`).

## Public Who's Coming

R1 — `GET /api/public/whos-coming` adds `checkedIn: boolean` to each eligible attendee. It does not add check-in timestamp, staff actor, payment state, donation data, or registration detail.

  Scenario: Given an eligible attendee who has checked in, when the public list loads, then that person's item contains `checkedIn: true` and no check-in timestamp.

R1.1 — The public response remains limited to attendees already eligible for Who's Coming. Donation-only records remain excluded.

  Scenario: Given a donation-only registration, when the public list loads, then it is absent regardless of check-in state.

R1.2 — The UI displays a clear but non-sensitive visual indicator for `checkedIn: true`, with accessible text such as `Checked in`. No indicator is shown for false.

  Scenario: Given one checked-in and one not-checked-in person, when the list renders, then only the checked-in person has the status indicator.

## Live Feed

R2 — The live feed is optional future scope. When enabled, it displays recent check-ins using only:

- Full name
- Branch, only if the display configuration explicitly includes it
- Profile thumbnail, only if the public Who's Coming photo is already eligible
- Check-in timestamp relative to now, not an exact staff audit timestamp

  Scenario: Given a recent check-in, when the projection client receives an event, then it shows the person's name and photo but no payment or private registration data.

R2.1 — The event shape is:

```json
{
  "type": "checkin.created",
  "eventId": "checkin-1001-1780000000000",
  "registrationId": 1001,
  "fullName": "Ravi Kumar",
  "photoUrl": "<public-photo-url>",
  "occurredAt": 1780000000000
}
```

  Scenario: Given a check-in event, when the projection client receives it, then the event has a stable ID and contains no payment, donation, contact, accommodation, or companion data.

R2.2 — The feed is best-effort notification, not the source of truth. On connection, reconnection, or detected event gaps, the client refetches the current public attendee list.

  Scenario: Given a dropped connection, when the client reconnects, then it refetches the current snapshot before displaying new events.

R2.3 — While the public Who's Coming page is visible, it refreshes its checked-in indicators at least every 15 seconds. The projected display may use a persistent update channel in a later release, but its behavior remains covered by the snapshot and event contracts in this spec.

  Scenario: Given the normal public page is open and a check-in occurs elsewhere, when 15 seconds elapse, then the page refreshes its checked-in indicators.

R2.4 — Live-feed connections and polling never expose the authenticated desk API or its pending-payment data.

  Scenario: Given a public projection client, when it requests attendance updates, then it receives only the public feed contract.

## Privacy and Availability

R3 — Check-in timestamps, staff actors, payment state, amount due, donation fields, direct contact fields, and private photo keys are never added to the public attendance-feed response. Existing fields already defined by the Who's Coming contract remain governed by that contract.

  Scenario: Given a serialized feed event and public list response, when fields are enumerated, then none of the prohibited private fields appears.

R3.1 — A temporary feed failure does not alter check-in state. The next snapshot request reflects the saved state.

  Scenario: Given the broadcaster is unavailable after a successful check-in, when the public page polls again, then it sees the saved checked-in indicator.

## Dependencies

- (see `../registration-desk.spec.md` R4) — check-in behavior and privacy boundary
- (see `registration-desk-api.ispec.md` R4) — check-in mutation
- (see `registration-desk-api.ispec.md` R4.4) — attendance event source
- (see `../access-control.spec.md` R6) — public and desk endpoint gates
- (see `whos-coming-avatars.ispec.md` R-IF-A4) — existing Who's Coming response fields
- (see `whos-coming-avatars.ispec.md` R-IF-A4) — existing `GET /api/public/whos-coming` contract
