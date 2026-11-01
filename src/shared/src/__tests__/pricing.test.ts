/**
 * Unit tests for calculateTotal() and getAttendeeCounts() from pricing.ts.
 *
 * Tests every line item type, edge cases, and configuration variations
 * directly — not through the service layer or e2e pricing snapshot checks.
 *
 * All tests construct Registration objects and call pricing functions with
 * PRICING_DEFAULTS or custom PricingConfig. No React, no server, no mocks.
 */

import { describe, it, expect } from "vitest";
import { calculateTotal, getAttendeeCounts } from "../pricing.ts";
import { PRICING_DEFAULTS } from "../constants.ts";
import type { PricingConfig, Registration } from "../types.ts";

// =============================================================================
// HELPERS
// =============================================================================

function makeRegistration(overrides: Partial<Registration> = {}): Registration {
  return {
    contact: {
      fullName: "Test User",
      branch: "Computer Science & Engineering",
      gender: "male",
      email: "test@test.com",
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
      spouse: undefined,
      children: [],
      guests: [],
    },
    accommodation: undefined,
    donation: undefined,
    idDocument: undefined,
    ...overrides,
  };
}

function configWithPlatformFee(): PricingConfig {
  return {
    ...PRICING_DEFAULTS,
    platformFeeEnabled: true,
    platformFeeFlat: 50,
    platformFeePercent: 0.02,
  };
}

function configWithAccommodationDisabled(): PricingConfig {
  return { ...PRICING_DEFAULTS, accommodationEnabled: false };
}

// =============================================================================
// calculateTotal — Base Fee (R2)
// =============================================================================

describe("calculateTotal — Base Fee", () => {
  it("charges alumni base fee for attending registrant", () => {
    const reg = makeRegistration();
    const result = calculateTotal(reg);
    expect(result.base).toBe(PRICING_DEFAULTS.alumniBaseFee);
    expect(result.total).toBeGreaterThanOrEqual(PRICING_DEFAULTS.alumniBaseFee);
  });

  it("charges base=0 for donation_only intent (R9.1)", () => {
    const reg = makeRegistration({
      attendance: { intent: "donation_only", participationType: "donation_only", alumniMeal: "non_veg", tshirtSize: "L" },
      donation: { amount: 5000, publicAcknowledgement: false, felicitationConsent: false },
    });
    const result = calculateTotal(reg);
    expect(result.base).toBe(0);
  });
});

// =============================================================================
// calculateTotal — Attendee Charges
// =============================================================================

