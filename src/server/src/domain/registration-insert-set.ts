/**
 * CONTRACT
 *
 * GUARANTEE: INVARIANT_TOTAL_POSITIVE — buildInsertSet() throws if
 *   pricing.total <= 0. Two independent guards: service rejects before
 *   calling this, and this asserts independently.
 *
 * GUARANTEE: NO_ID_DOC_FLAG — output never contains id_doc_uploaded.
 *   Document presence is determined by the document field being non-null.
 *
 * GUARANTEE: PLACEHOLDER_FKS — all child rows (attendees, document, payment)
 *   use registration_id = 0 as placeholder. The repository resolves actual
 *   FKs after obtaining the registration's auto-increment ID.
 *
 * EXPECTS: data has passed registrationSchema validation.
 * EXPECTS: regCode is a valid 16-char SMRT code.
 *
 * DOES NOT: access I/O, generate regCode, or compute pricing.
 */

import type { SubmitRegistrationRequest, PricingBreakup } from '@smriti/shared';
import type { NewRegistration, NewAttendee, NewIdDocument, NewPayment } from './types.js';

export interface RegistrationInsertSet {
  registration: NewRegistration;
  attendees: NewAttendee[];
  document: NewIdDocument | null;
  payment: NewPayment;
}

export function buildInsertSet(
  data: SubmitRegistrationRequest,
  regCode: string,
  pricing: PricingBreakup,
  isChildChargeable: (age: number) => boolean,
): RegistrationInsertSet {
  if (pricing.total <= 0) {
    throw new Error('Invariant: pricing.total must be > 0');
  }

  const registration: NewRegistration = {
    reg_code: regCode,
    full_name: data.contact.fullName,
    branch: data.contact.branch,
    email: data.contact.email,
    whatsapp: data.contact.whatsapp,
    mobile_alternate: data.contact.mobileAlternate?.trim() || null,
    city: data.contact.city,
    country: data.contact.country || 'India',
    attendance_intent: data.attendance.intent,
    participation_type: data.attendance.participationType,
    gender: data.contact.gender,
    tshirt_size: data.attendance.tshirtSize ?? null,
    alumni_meal: data.attendance.alumniMeal ?? 'none',
    accommodation: data.accommodation?.type ?? 'none',
    check_in: data.accommodation?.checkIn?.trim() || null,
    check_out: data.accommodation?.checkOut?.trim() || null,
    extra_bed: data.accommodation?.extraBed ? 1 : 0,
    donation_amount: data.donation?.amount ?? 0,
    public_ack: data.donation?.publicAcknowledgement ? 1 : 0,
    ack_display_name: data.donation?.acknowledgementDisplayName?.trim() || null,
    felicitation: data.donation?.felicitationConsent ? 1 : 0,
    contribution_splits: JSON.stringify(data.contributionSplits ?? {}),
    pricing_snapshot: JSON.stringify(pricing),
    total_amount: pricing.total,
    id_note: data.idDocument?.note?.trim() || null,
    photo_file_key: data.photo?.fileKey ?? null,
  };

  const attendees: NewAttendee[] = [];

  if (data.attendees.spouse) {
    attendees.push({
      registration_id: 0,
      type: 'spouse',
      name: data.attendees.spouse.name,
      age: null,
      relationship: null,
      meal: data.attendees.spouse.meal,
      is_chargeable: 1,
    });
  }

  for (const child of data.attendees.children) {
    attendees.push({
      registration_id: 0,
      type: 'child',
      name: child.name || null,
      age: child.age,
      relationship: null,
      meal: child.meal,
      is_chargeable: isChildChargeable(child.age) ? 1 : 0,
    });
  }

  for (const guest of data.attendees.guests) {
    attendees.push({
      registration_id: 0,
      type: 'guest',
      name: guest.name || null,
      age: null,
      relationship: guest.relationship || null,
      meal: guest.meal,
      is_chargeable: 1,
    });
  }

  const document: NewIdDocument | null = data.idDocument
    ? {
        registration_id: 0,
        file_name: data.idDocument.fileName,
        mime_type: data.idDocument.fileType,
        size_bytes: data.idDocument.sizeBytes,
        r2_key: data.idDocument.fileKey,
      }
    : null;

  const payment: NewPayment = {
    registration_id: 0,
    amount: pricing.total,
    status: 'payment_pending',
    gateway: null,
    gateway_ref: null,
    gateway_response: null,
    proof_file_key: null,
    verified_by: null,
    verified_at: null,
  };

  return { registration, attendees, document, payment };
}
