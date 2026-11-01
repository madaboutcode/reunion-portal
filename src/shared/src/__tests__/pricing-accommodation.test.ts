/**
 * Accommodation pricing tests — spec oracle: §7 worked examples.
 *
 * Strategy: compute accommodation contribution by differencing totals:
 *   accContribution = calculateTotal(reg, config).total
 *                   - calculateTotal({...reg, accommodation: undefined}, config).total
 *
 * This is label-wording-independent — no assertion references a line label string,
 * so label rewording cannot produce a false pass. The diff = room + child-bed charges
 * + GST, which is exactly what §7 describes as the "accommodation total".
 *
 * Generator exploits caught:
 *   - Wrong room rate (wrong per-night value)
 *   - Wrong night count
 *   - Missing or double-counted extra bed
 *   - GST applied to wrong subtotal
 *   - GST computed at wrong rate
 *   - Under-6 child charged
 *   - accommodation:undefined producing non-zero contribution
 */

import { describe, it, expect } from "vitest";
import { calculateTotal } from "../pricing.ts";
import { PRICING_DEFAULTS } from "../constants.ts";
import type { PricingConfig, Registration } from "../types.ts";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Compute the accommodation contribution in isolation.
 *
 * Returns: total(with accommodation) - total(without accommodation)
 *
 * This is the §7 "accommodation total" figure — it is label-independent
 * and stable against any changes in base-fee, attendee-charge, or donation
 * line amounts, because those cancel in the diff.
 */
function accommodationContribution(
  reg: Registration,
  config: PricingConfig = PRICING_DEFAULTS,
): number {
  const withAcc = calculateTotal(reg, config).total;
  const withoutAcc = calculateTotal({ ...reg, accommodation: undefined }, config).total;
  return withAcc - withoutAcc;
}

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

// =============================================================================
// §7 Oracle — exact rupee totals
// =============================================================================

