# Specification: Room Availability

## Purpose

Controls how many rooms are available for accommodation at the reunion, gates the registration form to prevent overcommitment, and provides real-time occupancy data to staff.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [Inventory Model](#inventory-model)
  - [Occupancy Computation](#occupancy-computation)
  - [Per-Date Rules](#per-date-rules)
  - [Room Type Availability](#room-type-availability)
  - [Public API](#public-api)
  - [Submission Gate](#submission-gate)
  - [Staff Edit Constraints](#staff-edit-constraints)
  - [Staff Inventory Management](#staff-inventory-management)
- [States](#states)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Room inventory storage, occupancy derivation from registration data, per-date and per-type availability rules, the public availability API, submission-time validation, staff edit constraints, and staff inventory management UI.

**Does not cover:** Physical room records and registration-to-room assignment (see `room-assignment.spec.md`). Accommodation pricing (see `pricing-engine.spec.md`). Accommodation selection UI details (see `accommodation.spec.md`). Staff dashboard layout (see `staff-resources.spec.md`).

## Requirements

### Inventory Model

R1 — Staff enters one total room count per check-in date. All room types (private, shared_double, shared_triple) draw from the same pool. The hotel deals in individual physical rooms — the system does not manage room-type-specific pools.

R1.1 — Check-in dates are the same as `CHECKIN_OPTIONS` in shared constants: `2026-08-14` and `2026-08-15`. Check-out is always `2026-08-16`.

R1.2 — Room inventory is stored in the backend. The storage shape is a pair of numbers: `(check_in_date, total_rooms)`.

R1.3 — When no inventory has been set (initial state), all room types are available with no capacity constraint — the system behaves as it does today. Availability gating activates only after staff enters inventory numbers.

### Occupancy Computation

R2 — Occupancy is computed in real-time from registration data per night. There is no running counter — a query derives current occupancy each time availability is checked. The existing `accommodationByNight()` query in `attendee.repo.ts` already computes this.

R2.1 — Each registration has one accommodation type and one check-in date. The type applies to all nights of the stay. Room-equivalents are computed per night from the combined set of registrations occupying that night:

| Accommodation type | Rooms consumed |
|---|---|
| `private` | 1 room per registration |
| `shared_double` | `ceil(count / 2)` rooms — 2 people share 1 room |
| `shared_triple` | `ceil(count / 3)` rooms — 3 people share 1 room |

R2.2 — Partially-filled shared rooms are committed to their type. A room with 1 shared_double occupant accepts only another shared_double person — not private or shared_triple. The committee handles actual room assignments.

R2.3 — Shared room counts are computed per night across all check-in dates. A shared_double person checking in Aug 14 and a shared_double person checking in Aug 15 are counted together for the night of the 15th (when both are present). This means they can fill each other's partial rooms on the overlap night — the committee can pair them since they share the room that night.

R2.4 — Only active registrations count toward occupancy. Archived registrations are hard-deleted from the `registrations` table (snapshot preserved in `archived_registrations`), so they are naturally excluded from the occupancy query.

R2.5 — Registrations with `accommodation = 'none'` do not consume rooms.

R2.6 — The existing `accommodationByNight()` query uses the interval predicate `check_in <= night AND check_out > night` to determine which registrations occupy each night. For night "2026-08-14", only 14th check-ins match. For night "2026-08-15", both 14th and 15th check-ins match (combined).

### Per-Date Rules

R3 — Staff enters independent room quotas: one for the night of Aug 14, one for the night of Aug 15. These represent the hotel's room block per night.

R3.1 — A registration checking in on Aug 14 (checkout Aug 16) occupies a room for both the night of the 14th and the night of the 15th. It contributes to both nights' room counts.

R3.2 — A registration checking in on Aug 15 (checkout Aug 16) occupies a room for the night of the 15th only.

R3.3 — Per-night remaining capacity:

```
night_14_remaining = rooms_14th − night_14_rooms_consumed
night_15_remaining = rooms_15th − night_15_rooms_consumed
```

Where `night_14_rooms_consumed` is the total room-equivalents from registrations present on the 14th (only 14th check-ins), and `night_15_rooms_consumed` is the total room-equivalents from registrations present on the 15th (14th + 15th check-ins combined, with shared types counted together per R2.3).

R3.4 — A check-in date can accept more registrations only if ALL nights it spans have remaining capacity:

```
can_accept_14th_checkin = night_14_remaining > 0 AND night_15_remaining > 0
can_accept_15th_checkin = night_15_remaining > 0
```

R3.5 — The 15th night is the bottleneck where all registrations overlap. If `rooms_14th > rooms_15th`, the effective capacity for 14th check-ins is limited by the 15th night. The staff edit page should display per-night occupancy clearly so this is not confusing.

### Room Type Availability

R4 — A room type is available for a given check-in date if, on every night that check-in spans, either:

- (a) There are open slots in partially-filled rooms of that type on that night, OR
- (b) There are empty (uncommitted) rooms on that night.

R4.1 — Empty rooms on a night = total quota for that night − total room-equivalents consumed on that night.

R4.2 — Open slots in partially-filled rooms (computed per night from combined counts):

| Type | Open slots |
|---|---|
| `shared_double` | `(ceil(sd_count / 2) × 2) − sd_count` — either 0 or 1 |
| `shared_triple` | `(ceil(st_count / 3) × 3) − st_count` — 0, 1, or 2 |

R4.3 — `private` has no partial-fill concept. It is available only when empty rooms exist on all nights the stay spans (R4.1).

R4.4 — `none` ("Not Needed") is always available regardless of room inventory.

R4.5 — For a 14th check-in, a room type must be available on BOTH the 14th and 15th nights. For a 15th check-in, it must be available on the 15th night only.

### Public API

R5 — `GET /api/accommodation/availability` — public endpoint, no auth required. Returns current room availability per check-in date and per room type.

R5.1 — Response shape:

```json
{
  "availability": {
    "2026-08-14": {
      "totalAvailable": 5,
      "types": {
        "private": { "available": true, "remaining": 3 },
        "shared_double": { "available": true, "remaining": 4 },
        "shared_triple": { "available": true, "remaining": 2 }
      }
    },
    "2026-08-15": {
      "totalAvailable": 2,
      "types": {
        "private": { "available": true, "remaining": 2 },
        "shared_double": { "available": true, "remaining": 3 },
        "shared_triple": { "available": false, "remaining": 0 }
      }
    }
  },
  "inventoryConfigured": true
}
```

R5.2 — `remaining` for private = empty rooms available for that date. `remaining` for shared types = open slots in partial rooms + (empty rooms × persons per room). This gives the user a count of how many more people can pick that option.

R5.3 — `inventoryConfigured` is `false` when staff has not yet entered any room inventory. When `false`, the frontend treats all room types as available (no gating). The `availability` object is still present but all types show `available: true` with no `remaining` counts.

R5.4 — Response may be cached with a short TTL (30–60 seconds). Availability changes only on registration submission. The backend validates on submit regardless of stale frontend data (see R6).

R5.5 — Covered by existing API rate limiting middleware.

### Submission Gate

R6 — When a registration is submitted via `POST /api/registrations`, the server checks room availability before any writes. If the selected accommodation type is not available for the selected check-in date, the submission is rejected.

R6.1 — The availability check runs after schema validation (R3.2 of `submission-api.spec.md`) and pricing computation (R3.3 of `submission-api.spec.md`), but before any database writes.

R6.2 — When accommodation is `none` or inventory has not been configured, the check is skipped.

R6.3 — When the selected room type is not available for the selected check-in date, the response is `409` with:

```json
{
  "error": "Selected accommodation is no longer available",
  "code": "ACCOMMODATION_UNAVAILABLE"
}
```

R6.4 — The frontend handles this error by refreshing availability data and updating the accommodation step to reflect current availability.

### Staff Edit Constraints

R7 — Staff edits to accommodation are subject to the same availability rules. No override is available.

R7.1 — When rooms are at capacity, staff can only downgrade or release accommodation:
- Any type → `none` (release)
- `private` → `shared_double` or `shared_triple` (downgrade)
- `shared_double` → `shared_triple` (downgrade)

R7.2 — Staff cannot upgrade accommodation (e.g., `shared_triple` → `private`) when rooms are full.

R7.3 — The edit service checks availability for the new accommodation type. If the edit would exceed capacity, it is rejected with a `409`.

### Staff Inventory Management

R8 — The Resources page includes an "Edit Room Availability" button that navigates to an inventory edit page.

R8.1 — The edit page shows:
- Two number inputs: "Rooms available — Aug 14 check-in" and "Rooms available — Aug 15 check-in"
- Current occupancy per date (rooms consumed / total)
- Per-night breakdown: how many rooms are occupied on the night of the 14th, the night of the 15th (showing the cross-date overlap clearly)
- A save button

R8.2 — Staff can reduce room inventory below current occupancy. A warning is shown: "Current occupancy is X rooms. Availability is Y. Over by Z rooms." The save is not blocked — reality may have changed (hotel reduced the block). The over-commitment is expressed in rooms, not registrations — the committee decides which registrations to contact.

R8.3 — Requires staff or admin role.

R8.4 — Staff API endpoints:
- `GET /api/staff/room-inventory` — returns current quotas and occupancy breakdown. Requires staff/admin auth.
- `PUT /api/staff/room-inventory` — updates quotas. Requires staff/admin auth. Body: `{ "2026-08-14": <number>, "2026-08-15": <number> }`.

R8.5 — The existing Accommodation section on the Resources page (see `staff-resources.spec.md` R5) adds occupancy-vs-capacity numbers: "X / Y rooms used" per check-in date, alongside the existing per-type breakdown.

## States

| State | Description |
|-------|-------------|
| No inventory configured | Staff has not entered room numbers. All room types available (no gating). System behaves as today. |
| Rooms available | Inventory configured, capacity not reached. All non-disabled room types shown as available with remaining counts. |
| Partially sold out | Some room types or dates at capacity. Affected options disabled with "Sold Out" badge and remaining count of 0. Other options still available. |
| Fully sold out | All room types at capacity for all dates. All room type cards disabled. "Not Needed" is the only enabled option. Message explains rooms are fully booked. |
| Over-committed | Staff reduced inventory below occupancy. New registrations cannot select rooms. Staff sees warning on edit page. |

## Edge Cases

- If staff sets `rooms_14th = 0` and `rooms_15th = 0`, all accommodation options are effectively disabled (only "Not Needed" available). The step still shows.
- A single shared_triple person checking in on the 14th consumes 1 room on night 14. On night 15, if another shared_triple person checked in on the 15th, they are counted together: ceil(2/3) = 1 room. The partial room on the 15th is shared across check-in dates.
- With 1 room remaining on a night and 1 person picks shared_double: private is unavailable (no empty rooms), shared_double has 1 open slot, shared_triple is unavailable (no empty rooms and no open triple slots).
- Two concurrent submissions for the last room: both may pass the availability check. This is a known limitation at the current registration volume (~200). The committee handles the rare over-commit operationally.
- Shared room pairing across check-in dates: a shared_double person checking in Aug 14 and a shared_double person checking in Aug 15 are counted together for the night of the 15th (ceil(2/2) = 1 room). They can be paired by the committee for the overlap night.
- `donation_only` and `campus_only` registrations skip accommodation entirely — they never consume rooms.

## Dependencies

- References: `accommodation.spec.md` — room type options, selection UI, conditional fields
- References: `pricing-engine.spec.md` — accommodation pricing (unaffected by availability)
- References: `submission-api.spec.md` — submission validation pipeline (R6 adds a step)
- References: `staff-resources.spec.md` — Resources page layout (R8.5 adds occupancy display)
- References: `staff-operations.spec.md` — staff edit service (R7 adds constraints)
- Data: `CHECKIN_OPTIONS`, `CHECKOUT_OPTIONS` from `@smriti/shared` constants
- Data: `accommodationByNight()` query in `attendee.repo.ts` — existing occupancy computation
- Physical assignment: `room-assignment.spec.md` — room records and registration-room-night mapping
