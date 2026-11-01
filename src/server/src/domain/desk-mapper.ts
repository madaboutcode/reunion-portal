/**
 * CONTRACT: Registration-desk response mappers.
 *
 * GUARANTEE: ALLOWLIST_ONLY — every mapper returns exactly the fields in
 *   docs/specs/interfaces/registration-desk-api.ispec.md. No email, donation,
 *   payment history, payment proof, bank reference, ID document, pricing
 *   snapshot, raw storage key, or audit data is serialized. Two narrowly-
 *   scoped exceptions are permitted: `whatsapp` (R1.2/R3.6 — primary
 *   registrant's stored number, helpdesk contact; email stays forbidden) and
 *   `rooms` (R3.7 — distinct assigned room numbers, read-only). These
 *   mappers are the ONLY place desk responses are built — the routes and
 *   service never hand-construct a response object. T-shirt entries carry
 *   only size, gender, and isIncluded — never an amount, price, or charge
 *   field from the separate additional_charges table.
 *
 * GUARANTEE: PHOTO_URL_SHAPE — the photo url is always
 *   `/api/staff/desk/registrations/<id>/photo` when a thumbnail exists and
 *   null otherwise; `available` mirrors that. The private storage key never
 *   appears (registration-desk.spec.md R3.3).
 *
 * GUARANTEE: ACCOMMODATION_NULLABLE — accommodation is null when the
 *   registration has accommodation 'none'; otherwise `{ type, checkIn,
 *   checkOut }` with nullable dates (registration-desk.spec.md R3).
 *
 * GUARANTEE: GUEST_FIELDS_MINIMAL — guest entries carry only name and
 *   mealPreference (requirements R21); spouse entries carry name and
 *   mealPreference; children carry name, age, mealPreference.
 *
 * EXPECTS: callers pass already-validated domain data. payment.state is
 *   derived via mapDeskPaymentState before any mapper is called — the mapper
 *   does not re-derive or default it.
 *
 * FAILURE BEHAVIOR: mappers are pure and do not throw on valid input. The
 *   service is responsible for the hard-failure boundary (unknown payment
 *   state throws in desk-types.ts before a mapper runs).
 *
 * DOES NOT: filter dashboard payloads. It consumes the dedicated desk domain
 *   types from desk-types.ts only.
 */

import type { ParticipationType } from '@smriti/shared';
import type {
  DeskCheckInState,
  DeskOverviewGroup,
  DeskOverviewRow,
  DeskOverviewTshirt,
  DeskSearchCandidate,
  DeskStatsRow,
} from './desk-types.js';
import { toDeskCheckInState } from './desk-types.js';
import { mapDeskPaymentState } from './desk-types.js';

export interface DeskSearchResultItem {
  id: number;
  fullName: string;
  branch: string;
  regCode: string;
  participationType: ParticipationType;
  hasPhoto: boolean;
  checkIn: DeskCheckInState;
}

export interface DeskSearchResponse {
  results: DeskSearchResultItem[];
  thumbsBaseUrl: string;
  photosVersion: number;
}

export interface DeskOverviewResponse {
  attendee: {
    id: number;
    fullName: string;
    regCode: string;
    branch: string;
    participationType: ParticipationType;
    photo: { available: boolean; url: string | null };
    whatsapp: string;
    mealPreference: string;
    accommodation: { type: string; checkIn: string | null; checkOut: string | null } | null;
    rooms: string[];
    additionalAttendees: {
      spouse: Array<{ name: string | null; mealPreference: string }>;
      children: Array<{ name: string | null; age: number | null; mealPreference: string }>;
      guests: Array<{ name: string | null; mealPreference: string }>;
    };
    payment: { state: 'payment_pending' | 'confirmed'; amountDue?: number };
    checkIn: DeskCheckInState;
    tshirts: Array<{ size: string; gender: string | null; isIncluded: boolean }>;
  };
}

export interface DeskCheckInResponse {
  checkIn: DeskCheckInState;
}

export interface DeskSpotRegistrationResponse {
  registration: {
    id: number;
    regCode: string;
    participationType: ParticipationType;
    payment: { state: 'payment_pending'; amountDue: number };
    checkIn: DeskCheckInState;
    passUrl: string;
  };
}

