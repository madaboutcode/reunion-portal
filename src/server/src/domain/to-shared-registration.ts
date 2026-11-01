/**
 * CONTRACT
 *
 * GUARANTEE: SOLE_MAPPER — toSharedRegistration() is the only place that maps
 *   the server's flat Registration domain type (+ separately-loaded attendees)
 *   into @smriti/shared's nested Registration shape required by
 *   calculateTotal(). Extracted from edit.service.ts so every caller that
 *   needs to price a registration (edit service, tshirt/charge service) uses
 *   the exact same mapping — no drift between two hand-written copies.
 *
 * EXPECTS: attendees is the full, current attendee list for reg.id (from
 *   IAttendeeRepository.findByRegistration), not a partial/filtered list.
 *
 * FAILURE BEHAVIOR: Pure function, never throws. Falls back to safe defaults
 *   (e.g. gender 'male', tshirtSize 'M') when the source field is null —
 *   these fallbacks only feed calculateTotal() and are never persisted.
 */

import type {
  Registration as SharedRegistration,
  MealPreference,
  AccommodationType,
  Gender as SharedGender,
  TshirtSize,
  ChildAttendee as SharedChild,
  GuestAttendee as SharedGuest,
} from '@smriti/shared';
import type { Registration, Attendee } from './types.js';

export function toSharedRegistration(
  reg: Registration,
  attendees: Attendee[],
): SharedRegistration {
  const spouse = attendees.find((a) => a.type === 'spouse');
  const children = attendees.filter((a) => a.type === 'child');
  const guests = attendees.filter((a) => a.type === 'guest');

  return {
    contact: {
      fullName: reg.fullName,
      branch: reg.branch,
      gender: (reg.gender ?? 'male') as SharedGender,
      email: reg.email,
      whatsapp: reg.whatsapp,
      mobileAlternate: reg.mobileAlternate ?? undefined,
      city: reg.city,
      country: reg.country,
    },
    attendance: {
      intent: reg.attendanceIntent,
      participationType: reg.participationType,
      alumniMeal: reg.alumniMeal as MealPreference,
      tshirtSize: (reg.tshirtSize ?? 'M') as TshirtSize,
    },
    attendees: {
      spouse: spouse ? { name: spouse.name ?? '', meal: spouse.meal as MealPreference } : undefined,
      children: children.map((c): SharedChild => ({
        id: String(c.id),
        name: c.name ?? '',
        age: c.age ?? 0,
        meal: c.meal as MealPreference,
      })),
      guests: guests.map((g): SharedGuest => ({
        id: String(g.id),
        name: g.name ?? '',
        relationship: g.relationship ?? '',
        meal: g.meal as MealPreference,
      })),
    },
    ...(reg.accommodation !== 'none' && reg.checkIn && reg.checkOut
      ? {
          accommodation: {
            type: reg.accommodation as Exclude<AccommodationType, 'none'>,
            checkIn: reg.checkIn,
            checkOut: reg.checkOut,
            extraBed: reg.extraBed,
            breakfastAdult: reg.breakfastAdult,
            breakfastChild: reg.breakfastChild,
          },
        }
      : {}),
    ...(reg.donationAmount > 0
      ? {
          donation: {
            amount: reg.donationAmount,
            publicAcknowledgement: reg.publicAck,
            acknowledgementDisplayName: reg.ackDisplayName ?? undefined,
            felicitationConsent: reg.felicitation,
          },
        }
      : {}),
    contributionSplits: reg.contributionSplits as Record<string, number>,
  };
}
