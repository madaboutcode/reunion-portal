/**
 * Breakfast pricing tests — proves additional breakfast line items appear
 * in the pricing breakup with correct fees and GST applied.
 *
 * Strategy: same differencing approach as pricing-accommodation.test.ts.
 * Compute breakfast contribution by subtracting total without breakfast
 * from total with breakfast. Label-independent.
 */

import { describe, it, expect } from "vitest";
import { calculateTotal } from "../pricing.ts";
import { PRICING_DEFAULTS } from "../constants.ts";
import type { PricingConfig, Registration } from "../types.ts";

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
    attendees: { spouse: undefined, children: [], guests: [] },
    accommodation: undefined,
    donation: undefined,
    idDocument: undefined,
    ...overrides,
  };
}

function breakfastContribution(
  reg: Registration,
  config: PricingConfig = PRICING_DEFAULTS,
): number {
  const withBreakfast = calculateTotal(reg, config).total;
  const withoutBreakfast = calculateTotal(
    {
      ...reg,
      accommodation: reg.accommodation
        ? { ...reg.accommodation, breakfastAdult: 0, breakfastChild: 0 }
        : undefined,
    },
    config,
  ).total;
  return withBreakfast - withoutBreakfast;
}

describe("Breakfast pricing", () => {
  it("PRICING_DEFAULTS carries breakfast rates", () => {
    expect(PRICING_DEFAULTS.breakfastAdultFee).toBe(1500);
    expect(PRICING_DEFAULTS.breakfastChildFee).toBe(1000);
  });

  it("zero breakfast counts produce no line items", () => {
    const reg = makeRegistration({
      accommodation: {
        type: "private",
        checkIn: "2026-08-14",
        checkOut: "2026-08-15",
        extraBed: false,
        breakfastAdult: 0,
        breakfastChild: 0,
      },
    });
    const result = calculateTotal(reg);
    const breakfastLines = result.lines.filter((l) => l.label.includes("Breakfast"));
    expect(breakfastLines).toHaveLength(0);
  });

  it("adult breakfast adds correct fee with GST", () => {
    const reg = makeRegistration({
      accommodation: {
        type: "private",
        checkIn: "2026-08-14",
        checkOut: "2026-08-15",
        extraBed: false,
        breakfastAdult: 2,
        breakfastChild: 0,
      },
    });
    // 2 × 1500 = 3000. GST on 3000 is part of the accommodation subtotal GST.
    // Differencing isolates breakfast's contribution including its GST share.
    const contribution = breakfastContribution(reg);
    // Expected: 2 × 1500 = 3000 + 18% GST on 3000 = 540 → 3540
    expect(contribution).toBe(3540);
  });

  it("child breakfast adds correct fee with GST", () => {
    const reg = makeRegistration({
      accommodation: {
        type: "private",
        checkIn: "2026-08-14",
        checkOut: "2026-08-15",
        extraBed: false,
        breakfastAdult: 0,
        breakfastChild: 3,
      },
    });
    // 3 × 1000 = 3000 + 18% GST = 540 → 3540
    const contribution = breakfastContribution(reg);
    expect(contribution).toBe(3540);
  });

  it("mixed adult and child breakfast", () => {
    const reg = makeRegistration({
      accommodation: {
        type: "private",
        checkIn: "2026-08-14",
        checkOut: "2026-08-16", // 2 nights
        extraBed: false,
        breakfastAdult: 4, // e.g. 2 adults × 2 nights
        breakfastChild: 2, // e.g. 1 child × 2 nights
      },
    });
    // 4 × 1500 = 6000 + 2 × 1000 = 2000 → subtotal 8000
    // GST on 8000 = 1440 → total 9440
    const contribution = breakfastContribution(reg);
    expect(contribution).toBe(9440);
  });

  it("breakfast without accommodation produces no charge", () => {
    const reg = makeRegistration({ accommodation: undefined });
    const result = calculateTotal(reg);
    const breakfastLines = result.lines.filter((l) => l.label.includes("Breakfast"));
    expect(breakfastLines).toHaveLength(0);
  });

  it("breakfast line items have accommodation category", () => {
    const reg = makeRegistration({
      accommodation: {
        type: "private",
        checkIn: "2026-08-14",
        checkOut: "2026-08-15",
        extraBed: false,
        breakfastAdult: 1,
        breakfastChild: 1,
      },
    });
    const result = calculateTotal(reg);
    const breakfastLines = result.lines.filter((l) => l.label.includes("Breakfast"));
    expect(breakfastLines).toHaveLength(2);
    breakfastLines.forEach((line) => {
      expect(line.category).toBe("accommodation");
    });
  });

  it("breakfastAdult and breakfastChild fields absent entirely (not just 0) produce no line items and no crash", () => {
    // Registration.accommodation.breakfastAdult/breakfastChild are optional —
    // a registration created before this feature existed (or mapped without
    // the fields) must not crash calculateTotal(). Distinct from the "zero
    // counts" test above, which sets 0 explicitly; this omits the keys.
    const reg = makeRegistration({
      accommodation: {
        type: "private",
        checkIn: "2026-08-14",
        checkOut: "2026-08-15",
        extraBed: false,
      },
    });
    const result = calculateTotal(reg);
    const breakfastLines = result.lines.filter((l) => l.label.includes("Breakfast"));
    expect(breakfastLines).toHaveLength(0);
  });

  it("breakfast fee applies on shared_double accommodation, independent of room type", () => {
    // Catches: generator gating breakfast fee behind `type === "private"`
    // (breakfast is documented as flat quantities, not tied to a specific
    // room type — the accommodation-catalog breakfastFor field is display-only).
    const reg = makeRegistration({
      accommodation: {
        type: "shared_double",
        checkIn: "2026-08-14",
        checkOut: "2026-08-15",
        extraBed: false,
        breakfastAdult: 1,
        breakfastChild: 0,
      },
    });
    // 1 × 1500 = 1500 + 18% GST = 1770
    const contribution = breakfastContribution(reg);
    expect(contribution).toBe(1770);
  });

  it("breakfast fee applies on shared_triple accommodation, independent of room type", () => {
    const reg = makeRegistration({
      accommodation: {
        type: "shared_triple",
        checkIn: "2026-08-14",
        checkOut: "2026-08-15",
        extraBed: false,
        breakfastAdult: 0,
        breakfastChild: 2,
      },
    });
    // 2 × 1000 = 2000 + 18% GST = 2360
    const contribution = breakfastContribution(reg);
    expect(contribution).toBe(2360);
  });

  it("breakfast pools into the single accommodation GST line — does not produce its own separate GST line", () => {
    // Catches: generator computing GST per-charge-type (room, extra bed,
    // breakfast each taxed separately and rounded independently) instead of
    // once over the full accommodation subtotal. A private room + extra bed +
    // breakfast booking must produce exactly ONE "GST" line.
    const reg = makeRegistration({
      accommodation: {
        type: "private",
        checkIn: "2026-08-14",
        checkOut: "2026-08-15",
        extraBed: true,
        breakfastAdult: 1,
        breakfastChild: 0,
      },
    });
    const result = calculateTotal(reg);
    const gstLines = result.lines.filter((l) => l.label.includes("GST"));
    expect(gstLines).toHaveLength(1);

    // Room 12000 + extra bed 1500 + breakfast 1500 = 15000 subtotal → GST 2700
    expect(gstLines[0].fee).toBe(2700);
  });

  it("campus_only participation ignores accommodation and breakfast entirely, even if present on the record", () => {
    // Defense-in-depth: sanitizeRegistration() normally strips accommodation
    // for campus_only registrations before they reach calculateTotal(), but
    // calculateTotal() itself must not price accommodation/breakfast for
    // campus_only even if a malformed/stale record still carries the block
    // (e.g. a staff edit that changed participationType without also clearing
    // accommodation before sanitize runs).
    const reg = makeRegistration({
      attendance: {
        intent: "attending",
        participationType: "campus_only",
        alumniMeal: "non_veg",
        tshirtSize: "L",
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-14",
        checkOut: "2026-08-15",
        extraBed: false,
        breakfastAdult: 3,
        breakfastChild: 2,
      },
    });
    const result = calculateTotal(reg);
    const breakfastLines = result.lines.filter((l) => l.label.includes("Breakfast"));
    const accommodationLines = result.lines.filter((l) => l.category === "accommodation");
    expect(breakfastLines).toHaveLength(0);
    expect(accommodationLines).toHaveLength(0);
    expect(result.total).toBe(PRICING_DEFAULTS.campusOnlyBaseFee);
  });
});
