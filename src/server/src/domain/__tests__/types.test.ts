import { describe, it, expect } from 'vitest';
import {
  toRegistration,
  toAttendee,
  toAuditEntry,
  type RegistrationRow,
  type AttendeeRow,
  type AuditEntryRow,
} from '../types.js';
import type { PricingBreakup } from '@smriti/shared';

// ---------------------------------------------------------------------------
// Minimal RegistrationRow factory — only fields needed for coercion tests.
// We set every required field to avoid TS errors, but the tests only assert
// on the fields that involve coercion logic.
// ---------------------------------------------------------------------------

function makeRegistrationRow(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  const snapshot: PricingBreakup = {
    base: 1000,
    lines: [{ label: 'Base fee', fee: 1000, free: false }],
    donation: 0,
    collegeContribution: 500,
    total: 1000,
  };

  return {
    id: 1,
    reg_code: 'ABCDEFGH1234',
    status: 'pending',
    full_name: 'Test User',
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

describe('toRegistration — integer boolean coercion', () => {
  it('coerces public_ack 0 → false', () => {
    const reg = toRegistration(makeRegistrationRow({ public_ack: 0 }));
    expect(reg.publicAck).toBe(false);
  });

  it('coerces public_ack 1 → true', () => {
    const reg = toRegistration(makeRegistrationRow({ public_ack: 1 }));
    expect(reg.publicAck).toBe(true);
  });

  it('coerces felicitation 0 → false', () => {
    const reg = toRegistration(makeRegistrationRow({ felicitation: 0 }));
    expect(reg.felicitation).toBe(false);
  });

  it('coerces felicitation 1 → true', () => {
    const reg = toRegistration(makeRegistrationRow({ felicitation: 1 }));
    expect(reg.felicitation).toBe(true);
  });

  it('coerces extra_bed 0 → extraBed false', () => {
    // Catches: toRegistration omits extraBed or leaves it as a number.
    const reg = toRegistration(makeRegistrationRow({ extra_bed: 0 }));
    expect(reg.extraBed).toBe(false);
    expect(typeof reg.extraBed).toBe('boolean');
  });

  it('coerces extra_bed 1 → extraBed true', () => {
    // Catches: toRegistration omits extraBed or leaves it as a number.
    const reg = toRegistration(makeRegistrationRow({ extra_bed: 1 }));
    expect(reg.extraBed).toBe(true);
    expect(typeof reg.extraBed).toBe('boolean');
  });
});

describe('toRegistration — pricing_snapshot JSON parsing', () => {
  it('parses pricing_snapshot JSON string into PricingBreakup object', () => {
    const snapshot: PricingBreakup = {
      base: 2500,
      lines: [
        { label: 'Alumni base fee', fee: 2500, free: false },
        { label: 'Spouse', fee: 1500, free: false },
      ],
      donation: 500,
      collegeContribution: 500,
      total: 4500,
    };

    const reg = toRegistration(makeRegistrationRow({
      pricing_snapshot: JSON.stringify(snapshot),
      total_amount: 4500,
    }));

    expect(reg.pricingSnapshot).toEqual(snapshot);
    expect(typeof reg.pricingSnapshot).toBe('object');
    expect(reg.pricingSnapshot.base).toBe(2500);
    expect(reg.pricingSnapshot.total).toBe(4500);
    expect(reg.pricingSnapshot.lines).toHaveLength(2);
    expect(reg.pricingSnapshot.donation).toBe(500);
  });

  it('pricing_snapshot is not a raw string on the domain type', () => {
    const snapshot: PricingBreakup = { base: 1000, lines: [], donation: 0, collegeContribution: 500, total: 1000 };
    const reg = toRegistration(makeRegistrationRow({ pricing_snapshot: JSON.stringify(snapshot) }));

    // If this were still a string, the test would fail — proves coercion happened
    expect(typeof reg.pricingSnapshot).not.toBe('string');
  });
});

describe('toAttendee — integer boolean coercion', () => {
  function makeAttendeeRow(overrides: Partial<AttendeeRow> = {}): AttendeeRow {
    return {
      id: 1,
      registration_id: 1,
      type: 'spouse',
      name: 'Spouse Name',
      age: null,
      relationship: null,
      meal: 'veg',
      is_chargeable: 1,
      created_at: 1747569600000,
      ...overrides,
    };
  }

  it('coerces is_chargeable 0 → false', () => {
    const attendee = toAttendee(makeAttendeeRow({ is_chargeable: 0 }));
    expect(attendee.isChargeable).toBe(false);
  });

  it('coerces is_chargeable 1 → true', () => {
    const attendee = toAttendee(makeAttendeeRow({ is_chargeable: 1 }));
    expect(attendee.isChargeable).toBe(true);
  });
});

describe('toAuditEntry — JSON parsing for changes and snapshot', () => {
  function makeAuditEntryRow(overrides: Partial<AuditEntryRow> = {}): AuditEntryRow {
    const snapshotReg = toRegistration(makeRegistrationRow());
    return {
      id: 1,
      registration_id: 1,
      action: 'created',
      actor: 'test@example.com',
      changes: null,
      snapshot: JSON.stringify({ registration: snapshotReg, attendees: [] }),
      created_at: 1747569600000,
      ...overrides,
    };
  }

  it('parses non-null changes JSON into Record<string, { old, new }>', () => {
    const changes = { fullName: { old: 'Alice', new: 'Bob' } };
    const entry = toAuditEntry(makeAuditEntryRow({ action: 'updated', changes: JSON.stringify(changes) }));
    expect(entry.changes).toEqual(changes);
    expect(entry.changes?.fullName.old).toBe('Alice');
    expect(entry.changes?.fullName.new).toBe('Bob');
  });

  it('preserves null changes for created actions', () => {
    const entry = toAuditEntry(makeAuditEntryRow({ action: 'created', changes: null }));
    expect(entry.changes).toBeNull();
  });

  it('parses snapshot JSON into AuditSnapshot with registration and attendees', () => {
    const entry = toAuditEntry(makeAuditEntryRow());
    expect(typeof entry.snapshot).toBe('object');
    expect(entry.snapshot).toHaveProperty('registration');
    expect(entry.snapshot).toHaveProperty('attendees');
    expect(entry.snapshot.registration).toHaveProperty('regCode');
    expect(Array.isArray(entry.snapshot.attendees)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FAILURE BEHAVIOR: malformed JSON throws — contract says "do not swallow parse errors"
// ---------------------------------------------------------------------------

describe('toRegistration — malformed pricing_snapshot throws (FAILURE BEHAVIOR)', () => {
  it('throws a SyntaxError when pricing_snapshot is not valid JSON', () => {
    // Generator exploit: silently return a default or null PricingBreakup instead
    // of throwing. This test catches that.
    expect(() =>
      toRegistration(makeRegistrationRow({ pricing_snapshot: 'not-json' }))
    ).toThrow(SyntaxError);
  });

  it('throws when pricing_snapshot is an empty string', () => {
    expect(() =>
      toRegistration(makeRegistrationRow({ pricing_snapshot: '' }))
    ).toThrow();
  });

  it('throws when pricing_snapshot is a bare number string with trailing garbage', () => {
    expect(() =>
      toRegistration(makeRegistrationRow({ pricing_snapshot: '{base: 1000}' }))
    ).toThrow(SyntaxError);
  });

  it('throws when pricing_snapshot is a truncated JSON object', () => {
    expect(() =>
      toRegistration(makeRegistrationRow({ pricing_snapshot: '{"base": 100' }))
    ).toThrow(SyntaxError);
  });
});

describe('toAuditEntry — malformed snapshot JSON throws (FAILURE BEHAVIOR)', () => {
  it('throws a SyntaxError when snapshot is not valid JSON', () => {
    // Generator exploit: return an empty AuditSnapshot object rather than throwing.
    // This test catches that.
    expect(() =>
      toAuditEntry({
        id: 1,
        registration_id: 1,
        action: 'created',
        actor: null,
        changes: null,
        snapshot: 'not-json',
        created_at: 1747569600000,
      })
    ).toThrow(SyntaxError);
  });

  it('throws when snapshot is a truncated JSON object', () => {
    expect(() =>
      toAuditEntry({
        id: 1,
        registration_id: 1,
        action: 'updated',
        actor: null,
        changes: null,
        snapshot: '{"registration":{',
        created_at: 1747569600000,
      })
    ).toThrow(SyntaxError);
  });
});

describe('toAuditEntry — malformed changes JSON throws (FAILURE BEHAVIOR)', () => {
  it('throws a SyntaxError when changes is non-null but not valid JSON', () => {
    // Generator exploit: return null or {} for changes rather than throwing.
    // The contract says malformed JSON throws — null changes are fine,
    // but a non-null invalid string must throw.
    const snapshotReg = toRegistration(makeRegistrationRow());
    expect(() =>
      toAuditEntry({
        id: 1,
        registration_id: 1,
        action: 'updated',
        actor: 'admin@example.com',
        changes: '{fullName: broken}',      // invalid JSON (unquoted key)
        snapshot: JSON.stringify({ registration: snapshotReg, attendees: [] }),
        created_at: 1747569600000,
      })
    ).toThrow(SyntaxError);
  });
});

// ---------------------------------------------------------------------------
// ROW_COERCION: all three boolean fields simultaneously — all zeros and all ones
// ---------------------------------------------------------------------------

describe('toRegistration — all boolean fields coerced together', () => {
  it('coerces all boolean fields 0→false simultaneously', () => {
    const reg = toRegistration(makeRegistrationRow({
      public_ack: 0,
      felicitation: 0,
    }));
    // Generator exploit: only coerce one field and leave the others as integers.
    // All boolean fields must be boolean false — not 0.
    expect(reg.publicAck).toBe(false);
    expect(reg.felicitation).toBe(false);
    expect(typeof reg.publicAck).toBe('boolean');
    expect(typeof reg.felicitation).toBe('boolean');
  });

  it('coerces all boolean fields 1→true simultaneously', () => {
    const reg = toRegistration(makeRegistrationRow({
      public_ack: 1,
      felicitation: 1,
    }));
    expect(reg.publicAck).toBe(true);
    expect(reg.felicitation).toBe(true);
    expect(typeof reg.publicAck).toBe('boolean');
    expect(typeof reg.felicitation).toBe('boolean');
  });

  it('boolean fields on Registration are never integers (strict type check)', () => {
    const reg = toRegistration(makeRegistrationRow({ public_ack: 1, felicitation: 0 }));
    // If these were integers D1 returned without coercion, === comparison with
    // boolean true/false would fail even though the value is "truthy".
    // Generator exploit: return 1 without converting — passes truthiness checks
    // but fails strict === comparison.
    expect(reg.publicAck === true).toBe(true);
    expect(reg.felicitation === false).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NO_DATE_OBJECTS: timestamps must be epoch ms numbers, not Date objects or strings
// ---------------------------------------------------------------------------

describe('toRegistration — timestamps are epoch ms numbers (NO_DATE_OBJECTS)', () => {
  it('createdAt is a number, not a Date object or string', () => {
    const reg = toRegistration(makeRegistrationRow({ created_at: 1747569600000 }));
    expect(typeof reg.createdAt).toBe('number');
    // Type-level guard: if toRegistration ever returns Date, this line won't compile
    const createdAt: number = reg.createdAt;
    expect(createdAt).toBeTruthy();
  });

  it('updatedAt is a number, not a Date object or string', () => {
    const reg = toRegistration(makeRegistrationRow({ updated_at: 1747575000000 }));
    expect(typeof reg.updatedAt).toBe('number');
    const updatedAt: number = reg.updatedAt;
    expect(updatedAt).toBeTruthy();
  });

  it('preserves the exact epoch ms number without modification', () => {
    const ts = 1747569600000;
    const reg = toRegistration(makeRegistrationRow({ created_at: ts }));
    expect(reg.createdAt).toBe(ts);
  });
});
