# Glossary

## Registration desk

The event-day workflow used by external staff to find attendees, create basic spot registrations, see outstanding payment, and mark arrival.

## Desk user

A staff account granted the `registration_desk` scope. A desk user does not receive the full dashboard scope by implication.

## Spot registration

A registration created by desk staff during the event or at the venue using the minimum event-operational fields.

## Check-in

The act of marking an eligible attendee as present. Check-in is separate from payment verification.

## Payment state

The limited payment information visible to desk users: `confirmed` or `payment_pending`, with `amountDue` shown only when payment is pending.

## Attendance feed

The public checked-in indicators on Who's Coming and the optional recent-check-in display.

## Attendance wall (LED wall)

The fullscreen ambient display for venue screens that shows present attendees as drifting
branch film-strips and spotlights each arrival. See `led-wall.spec.md`.

## Present

An attendee who has checked in — their registration has `checked_in_at` set. The
attendance wall shows only present attendees.

## Eligible attendee

A registration with participation type `full_celebration` or `campus_only`. Donation-only registrations are not eligible for desk check-in.
