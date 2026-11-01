/**
 * Unit tests for buildInsertSet() — registration-insert-set.ts
 *
 * Tests every CONTRACT guarantee directly, without going through the service layer.
 */

import { describe, it, expect } from 'vitest';
import type { SubmitRegistrationRequest, PricingBreakup } from '@smriti/shared';
import { buildInsertSet } from '../registration-insert-set.js';

// ---------------------------------------------------------------------------
// Minimal valid fixtures
// ---------------------------------------------------------------------------

const minimalPricing: PricingBreakup = {
  base: 1000,
  lines: [],
  donation: 0,
  collegeContribution: 500,
  total: 1000,
};

/** Minimal valid request — no optional fields */
const minimalRequest: SubmitRegistrationRequest = {
  contact: {
    fullName: 'Test Alumni',
    branch: 'Computer Science',
    gender: 'male',
    email: 'test@example.com',
    whatsapp: '+919876543210',
    city: 'Kochi',
    country: 'India',
  },
  attendance: {
    intent: 'attending',
    participationType: 'full_celebration',
    alumniMeal: 'veg',
    tshirtSize: 'M',
  },
  attendees: {
    children: [],
    guests: [],
  },
};

const noopIsChargeable = (_age: number) => false;

// ---------------------------------------------------------------------------
// INVARIANT_TOTAL_POSITIVE
// ---------------------------------------------------------------------------