describe("calculateTotal — Spouse Charge (R3)", () => {
  it("charges additionalPersonFee when spouse is present", () => {
    const reg = makeRegistration({
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const spouseLine = result.lines.find((l) => l.label.includes("Spouse"));
    expect(spouseLine).toBeDefined();
    expect(spouseLine!.fee).toBe(PRICING_DEFAULTS.spouseFee);
    expect(spouseLine!.free).toBe(false);
    expect(spouseLine!.label).toContain("Priya");
  });

  it("does not charge spouse when spouse is undefined (R3 — toggle off)", () => {
    const reg = makeRegistration(); // no spouse
    const result = calculateTotal(reg);
    const spouseLine = result.lines.find((l) => l.label.includes("Spouse"));
    expect(spouseLine).toBeUndefined();
  });

  it("spouse charge line includes spouse name in label", () => {
    const reg = makeRegistration({
      attendees: {
        spouse: { name: "Jane Doe", meal: "non_veg" },
        children: [],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const spouseLine = result.lines.find((l) => l.label.includes("Spouse"));
    expect(spouseLine!.label).toBe("Spouse — Jane Doe · Lunch & Dinner");
  });
});

describe("calculateTotal — Child Charges (R4)", () => {
  it("child under free-age threshold → free line item with fee=0 (R4.1)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Baby", age: 2, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Baby"));
    expect(childLine).toBeDefined();
    expect(childLine!.fee).toBe(0);
    expect(childLine!.free).toBe(true);
  });

  it("child aged 0 (newborn) → free (R4.1 + edge case)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Newborn", age: 0, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Newborn"));
    expect(childLine!.fee).toBe(0);
    expect(childLine!.free).toBe(true);
  });

  it("child aged 5 (just below threshold=6) → free", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Five", age: 5, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Five"));
    expect(childLine!.fee).toBe(0);
    expect(childLine!.free).toBe(true);
  });

  it("child aged exactly 6 (at threshold) → charged at 6-12 rate (R4.2)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Six", age: 6, meal: "non_veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Six"));
    expect(childLine).toBeDefined();
    expect(childLine!.fee).toBe(PRICING_DEFAULTS.childFee6to12);
    expect(childLine!.free).toBe(false);
  });

  it("child 6-12 → charged at half rate (R4.2)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Arjun", age: 10, meal: "non_veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Arjun"));
    expect(childLine!.fee).toBe(PRICING_DEFAULTS.childFee6to12);
    expect(childLine!.free).toBe(false);
  });

  it("child aged 12 (boundary) → charged at 6-12 rate (R4.2)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Twelve", age: 12, meal: "non_veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Twelve"));
    expect(childLine!.fee).toBe(PRICING_DEFAULTS.childFee6to12);
    expect(childLine!.free).toBe(false);
  });

  it("child aged 13+ → charged at full adult rate (R4.2.1)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Teen", age: 13, meal: "non_veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Teen"));
    expect(childLine!.fee).toBe(PRICING_DEFAULTS.childFee12plus);
    expect(childLine!.free).toBe(false);
  });

  it("child label shows name and age (R4.3)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Arjun", age: 8, meal: "non_veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Arjun"));
    expect(childLine!.label).toContain("Arjun");
    expect(childLine!.label).toContain("8 yrs");
  });

  it("unnamed child shows 'Child' with age (R4.3)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "", age: 7, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Child"));
    expect(childLine).toBeDefined();
    expect(childLine!.label).toContain("Child");
    expect(childLine!.label).toContain("7 yrs");
  });

  it("child aged 0 with no name shows 'Child' with no age suffix", () => {
    // age falsy (0) → no age parens in label per `age ? ... : ""`
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "", age: 0, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Child"));
    expect(childLine!.label).toBe("Child · Lunch & Dinner");
  });

  it("multiple children: free, 6-12, and 12+ tiers", () => {
    const reg = makeRegistration({
      attendees: {
        children: [
          { id: "c1", name: "FreeKid", age: 3, meal: "veg" },
          { id: "c2", name: "MidKid", age: 10, meal: "non_veg" },
          { id: "c3", name: "Teen", age: 14, meal: "non_veg" },
        ],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const freeLine = result.lines.find((l) => l.label.includes("FreeKid"));
    const midLine = result.lines.find((l) => l.label.includes("MidKid"));
    const teenLine = result.lines.find((l) => l.label.includes("Teen"));
    expect(freeLine!.fee).toBe(0);
    expect(freeLine!.free).toBe(true);
    expect(midLine!.fee).toBe(PRICING_DEFAULTS.childFee6to12);
    expect(midLine!.free).toBe(false);
    expect(teenLine!.fee).toBe(PRICING_DEFAULTS.childFee12plus);
    expect(teenLine!.free).toBe(false);
  });
});

describe("calculateTotal — Guest Charges (R5)", () => {
  it("charges additionalPersonFee per guest", () => {
    const reg = makeRegistration({
      attendees: {
        children: [],
        guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
      },
    });
    const result = calculateTotal(reg);
    const guestLine = result.lines.find((l) => l.label.includes("Guest"));
    expect(guestLine).toBeDefined();
    expect(guestLine!.fee).toBe(PRICING_DEFAULTS.guestFee);
    expect(guestLine!.free).toBe(false);
  });

  it("named guest label shows 'Guest — <name>'", () => {
    const reg = makeRegistration({
      attendees: {
        children: [],
        guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
      },
    });
    const result = calculateTotal(reg);
    const guestLine = result.lines.find((l) => l.label.includes("Ravi"));
    expect(guestLine!.label).toBe("Guest — Ravi · Lunch & Dinner");
  });

  it("unnamed guest label shows 'Additional Guest'", () => {
    const reg = makeRegistration({
      attendees: {
        children: [],
        guests: [{ id: "g1", name: "", relationship: "", meal: "non_veg" }],
      },
    });
    const result = calculateTotal(reg);
    const guestLine = result.lines.find((l) => l.label.includes("Additional Guest"));
    expect(guestLine).toBeDefined();
  });

  it("multiple guests all charged", () => {
    const reg = makeRegistration({
      attendees: {
        children: [],
        guests: [
          { id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" },
          { id: "g2", name: "Sita", relationship: "Colleague", meal: "non_veg" },
        ],
      },
    });
    const result = calculateTotal(reg);
    const guestLines = result.lines.filter((l) => l.label.includes("Guest"));
    expect(guestLines).toHaveLength(2);
    guestLines.forEach((l) => {
      expect(l.fee).toBe(PRICING_DEFAULTS.guestFee);
      expect(l.free).toBe(false);
    });
  });
});

// =============================================================================
// calculateTotal — Accommodation (R6)
// =============================================================================

describe("calculateTotal — Accommodation Charge (R6)", () => {
  it("shared_double room: charges accommodationSharedDoubleFee per night", () => {
    const reg = makeRegistration({
      accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    });
    const result = calculateTotal(reg);
    const accLine = result.lines.find((l) => l.label.includes("Accommodation"));
    expect(accLine).toBeDefined();
    // 2 nights (Aug 14-16) × 6000 = 12000
    expect(accLine!.fee).toBe(6000 * 2);
    expect(accLine!.free).toBe(false);
    expect(accLine!.label).toContain("Shared Room");
    expect(accLine!.label).toContain("2 nights");
  });

  it("private room: charges accommodationPrivateFee per night", () => {
    const reg = makeRegistration({
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    });
    const result = calculateTotal(reg);
    const accLine = result.lines.find((l) => l.label.includes("Accommodation"));
    expect(accLine!.fee).toBe(12000 * 2);
    expect(accLine!.label).toContain("Private Room");
  });

  it("single night shows '1 night', multiple shows 'N nights'", () => {
    const reg = makeRegistration({
      accommodation: { type: "shared_double", checkIn: "2026-08-15", checkOut: "2026-08-16", extraBed: false },
    });
    const result = calculateTotal(reg);
    const accLine = result.lines.find((l) => l.label.includes("Accommodation"));
    expect(accLine!.label).toContain("1 night");
    expect(accLine!.label).not.toContain("1 nights");
  });

  it("no accommodation object → no accommodation charge (R6.3)", () => {
    const reg = makeRegistration(); // no accommodation
    const result = calculateTotal(reg);
    const accLine = result.lines.find((l) => l.label.includes("Accommodation"));
    expect(accLine).toBeUndefined();
  });

  it("accommodation disabled in config → no charge (R6.3)", () => {
    const reg = makeRegistration({
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    });
    const result = calculateTotal(reg, configWithAccommodationDisabled());
    const accLine = result.lines.find((l) => l.label.includes("Accommodation"));
    expect(accLine).toBeUndefined();
  });

  it("fee=0 in config → no line generated", () => {
    const reg = makeRegistration({
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    });
    const result = calculateTotal(reg, {
      ...PRICING_DEFAULTS,
      accommodationPrivateFee: 0,
    });
    const accLine = result.lines.find((l) => l.label.includes("Accommodation"));
    expect(accLine).toBeUndefined();
  });

  it("missing checkIn/checkOut: defaults to 1 night", () => {
    const reg = makeRegistration({
      accommodation: { type: "shared_double", checkIn: "", checkOut: "", extraBed: false },
    });
    const result = calculateTotal(reg);
    const accLine = result.lines.find((l) => l.label.includes("Accommodation"));
    expect(accLine!.fee).toBe(6000); // 1 night × 6000
    expect(accLine!.label).toContain("1 night");
  });

  it("checkOut same as checkIn: defaults to 1 night", () => {
    const reg = makeRegistration({
      accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-14", extraBed: false },
    });
    const result = calculateTotal(reg);
    const accLine = result.lines.find((l) => l.label.includes("Accommodation"));
    expect(accLine!.fee).toBe(6000);
  });
});

// =============================================================================
// calculateTotal — Donation (R7)
// =============================================================================

describe("calculateTotal — Donation (R7)", () => {
  it("includes donation amount in total", () => {
    const reg = makeRegistration({
      donation: { amount: 500, publicAcknowledgement: false, felicitationConsent: false },
    });
    const result = calculateTotal(reg);
    expect(result.donation).toBe(500);
    // Total includes donation
    expect(result.total).toBe(result.base + result.donation);
  });

  it("no donation → donation=0 (R7)", () => {
    const reg = makeRegistration(); // no donation
    const result = calculateTotal(reg);
    expect(result.donation).toBe(0);
  });

  it("large donation added correctly", () => {
    const reg = makeRegistration({
      donation: { amount: 100000, publicAcknowledgement: true, felicitationConsent: true },
    });
    const result = calculateTotal(reg);
    expect(result.donation).toBe(100000);
  });
});

// =============================================================================
// calculateTotal — Platform Fee (R8)
// =============================================================================

describe("calculateTotal — Platform Fee (R8)", () => {
  it("platform fee disabled by default → no platform fee line (R8.3)", () => {
    const reg = makeRegistration();
    const result = calculateTotal(reg, PRICING_DEFAULTS);
    const pfLine = result.lines.find((l) => l.label === "Platform fee");
    expect(pfLine).toBeUndefined();
  });

  it("platform fee enabled: flat + percentage of pre-pf subtotal (R8.1)", () => {
    const config = configWithPlatformFee(); // flat=50, percent=0.02
    const reg = makeRegistration(); // base=8500, no other charges
    const result = calculateTotal(reg, config);
    const pfLine = result.lines.find((l) => l.label === "Platform fee");
    expect(pfLine).toBeDefined();
    // subtotal before PF = 8500. PF = 50 + 8500*0.02 = 50 + 170 = 220
    expect(pfLine!.fee).toBe(220);
    expect(pfLine!.free).toBe(false);
  });

  it("platform fee calculated on subtotal BEFORE platform fee (not including itself)", () => {
    const config = configWithPlatformFee();
    const reg = makeRegistration({
      attendees: {
        children: [
          { id: "c1", name: "Kid", age: 10, meal: "veg" },
        ],
        guests: [],
      },
    });
    // Subtotal before PF: base(8500) + child 6-12(1455) = 9955
    // PF: 50 + 9955*0.02 = 50 + 199.1 = 249.1
    const result = calculateTotal(reg, config);
    const pfLine = result.lines.find((l) => l.label === "Platform fee");
    expect(pfLine!.fee).toBeCloseTo(249.1, 5);
  });

  it("platform fee with zero flat and zero percent → no line (fee=0)", () => {
    const config: PricingConfig = {
      ...PRICING_DEFAULTS,
      platformFeeEnabled: true,
      platformFeeFlat: 0,
      platformFeePercent: 0,
    };
    const reg = makeRegistration();
    const result = calculateTotal(reg, config);
    const pfLine = result.lines.find((l) => l.label === "Platform fee");
    expect(pfLine).toBeUndefined();
  });

  it("platform fee includes flat component even with 0% percent", () => {
    const config: PricingConfig = {
      ...PRICING_DEFAULTS,
      platformFeeEnabled: true,
      platformFeeFlat: 100,
      platformFeePercent: 0,
    };
    const reg = makeRegistration();
    const result = calculateTotal(reg, config);
    const pfLine = result.lines.find((l) => l.label === "Platform fee");
    expect(pfLine!.fee).toBe(100);
  });
});

// =============================================================================
// calculateTotal — Donation-Only (R9)
// =============================================================================

describe("calculateTotal — Donation-Only (R9)", () => {
  it("returns only donation: base=0, lines=[], total=donation (R9.1-R9.4)", () => {
    const reg = makeRegistration({
      attendance: { intent: "donation_only", participationType: "donation_only", alumniMeal: "non_veg", tshirtSize: "L" },
      donation: { amount: 2000, publicAcknowledgement: true, felicitationConsent: false },
    });
    const result = calculateTotal(reg);
    expect(result.base).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.donation).toBe(2000);
    expect(result.total).toBe(2000);
  });

  it("donation_only with no donation → donation=0, total=0", () => {
    const reg = makeRegistration({
      attendance: { intent: "donation_only", participationType: "donation_only", alumniMeal: "non_veg", tshirtSize: "L" },
    });
    const result = calculateTotal(reg);
    expect(result.base).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.donation).toBe(0);
    expect(result.total).toBe(0);
  });

  it("donation_only ignores spouse/children/guests/accommodation entirely (R9.2)", () => {
    const reg = makeRegistration({
      attendance: { intent: "donation_only", participationType: "donation_only", alumniMeal: "non_veg", tshirtSize: "L" },
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [{ id: "c1", name: "Arjun", age: 10, meal: "non_veg" }],
        guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
      },
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      donation: { amount: 1000, publicAcknowledgement: false, felicitationConsent: false },
    });
    const result = calculateTotal(reg);
    expect(result.base).toBe(0);
    expect(result.lines).toEqual([]); // no attendee/accommodation lines
    expect(result.donation).toBe(1000);
    expect(result.total).toBe(1000);
  });
});

