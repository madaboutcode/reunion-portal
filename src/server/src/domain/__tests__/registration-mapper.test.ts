/**
 * Unit tests for mapToResponse() — registration-mapper.ts
 *
 * Tests every CONTRACT guarantee directly.
 */

import { describe, it, expect } from 'vitest';
import type { PricingBreakup } from '@smriti/shared';
import type { Registration, Attendee, IdDocument } from '../types.js';
import { mapToResponse } from '../registration-mapper.js';

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

const baseReg: Registration = {
  id: 42,
  regCode: 'SMRT0000000000042',
  status: 'pending',
  fullName: 'Test Alumni',
  branch: 'Civil Engineering',
  email: 'test@example.com',
  whatsapp: '+919876543210',
  mobileAlternate: null,
  city: 'Kochi',
  country: 'India',
  attendanceIntent: 'attending',
  participationType: 'full_celebration',
  gender: 'male',
  tshirtSize: 'L',
  alumniMeal: 'veg',
  accommodation: 'none',
  checkIn: null,
  checkOut: null,
  extraBed: false,
  breakfastAdult: 0,
  breakfastChild: 0,
  donationAmount: 0,
  publicAck: false,
  ackDisplayName: null,
  felicitation: false,
  contributionSplits: {},
  pricingSnapshot: minimalPricing,
  totalAmount: 1000,
  idNote: null,
  photoFileKey: null,
  photoThumbKey: null,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

function makeAttendee(overrides: Partial<Attendee>): Attendee {
  return {
    id: 1,
    registrationId: 42,
    type: 'spouse',
    name: null,
    age: null,
    relationship: null,
    meal: 'veg',
    isChargeable: true,
    createdAt: 1700000000000,
    ...overrides,
  };
}

function makeDoc(overrides?: Partial<IdDocument>): IdDocument {
  return {
    id: 1,
    registrationId: 42,
    fileName: 'id.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 2048,
    r2Key: 'r2/abc123',
    createdAt: 1700000000000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// NO_FABRICATED_DEFAULTS
// ---------------------------------------------------------------------------

describe('NO_FABRICATED_DEFAULTS', () => {
  it('null gender is passed through as null, not replaced with prefer_not_to_say', () => {
    const reg: Registration = { ...baseReg, gender: null };
    const result = mapToResponse(reg, [], null);
    expect(result.contact.gender).toBeNull();
  });

  it('null tshirtSize is passed through as null, not replaced with M', () => {
    const reg: Registration = { ...baseReg, tshirtSize: null };
    const result = mapToResponse(reg, [], null);
    expect(result.attendance.tshirtSize).toBeNull();
  });

  it('a real gender value is passed through unchanged', () => {
    const reg: Registration = { ...baseReg, gender: 'female' };
    const result = mapToResponse(reg, [], null);
    expect(result.contact.gender).toBe('female');
  });

  it('a real tshirtSize value is passed through unchanged', () => {
    const reg: Registration = { ...baseReg, tshirtSize: '2XL' };
    const result = mapToResponse(reg, [], null);
    expect(result.attendance.tshirtSize).toBe('2XL');
  });
});

// ---------------------------------------------------------------------------
// DOC_FROM_ROW
// ---------------------------------------------------------------------------

describe('DOC_FROM_ROW', () => {
  it('idDocument is absent when doc param is null', () => {
    const result = mapToResponse(baseReg, [], null);
    expect(result.idDocument).toBeUndefined();
  });

  it('idDocument is present when doc param is non-null', () => {
    const result = mapToResponse(baseReg, [], makeDoc());
    expect(result.idDocument).toBeDefined();
  });

  it('idDocument fields match the doc row', () => {
    const doc = makeDoc({ r2Key: 'r2/xyz', mimeType: 'application/pdf', sizeBytes: 8192, fileName: 'passport.pdf' });
    const reg: Registration = { ...baseReg, idNote: 'back page' };
    const result = mapToResponse(reg, [], doc);
    expect(result.idDocument).toMatchObject({
      fileKey: 'r2/xyz',
      fileType: 'application/pdf',
      sizeBytes: 8192,
      fileName: 'passport.pdf',
      note: 'back page',
    });
  });

  it('idDocument.note is empty string when idNote is null', () => {
    const reg: Registration = { ...baseReg, idNote: null };
    const result = mapToResponse(reg, [], makeDoc());
    expect(result.idDocument!.note).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Attendee grouping
// ---------------------------------------------------------------------------

describe('attendee grouping', () => {
  it('spouse attendee mapped to attendees.spouse', () => {
    const spouse = makeAttendee({ type: 'spouse', name: 'Jane' });
    const result = mapToResponse(baseReg, [spouse], null);
    expect(result.attendees.spouse).toMatchObject({ name: 'Jane', meal: 'veg' });
  });

  it('attendees.spouse is undefined when no spouse attendee', () => {
    const result = mapToResponse(baseReg, [], null);
    expect(result.attendees.spouse).toBeUndefined();
  });

  it('child attendees mapped to attendees.children', () => {
    const child = makeAttendee({ id: 10, type: 'child', name: 'Kid', age: 7, meal: 'non_veg' });
    const result = mapToResponse(baseReg, [child], null);
    expect(result.attendees.children).toHaveLength(1);
    expect(result.attendees.children[0]).toMatchObject({ id: '10', name: 'Kid', age: 7, meal: 'non_veg' });
  });

  it('guest attendees mapped to attendees.guests', () => {
    const guest = makeAttendee({ id: 20, type: 'guest', name: 'Bob', relationship: 'Colleague', meal: 'veg' });
    const result = mapToResponse(baseReg, [guest], null);
    expect(result.attendees.guests).toHaveLength(1);
    expect(result.attendees.guests[0]).toMatchObject({ id: '20', name: 'Bob', relationship: 'Colleague', meal: 'veg' });
  });

  it('attendees of each type are separated correctly when all three types present', () => {
    const spouse = makeAttendee({ id: 1, type: 'spouse', name: 'Spouse' });
    const child = makeAttendee({ id: 2, type: 'child', name: 'Child', age: 8 });
    const guest = makeAttendee({ id: 3, type: 'guest', name: 'Guest', relationship: 'Friend' });
    const result = mapToResponse(baseReg, [spouse, child, guest], null);
    expect(result.attendees.spouse).toBeDefined();
    expect(result.attendees.children).toHaveLength(1);
    expect(result.attendees.guests).toHaveLength(1);
  });

  it('children array is empty when no child attendees', () => {
    const result = mapToResponse(baseReg, [], null);
    expect(result.attendees.children).toEqual([]);
  });

  it('guests array is empty when no guest attendees', () => {
    const result = mapToResponse(baseReg, [], null);
    expect(result.attendees.guests).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Accommodation mapping
// ---------------------------------------------------------------------------

describe('accommodation mapping', () => {
  it('accommodation is absent when type is none', () => {
    const reg: Registration = { ...baseReg, accommodation: 'none' };
    const result = mapToResponse(reg, [], null);
    expect(result.accommodation).toBeUndefined();
  });

  it('accommodation is present when type is shared_double', () => {
    const reg: Registration = { ...baseReg, accommodation: 'shared_double', checkIn: '2026-08-14', checkOut: '2026-08-16', extraBed: false };
    const result = mapToResponse(reg, [], null);
    expect(result.accommodation).toMatchObject({ type: 'shared_double', checkIn: '2026-08-14', checkOut: '2026-08-16', extraBed: false });
  });

  it('accommodation is present when type is shared_triple', () => {
    const reg: Registration = { ...baseReg, accommodation: 'shared_triple', checkIn: '2026-08-14', checkOut: '2026-08-16', extraBed: false };
    const result = mapToResponse(reg, [], null);
    expect(result.accommodation).toMatchObject({ type: 'shared_triple', extraBed: false });
  });

  it('accommodation is present when type is private', () => {
    const reg: Registration = { ...baseReg, accommodation: 'private', checkIn: '2026-08-14', checkOut: '2026-08-16', extraBed: false };
    const result = mapToResponse(reg, [], null);
    expect(result.accommodation).toMatchObject({ type: 'private', extraBed: false });
  });

  it('accommodation.extraBed is true when stored extraBed is true', () => {
    // Catches: mapToResponse omits extraBed from the response object entirely
    // (the stale cast `as 'shared' | 'single'` on the type field also drops extraBed).
    const reg: Registration = { ...baseReg, accommodation: 'private', checkIn: '2026-08-14', checkOut: '2026-08-16', extraBed: true };
    const result = mapToResponse(reg, [], null);
    expect(result.accommodation).toBeDefined();
    expect(result.accommodation!.extraBed).toBe(true);
  });

  it('accommodation.breakfastAdult and breakfastChild pass through the stored counts', () => {
    // Gap: this file previously never varied breakfastAdult/breakfastChild off
    // the baseReg default (0, 0) — the passthrough at registration-mapper.ts
    // lines 75-76 had zero coverage for non-zero values.
    const reg: Registration = {
      ...baseReg,
      accommodation: 'private',
      checkIn: '2026-08-14',
      checkOut: '2026-08-16',
      breakfastAdult: 2,
      breakfastChild: 1,
    };
    const result = mapToResponse(reg, [], null);
    expect(result.accommodation).toMatchObject({ breakfastAdult: 2, breakfastChild: 1 });
  });
});

// ---------------------------------------------------------------------------
// Donation mapping
// ---------------------------------------------------------------------------

describe('donation mapping', () => {
  it('donation is absent when donationAmount is 0', () => {
    const reg: Registration = { ...baseReg, donationAmount: 0 };
    const result = mapToResponse(reg, [], null);
    expect(result.donation).toBeUndefined();
  });

  it('donation is present when donationAmount > 0', () => {
    const reg: Registration = {
      ...baseReg,
      donationAmount: 1000,
      publicAck: true,
      ackDisplayName: 'Ravi K',
      felicitation: false,
    };
    const result = mapToResponse(reg, [], null);
    expect(result.donation).toMatchObject({
      amount: 1000,
      publicAcknowledgement: true,
      acknowledgementDisplayName: 'Ravi K',
      felicitationConsent: false,
    });
  });

  it('donation.acknowledgementDisplayName is undefined when ackDisplayName is null', () => {
    const reg: Registration = {
      ...baseReg,
      donationAmount: 500,
      publicAck: false,
      ackDisplayName: null,
      felicitation: false,
    };
    const result = mapToResponse(reg, [], null);
    expect(result.donation!.acknowledgementDisplayName).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// contributionSplits mapping (GET response persistence-fix companion feature)
// ---------------------------------------------------------------------------
//
// Gap found: every fixture in this file previously used the baseReg default
// of contributionSplits: {} and never overrode it — so the ternary at
// registration-mapper.ts lines 87-89 (`Object.keys(...).length > 0 ? ... :
// undefined`) only ever exercised the empty-object branch. The "GET response
// now returns contributionSplits" feature (the non-empty branch) had zero
// test coverage before this describe block.

describe('contributionSplits mapping', () => {
  it('contributionSplits is undefined when the map is empty', () => {
    const reg: Registration = { ...baseReg, contributionSplits: {} };
    const result = mapToResponse(reg, [], null);
    expect(result.contributionSplits).toBeUndefined();
  });

  it('contributionSplits is present and passed through when the map is non-empty', () => {
    const reg: Registration = { ...baseReg, contributionSplits: { green_energy: 2000 } };
    const result = mapToResponse(reg, [], null);
    expect(result.contributionSplits).toEqual({ green_energy: 2000 });
  });

  it('contributionSplits with multiple causes are all passed through', () => {
    // Catches: generator that only maps the first cause key
    const reg: Registration = { ...baseReg, contributionSplits: { green_energy: 1000, scholarship: 500 } };
    const result = mapToResponse(reg, [], null);
    expect(result.contributionSplits).toEqual({ green_energy: 1000, scholarship: 500 });
  });
});
