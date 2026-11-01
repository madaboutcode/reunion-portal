/**
 * Tests for the reports "Budget Progress" split: `splitPricingBreakup()` and
 * its label-matching fallback `isAccommodationLine()`.
 *
 * The invariant that matters most: accommodation + event === total, always —
 * `event` is derived by subtraction, not by summing "event" lines, so it
 * can't silently drift even if a future line type is added and mistagged.
 */

import { describe, it, expect } from "vitest";
import { calculateTotal, isAccommodationLine, splitPricingBreakup } from "../pricing.ts";
import { PRICING_DEFAULTS } from "../constants.ts";
import type { PricingConfig, PricingLineItem, Registration } from "../types.ts";

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

function splitFor(reg: Registration, config: PricingConfig = PRICING_DEFAULTS) {
  const breakup = calculateTotal(reg, config);
  return splitPricingBreakup(breakup, breakup.total);
}

describe("splitPricingBreakup — always sums to total", () => {
  it("no accommodation (base fee only): all event, zero accommodation", () => {
    const { accommodation, event } = splitFor(makeRegistration());
    expect(accommodation).toBe(0);
    expect(event).toBe(PRICING_DEFAULTS.alumniBaseFee + PRICING_DEFAULTS.collegeContributionMinimum);
  });

  it("campus_only: accommodation is skipped entirely regardless of accommodation field", () => {
    const reg = makeRegistration({
      attendance: {
        intent: "attending",
        participationType: "campus_only",
        alumniMeal: "veg",
        tshirtSize: "M",
      },
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    });
    const { accommodation, event } = splitFor(reg);
    expect(accommodation).toBe(0);
    expect(event).toBe(reg && calculateTotal(reg, PRICING_DEFAULTS).total);
  });

  it("private room, 2 nights: accommodation share matches room+GST, event covers the rest", () => {
    const reg = makeRegistration({
      accommodation: { type: "private", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
    });
    const breakup = calculateTotal(reg, PRICING_DEFAULTS);
    const { accommodation, event } = splitPricingBreakup(breakup, breakup.total);

    const roomFee = PRICING_DEFAULTS.accommodationPrivateFee! * 2;
    const gst = Math.round(roomFee * (PRICING_DEFAULTS.accommodationTaxPercent! / 100));
    expect(accommodation).toBe(roomFee + gst);
    expect(event).toBe(breakup.total - accommodation);
    expect(accommodation + event).toBe(breakup.total);
  });

  it("shared_double room: accommodation share matches shared-room rate, not the private rate", () => {
    const reg = makeRegistration({
      accommodation: { type: "shared_double", checkIn: "2026-08-15", checkOut: "2026-08-16", extraBed: false },
    });
    const breakup = calculateTotal(reg, PRICING_DEFAULTS);
    const { accommodation } = splitPricingBreakup(breakup, breakup.total);

    const sharedFee = PRICING_DEFAULTS.accommodationSharedDoubleFee! * 1;
    const gst = Math.round(sharedFee * (PRICING_DEFAULTS.accommodationTaxPercent! / 100));
    expect(accommodation).toBe(sharedFee + gst);
  });

  it("private room + spouse + child: spouse/child food is event, child accommodation surcharge is accommodation", () => {
    const reg = makeRegistration({
      attendees: {
        spouse: { name: "Jane", meal: "veg" },
        children: [{ id: "c1", name: "Kid", age: 8, meal: "veg" }],
        guests: [],
      },
      accommodation: { type: "private", checkIn: "2026-08-15", checkOut: "2026-08-16", extraBed: false },
    });
    const breakup = calculateTotal(reg, PRICING_DEFAULTS);
    const { accommodation, event } = splitPricingBreakup(breakup, breakup.total);

    // Everything sums back to total regardless of how many line types are involved.
    expect(accommodation + event).toBe(breakup.total);
    // Accommodation only reflects room + child-bed-age charge + GST, not the spouse/child food fees.
    const roomFee = PRICING_DEFAULTS.accommodationPrivateFee!;
    const childFee = PRICING_DEFAULTS.accommodationChild6to12Fee ?? 0; // age 8 is within 6-12
    const gst = Math.round((roomFee + childFee) * (PRICING_DEFAULTS.accommodationTaxPercent! / 100));
    expect(accommodation).toBe(roomFee + childFee + gst);
  });

  it("donation_only: donation and college contribution are event, no accommodation possible", () => {
    const reg = makeRegistration({
      attendance: { intent: "donation_only", participationType: "donation_only" },
      donation: { amount: 5000, publicAcknowledgement: false, felicitationConsent: false },
    });
    const breakup = calculateTotal(reg, PRICING_DEFAULTS);
    const { accommodation, event } = splitPricingBreakup(breakup, breakup.total);
    expect(accommodation).toBe(0);
    expect(event).toBe(breakup.total);
    expect(breakup.total).toBe(5000);
  });
});

describe("isAccommodationLine — legacy fallback for untagged historical snapshots", () => {
  it("classifies tagged lines by category, ignoring label wording", () => {
    const line: PricingLineItem = { label: "Anything at all", fee: 100, free: false, category: "accommodation" };
    expect(isAccommodationLine(line)).toBe(true);
    const eventLine: PricingLineItem = { label: "Accommodation — looks like a room but isn't", fee: 100, free: false, category: "event" };
    expect(isAccommodationLine(eventLine)).toBe(false);
  });

  it("falls back to label matching when category is absent (frozen pre-migration snapshot)", () => {
    const legacyLines: PricingLineItem[] = [
      { label: "Accommodation — Private · 2 nights", fee: 24000, free: false },
      { label: "Kid (8 yrs) — accommodation", fee: 3000, free: false },
      { label: "Extra bed · 2 nights", fee: 4000, free: false },
      { label: "GST (18%) — accommodation", fee: 5580, free: false },
    ];
    for (const line of legacyLines) {
      expect(isAccommodationLine(line)).toBe(true);
    }
  });

  it("does not misclassify legacy event lines as accommodation", () => {
    const legacyLines: PricingLineItem[] = [
      { label: "Spouse — Jane · Lunch & Dinner", fee: 1000, free: false },
      { label: "College Contribution — Scholarship", fee: 2000, free: false },
      { label: "Platform fee", fee: 50, free: false },
    ];
    for (const line of legacyLines) {
      expect(isAccommodationLine(line)).toBe(false);
    }
  });

  it("legacy untagged breakup still splits correctly via label fallback", () => {
    const legacyBreakup = {
      base: 8500,
      collegeContribution: 1000,
      lines: [
        { label: "Accommodation — Private · 1 nights", fee: 12000, free: false },
        { label: "GST (18%) — accommodation", fee: 2160, free: false },
        { label: "Spouse — Jane · Lunch & Dinner", fee: 4250, free: false },
      ],
      donation: 0,
      total: 8500 + 12000 + 2160 + 4250,
    };
    const { accommodation, event } = splitPricingBreakup(legacyBreakup, legacyBreakup.total);
    expect(accommodation).toBe(12000 + 2160);
    expect(event).toBe(legacyBreakup.total - accommodation);
  });
});
