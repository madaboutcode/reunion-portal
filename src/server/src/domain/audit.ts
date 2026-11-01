/**
 * CONTRACT
 *
 * GUARANTEE: DIFF_DETECTS_CHANGES — computeDiff returns a Record keyed by field
 *   name for every scalar field on Registration that differs between `before` and
 *   `after`. Each entry carries { old, new } with the respective values.
 *
 * GUARANTEE: DIFF_HANDLES_NULLS — computeDiff treats null as a distinct value.
 *   A field transitioning null→value or value→null is recorded in the diff.
 *
 * GUARANTEE: DIFF_IGNORES_UPDATED_AT — computeDiff never includes `updatedAt`
 *   in the returned changeset. updatedAt changes on every write and is not a
 *   meaningful application-level change.
 *
 * GUARANTEE: DIFF_IGNORES_ATTENDEES — attendee changes are tracked separately
 *   by the service layer. computeDiff only diffs scalar fields on Registration.
 *
 * GUARANTEE: SNAPSHOT_SHAPE — createSnapshot returns a JSON string encoding the
 *   full Registration domain type (with boolean fields and a parsed PricingBreakup
 *   object) plus the attendees array. The snapshot captures parsed types, not raw
 *   DB row shapes.
 *
 * EXPECTS: `before` and `after` are valid Registration domain objects (booleans
 *   parsed, pricingSnapshot already a PricingBreakup object). Passing raw DB rows
 *   is a caller bug — the comparison will still run but the snapshot would encode
 *   the wrong types.
 *
 * NOTE: For 'created' audit entries, `computeDiff` is NOT called. The service
 *   layer passes `changes: null` and stores only the snapshot. This is enforced
 *   at the service layer, not here.
 *
 * FAILURE BEHAVIOR: Both functions are pure and do not throw under normal inputs.
 *   JSON.stringify can only throw for circular references; Registration objects
 *   are plain data and cannot be circular.
 */

import type { Registration, Attendee } from './types.js';

type DiffEntry = { old: unknown; new: unknown };

/**
 * Compares all scalar fields on Registration (except updatedAt and pricingSnapshot
 * identity — pricingSnapshot is compared by JSON equality).
 *
 * Does NOT diff attendees — those are tracked separately.
 * Returns an empty object when no fields changed.
 */
export function computeDiff(
  before: Registration,
  after: Registration,
): Record<string, DiffEntry> {
  const diff: Record<string, DiffEntry> = {};

  function check(key: string, a: unknown, b: unknown): void {
    if (a !== b) {
      diff[key] = { old: a, new: b };
    }
  }

  function checkJson(key: string, a: unknown, b: unknown): void {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diff[key] = { old: a, new: b };
    }
  }

  // Identity fields
  check('id', before.id, after.id);
  check('regCode', before.regCode, after.regCode);
  check('status', before.status, after.status);

  // Alumni details
  check('fullName', before.fullName, after.fullName);
  check('branch', before.branch, after.branch);
  check('email', before.email, after.email);
  check('whatsapp', before.whatsapp, after.whatsapp);
  check('mobileAlternate', before.mobileAlternate, after.mobileAlternate);
  check('city', before.city, after.city);
  check('country', before.country, after.country);
  check('attendanceIntent', before.attendanceIntent, after.attendanceIntent);
  check('gender', before.gender, after.gender);
  check('tshirtSize', before.tshirtSize, after.tshirtSize);

  // Meals
  check('alumniMeal', before.alumniMeal, after.alumniMeal);

  // Accommodation
  check('accommodation', before.accommodation, after.accommodation);
  check('checkIn', before.checkIn, after.checkIn);
  check('checkOut', before.checkOut, after.checkOut);

  // Donation
  check('donationAmount', before.donationAmount, after.donationAmount);
  check('publicAck', before.publicAck, after.publicAck);
  check('ackDisplayName', before.ackDisplayName, after.ackDisplayName);
  check('felicitation', before.felicitation, after.felicitation);

  // Pricing — compared by JSON equality (objects are never reference-equal)
  checkJson('pricingSnapshot', before.pricingSnapshot, after.pricingSnapshot);
  check('totalAmount', before.totalAmount, after.totalAmount);

  // Notes
  check('idNote', before.idNote, after.idNote);

  // Timestamps — createdAt is immutable; updatedAt is intentionally excluded
  check('createdAt', before.createdAt, after.createdAt);
  // updatedAt is NOT compared — it always changes on update and carries no
  // application-level meaning.

  return diff;
}

/**
 * Creates a JSON string of the full registration state including attendees.
 * Uses the parsed domain types — booleans are boolean, pricingSnapshot is a
 * PricingBreakup object, NOT a raw JSON string.
 */
export function createSnapshot(
  registration: Registration,
  attendees: Attendee[],
): string {
  return JSON.stringify({ registration, attendees });
}