export function toDeskSearchResponse(
  candidates: DeskSearchCandidate[],
  thumbsBaseUrl: string,
  photosVersion: number,
): DeskSearchResponse {
  return {
    results: candidates.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      branch: c.branch,
      regCode: c.regCode,
      participationType: c.participationType,
      hasPhoto: c.hasPhoto,
      checkIn: toDeskCheckInState(c.checkedInAt),
    })),
    thumbsBaseUrl,
    photosVersion,
  };
}

function mealValue(meal: string | undefined): string {
  // The desk request schema restricts meals to 'veg' | 'non_veg' at the
  // boundary; a missing value would be a schema violation caught earlier.
  return meal as string;
}

export function toDeskOverviewResponse(
  row: DeskOverviewRow,
  attendees: DeskOverviewGroup,
  amountDue: number | null,
  tshirts: DeskOverviewTshirt[],
  rooms: string[],
): DeskOverviewResponse {
  const state = mapDeskPaymentState(row.status);
  const photoAvailable = row.photo_thumb_key !== null && row.photo_thumb_key !== '';
  const accommodation =
    row.accommodation === 'none'
      ? null
      : { type: row.accommodation, checkIn: row.check_in, checkOut: row.check_out };

  const payment: { state: 'payment_pending' | 'confirmed'; amountDue?: number } = { state };
  if (state === 'payment_pending' && amountDue !== null) {
    payment.amountDue = amountDue;
  }

  return {
    attendee: {
      id: row.id,
      fullName: row.full_name,
      regCode: row.reg_code,
      branch: row.branch,
      participationType: row.participation_type,
      photo: {
        available: photoAvailable,
        url: photoAvailable ? `/api/staff/desk/registrations/${row.id}/photo` : null,
      },
      whatsapp: row.whatsapp,
      mealPreference: row.alumni_meal,
      accommodation,
      rooms,
      additionalAttendees: {
        spouse: attendees.spouse.map((a) => ({
          name: a.name,
          mealPreference: mealValue(a.mealPreference),
        })),
        children: attendees.children.map((a) => ({
          name: a.name,
          age: a.age,
          mealPreference: mealValue(a.mealPreference),
        })),
        guests: attendees.guests.map((a) => ({
          name: a.name,
          mealPreference: mealValue(a.mealPreference),
        })),
      },
      payment,
      checkIn: toDeskCheckInState(row.checked_in_at),
      tshirts: tshirts.map((t) => ({
        size: t.size,
        gender: t.gender,
        isIncluded: t.isIncluded,
      })),
    },
  };
}

export function toDeskCheckInResponse(checkedInAt: number | null): DeskCheckInResponse {
  return { checkIn: { present: checkedInAt !== null, checkedInAt } };
}

/** Per-type headline: registrations of one participation type and how many
 *  are present. */
export interface DeskTypeCount {
  total: number;
  checkedIn: number;
}

/** Live desk counts (roster totals only — no registration data). `total` and
 *  `checkedIn` are the overall figures across the eligible types; `byType`
 *  breaks the same figures down by participation type. Donation-only is never
 *  counted. */
export interface DeskStatsResponse {
  total: number;
  checkedIn: number;
  byType: {
    full_celebration: DeskTypeCount;
    campus_only: DeskTypeCount;
  };
}

/** Folds the grouped counts rows into the overall + per-type response. A type
 *  absent from `rows` (zero registrations) defaults to {0, 0}; the overall
 *  figures are the sum of the buckets, so they stay consistent by construction. */
export function toDeskStatsResponse(rows: DeskStatsRow[]): DeskStatsResponse {
  const byType = {
    full_celebration: { total: 0, checkedIn: 0 },
    campus_only: { total: 0, checkedIn: 0 },
  };
  for (const row of rows) {
    byType[row.participation_type] = { total: row.total, checkedIn: row.checked_in };
  }
  return {
    total: byType.full_celebration.total + byType.campus_only.total,
    checkedIn: byType.full_celebration.checkedIn + byType.campus_only.checkedIn,
    byType,
  };
}

export function toDeskSpotRegistrationResponse(args: {
  id: number;
  regCode: string;
  participationType: ParticipationType;
  amountDue: number;
}): DeskSpotRegistrationResponse {
  return {
    registration: {
      id: args.id,
      regCode: args.regCode,
      participationType: args.participationType,
      payment: { state: 'payment_pending', amountDue: args.amountDue },
      checkIn: { present: false, checkedInAt: null },
      passUrl: `/pass#${args.regCode}`,
    },
  };
}
