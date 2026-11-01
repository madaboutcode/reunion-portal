/**
 * CONTRACT
 *
 * GUARANTEE: NO_FABRICATED_DEFAULTS — nullable fields (gender, tshirtSize)
 *   are passed through as-is. No fake 'prefer_not_to_say' or 'M' defaults.
 *
 * GUARANTEE: DOC_FROM_ROW — idDocument block is present if and only if
 *   the doc parameter is non-null. No flag check involved.
 *
 * EXPECTS: Registration from repo with parsed PricingBreakup.
 * EXPECTS: Attendees from repo.
 * EXPECTS: First IdDocument from repo (or null if none uploaded).
 *
 * DOES NOT: access DB or apply business logic.
 */

import type { RegistrationResponseData, MealPreference } from '@smriti/shared';
import type { Registration, Attendee, IdDocument } from './types.js';

export function mapToResponse(
  reg: Registration,
  attendees: Attendee[],
  doc: IdDocument | null,
  paymentInfo?: { pendingPaymentAmount: number | null; hasVerifiedPayments: boolean; verifiedPaymentAmount: number },
): RegistrationResponseData {
  const spouseAttendee = attendees.find(a => a.type === 'spouse');
  const childAttendees = attendees.filter(a => a.type === 'child');
  const guestAttendees = attendees.filter(a => a.type === 'guest');

  return {
    regId: String(reg.id),
    regCode: reg.regCode,
    status: reg.status,
    pricingBreakup: reg.pricingSnapshot,
    createdAt: reg.createdAt,
    contact: {
      fullName: reg.fullName,
      branch: reg.branch,
      gender: reg.gender,
      email: reg.email,
      whatsapp: reg.whatsapp,
      mobileAlternate: reg.mobileAlternate ?? undefined,
      city: reg.city,
      country: reg.country,
    },
    attendance: {
      intent: reg.attendanceIntent,
      participationType: reg.participationType,
      alumniMeal: reg.alumniMeal === 'none' ? undefined : reg.alumniMeal as MealPreference,
      tshirtSize: reg.tshirtSize ?? null,
    },
    attendees: {
      spouse: spouseAttendee
        ? { name: spouseAttendee.name ?? '', meal: spouseAttendee.meal }
        : undefined,
      children: childAttendees.map(c => ({
        id: String(c.id),
        name: c.name ?? '',
        age: c.age ?? 0,
        meal: c.meal,
      })),
      guests: guestAttendees.map(g => ({
        id: String(g.id),
        name: g.name ?? '',
        relationship: g.relationship ?? '',
        meal: g.meal,
      })),
    },
    accommodation: reg.accommodation !== 'none'
      ? {
          type: reg.accommodation,
          checkIn: reg.checkIn ?? '',
          checkOut: reg.checkOut ?? '',
          extraBed: reg.extraBed,
          breakfastAdult: reg.breakfastAdult,
          breakfastChild: reg.breakfastChild,
        }
      : undefined,
    donation: reg.donationAmount > 0
      ? {
          amount: reg.donationAmount,
          publicAcknowledgement: reg.publicAck,
          acknowledgementDisplayName: reg.ackDisplayName ?? undefined,
          felicitationConsent: reg.felicitation,
        }
      : undefined,
    contributionSplits: Object.keys(reg.contributionSplits).length > 0
      ? reg.contributionSplits as RegistrationResponseData['contributionSplits']
      : undefined,
    idDocument: doc
      ? {
          fileKey: doc.r2Key,
          fileType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          fileName: doc.fileName,
          note: reg.idNote ?? '',
        }
      : undefined,
    pendingPaymentAmount: paymentInfo?.pendingPaymentAmount ?? null,
    hasVerifiedPayments: paymentInfo?.hasVerifiedPayments ?? false,
    verifiedPaymentAmount: paymentInfo?.verifiedPaymentAmount ?? 0,
  };
}
