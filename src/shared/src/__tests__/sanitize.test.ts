/**
 * Unit tests for sanitizeRegistration() from sanitize.ts.
 *
 * Verifies that fields not applicable to a participationType are stripped,
 * applicable fields are preserved unchanged, and the function is idempotent.
 *
 * No React, no server, no mocks — pure function tests.
 */

import { describe, it, expect } from "vitest";
import { sanitizeRegistration } from "../sanitize.ts";
import type { Registration } from "../types.ts";

// =============================================================================
// HELPERS
// =============================================================================

function makeFullRegistration(overrides: Partial<Registration> = {}): Registration {
  return {
    contact: {
      fullName: "Mangalasseri Neelakantan",
      branch: "Computer Science & Engineering",
      gender: "male",
      email: "neelakantan@example.com",
      whatsapp: "+919876543210",
      city: "Kochi",
      country: "India",
    },
    attendance: {
      intent: "attending",
      participationType: "full_celebration",
      alumniMeal: "non_veg",
      tshirtSize: "L",
    },
    attendees: {
      spouse: { name: "Priya", meal: "veg" },
      children: [{ id: "c1", name: "Arjun", age: 8, meal: "non_veg" }],
      guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
    },
    accommodation: {
      type: "private",
      checkIn: "2026-08-14",
      checkOut: "2026-08-16",
      extraBed: true,
    },
    donation: {
      amount: 1000,
      publicAcknowledgement: true,
      felicitationConsent: false,
    },
    contributionSplits: { green_energy: 500 },
    ...overrides,
  };
}

// =============================================================================
// full_celebration — passthrough (no stripping)
// =============================================================================

describe("sanitizeRegistration — full_celebration", () => {
  it("returns registration unchanged", () => {
    const reg = makeFullRegistration();
    const result = sanitizeRegistration(reg);
    expect(result).toBe(reg); // exact same reference — no copy made
  });

  it("preserves accommodation", () => {
    const reg = makeFullRegistration();
    const result = sanitizeRegistration(reg);
    expect(result.accommodation).toEqual({
      type: "private",
      checkIn: "2026-08-14",
      checkOut: "2026-08-16",
      extraBed: true,
    });
  });

  it("preserves attendees (spouse, children, guests)", () => {
    const reg = makeFullRegistration();
    const result = sanitizeRegistration(reg);
    expect(result.attendees.spouse).toEqual({ name: "Priya", meal: "veg" });
    expect(result.attendees.children).toHaveLength(1);
    expect(result.attendees.guests).toHaveLength(1);
  });

  it("preserves contributionSplits", () => {
    const reg = makeFullRegistration();
    const result = sanitizeRegistration(reg);
    expect(result.contributionSplits).toEqual({ green_energy: 500 });
  });

  it("preserves contact info", () => {
    const reg = makeFullRegistration();
    const result = sanitizeRegistration(reg);
    expect(result.contact.email).toBe("neelakantan@example.com");
    expect(result.contact.fullName).toBe("Mangalasseri Neelakantan");
  });
});

// =============================================================================
// campus_only — strips accommodation only
// =============================================================================

describe("sanitizeRegistration — campus_only", () => {
  function makeCampusRegistration(overrides: Partial<Registration> = {}): Registration {
    return makeFullRegistration({
      attendance: {
        intent: "attending",
        participationType: "campus_only",
        alumniMeal: "non_veg",
        tshirtSize: "L",
      },
      ...overrides,
    });
  }

  it("sets accommodation to undefined", () => {
    const reg = makeCampusRegistration({
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    });
    const result = sanitizeRegistration(reg);
    expect(result.accommodation).toBeUndefined();
  });

  it("preserves attendees — spouse", () => {
    const reg = makeCampusRegistration();
    const result = sanitizeRegistration(reg);
    expect(result.attendees.spouse).toEqual({ name: "Priya", meal: "veg" });
  });

  it("preserves attendees — children", () => {
    const reg = makeCampusRegistration();
    const result = sanitizeRegistration(reg);
    expect(result.attendees.children).toHaveLength(1);
    expect(result.attendees.children[0].name).toBe("Arjun");
  });

  it("preserves attendees — guests", () => {
    const reg = makeCampusRegistration();
    const result = sanitizeRegistration(reg);
    expect(result.attendees.guests).toHaveLength(1);
    expect(result.attendees.guests[0].name).toBe("Ravi");
  });

  it("preserves contributionSplits", () => {
    const reg = makeCampusRegistration();
    const result = sanitizeRegistration(reg);
    expect(result.contributionSplits).toEqual({ green_energy: 500 });
  });

  it("preserves contact info", () => {
    const reg = makeCampusRegistration();
    const result = sanitizeRegistration(reg);
    expect(result.contact.email).toBe("neelakantan@example.com");
  });

  it("result with no accommodation input also yields undefined accommodation", () => {
    const reg = makeCampusRegistration({ accommodation: undefined });
    const result = sanitizeRegistration(reg);
    expect(result.accommodation).toBeUndefined();
  });
});

// =============================================================================
// donation_only — strips attendees, accommodation, and collegeContribution
// =============================================================================