describe("Accommodation contribution — §7 worked examples", () => {
  // ── PRICING_DEFAULTS sanity guard ─────────────────────────────────────────
  // If these fail the spec's rate values were not wired into PRICING_DEFAULTS.
  // Everything below depends on these being correct.

  it("PRICING_DEFAULTS carries the spec-mandated accommodation rates", () => {
    expect(PRICING_DEFAULTS.accommodationPrivateFee).toBe(12000);
    expect(PRICING_DEFAULTS.accommodationSharedDoubleFee).toBe(6000);
    expect(PRICING_DEFAULTS.accommodationSharedTripleFee).toBe(4500);
    expect(PRICING_DEFAULTS.accommodationExtraBedFee).toBe(1500);
    expect(PRICING_DEFAULTS.accommodationChild6to12Fee).toBe(1000);
    expect(PRICING_DEFAULTS.accommodationChildBedAge).toBe(12);
    expect(PRICING_DEFAULTS.accommodationTaxPercent).toBe(18);
  });

  // ── Row 1: Solo, Twin Sharing (shared_double), 1 night ────────────────────
  // Lines: 6,000 head × 1 night = 6,000. GST: round(6000 × 0.18) = 1,080. Total: 7,080.

  it("solo shared_double 1 night → accommodation contribution = 7080", () => {
    const reg = makeRegistration({
      accommodation: {
        type: "shared_double",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    expect(accommodationContribution(reg)).toBe(7080);
  });

  // ── Row 2: Solo, Triple Sharing (shared_triple), 1 night ──────────────────
  // Lines: 4,500 head × 1 night = 4,500. GST: round(4500 × 0.18) = 810. Total: 5,310.

  it("solo shared_triple 1 night → accommodation contribution = 5310", () => {
    const reg = makeRegistration({
      accommodation: {
        type: "shared_triple",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    expect(accommodationContribution(reg)).toBe(5310);
  });

  // ── Row 3: Couple, Private, no extra bed, 1 night ─────────────────────────
  // Lines: 12,000 room × 1 night = 12,000. GST: round(12000 × 0.18) = 2,160. Total: 14,160.

  it("couple private no extra bed 1 night → accommodation contribution = 14160", () => {
    const reg = makeRegistration({
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [],
        guests: [],
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    expect(accommodationContribution(reg)).toBe(14160);
  });

  // ── Row 4: Couple, Private, Aug-14 check-in (2 nights) ───────────────────
  // Lines: 12,000 room × 2 nights = 24,000. GST: round(24000 × 0.18) = 4,320. Total: 28,320.

  it("couple private 2 nights (Aug-14 to Aug-16) → accommodation contribution = 28320", () => {
    const reg = makeRegistration({
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [],
        guests: [],
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-14",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    expect(accommodationContribution(reg)).toBe(28320);
  });

  // ── Row 5: Private + child age 8 + child age 14, extraBed:true (auto), 1 night
  // Lines: 12,000 room + 1,000 (age-8 child) + 1,500 (extra bed for age-14 child)
  //      = 14,500 subtotal. GST: round(14500 × 0.18) = 2,610. Total: 17,110.
  //
  // D6 guarantee: exactly ONE ₹1,500 line (the 14-yo IS the bed, not two charges).

  it("private + child-8 + child-14 extraBed:true (auto) 1 night → accommodation contribution = 17110", () => {
    const reg = makeRegistration({
      attendees: {
        spouse: undefined,
        children: [
          { id: "c1", name: "YoungKid", age: 8, meal: "veg" },
          { id: "c2", name: "OlderKid", age: 14, meal: "veg" },
        ],
        guests: [],
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: true,
      },
    });
    expect(accommodationContribution(reg)).toBe(17110);
  });

  it("private + child-8 + child-14 has exactly ONE line with fee === 1500 (D6: no double-count)", () => {
    // Catches: generator emits two separate ₹1,500 charges (one for the child, one for the bed)
    const reg = makeRegistration({
      attendees: {
        spouse: undefined,
        children: [
          { id: "c1", name: "YoungKid", age: 8, meal: "veg" },
          { id: "c2", name: "OlderKid", age: 14, meal: "veg" },
        ],
        guests: [],
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: true,
      },
    });
    const result = calculateTotal(reg);
    const extraBedLines = result.lines.filter((l) => l.fee === 1500);
    expect(extraBedLines).toHaveLength(1);
  });

  // ── Row 6: Private + manual extra bed (3rd adult, no children), 1 night ──
  // Lines: 12,000 room + 1,500 extra bed = 13,500 subtotal.
  // GST: round(13500 × 0.18) = 2,430. Total: 15,930.

  it("private + manual extraBed + 1 guest 1 night → accommodation contribution = 15930", () => {
    const reg = makeRegistration({
      attendees: {
        spouse: undefined,
        children: [],
        guests: [{ id: "g1", name: "ThirdAdult", relationship: "Friend", meal: "veg" }],
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: true,
      },
    });
    expect(accommodationContribution(reg)).toBe(15930);
  });
});

// =============================================================================
// GST line assertions
// =============================================================================

describe("GST line — existence and value", () => {
  it("exactly one GST line in the 17110 case, fee = 2610", () => {
    // Catches: multiple GST lines, or GST computed on wrong subtotal
    // Subtotal: 12000 + 1000 + 1500 = 14500. GST: round(14500 × 0.18) = 2610.
    const reg = makeRegistration({
      attendees: {
        spouse: undefined,
        children: [
          { id: "c1", name: "YoungKid", age: 8, meal: "veg" },
          { id: "c2", name: "OlderKid", age: 14, meal: "veg" },
        ],
        guests: [],
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: true,
      },
    });
    const result = calculateTotal(reg);
    const gstLines = result.lines.filter((l) => l.label.includes("GST") || l.label.includes("gst") || l.label.includes("tax") || l.label.includes("Tax"));
    expect(gstLines).toHaveLength(1);
    expect(gstLines[0]!.fee).toBe(2610);
  });

  it("exactly one GST line in the 7080 case, fee = 1080", () => {
    // Catches: GST line missing for shared rooms, or wrong rate applied
    // Subtotal: 6000. GST: round(6000 × 0.18) = 1080.
    const reg = makeRegistration({
      accommodation: {
        type: "shared_double",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    const result = calculateTotal(reg);
    const gstLines = result.lines.filter((l) => l.label.includes("GST") || l.label.includes("gst") || l.label.includes("tax") || l.label.includes("Tax"));
    expect(gstLines).toHaveLength(1);
    expect(gstLines[0]!.fee).toBe(1080);
  });

  it("no accommodation → no GST line (§6 A3: no accommodation lines, no GST line)", () => {
    // Catches: generator emits a GST line even when no accommodation present
    const reg = makeRegistration();
    const result = calculateTotal(reg);
    const gstLines = result.lines.filter((l) => l.label.includes("GST") || l.label.includes("gst") || l.label.includes("tax") || l.label.includes("Tax"));
    expect(gstLines).toHaveLength(0);
  });

  it("accommodationEnabled:false → no GST line", () => {
    // Catches: GST line generated even when accommodation is disabled
    const reg = makeRegistration({
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    const result = calculateTotal(reg, { ...PRICING_DEFAULTS, accommodationEnabled: false });
    const gstLines = result.lines.filter((l) => l.label.includes("GST") || l.label.includes("gst") || l.label.includes("tax") || l.label.includes("Tax"));
    expect(gstLines).toHaveLength(0);
  });
});

// =============================================================================
// Tax-percent override
// =============================================================================

describe("Tax-percent override (§5 D2)", () => {
  it("accommodationTaxPercent:12 on couple-private 1 night → contribution = 13440", () => {
    // Subtotal: 12000. Tax at 12%: round(12000 × 0.12) = 1440. Total: 13440.
    // Catches: tax rate hardcoded to 18% ignoring config
    const customConfig: PricingConfig = {
      ...PRICING_DEFAULTS,
      accommodationTaxPercent: 12,
    };
    const reg = makeRegistration({
      attendees: {
        spouse: { name: "Priya", meal: "veg" },
        children: [],
        guests: [],
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    expect(accommodationContribution(reg, customConfig)).toBe(13440);
  });
});

// =============================================================================
// accommodation: undefined → zero contribution
// =============================================================================

describe("No accommodation → zero contribution", () => {
  it("accommodation:undefined → accommodation contribution is exactly 0", () => {
    // Catches: phantom accommodation line generated without an accommodation object
    const reg = makeRegistration();
    expect(accommodationContribution(reg)).toBe(0);
  });
});

// =============================================================================
// Under-6 child → no accommodation charge (§6 A3: <6 children → no line)
// =============================================================================

describe("Under-6 child on private booking → no accommodation surcharge", () => {
  it("private room + child age 4 → same accommodation contribution as same booking without that child", () => {
    // Catches: under-6 child charged an accommodation line when using private room
    const withUnder6 = makeRegistration({
      attendees: {
        spouse: undefined,
        children: [{ id: "c1", name: "Toddler", age: 4, meal: "veg" }],
        guests: [],
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    const withoutChild = makeRegistration({
      attendees: { spouse: undefined, children: [], guests: [] },
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    expect(accommodationContribution(withUnder6)).toBe(accommodationContribution(withoutChild));
  });

  it("under-6 child shows free accommodation line when on private booking", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Toddler", age: 4, meal: "veg" }],
        guests: [],
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    const result = calculateTotal(reg);
    const childAccomLine = result.lines.find(
      (l) => l.label.includes("Toddler") && l.label.includes("accommodation"),
    );
    expect(childAccomLine).toBeDefined();
    expect(childAccomLine!.fee).toBe(0);
    expect(childAccomLine!.free).toBe(true);
  });
});

// =============================================================================
// PRICE-002a: Shared Triple Rate Correction (4750 → 4500 pre-tax)
// =============================================================================

describe("Accommodation contribution — corrected shared triple rate", () => {
  it("shared_triple 1 night with corrected rate → 5310 (matches brochure)", () => {
    // Brochure: ₹5,310 per head (inclusive of tax)
    // Pre-tax should be ₹4,500 → GST 18% = ₹810 → total ₹5,310
    const config: PricingConfig = {
      ...PRICING_DEFAULTS,
      accommodationSharedTripleFee: 4500,
    };
    const reg = makeRegistration({
      accommodation: {
        type: "shared_triple",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    expect(accommodationContribution(reg, config)).toBe(5310);
  });
});

// =============================================================================
// R6.3 — under-6 free accommodation line: edge cases and plural children
// =============================================================================

describe("R6.3 — free under-6 accommodation line: additional spec cases", () => {
  // Spec edge case (pricing-engine.spec.md line 133):
  // "A child aged exactly 0 (newborn) ... When accommodation is selected, they also receive
  // a free accommodation line item (fee=0, marked free)."
  it("newborn (age=0) with private accommodation → free accommodation line present (spec edge case)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Newborn", age: 0, meal: "veg" }],
        guests: [],
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    const result = calculateTotal(reg);
    // Catches: generator skips the free accommodation line when age is falsy (0)
    const childAccomLine = result.lines.find(
      (l) => l.label.includes("Newborn") && l.label.includes("accommodation"),
    );
    expect(childAccomLine).toBeDefined();
    expect(childAccomLine!.fee).toBe(0);
    expect(childAccomLine!.free).toBe(true);
  });

  // R6.3 says "for each such child" — two under-6 children must each get their own free line.
  it("two under-6 children with private accommodation → two free accommodation lines (R6.3 plural)", () => {
    const reg = makeRegistration({
      attendees: {
        children: [
          { id: "c1", name: "BabyA", age: 1, meal: "veg" },
          { id: "c2", name: "BabyB", age: 4, meal: "veg" },
        ],
        guests: [],
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    const result = calculateTotal(reg);
    // Catches: generator emits only one free line regardless of how many under-6 children there are
    const freeAccomLines = result.lines.filter(
      (l) => l.free === true && l.fee === 0 && l.label.includes("accommodation"),
    );
    expect(freeAccomLines).toHaveLength(2);
  });

  // Two free lines must not inflate the total
  it("two under-6 children: free accommodation lines do not add to total (R6.3)", () => {
    const withUnder6 = makeRegistration({
      attendees: {
        children: [
          { id: "c1", name: "BabyA", age: 1, meal: "veg" },
          { id: "c2", name: "BabyB", age: 4, meal: "veg" },
        ],
        guests: [],
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    const withoutChildren = makeRegistration({
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    // Catches: generator adds a nonzero amount for the free accommodation lines
    expect(accommodationContribution(withUnder6)).toBe(accommodationContribution(withoutChildren));
  });
});

// =============================================================================
// R6.4 — no free accommodation line when accommodation is not selected
// =============================================================================

describe("R6.4 — no free under-6 accommodation line without accommodation", () => {
  it("under-6 child with NO accommodation → no free accommodation line (R6.4)", () => {
    // Catches: generator emits a free accommodation line even when accommodation:undefined
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Toddler", age: 3, meal: "veg" }],
        guests: [],
      },
      // accommodation intentionally absent
    });
    const result = calculateTotal(reg);
    const accLines = result.lines.filter((l) => l.label.includes("accommodation"));
    expect(accLines).toHaveLength(0);
  });

  it("under-6 child with accommodationEnabled:false → no free accommodation line (R6.4)", () => {
    // Catches: generator emits free line when accommodation is disabled in config
    const reg = makeRegistration({
      attendees: {
        children: [{ id: "c1", name: "Toddler", age: 3, meal: "veg" }],
        guests: [],
      },
      accommodation: {
        type: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
        extraBed: false,
      },
    });
    const result = calculateTotal(reg, { ...PRICING_DEFAULTS, accommodationEnabled: false });
    const accLines = result.lines.filter((l) => l.label.includes("accommodation"));
    expect(accLines).toHaveLength(0);
  });
});