// =============================================================================
// calculateTotal — Total (R10)
// =============================================================================

describe("calculateTotal — Total (R10)", () => {
  it("total = base + all attendee charges + accommodation (incl GST) + platform fee + donation", () => {
    // Tests the structural invariant: total === base + sum(lines) + donation.
    // Exact accommodation value is tested in pricing-accommodation.test.ts (§7 oracle).
    const config = configWithPlatformFee();
    const reg = makeRegistration({
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [{ id: "c1", name: "Arjun", age: 10, meal: "non_veg" }],
        guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
      },
      accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      donation: { amount: 500, publicAcknowledgement: false, felicitationConsent: false },
    });
    const result = calculateTotal(reg, config);

    const lineSum = result.lines.reduce((s, l) => s + l.fee, 0);
    expect(result.total).toBe(result.base + lineSum + result.donation);
    // total must be greater than base alone (attendees, accommodation, GST, PF, donation all add)
    expect(result.total).toBeGreaterThan(PRICING_DEFAULTS.alumniBaseFee);
  });

  it("bare minimum registration: total = base fee only", () => {
    const reg = makeRegistration();
    const result = calculateTotal(reg);
    expect(result.total).toBe(PRICING_DEFAULTS.alumniBaseFee);
    expect(result.base).toBe(PRICING_DEFAULTS.alumniBaseFee);
    expect(result.donation).toBe(0);
    expect(result.lines).toHaveLength(0);
  });

  it("total with no donation: total = base + lines sum only", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Kid", age: 8, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const lineSum = result.lines.reduce((s, l) => s + l.fee, 0);
    expect(result.total).toBe(result.base + lineSum + 0);
    expect(result.donation).toBe(0);
  });
});

