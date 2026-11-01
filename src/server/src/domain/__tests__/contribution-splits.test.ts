/**
 * Tests for contribution_splits handling:
 * - buildInsertSet serializes contributionSplits to JSON
 * - toRegistration parses contribution_splits with {} fallback on malformed JSON
 * - mapToResponse emits contributionSplits when non-empty, omits when empty
 *
 * These cover the feature tests required by the plan (phase 5 server tests).
 */

import { describe, it, expect } from 'vitest';
import type { SubmitRegistrationRequest, PricingBreakup } from '@smriti/shared';
import { buildInsertSet } from '../registration-insert-set.js';
import { toRegistration, type RegistrationRow } from '../types.js';
import { mapToResponse } from '../registration-mapper.js';
import type { Registration } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const minimalPricing: PricingBreakup = {
  base: 8500,
  lines: [],
  donation: 0,
  collegeContribution: 5000,
  total: 13500,
};

const donationOnlyPricing: PricingBreakup = {
  base: 0,
  lines: [
    { label: 'Batch Contribution to College — Scholarship Fund', fee: 5000, free: false },
  ],
  donation: 0,
  collegeContribution: 5000,
  total: 5000,
};

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
  attendees: { children: [], guests: [] },
};

const donationOnlyRequest: SubmitRegistrationRequest = {
  contact: {
    fullName: 'Donor Alumni',
    branch: 'Electronics & Communication',
    gender: 'female',
    email: 'donor@example.com',
    whatsapp: '+919812345678',
    city: 'Thrissur',
    country: 'India',
  },
  attendance: {
    intent: 'donation_only',
    participationType: 'donation_only',
    alumniMeal: 'veg',
    tshirtSize: 'M',
  },
  attendees: { children: [], guests: [] },
  contributionSplits: { scholarship: 5000 },
};

function makeRegistrationRow(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  const snapshot: PricingBreakup = {
    base: 1000,
    lines: [],
    donation: 0,
    collegeContribution: 0,
    total: 1000,
  };
  return {
    id: 1,
    reg_code: 'SMRT0000000000001',
    status: 'pending',
    full_name: 'Test Alumni',
    branch: 'CSE',
    email: 'test@example.com',
    whatsapp: '9999999999',
    mobile_alternate: null,
    city: 'Trivandrum',
    country: 'India',
    attendance_intent: 'attending',
    participation_type: 'full_celebration',
    gender: null,
    tshirt_size: null,
    alumni_meal: 'veg',
    accommodation: 'none',
    check_in: null,
    check_out: null,
    extra_bed: 0,
    breakfast_adult: 0,
    breakfast_child: 0,
    donation_amount: 0,
    public_ack: 0,
    ack_display_name: null,
    felicitation: 0,
    contribution_splits: '{}',
    pricing_snapshot: JSON.stringify(snapshot),
    total_amount: 1000,
    id_note: null,
    photo_file_key: null,
    photo_thumb_key: null,
    created_at: 1747569600000,
    updated_at: 1747569600000,
    ...overrides,
  };
}

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
  pricingSnapshot: { base: 1000, lines: [], donation: 0, collegeContribution: 0, total: 1000 },
  totalAmount: 1000,
  idNote: null,
  photoFileKey: null,
  photoThumbKey: null,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

const noopIsChargeable = (_age: number) => false;

// ---------------------------------------------------------------------------
// buildInsertSet — contribution_splits serialization
// ---------------------------------------------------------------------------