describe('INVARIANT_TOTAL_POSITIVE', () => {
  it('throws when pricing.total is zero', () => {
    const zeroPricing: PricingBreakup = { ...minimalPricing, total: 0 };
    expect(() => buildInsertSet(minimalRequest, 'SMRT0000000000001', zeroPricing, noopIsChargeable))
      .toThrow('Invariant: pricing.total must be > 0');
  });

  it('throws when pricing.total is negative', () => {
    const negativePricing: PricingBreakup = { ...minimalPricing, total: -500 };
    expect(() => buildInsertSet(minimalRequest, 'SMRT0000000000001', negativePricing, noopIsChargeable))
      .toThrow();
  });

  it('does not throw when pricing.total is positive', () => {
    expect(() => buildInsertSet(minimalRequest, 'SMRT0000000000001', minimalPricing, noopIsChargeable))
      .not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// NO_ID_DOC_FLAG
// ---------------------------------------------------------------------------

describe('NO_ID_DOC_FLAG', () => {
  it('registration row does not contain id_doc_uploaded', () => {
    const result = buildInsertSet(minimalRequest, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration).not.toHaveProperty('id_doc_uploaded');
  });

  it('registration row does not contain id_doc_uploaded even when idDocument is present', () => {
    const withDoc: SubmitRegistrationRequest = {
      ...minimalRequest,
      idDocument: { fileKey: 'r2/key', fileType: 'image/jpeg', sizeBytes: 2048, fileName: 'id.jpg', note: '' },
    };
    const result = buildInsertSet(withDoc, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration).not.toHaveProperty('id_doc_uploaded');
  });
});

// ---------------------------------------------------------------------------
// PLACEHOLDER_FKS
// ---------------------------------------------------------------------------

describe('PLACEHOLDER_FKS', () => {
  it('payment row has registration_id = 0', () => {
    const result = buildInsertSet(minimalRequest, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.payment.registration_id).toBe(0);
  });

  it('document row has registration_id = 0', () => {
    const withDoc: SubmitRegistrationRequest = {
      ...minimalRequest,
      idDocument: { fileKey: 'r2/key', fileType: 'image/jpeg', sizeBytes: 2048, fileName: 'id.jpg', note: '' },
    };
    const result = buildInsertSet(withDoc, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.document!.registration_id).toBe(0);
  });

  it('all attendee rows have registration_id = 0', () => {
    const withAttendees: SubmitRegistrationRequest = {
      ...minimalRequest,
      attendees: {
        spouse: { name: 'Spouse Name', meal: 'veg' },
        children: [{ id: 'c1', name: 'Child', age: 8, meal: 'non_veg' }],
        guests: [{ id: 'g1', name: 'Guest', relationship: 'Friend', meal: 'veg' }],
      },
    };
    const result = buildInsertSet(withAttendees, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    for (const attendee of result.attendees) {
      expect(attendee.registration_id).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Document null / non-null
// ---------------------------------------------------------------------------

describe('document field', () => {
  it('is null when idDocument is absent', () => {
    const result = buildInsertSet(minimalRequest, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.document).toBeNull();
  });

  it('is non-null when idDocument is present', () => {
    const withDoc: SubmitRegistrationRequest = {
      ...minimalRequest,
      idDocument: { fileKey: 'r2/abc', fileType: 'application/pdf', sizeBytes: 4096, fileName: 'passport.pdf', note: '' },
    };
    const result = buildInsertSet(withDoc, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.document).not.toBeNull();
  });

  it('document row fields match idDocument input', () => {
    const idDocument = { fileKey: 'r2/abc', fileType: 'application/pdf', sizeBytes: 4096, fileName: 'passport.pdf', note: '' };
    const withDoc: SubmitRegistrationRequest = { ...minimalRequest, idDocument };
    const result = buildInsertSet(withDoc, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.document).toMatchObject({
      r2_key: idDocument.fileKey,
      mime_type: idDocument.fileType,
      size_bytes: idDocument.sizeBytes,
      file_name: idDocument.fileName,
    });
  });
});

// ---------------------------------------------------------------------------
// Payment always present
// ---------------------------------------------------------------------------

describe('payment always present', () => {
  it('payment is always included in the output', () => {
    const result = buildInsertSet(minimalRequest, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.payment).toBeDefined();
  });

  it('payment.amount equals pricing.total', () => {
    const pricing: PricingBreakup = { ...minimalPricing, total: 2500 };
    const result = buildInsertSet(minimalRequest, 'SMRT0000000000001', pricing, noopIsChargeable);
    expect(result.payment.amount).toBe(2500);
  });

  it('payment.status is payment_pending', () => {
    const result = buildInsertSet(minimalRequest, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.payment.status).toBe('payment_pending');
  });
});

// ---------------------------------------------------------------------------
// Attendee mapping
// ---------------------------------------------------------------------------

describe('attendee mapping', () => {
  it('spouse mapped with type=spouse, is_chargeable=1, age=null', () => {
    const withSpouse: SubmitRegistrationRequest = {
      ...minimalRequest,
      attendees: { ...minimalRequest.attendees, spouse: { name: 'Jane', meal: 'veg' } },
    };
    const result = buildInsertSet(withSpouse, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    const spouse = result.attendees.find(a => a.type === 'spouse');
    expect(spouse).toMatchObject({ type: 'spouse', name: 'Jane', meal: 'veg', is_chargeable: 1, age: null });
  });

  it('no spouse attendee when spouse is absent', () => {
    const result = buildInsertSet(minimalRequest, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.attendees.some(a => a.type === 'spouse')).toBe(false);
  });

  it('child is_chargeable=1 when isChildChargeable returns true', () => {
    const alwaysChargeable = (_age: number) => true;
    const withChild: SubmitRegistrationRequest = {
      ...minimalRequest,
      attendees: { ...minimalRequest.attendees, children: [{ id: 'c1', name: 'Kid', age: 10, meal: 'veg' }] },
    };
    const result = buildInsertSet(withChild, 'SMRT0000000000001', minimalPricing, alwaysChargeable);
    const child = result.attendees.find(a => a.type === 'child');
    expect(child!.is_chargeable).toBe(1);
  });

  it('child is_chargeable=0 when isChildChargeable returns false', () => {
    const neverChargeable = (_age: number) => false;
    const withChild: SubmitRegistrationRequest = {
      ...minimalRequest,
      attendees: { ...minimalRequest.attendees, children: [{ id: 'c1', name: 'Toddler', age: 3, meal: 'veg' }] },
    };
    const result = buildInsertSet(withChild, 'SMRT0000000000001', minimalPricing, neverChargeable);
    const child = result.attendees.find(a => a.type === 'child');
    expect(child!.is_chargeable).toBe(0);
  });

  it('isChildChargeable callback receives the child age', () => {
    const capturedAges: number[] = [];
    const captureAge = (age: number) => { capturedAges.push(age); return false; };
    const withChildren: SubmitRegistrationRequest = {
      ...minimalRequest,
      attendees: {
        ...minimalRequest.attendees,
        children: [
          { id: 'c1', name: 'A', age: 5, meal: 'veg' },
          { id: 'c2', name: 'B', age: 12, meal: 'non_veg' },
        ],
      },
    };
    buildInsertSet(withChildren, 'SMRT0000000000001', minimalPricing, captureAge);
    expect(capturedAges).toEqual([5, 12]);
  });

  it('guest mapped with type=guest, is_chargeable=1', () => {
    const withGuest: SubmitRegistrationRequest = {
      ...minimalRequest,
      attendees: {
        ...minimalRequest.attendees,
        guests: [{ id: 'g1', name: 'Bob', relationship: 'Colleague', meal: 'non_veg' }],
      },
    };
    const result = buildInsertSet(withGuest, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    const guest = result.attendees.find(a => a.type === 'guest');
    expect(guest).toMatchObject({ type: 'guest', name: 'Bob', relationship: 'Colleague', meal: 'non_veg', is_chargeable: 1, age: null });
  });
});

// ---------------------------------------------------------------------------
// String trimming
// ---------------------------------------------------------------------------

describe('string trimming', () => {
  it('mobileAlternate is trimmed', () => {
    const withPadded: SubmitRegistrationRequest = {
      ...minimalRequest,
      contact: { ...minimalRequest.contact, mobileAlternate: '  +91123456789  ' },
    };
    const result = buildInsertSet(withPadded, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.mobile_alternate).toBe('+91123456789');
  });

  it('checkIn is trimmed', () => {
    const withPadded: SubmitRegistrationRequest = {
      ...minimalRequest,
      accommodation: { type: 'shared_double', checkIn: ' 2026-08-14 ', checkOut: '2026-08-16', extraBed: false },
    };
    const result = buildInsertSet(withPadded, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.check_in).toBe('2026-08-14');
  });

  it('checkOut is trimmed', () => {
    const withPadded: SubmitRegistrationRequest = {
      ...minimalRequest,
      accommodation: { type: 'shared_double', checkIn: '2026-08-14', checkOut: ' 2026-08-16 ', extraBed: false },
    };
    const result = buildInsertSet(withPadded, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.check_out).toBe('2026-08-16');
  });

  it('ackDisplayName is trimmed', () => {
    const withPadded: SubmitRegistrationRequest = {
      ...minimalRequest,
      donation: { amount: 500, publicAcknowledgement: true, acknowledgementDisplayName: '  Ravi K  ', felicitationConsent: false },
    };
    const result = buildInsertSet(withPadded, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.ack_display_name).toBe('Ravi K');
  });

  it('idNote is trimmed', () => {
    const withPadded: SubmitRegistrationRequest = {
      ...minimalRequest,
      idDocument: { fileKey: 'r2/key', fileType: 'image/jpeg', sizeBytes: 1024, fileName: 'id.jpg', note: '  passport  ' },
    };
    const result = buildInsertSet(withPadded, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.id_note).toBe('passport');
  });

  it('mobileAlternate becomes null when blank after trim', () => {
    const withBlank: SubmitRegistrationRequest = {
      ...minimalRequest,
      contact: { ...minimalRequest.contact, mobileAlternate: '   ' },
    };
    const result = buildInsertSet(withBlank, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.mobile_alternate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extra_bed field
// ---------------------------------------------------------------------------

describe('extra_bed field', () => {
  it('private + extraBed:true → registration.extra_bed === 1', () => {
    // Catches: buildInsertSet ignores the extraBed flag and always writes 0.
    const data: SubmitRegistrationRequest = {
      ...minimalRequest,
      accommodation: { type: 'private', checkIn: '2026-08-14', checkOut: '2026-08-16', extraBed: true },
    };
    const result = buildInsertSet(data, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.extra_bed).toBe(1);
  });

  it('private + extraBed:false → registration.extra_bed === 0', () => {
    // Catches: buildInsertSet always writes extra_bed=1 regardless of flag.
    const data: SubmitRegistrationRequest = {
      ...minimalRequest,
      accommodation: { type: 'private', checkIn: '2026-08-14', checkOut: '2026-08-16', extraBed: false },
    };
    const result = buildInsertSet(data, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.extra_bed).toBe(0);
  });

  it('shared_double → registration.extra_bed === 0', () => {
    // Catches: generator copies extraBed flag for shared rooms where it has no meaning.
    const data: SubmitRegistrationRequest = {
      ...minimalRequest,
      accommodation: { type: 'shared_double', checkIn: '2026-08-14', checkOut: '2026-08-16', extraBed: false },
    };
    const result = buildInsertSet(data, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.extra_bed).toBe(0);
  });

  it('shared_triple → registration.extra_bed === 0', () => {
    const data: SubmitRegistrationRequest = {
      ...minimalRequest,
      accommodation: { type: 'shared_triple', checkIn: '2026-08-14', checkOut: '2026-08-16', extraBed: false },
    };
    const result = buildInsertSet(data, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.extra_bed).toBe(0);
  });

  it('accommodation absent (none path) → registration.accommodation === none and extra_bed === 0', () => {
    // Catches: generator omits extra_bed for the none path, leaving it undefined.
    const result = buildInsertSet(minimalRequest, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.accommodation).toBe('none');
    expect(result.registration.extra_bed).toBe(0);
  });

  it('accommodation type is written through correctly for all four new enum values', () => {
    // Catches: generator maps new types back to stale "shared"/"single" values.
    const types: Array<'private' | 'shared_double' | 'shared_triple'> = ['private', 'shared_double', 'shared_triple'];
    for (const type of types) {
      const data: SubmitRegistrationRequest = {
        ...minimalRequest,
        accommodation: { type, checkIn: '2026-08-14', checkOut: '2026-08-16', extraBed: false },
      };
      const result = buildInsertSet(data, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
      expect(result.registration.accommodation).toBe(type);
    }
  });
});
