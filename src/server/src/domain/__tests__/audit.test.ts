import { describe, it, expect } from 'vitest';
import { computeDiff, createSnapshot } from '../audit.js';
import type { Registration, Attendee } from '../types.js';
import type { PricingBreakup } from '@smriti/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePricingSnapshot(base = 2500): PricingBreakup {
  return {
    base,
    lines: [{ label: 'Alumni base fee', fee: base, free: false }],
    donation: 0,
    collegeContribution: 500,
    total: base,
  };
}

function makeRegistration(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 1,
    regCode: 'ABCDEFGH1234',
    status: 'pending',
    fullName: 'Rajesh Kumar',
    branch: 'CSE',
    email: 'rajesh@example.com',
    whatsapp: '9876543210',
    mobileAlternate: null,
    city: 'Trivandrum',
    country: 'India',
    attendanceIntent: 'attending',
    participationType: 'full_celebration',
    gender: null,
    tshirtSize: null,
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
    pricingSnapshot: makePricingSnapshot(),
    totalAmount: 2500,
    idNote: null,
    photoFileKey: null,
    photoThumbKey: null,
    createdAt: 1747569600000,
    updatedAt: 1747569600000,
    ...overrides,
  };
}

function makeAttendee(overrides: Partial<Attendee> = {}): Attendee {
  return {
    id: 10,
    registrationId: 1,
    type: 'spouse',
    name: 'Priya Kumar',
    age: null,
    relationship: null,
    meal: 'veg',
    isChargeable: true,
    createdAt: 1747569600000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeDiff
// ---------------------------------------------------------------------------

describe('computeDiff — field changes', () => {
  it('detects a changed fullName and records old and new values', () => {
    const before = makeRegistration({ fullName: 'Rajesh Kumar' });
    const after = makeRegistration({ fullName: 'Rajesh K. Nair' });

    const diff = computeDiff(before, after);

    expect(diff).toHaveProperty('fullName');
    expect(diff['fullName']).toEqual({ old: 'Rajesh Kumar', new: 'Rajesh K. Nair' });
  });

  it('detects a status change', () => {
    const before = makeRegistration({ status: 'pending' });
    const after = makeRegistration({ status: 'confirmed' });

    const diff = computeDiff(before, after);

    expect(diff['status']).toEqual({ old: 'pending', new: 'confirmed' });
  });

  it('returns empty object when no fields changed', () => {
    const reg = makeRegistration();
    const diff = computeDiff(reg, { ...reg });

    expect(diff).toEqual({});
  });

  it('records multiple changed fields simultaneously', () => {
    const before = makeRegistration({ city: 'Trivandrum', alumniMeal: 'veg' });
    const after = makeRegistration({ city: 'Kochi', alumniMeal: 'non_veg' });

    const diff = computeDiff(before, after);

    expect(diff['city']).toEqual({ old: 'Trivandrum', new: 'Kochi' });
    expect(diff['alumniMeal']).toEqual({ old: 'veg', new: 'non_veg' });
  });
});

describe('computeDiff — null transitions (DIFF_HANDLES_NULLS)', () => {
  it('records null→value transition for mobileAlternate', () => {
    const before = makeRegistration({ mobileAlternate: null });
    const after = makeRegistration({ mobileAlternate: '1234567890' });

    const diff = computeDiff(before, after);

    expect(diff['mobileAlternate']).toEqual({ old: null, new: '1234567890' });
  });

  it('records value→null transition for mobileAlternate', () => {
    const before = makeRegistration({ mobileAlternate: '1234567890' });
    const after = makeRegistration({ mobileAlternate: null });

    const diff = computeDiff(before, after);

    expect(diff['mobileAlternate']).toEqual({ old: '1234567890', new: null });
  });

  it('records null→value for ackDisplayName', () => {
    const before = makeRegistration({ ackDisplayName: null });
    const after = makeRegistration({ ackDisplayName: 'Rajesh & Family' });

    const diff = computeDiff(before, after);

    expect(diff['ackDisplayName']).toEqual({ old: null, new: 'Rajesh & Family' });
  });
});

describe('computeDiff — updatedAt is ignored', () => {
  it('does not include updatedAt even when it differs', () => {
    const before = makeRegistration({ updatedAt: 1747569600000 });
    const after = makeRegistration({ updatedAt: 1747575000000 });

    const diff = computeDiff(before, after);

    expect(diff).not.toHaveProperty('updatedAt');
    expect(diff).toEqual({});
  });
});

describe('computeDiff — pricingSnapshot compared by value', () => {
  it('detects changed pricingSnapshot when base fee changes', () => {
    const before = makeRegistration({ pricingSnapshot: makePricingSnapshot(2500) });
    const after = makeRegistration({ pricingSnapshot: makePricingSnapshot(3000) });

    const diff = computeDiff(before, after);

    expect(diff['pricingSnapshot']).toBeDefined();
    expect(diff['pricingSnapshot'].old).toEqual(makePricingSnapshot(2500));
    expect(diff['pricingSnapshot'].new).toEqual(makePricingSnapshot(3000));
  });

  it('does not flag pricingSnapshot when structurally equal objects are passed', () => {
    // Two separate object instances with identical content must NOT produce a diff
    const before = makeRegistration({ pricingSnapshot: makePricingSnapshot(2500) });
    const after = makeRegistration({ pricingSnapshot: makePricingSnapshot(2500) });

    const diff = computeDiff(before, after);

    expect(diff).not.toHaveProperty('pricingSnapshot');
  });
});

// ---------------------------------------------------------------------------
// createSnapshot — SNAPSHOT_SHAPE
// ---------------------------------------------------------------------------

describe('createSnapshot', () => {
  it('returns a valid JSON string', () => {
    const reg = makeRegistration();
    const snapshot = createSnapshot(reg, []);

    expect(() => JSON.parse(snapshot)).not.toThrow();
  });

  it('snapshot contains registration fields', () => {
    const reg = makeRegistration({ fullName: 'Rajesh Kumar', email: 'rajesh@example.com' });
    const parsed = JSON.parse(createSnapshot(reg, [])) as { registration: Registration };

    expect(parsed.registration.fullName).toBe('Rajesh Kumar');
    expect(parsed.registration.email).toBe('rajesh@example.com');
  });

  it('snapshot contains boolean values (not integers) for boolean fields', () => {
    const reg = makeRegistration({ publicAck: true, felicitation: false });
    const parsed = JSON.parse(createSnapshot(reg, [])) as { registration: Registration };

    // These must be actual booleans — if they were 0/1 integers, the test would fail
    expect(parsed.registration.publicAck).toBe(true);
    expect(typeof parsed.registration.publicAck).toBe('boolean');

    expect(parsed.registration.felicitation).toBe(false);
    expect(typeof parsed.registration.felicitation).toBe('boolean');
  });

  it('snapshot contains attendees array', () => {
    const reg = makeRegistration();
    const attendees = [makeAttendee(), makeAttendee({ id: 11, type: 'child', name: 'Arjun', age: 8 })];
    const parsed = JSON.parse(createSnapshot(reg, attendees)) as { registration: Registration; attendees: Attendee[] };

    expect(Array.isArray(parsed.attendees)).toBe(true);
    expect(parsed.attendees).toHaveLength(2);
    expect(parsed.attendees[0].type).toBe('spouse');
    expect(parsed.attendees[1].type).toBe('child');
  });

  it('snapshot contains parsed pricingSnapshot object (not a double-encoded JSON string)', () => {
    const pricing = makePricingSnapshot(3500);
    const reg = makeRegistration({ pricingSnapshot: pricing });
    const parsed = JSON.parse(createSnapshot(reg, [])) as { registration: Registration };

    // pricingSnapshot must be an object, not a string
    expect(typeof parsed.registration.pricingSnapshot).toBe('object');
    expect(parsed.registration.pricingSnapshot).not.toBeNull();
    expect(parsed.registration.pricingSnapshot.base).toBe(3500);
    expect(parsed.registration.pricingSnapshot.total).toBe(3500);

    // Definitively: if it were double-encoded, this would be a string, not an object
    expect(typeof parsed.registration.pricingSnapshot).not.toBe('string');
  });

  it('snapshot with empty attendees array is still valid', () => {
    const reg = makeRegistration();
    const parsed = JSON.parse(createSnapshot(reg, [])) as { registration: Registration; attendees: Attendee[] };

    expect(parsed.attendees).toEqual([]);
  });

  it('attendee isChargeable is a boolean in the snapshot, not an integer', () => {
    // Generator exploit: skip attendee field coercion in snapshot — pass raw row
    // shapes where isChargeable is 0 or 1. The contract says snapshot captures
    // parsed domain types.
    const reg = makeRegistration();
    const attendees = [
      makeAttendee({ isChargeable: true }),
      makeAttendee({ id: 11, isChargeable: false }),
    ];
    const parsed = JSON.parse(createSnapshot(reg, attendees)) as { attendees: Attendee[] };

    expect(typeof parsed.attendees[0].isChargeable).toBe('boolean');
    expect(parsed.attendees[0].isChargeable).toBe(true);
    expect(typeof parsed.attendees[1].isChargeable).toBe('boolean');
    expect(parsed.attendees[1].isChargeable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeDiff — createdAt IS included (only updatedAt is excluded)
// ---------------------------------------------------------------------------

describe('computeDiff — createdAt is included (only updatedAt excluded)', () => {
  it('includes createdAt in diff when it changes', () => {
    // The contract says DIFF_IGNORES_UPDATED_AT — updatedAt only.
    // createdAt is immutable in practice, but the contract does not exclude it.
    // Generator exploit: exclude all timestamp fields from the diff.
    // This test catches an over-broad exclusion.
    const before = makeRegistration({ createdAt: 1747569600000 });
    const after = makeRegistration({ createdAt: 1747656000000 });

    const diff = computeDiff(before, after);

    expect(diff).toHaveProperty('createdAt');
    expect(diff['createdAt']).toEqual({
      old: 1747569600000,
      new: 1747656000000,
    });
  });
});

// ---------------------------------------------------------------------------
// computeDiff — pricingSnapshot: identical object reference vs identical values
// ---------------------------------------------------------------------------

describe('computeDiff — pricingSnapshot deep equality for all fields', () => {
  it('does not flag pricingSnapshot when donation field is also identical', () => {
    // Generator exploit: compare only top-level keys (base, total) — skip `lines`
    // and `donation`. If the generator uses a shallow JSON comparison that only
    // checks base/total, a diff with changed donation would be missed.
    const pricingA: PricingBreakup = {
      base: 2500,
      lines: [{ label: 'Alumni base fee', fee: 2500, free: false }],
      donation: 500,
      collegeContribution: 500,
      total: 3000,
    };
    const pricingB: PricingBreakup = {
      base: 2500,
      lines: [{ label: 'Alumni base fee', fee: 2500, free: false }],
      donation: 500,
      collegeContribution: 500,
      total: 3000,
    };

    const before = makeRegistration({ pricingSnapshot: pricingA });
    const after = makeRegistration({ pricingSnapshot: pricingB });

    const diff = computeDiff(before, after);

    expect(diff).not.toHaveProperty('pricingSnapshot');
  });

  it('detects pricingSnapshot change when only donation amount differs', () => {
    // Generator exploit: compare only base and total fields. A donation change
    // would be missed if the generator strips donation from the JSON comparison.
    const pricingBefore: PricingBreakup = {
      base: 2500,
      lines: [{ label: 'Alumni base fee', fee: 2500, free: false }],
      donation: 0,
      collegeContribution: 500,
      total: 2500,
    };
    const pricingAfter: PricingBreakup = {
      base: 2500,
      lines: [{ label: 'Alumni base fee', fee: 2500, free: false }],
      donation: 1000,
      collegeContribution: 500,
      total: 3500,
    };

    const before = makeRegistration({ pricingSnapshot: pricingBefore });
    const after = makeRegistration({ pricingSnapshot: pricingAfter });

    const diff = computeDiff(before, after);

    expect(diff).toHaveProperty('pricingSnapshot');
  });

  it('detects pricingSnapshot change when only a line item label differs', () => {
    // Generator exploit: ignore `lines` array in comparison. The line label
    // is part of what the user saw — a change must be recorded.
    const pricingBefore: PricingBreakup = {
      base: 2500,
      lines: [{ label: 'Alumni base fee', fee: 2500, free: false }],
      donation: 0,
      collegeContribution: 500,
      total: 2500,
    };
    const pricingAfter: PricingBreakup = {
      base: 2500,
      lines: [{ label: 'Revised alumni fee', fee: 2500, free: false }],
      donation: 0,
      collegeContribution: 500,
      total: 2500,
    };

    const before = makeRegistration({ pricingSnapshot: pricingBefore });
    const after = makeRegistration({ pricingSnapshot: pricingAfter });

    const diff = computeDiff(before, after);

    expect(diff).toHaveProperty('pricingSnapshot');
  });
});

// ---------------------------------------------------------------------------
// computeDiff — DIFF_HANDLES_NULLS: boolean field null transitions
// (boolean fields cannot actually be null per the type, but verify other
// nullable fields — checkIn, checkOut — are handled correctly)
// ---------------------------------------------------------------------------

describe('computeDiff — null transitions for accommodation fields', () => {
  it('records null→value for checkIn', () => {
    const before = makeRegistration({ checkIn: null });
    const after = makeRegistration({ checkIn: '2026-08-15' });

    const diff = computeDiff(before, after);

    expect(diff['checkIn']).toEqual({ old: null, new: '2026-08-15' });
  });

  it('records value→null for checkOut', () => {
    const before = makeRegistration({ checkOut: '2026-08-17' });
    const after = makeRegistration({ checkOut: null });

    const diff = computeDiff(before, after);

    expect(diff['checkOut']).toEqual({ old: '2026-08-17', new: null });
  });

  it('does not record null→null as a change for optional fields', () => {
    // Generator exploit: treat null !== null as a change when comparing
    // reference equality on null values (unlikely, but tests the guarantee).
    const before = makeRegistration({ mobileAlternate: null, checkIn: null });
    const after = makeRegistration({ mobileAlternate: null, checkIn: null });

    const diff = computeDiff(before, after);

    expect(diff).not.toHaveProperty('mobileAlternate');
    expect(diff).not.toHaveProperty('checkIn');
  });
});