describe('buildInsertSet — contribution_splits serialization', () => {
  it('serializes contributionSplits to JSON string when splits are present', () => {
    const requestWithSplits: SubmitRegistrationRequest = {
      ...minimalRequest,
      contributionSplits: { green_energy: 3000 },
    };
    const result = buildInsertSet(requestWithSplits, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.contribution_splits).toBe('{"green_energy":3000}');
  });

  it('serializes empty object when contributionSplits is undefined', () => {
    const result = buildInsertSet(minimalRequest, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.contribution_splits).toBe('{}');
  });

  it('serializes empty object when contributionSplits is explicitly empty', () => {
    const requestEmpty: SubmitRegistrationRequest = {
      ...minimalRequest,
      contributionSplits: {},
    };
    const result = buildInsertSet(requestEmpty, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    expect(result.registration.contribution_splits).toBe('{}');
  });

  it('serializes multiple cause splits correctly', () => {
    const requestMulti: SubmitRegistrationRequest = {
      ...minimalRequest,
      contributionSplits: { green_energy: 2000, scholarship: 3000 },
    };
    const result = buildInsertSet(requestMulti, 'SMRT0000000000001', minimalPricing, noopIsChargeable);
    const parsed = JSON.parse(result.registration.contribution_splits);
    expect(parsed).toEqual({ green_energy: 2000, scholarship: 3000 });
  });

  it('donation_only with only contributionSplits produces valid insert (total = contributions sum)', () => {
    const result = buildInsertSet(donationOnlyRequest, 'SMRT0000000000001', donationOnlyPricing, noopIsChargeable);
    expect(result.registration.contribution_splits).toBe('{"scholarship":5000}');
    expect(result.registration.total_amount).toBe(5000);
    expect(result.registration.donation_amount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toRegistration — contribution_splits parsing
// ---------------------------------------------------------------------------

describe('toRegistration — contribution_splits round-trip', () => {
  it('parses valid JSON map into Record<string, number>', () => {
    const reg = toRegistration(makeRegistrationRow({ contribution_splits: '{"green_energy":3000}' }));
    expect(reg.contributionSplits).toEqual({ green_energy: 3000 });
  });

  it('parses multi-cause splits correctly', () => {
    const reg = toRegistration(makeRegistrationRow({
      contribution_splits: '{"green_energy":2000,"scholarship":3000}',
    }));
    expect(reg.contributionSplits).toEqual({ green_energy: 2000, scholarship: 3000 });
  });

  it('returns {} for an empty JSON object string', () => {
    const reg = toRegistration(makeRegistrationRow({ contribution_splits: '{}' }));
    expect(reg.contributionSplits).toEqual({});
  });

  it('falls back to {} for malformed JSON (FAILURE BEHAVIOR override for this field)', () => {
    // Unlike pricing_snapshot which throws, contribution_splits has a soft fallback
    // so legacy rows or corruption don't break reads.
    const reg = toRegistration(makeRegistrationRow({ contribution_splits: 'not-json' }));
    expect(reg.contributionSplits).toEqual({});
  });

  it('falls back to {} for a truncated JSON object', () => {
    const reg = toRegistration(makeRegistrationRow({ contribution_splits: '{"green_energy":' }));
    expect(reg.contributionSplits).toEqual({});
  });

  it('falls back to {} when contribution_splits is a JSON array (not an object)', () => {
    // Defensive: should not happen in practice but the fallback must guard against it
    const reg = toRegistration(makeRegistrationRow({ contribution_splits: '[1,2,3]' }));
    expect(reg.contributionSplits).toEqual({});
  });

  it('contribution_splits field is always a Record<string, number> on the domain type', () => {
    const reg = toRegistration(makeRegistrationRow({ contribution_splits: '{"scholarship":5000}' }));
    expect(typeof reg.contributionSplits).toBe('object');
    expect(reg.contributionSplits).not.toBeNull();
    expect(Array.isArray(reg.contributionSplits)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mapToResponse — contributionSplits emit/omit
// ---------------------------------------------------------------------------

describe('mapToResponse — contributionSplits emit and omit', () => {
  it('omits contributionSplits from response when map is empty', () => {
    const reg: Registration = { ...baseReg, contributionSplits: {} };
    const result = mapToResponse(reg, [], null);
    expect(result.contributionSplits).toBeUndefined();
  });

  it('emits contributionSplits when non-empty', () => {
    const reg: Registration = { ...baseReg, contributionSplits: { green_energy: 3000 } };
    const result = mapToResponse(reg, [], null);
    expect(result.contributionSplits).toEqual({ green_energy: 3000 });
  });

  it('emits multi-cause splits correctly', () => {
    const reg: Registration = {
      ...baseReg,
      contributionSplits: { green_energy: 2000, scholarship: 3000 },
    };
    const result = mapToResponse(reg, [], null);
    expect(result.contributionSplits).toEqual({ green_energy: 2000, scholarship: 3000 });
  });

  it('emits contributionSplits for a donation_only registration with only splits', () => {
    const donorReg: Registration = {
      ...baseReg,
      attendanceIntent: 'donation_only',
      participationType: 'donation_only',
      donationAmount: 0,
      contributionSplits: { scholarship: 5000 },
      totalAmount: 5000,
    };
    const result = mapToResponse(donorReg, [], null);
    expect(result.contributionSplits).toEqual({ scholarship: 5000 });
    // No donation block since donationAmount is 0
    expect(result.donation).toBeUndefined();
  });
});
