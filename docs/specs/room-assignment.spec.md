# Specification: Physical Room Assignment

## Purpose

Allows the committee to record which physical room a registration uses on each
overnight night of the event.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Physical room records, registration-to-room assignment by night,
room notes, and assignment visibility for staff allocation operations.

**Does not cover:** Automatic room allocation, room capacity validation,
roommate matching, accommodation pricing, or public room data. Roommate
preferences remain advisory (see `roommate-preferences.spec.md` R4). Aggregate
availability remains governed by `room-availability.spec.md` R1.1.

## Requirements

### Physical Rooms

R1 — A physical room has a unique room number, optional notes, and an active
state. The room number identifies the room staff select during assignment.

Scenario: Given an active room numbered `204`, when staff view the room list,
then the list shows room `204`, its notes, and its active state.

R1.1 — Room capacity is not stored or validated in this first version. The
committee is responsible for deciding whether the recorded occupants fit the
physical room.

Scenario: Given two registrations assigned to room `204` on the same night,
when the assignment list loads, then both assignments are retained without a
capacity rejection.

### Registration-Room-Night Mapping

R2 — A registration may be assigned to at most one room for a given night.
The current assignment is replaced when staff select a different room for the
same registration and night.

Scenario: Given registration `1001` is assigned to room `204` for
`2026-08-14`, when staff assign it to room `205` for the same night, then the
assignment changes to room `205` and there is still one assignment for that
registration and night.

R2.1 — A room may have multiple registrations assigned on the same night. The
system records the assignment but does not validate capacity.

Scenario: Given registrations `1001` and `1002`, when both are assigned to
room `204` for `2026-08-15`, then both assignments appear in the room view.

R2.2 — A registration may use different rooms on different nights.

Scenario: Given registration `1001` is in room `204` on `2026-08-14`, when staff
assign it to room `305` on `2026-08-15`, then both night-specific assignments
remain visible.

R2.3 — `night_date` identifies the overnight night, not the registration's
check-in date. It must be one of the configured event nights (`2026-08-14` or
`2026-08-15` for this event).

Scenario: Given a room assignment request for `2026-08-14`, when it is saved,
then the assignment is associated with the night of August 14 and not merely
with the registration's check-in date.

R2.4 — Assignment records identify the staff user who made the assignment and
the assignment is auditable through the system audit log.

Scenario: Given staff user A assigns registration `1001` to room `204`, when
the save completes, then the assignment records user A and the audit log
records the assignment action.

### Registration Model Check-In

R3 — A registration stores its current group check-in state directly:

- `checkedInAt`, nullable Unix epoch milliseconds;
- `checkedInBy`, nullable staff user ID.

Scenario: Given staff user A marks registration `1001` present, when the
operation succeeds, then registration `1001` has `checkedInAt` and `checkedInBy`
set and the whole registration group is considered present.

R3.1 — Check-in is independent of room assignment and payment state. A
registration may be checked in without a room assignment and while payment is
pending.

Scenario: Given a pending-payment registration with no room assignment, when
the desk marks it present, then check-in succeeds and neither payment nor room
assignment changes.

## States

- Room active and unassigned
- Room active with assignments
- Room inactive
- Registration unassigned for a night
- Registration assigned for one night
- Registration assigned to different rooms on different nights
- Registration checked in without a room assignment

## Data Flow

- Staff creates or updates physical room records.
- Allocation staff assign registrations to rooms for individual event nights.
- Registration check-in writes current fields on `registrations`.
- Assignment and check-in actions write system audit entries.
- Public pages receive no room number, room notes, assignment actor, or
  assignment history.

## Edge Cases

- Changing a room assignment replaces the registration's assignment for that
  night; it does not create a second current assignment.
- Archiving a registration removes its assignments through the registration
  foreign key cascade.
- Inactive rooms cannot receive new assignments but remain visible on existing
  historical assignments.
- Unknown event nights are rejected at the API boundary. No date default is
  invented.
- Room capacity is deliberately not checked in this version.

## Dependencies

- (see `room-availability.spec.md` R1.1) — aggregate room inventory and event nights
- (see `roommate-preferences.spec.md` R4) — advisory roommate preferences and manual allocation workflow
- (see `staff-api.spec.md` R31) — allocation scope and staff API conventions
- (see `staff-operations.spec.md` R12) — audit action registry
- (see `registration-desk.spec.md` R4.2) — group-level check-in and desk visibility
- (see `authentication.spec.md` R15) — staff identity and scoped access