// =============================================================================
// calculateTotal — Free Items (R4.1)
// =============================================================================

describe("calculateTotal — Free Item Marking", () => {
  it("free child is marked free: true", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Baby", age: 2, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Baby"));
    expect(childLine!.free).toBe(true);
    expect(childLine!.fee).toBe(0);
  });

  it("spouse and guests are never marked free: false", () => {
    const reg = makeRegistration({
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [],
        guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
      },
    });
    const result = calculateTotal(reg);
    const spouseLine = result.lines.find((l) => l.label.includes("Spouse"));
    const guestLine = result.lines.find((l) => l.label.includes("Guest"));
    expect(spouseLine!.free).toBe(false);
    expect(guestLine!.free).toBe(false);
  });
});

// =============================================================================
// getAttendeeCounts — Meal & Headcount Summary (R11)
// =============================================================================

describe("getAttendeeCounts — Meal & Headcount Summary (R11)", () => {
  it("counts primary registrant with their meal preference (R11.1)", () => {
    const reg = makeRegistration({
      attendance: { intent: "attending", participationType: "full_celebration", alumniMeal: "non_veg", tshirtSize: "L" },
    });
    const counts = getAttendeeCounts(reg);
    expect(counts.veg).toBe(0);
    expect(counts.nonveg).toBe(1);
    expect(counts.total).toBe(1);
  });

  it("counts alumni with veg meal", () => {
    const reg = makeRegistration({
      attendance: { intent: "attending", participationType: "full_celebration", alumniMeal: "veg", tshirtSize: "L" },
    });
    const counts = getAttendeeCounts(reg);
    expect(counts.veg).toBe(1);
    expect(counts.nonveg).toBe(0);
  });

  it("counts spouse only when present (R11.2)", () => {
    const reg = makeRegistration({
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [],
        guests: [],
      },
    });
    const counts = getAttendeeCounts(reg);
    expect(counts.veg).toBe(1); // spouse veg only (alumni is non_veg)
    expect(counts.nonveg).toBe(1); // alumni non_veg
    expect(counts.total).toBe(2);
  });

  it("counts all children regardless of age/free status (R11.3)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [
          { id: "c1", name: "Baby", age: 2, meal: "veg" },   // free
          { id: "c2", name: "Teen", age: 13, meal: "non_veg" }, // charged
        ],
        guests: [],
      },
    });
    const counts = getAttendeeCounts(reg);
    // alumni non_veg + Baby veg + Teen non_veg
    expect(counts.veg).toBe(1);
    expect(counts.nonveg).toBe(2);
    expect(counts.total).toBe(3);
  });

  it("counts all guests (R11.4)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [],
        guests: [
          { id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" },
          { id: "g2", name: "Sita", relationship: "Colleague", meal: "non_veg" },
        ],
      },
    });
    const counts = getAttendeeCounts(reg);
    // alumni non_veg + Ravi veg + Sita non_veg
    expect(counts.veg).toBe(1);
    expect(counts.nonveg).toBe(2);
    expect(counts.total).toBe(3);
  });

  it("full family: alumni + spouse + 2 children + 1 guest → correct counts", () => {
    const reg = makeRegistration({
      attendance: { intent: "attending", participationType: "full_celebration", alumniMeal: "non_veg", tshirtSize: "L" },
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [
          { id: "c1", name: "Arjun", age: 10, meal: "non_veg" },
          { id: "c2", name: "Meera", age: 4, meal: "veg" },
        ],
        guests: [
          { id: "g1", name: "Ravi", relationship: "Friend", meal: "non_veg" },
        ],
      },
    });
    const counts = getAttendeeCounts(reg);
    // alumni: non_veg(1)
    // spouse: veg(1)
    // Arjun: non_veg(2)
    // Meera: veg(2)
    // Ravi: non_veg(3)
    expect(counts.veg).toBe(2);
    expect(counts.nonveg).toBe(3);
    expect(counts.total).toBe(5);
  });

  it("donation_only → headcount is zero (R11.5)", () => {
    const reg = makeRegistration({
      attendance: { intent: "donation_only", participationType: "donation_only", alumniMeal: "non_veg", tshirtSize: "L" },
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [{ id: "c1", name: "Arjun", age: 10, meal: "non_veg" }],
        guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
      },
    });
    const counts = getAttendeeCounts(reg);
    expect(counts.veg).toBe(0);
    expect(counts.nonveg).toBe(0);
    expect(counts.total).toBe(0);
  });

  it("no spouse, no children, no guests → count is 1 (alumni only)", () => {
    const reg = makeRegistration();
    const counts = getAttendeeCounts(reg);
    expect(counts.total).toBe(1);
  });

  it("empty children and guests arrays → count is 1 + spouse if present", () => {
    const reg = makeRegistration({
      attendees: { spouse: { name: "Priya", meal: "veg" }, children: [], guests: [] },
    });
    const counts = getAttendeeCounts(reg);
    expect(counts.total).toBe(2);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("calculateTotal — Edge Cases", () => {
  it("no spouse, no children, no guests, no accommodation, no donation: total = base (spec edge case)", () => {
    const reg = makeRegistration();
    const result = calculateTotal(reg);
    expect(result.lines).toHaveLength(0);
    expect(result.base).toBe(PRICING_DEFAULTS.alumniBaseFee);
    expect(result.donation).toBe(0);
    expect(result.total).toBe(PRICING_DEFAULTS.alumniBaseFee);
  });

  it("'shared_double' and 'private' both charged — type affects both label and price", () => {
    const sharedReg = makeRegistration({
      accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-15", extraBed: false },
    });
    const privateReg = makeRegistration({
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-15", extraBed: false },
    });
    const sharedResult = calculateTotal(sharedReg);
    const privateResult = calculateTotal(privateReg);
    const sharedLine = sharedResult.lines.find((l) => l.label.includes("Accommodation"));
    const privateLine = privateResult.lines.find((l) => l.label.includes("Accommodation"));
    expect(sharedLine!.label).toContain("Shared Room");
    expect(privateLine!.label).toContain("Private Room");
    // Different fees (6000 vs 12000)
    expect(sharedLine!.fee).toBe(6000);
    expect(privateLine!.fee).toBe(12000);
  });

  it("child aged exactly 0 (newborn): below threshold → free (edge case)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Newborn", age: 0, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Newborn"));
    expect(childLine!.fee).toBe(0);
    expect(childLine!.free).toBe(true);
  });
});

// =============================================================================
// PRICE-001: Family Member Type-Specific Fees (spouse ₹2,910, child ₹2,910)
// =============================================================================

describe("calculateTotal — Family Type-Specific Fees (PRICE-001)", () => {
  const CUSTOM_CONFIG: PricingConfig = {
    ...PRICING_DEFAULTS,
    spouseFee: 2910,
    childFee6to12: 1455,
    childFee12plus: 2910,
    guestFee: 2910,
  };

  it("spouse uses spouseFee (₹2,910) not additionalPersonFee", () => {
    const reg = makeRegistration({
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [],
        guests: [],
      },
    });
    const result = calculateTotal(reg, CUSTOM_CONFIG);
    const spouseLine = result.lines.find((l) => l.label.includes("Spouse"));
    expect(spouseLine).toBeDefined();
    expect(spouseLine!.fee).toBe(2910);
  });

  it("child 6-12 uses childFee6to12 (₹1,455)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Arjun", age: 8, meal: "non_veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg, CUSTOM_CONFIG);
    const childLine = result.lines.find((l) => l.label.includes("Arjun"));
    expect(childLine).toBeDefined();
    expect(childLine!.fee).toBe(1455);
  });

  it("child 12+ uses childFee12plus (₹2,910)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Teen", age: 14, meal: "non_veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg, CUSTOM_CONFIG);
    const childLine = result.lines.find((l) => l.label.includes("Teen"));
    expect(childLine).toBeDefined();
    expect(childLine!.fee).toBe(2910);
  });

  it("guest uses guestFee (₹2,910)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [],
        guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
      },
    });
    const result = calculateTotal(reg, CUSTOM_CONFIG);
    const guestLine = result.lines.find((l) => l.label.includes("Guest"));
    expect(guestLine).toBeDefined();
    expect(guestLine!.fee).toBe(2910);
  });

  it("falls back to additionalPersonFee when type-specific fees are undefined", () => {
    const fallbackConfig: PricingConfig = {
      ...PRICING_DEFAULTS,
      spouseFee: undefined,
      childFee6to12: undefined,
      childFee12plus: undefined,
      guestFee: undefined,
    };
    const reg = makeRegistration({
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [{ id: "c1", name: "Arjun", age: 8, meal: "non_veg" }],
        guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
      },
    });
    const result = calculateTotal(reg, fallbackConfig);
    const spouseLine = result.lines.find((l) => l.label.includes("Spouse"));
    const childLine = result.lines.find((l) => l.label.includes("Arjun"));
    const guestLine = result.lines.find((l) => l.label.includes("Guest"));
    expect(spouseLine!.fee).toBe(PRICING_DEFAULTS.additionalPersonFee);
    // fallback: 50% of additionalPersonFee for 6-12
    expect(childLine!.fee).toBe(Math.round(PRICING_DEFAULTS.additionalPersonFee / 2));
    expect(guestLine!.fee).toBe(PRICING_DEFAULTS.additionalPersonFee);
  });

  it("spouse line label includes '· Food' suffix", () => {
    const reg = makeRegistration({
      attendees: {
        spouse: { name: "O21", meal: "veg" },
        children: [],
        guests: [],
      },
    });
    const result = calculateTotal(reg, CUSTOM_CONFIG);
    const spouseLine = result.lines.find((l) => l.label.includes("Spouse"));
    expect(spouseLine!.label).toContain("Lunch & Dinner");
  });

  it("child line label includes '· Food' suffix", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "254", age: 7, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg, CUSTOM_CONFIG);
    const childLine = result.lines.find((l) => l.label.includes("254"));
    expect(childLine!.label).toContain("Lunch & Dinner");
  });

  it("guest line label includes '· Food' suffix", () => {
    const reg = makeRegistration({
      attendees: {
        children: [],
        guests: [{ id: "g1", name: "", relationship: "", meal: "non_veg" }],
      },
    });
    const result = calculateTotal(reg, CUSTOM_CONFIG);
    const guestLine = result.lines.find((l) => l.label.includes("Additional Guest"));
    expect(guestLine!.label).toContain("Lunch & Dinner");
  });
});