describe("sanitizeRegistration — donation_only", () => {
  function makeDonationRegistration(overrides: Partial<Registration> = {}): Registration {
    return makeFullRegistration({
      attendance: {
        intent: "donation_only",
        participationType: "donation_only",
        alumniMeal: "non_veg",
        tshirtSize: "L",
      },
      ...overrides,
    });
  }

  it("sets attendees to { children: [], guests: [] } — no spouse", () => {
    const reg = makeDonationRegistration();
    const result = sanitizeRegistration(reg);
    expect(result.attendees).toEqual({ children: [], guests: [] });
    expect(result.attendees.spouse).toBeUndefined();
  });

  it("sets accommodation to undefined", () => {
    const reg = makeDonationRegistration({
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    });
    const result = sanitizeRegistration(reg);
    expect(result.accommodation).toBeUndefined();
  });

  it("preserves contributionSplits — donation_only can contribute to college causes", () => {
    const reg = makeDonationRegistration({ contributionSplits: { scholarship: 5000 } });
    const result = sanitizeRegistration(reg);
    expect(result.contributionSplits).toEqual({ scholarship: 5000 });
  });

  it("preserves donation field", () => {
    const reg = makeDonationRegistration({
      donation: { amount: 5000, publicAcknowledgement: true, felicitationConsent: false },
    });
    const result = sanitizeRegistration(reg);
    expect(result.donation).toEqual({
      amount: 5000,
      publicAcknowledgement: true,
      felicitationConsent: false,
    });
  });

  it("preserves contact info", () => {
    const reg = makeDonationRegistration();
    const result = sanitizeRegistration(reg);
    expect(result.contact.fullName).toBe("Mangalasseri Neelakantan");
    expect(result.contact.email).toBe("neelakantan@example.com");
  });

  it("strips spouse even when populated", () => {
    const reg = makeDonationRegistration({
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [{ id: "c1", name: "Arjun", age: 8, meal: "non_veg" }],
        guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
      },
    });
    const result = sanitizeRegistration(reg);
    expect(result.attendees.spouse).toBeUndefined();
    expect(result.attendees.children).toHaveLength(0);
    expect(result.attendees.guests).toHaveLength(0);
  });

  it("no donation input → donation remains undefined", () => {
    const reg = makeDonationRegistration({ donation: undefined });
    const result = sanitizeRegistration(reg);
    expect(result.donation).toBeUndefined();
  });
});

// =============================================================================
// Idempotency
// =============================================================================

describe("sanitizeRegistration — idempotency", () => {
  it("full_celebration: applying twice equals applying once", () => {
    const reg = makeFullRegistration();
    const once = sanitizeRegistration(reg);
    const twice = sanitizeRegistration(once);
    expect(twice).toEqual(once);
  });

  it("campus_only: applying twice equals applying once", () => {
    const reg = makeFullRegistration({
      attendance: {
        intent: "attending",
        participationType: "campus_only",
        alumniMeal: "non_veg",
        tshirtSize: "L",
      },
    });
    const once = sanitizeRegistration(reg);
    const twice = sanitizeRegistration(once);
    expect(twice).toEqual(once);
  });

  it("donation_only: applying twice equals applying once", () => {
    const reg = makeFullRegistration({
      attendance: {
        intent: "donation_only",
        participationType: "donation_only",
        alumniMeal: "non_veg",
        tshirtSize: "L",
      },
      donation: { amount: 2000, publicAcknowledgement: false, felicitationConsent: false },
    });
    const once = sanitizeRegistration(reg);
    const twice = sanitizeRegistration(once);
    expect(twice).toEqual(once);
  });
});

// =============================================================================
// sanitizeRegistration — donation_only preserves contributionSplits (new)
// =============================================================================

describe("sanitizeRegistration — donation_only preserves contributionSplits", () => {
  function makeDonationRegistration(overrides: Partial<Registration> = {}): Registration {
    return {
      contact: {
        fullName: "Georgekutty",
        branch: "Civil Engineering",
        gender: "male",
        email: "geo@example.com",
        whatsapp: "+919876543210",
        city: "Kochi",
        country: "India",
      },
      attendance: {
        intent: "donation_only",
        participationType: "donation_only",
        alumniMeal: "veg",
        tshirtSize: "L",
      },
      attendees: { children: [], guests: [] },
      accommodation: undefined,
      donation: { amount: 0, publicAcknowledgement: false, felicitationConsent: false },
      ...overrides,
    };
  }

  it("donation_only: contributionSplits is preserved after sanitize", () => {
    const reg = makeDonationRegistration({ contributionSplits: { scholarship: 5000 } });
    const result = sanitizeRegistration(reg);
    expect(result.contributionSplits).toEqual({ scholarship: 5000 });
  });

  it("donation_only: attendees still stripped even when contributionSplits present", () => {
    const reg = makeDonationRegistration({
      contributionSplits: { green_energy: 2000 },
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [{ id: "c1", name: "Kid", age: 5, meal: "veg" }],
        guests: [],
      },
    });
    const result = sanitizeRegistration(reg);
    expect(result.attendees.spouse).toBeUndefined();
    expect(result.attendees.children).toHaveLength(0);
    expect(result.contributionSplits).toEqual({ green_energy: 2000 });
  });

  it("donation_only: accommodation stripped even when contributionSplits present", () => {
    const reg = makeDonationRegistration({
      contributionSplits: { scholarship: 3000 },
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    });
    const result = sanitizeRegistration(reg);
    expect(result.accommodation).toBeUndefined();
    expect(result.contributionSplits).toEqual({ scholarship: 3000 });
  });
});
