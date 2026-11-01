/**
 * Accommodation catalog tests — §6 A2 (data-driven, no hardcoded prices in UI).
 *
 * Tests:
 *   B — getAccommodationCatalog() returns exactly 3 entries with spec-mandated values.
 *   C — ACCOMMODATION_LABELS covers every AccommodationType with the spec-mandated strings.
 *
 * Generator exploits caught:
 *   - Catalog hardcodes prices instead of reading from config
 *   - Catalog includes "none" as a selectable option
 *   - Catalog returns wrong basis (room vs head)
 *   - Catalog returns wrong breakfastFor count
 *   - ACCOMMODATION_LABELS missing a key (returns undefined for new types)
 *   - ACCOMMODATION_LABELS returns wrong string for a type
 */

import { describe, it, expect } from "vitest";
import { getAccommodationCatalog, ACCOMMODATION_LABELS, PRICING_DEFAULTS } from "../constants.ts";
import type { AccommodationType } from "../types.ts";

// =============================================================================
// B — Catalog shape and default values
// =============================================================================

describe("getAccommodationCatalog() — shape and default values", () => {
  it("returns exactly 3 entries (private, shared_double, shared_triple — not none)", () => {
    // Catches: catalog includes "none" as a room option, or is missing an entry
    const catalog = getAccommodationCatalog();
    expect(catalog).toHaveLength(3);
    const values = catalog.map((e) => e.value);
    expect(values).toContain("private");
    expect(values).toContain("shared_double");
    expect(values).toContain("shared_triple");
    expect(values).not.toContain("none");
  });

  it("private entry: perNight = 12000, basis = 'room', breakfastFor = 2", () => {
    // Catches: wrong per-night, wrong basis (charges per-head instead of per-room), wrong breakfast count
    const catalog = getAccommodationCatalog();
    const privateEntry = catalog.find((e) => e.value === "private")!;
    expect(privateEntry).toBeDefined();
    expect(privateEntry.perNight).toBe(12000);
    expect(privateEntry.basis).toBe("room");
    expect(privateEntry.breakfastFor).toBe(2);
  });

  it("shared_double entry: perNight = 6000, basis = 'head', breakfastFor = 1 (per head)", () => {
    // Catches: wrong per-night, per-room basis instead of per-head, wrong breakfast count.
    // breakfastFor is 1 (not 2): shared is priced per head, so the booker's fee covers
    // only their own breakfast — roommates book and get their own.
    const catalog = getAccommodationCatalog();
    const sharedDoubleEntry = catalog.find((e) => e.value === "shared_double")!;
    expect(sharedDoubleEntry).toBeDefined();
    expect(sharedDoubleEntry.perNight).toBe(6000);
    expect(sharedDoubleEntry.basis).toBe("head");
    expect(sharedDoubleEntry.breakfastFor).toBe(1);
  });

  it("shared_triple entry: perNight = 4750, basis = 'head', breakfastFor = 1 (per head)", () => {
    // Catches: wrong per-night (must be 4500, NOT derived as 6000×0.75 or similar),
    //          wrong basis, wrong breakfast count (1 per head, not 3 for the room).
    const catalog = getAccommodationCatalog();
    const sharedTripleEntry = catalog.find((e) => e.value === "shared_triple")!;
    expect(sharedTripleEntry).toBeDefined();
    expect(sharedTripleEntry.perNight).toBe(4500);
    expect(sharedTripleEntry.basis).toBe("head");
    expect(sharedTripleEntry.breakfastFor).toBe(1);
  });

  it("every entry has a non-empty label and non-empty description", () => {
    // Catches: catalog entries with blank labels that would render as empty in UI
    const catalog = getAccommodationCatalog();
    for (const entry of catalog) {
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// B — Config prices flow through to catalog (data-driven proof)
// =============================================================================

describe("getAccommodationCatalog(config) — prices come from config, not hardcoded", () => {
  it("passing accommodationPrivateFee:15000 changes private entry perNight to 15000", () => {
    // Catches: catalog hardcodes 12000 instead of reading from config
    const customConfig = { ...PRICING_DEFAULTS, accommodationPrivateFee: 15000 };
    const catalog = getAccommodationCatalog(customConfig);
    const privateEntry = catalog.find((e) => e.value === "private")!;
    expect(privateEntry.perNight).toBe(15000);
  });

  it("passing accommodationSharedDoubleFee:7000 changes shared_double perNight to 7000", () => {
    // Catches: shared_double fee hardcoded instead of config-driven
    const customConfig = { ...PRICING_DEFAULTS, accommodationSharedDoubleFee: 7000 };
    const catalog = getAccommodationCatalog(customConfig);
    const sharedDoubleEntry = catalog.find((e) => e.value === "shared_double")!;
    expect(sharedDoubleEntry.perNight).toBe(7000);
  });

  it("passing accommodationSharedTripleFee:5000 changes shared_triple perNight to 5000", () => {
    // Catches: shared_triple fee hardcoded instead of config-driven
    const customConfig = { ...PRICING_DEFAULTS, accommodationSharedTripleFee: 5000 };
    const catalog = getAccommodationCatalog(customConfig);
    const sharedTripleEntry = catalog.find((e) => e.value === "shared_triple")!;
    expect(sharedTripleEntry.perNight).toBe(5000);
  });

  it("default call (no config) uses PRICING_DEFAULTS values", () => {
    // Catches: getAccommodationCatalog() without argument returns wrong defaults
    const catalog = getAccommodationCatalog();
    const privateEntry = catalog.find((e) => e.value === "private")!;
    expect(privateEntry.perNight).toBe(PRICING_DEFAULTS.accommodationPrivateFee);
  });
});

// =============================================================================
// C — ACCOMMODATION_LABELS covers every AccommodationType
// =============================================================================

describe("ACCOMMODATION_LABELS — complete coverage of AccommodationType", () => {
  const allTypes: AccommodationType[] = ["none", "private", "shared_double", "shared_triple"];

  it("has a non-empty string for every AccommodationType value (no undefined labels)", () => {
    // Catches: new enum values missing from the labels map (silently return undefined)
    for (const type of allTypes) {
      const label = ACCOMMODATION_LABELS[type];
      expect(label).toBeDefined();
      expect(typeof label).toBe("string");
      expect((label as string).length).toBeGreaterThan(0);
    }
  });

  it("private label is 'Private Room'", () => {
    // Catches: label mismatch that would show "single", "Private room" (wrong case), or other
    expect(ACCOMMODATION_LABELS["private"]).toBe("Private Room");
  });

  it("shared_double label is 'Shared Room (2 persons)'", () => {
    // Catches: label mismatch, stale "Shared Room" without occupancy qualifier
    expect(ACCOMMODATION_LABELS["shared_double"]).toBe("Shared Room (2 persons)");
  });

  it("shared_triple label is 'Shared Room (3 persons)'", () => {
    // Catches: label mismatch, swapped occupancy counts
    expect(ACCOMMODATION_LABELS["shared_triple"]).toBe("Shared Room (3 persons)");
  });
});