// =============================================================================
// Campus Only — additional person fees (college food only)
// =============================================================================

function makeCampusRegistration(overrides: Partial<Registration> = {}): Registration {
  return makeRegistration({
    attendance: {
      intent: "attending",
      participationType: "campus_only",
      alumniMeal: "non_veg",
      tshirtSize: "L",
      ...(overrides.attendance ?? {}),
    },
    ...overrides,
  });
}

describe("calculateTotal — Campus Only additional person fees", () => {
  it("uses campusOnlyBaseFee for base", () => {
    const reg = makeCampusRegistration();
    const result = calculateTotal(reg);
    expect(result.base).toBe(PRICING_DEFAULTS.campusOnlyBaseFee);
  });

  it("charges campusOnlySpouseFee (₹550) for spouse", () => {
    const reg = makeCampusRegistration({
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const spouseLine = result.lines.find((l) => l.label.includes("Spouse"));
    expect(spouseLine!.fee).toBe(550);
    expect(spouseLine!.label).toContain("Lunch");
  });

  it("charges campusOnlyChildFee6to12 (₹275) for child age 6-12", () => {
    const reg = makeCampusRegistration({
      attendees: {
        children: [{ id: "c1", name: "Arjun", age: 8, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Arjun"));
    expect(childLine!.fee).toBe(275);
    expect(childLine!.label).toContain("Lunch");
  });

  it("charges campusOnlyChildFee12plus (₹550) for child age 13+", () => {
    const reg = makeCampusRegistration({
      attendees: {
        children: [{ id: "c1", name: "Teen", age: 14, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Teen"));
    expect(childLine!.fee).toBe(550);
    expect(childLine!.label).toContain("Lunch");
  });

  it("child under 6 remains free on campus_only", () => {
    const reg = makeCampusRegistration({
      attendees: {
        children: [{ id: "c1", name: "Baby", age: 4, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Baby"));
    expect(childLine!.fee).toBe(0);
    expect(childLine!.free).toBe(true);
  });

  it("charges campusOnlyGuestFee (₹550) for guest", () => {
    const reg = makeCampusRegistration({
      attendees: {
        children: [],
        guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
      },
    });
    const result = calculateTotal(reg);
    const guestLine = result.lines.find((l) => l.label.includes("Guest"));
    expect(guestLine!.fee).toBe(550);
    expect(guestLine!.label).toContain("Lunch");
  });

  it("full_celebration spouse fee unchanged (regression)", () => {
    const reg = makeRegistration({
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const spouseLine = result.lines.find((l) => l.label.includes("Spouse"));
    expect(spouseLine!.fee).toBe(PRICING_DEFAULTS.spouseFee);
    expect(spouseLine!.label).toContain("Lunch & Dinner");
  });

  it("full_celebration child 6-12 fee uses half rate (regression)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Arjun", age: 8, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Arjun"));
    expect(childLine!.fee).toBe(PRICING_DEFAULTS.childFee6to12);
  });

  it("full_celebration child 12+ fee uses full rate (regression)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Teen", age: 14, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Teen"));
    expect(childLine!.fee).toBe(PRICING_DEFAULTS.childFee12plus);
  });

  // Campus-only age boundary tests (R9.6.3) — mirrors full_celebration boundary tests
  it("campus_only child aged exactly 6 → charged at half rate ₹275 (R9.6.3 boundary)", () => {
    const reg = makeCampusRegistration({
      attendees: {
        children: [{ id: "c1", name: "Six", age: 6, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Six"));
    expect(childLine).toBeDefined();
    expect(childLine!.fee).toBe(PRICING_DEFAULTS.campusOnlyChildFee6to12);
    expect(childLine!.free).toBe(false);
  });

  it("campus_only child aged exactly 12 → still charged at half rate ₹275 (R9.6.3 boundary)", () => {
    const reg = makeCampusRegistration({
      attendees: {
        children: [{ id: "c1", name: "Twelve", age: 12, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Twelve"));
    expect(childLine).toBeDefined();
    expect(childLine!.fee).toBe(PRICING_DEFAULTS.campusOnlyChildFee6to12);
    expect(childLine!.free).toBe(false);
  });

  it("campus_only child aged exactly 13 → charged at full rate ₹550 (R9.6.3 boundary)", () => {
    const reg = makeCampusRegistration({
      attendees: {
        children: [{ id: "c1", name: "Thirteen", age: 13, meal: "veg" }],
        guests: [],
      },
    });
    const result = calculateTotal(reg);
    const childLine = result.lines.find((l) => l.label.includes("Thirteen"));
    expect(childLine).toBeDefined();
    expect(childLine!.fee).toBe(PRICING_DEFAULTS.campusOnlyChildFee12plus);
    expect(childLine!.free).toBe(false);
  });
});

// =============================================================================
// College Contribution (R2.1, R2.2, R2.3)
// =============================================================================

describe("calculateTotal — College Contribution (R2.2)", () => {
  it("attending with contributionSplits {green_energy: 1000} → line item emitted (R2.2)", () => {
    const reg = makeRegistration({
      contributionSplits: { green_energy: 1000 },
    });
    const result = calculateTotal(reg);
    const contribLine = result.lines.find((l) => l.fee === 1000 && !l.free);
    expect(contribLine).toBeDefined();
    expect(contribLine!.label).toContain("Green Energy Project");
  });

  it("attending with no contributionSplits produces NO contribution line (R2.2 + edge case)", () => {
    // contributionSplits absent → no college contribution line
    const reg = makeRegistration();
    const result = calculateTotal(reg);
    const contribLine = result.lines.find((l) => l.label.includes("Batch Contribution"));
    expect(contribLine).toBeUndefined();
    expect(result.total).toBe(result.base);
  });

  it("attending contribution line is included in total (R10)", () => {
    const reg = makeRegistration({
      contributionSplits: { scholarship: 2000 },
    });
    const result = calculateTotal(reg);
    const lineSum = result.lines.reduce((s, l) => s + l.fee, 0);
    expect(result.total).toBe(result.base + lineSum + result.donation);
    expect(result.total).toBe(PRICING_DEFAULTS.alumniBaseFee + 2000);
  });

  it("donation_only with contributionSplits → contribution line IS emitted and total includes it (R9.5)", () => {
    // R9.5 (inverted): donation_only CAN have college contribution lines — they appear in pricing.
    const reg = makeRegistration({
      attendance: { intent: "donation_only", participationType: "donation_only", alumniMeal: "non_veg", tshirtSize: "L" },
      contributionSplits: { scholarship: 5000 },
      donation: { amount: 500, publicAcknowledgement: false, felicitationConsent: false },
    });
    const result = calculateTotal(reg);
    const contribLine = result.lines.find((l) => l.label.includes("Scholarship Fund"));
    expect(contribLine).toBeDefined();
    expect(contribLine!.fee).toBe(5000);
    expect(result.collegeContribution).toBe(5000);
    expect(result.donation).toBe(500);
    expect(result.total).toBe(5500);
  });
});

// =============================================================================
// Campus-Only Accommodation Suppression (R9.6.2)
// =============================================================================

describe("calculateTotal — Campus Only: no accommodation charge (R9.6.2)", () => {
  it("campus_only with accommodation data → no accommodation charge regardless (R9.6.2)", () => {
    // Spec R9.6.2: "No accommodation charge is applied, regardless of accommodation data in the draft."
    const reg = makeCampusRegistration({
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    });
    const result = calculateTotal(reg);
    const accLine = result.lines.find((l) => l.label.includes("Accommodation"));
    expect(accLine).toBeUndefined();
    // No GST line either (no accommodation → no GST)
    const gstLine = result.lines.find((l) => l.label.includes("GST"));
    expect(gstLine).toBeUndefined();
  });

  it("campus_only total is not inflated by accommodation data (R9.6.2)", () => {
    // Total with accommodation data must equal total without it
    const withAcc = makeCampusRegistration({
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    });
    const withoutAcc = makeCampusRegistration();
    expect(calculateTotal(withAcc).total).toBe(calculateTotal(withoutAcc).total);
  });
});

// =============================================================================
// calculateTotal — Multi-cause contributionSplits (new behavior)
// =============================================================================

describe("calculateTotal — contributionSplits per-cause lines", () => {
  it("donation_only: donation + scholarship split → total = donation + contribution", () => {
    // Core new behavior: donation_only total includes contribution
    const reg = makeRegistration({
      attendance: { intent: "donation_only", participationType: "donation_only", alumniMeal: "non_veg", tshirtSize: "L" },
      donation: { amount: 500, publicAcknowledgement: false, felicitationConsent: false },
      contributionSplits: { scholarship: 5000 },
    });
    const result = calculateTotal(reg);
    expect(result.base).toBe(0);
    expect(result.donation).toBe(500);
    expect(result.collegeContribution).toBe(5000);
    expect(result.total).toBe(5500);
    const scholarshipLine = result.lines.find((l) => l.label.includes("Scholarship Fund"));
    expect(scholarshipLine).toBeDefined();
    expect(scholarshipLine!.fee).toBe(5000);
  });

  it("attending with green_energy split → line labeled 'Batch Contribution to College — Green Energy Project'", () => {
    const reg = makeRegistration({
      contributionSplits: { green_energy: 2000 },
    });
    const result = calculateTotal(reg);
    const line = result.lines.find((l) => l.label.includes("Green Energy Project"));
    expect(line).toBeDefined();
    expect(line!.label).toBe("Batch Contribution to College — Green Energy Project");
    expect(line!.fee).toBe(2000);
    expect(result.collegeContribution).toBe(2000);
    expect(result.total).toBe(PRICING_DEFAULTS.alumniBaseFee + 2000);
  });

  it("two-cause split renders two lines with correct fees", () => {
    // Future-proof path: two causes → two line items
    const reg = makeRegistration({
      contributionSplits: { green_energy: 3000, scholarship: 2000 },
    });
    const result = calculateTotal(reg);
    const greenLine = result.lines.find((l) => l.label.includes("Green Energy Project"));
    const scholarLine = result.lines.find((l) => l.label.includes("Scholarship Fund"));
    expect(greenLine).toBeDefined();
    expect(greenLine!.fee).toBe(3000);
    expect(scholarLine).toBeDefined();
    expect(scholarLine!.fee).toBe(2000);
    expect(result.collegeContribution).toBe(5000);
  });

  it("unknown cause key falls back to raw key in label", () => {
    // Spec: labels fall back to the raw key for unknown/legacy causes
    const reg = makeRegistration({
      contributionSplits: { future_cause: 1000 } as unknown as { green_energy: number },
    });
    const result = calculateTotal(reg);
    const line = result.lines.find((l) => l.label.includes("future_cause"));
    expect(line).toBeDefined();
    expect(line!.label).toContain("future_cause");
  });
});
