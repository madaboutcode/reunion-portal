/**
 * Spec enforcement tests — classifyChanges() in edit-classifier.ts
 *
 * Tests every GUARANTEE in the CONTRACT block at the top of edit-classifier.ts:
 *   - CLASSIFY_COSMETIC: cosmetic field list
 *   - CLASSIFY_COST_AFFECTING: cost-affecting field list, including the new
 *     accommodation.breakfastAdult / accommodation.breakfastChild fields and
 *     contributionSplits (the persistence-fix feature)
 *   - EMAIL_GATED: email is neither cosmetic nor cost-affecting
 *   - PARTICIPATION_COUPLING: participationType change always couples
 *     attendanceIntent into costAffecting
 *   - PURE: no side effects (implicit — verified by not needing any fakes)
 *
 * Boundary: classifyChanges() is a pure function and IS the boundary — it has
 * no internal helpers worth bypassing. Tests call it directly with two
 * Registration snapshots and assert on the returned FieldClassification.
 *
 * This file did not exist before — classifyChanges() had zero direct test
 * coverage; it was only exercised indirectly through EditService.edit()
 * end-to-end tests in staff-edit-archive.test.ts, none of which target
 * breakfast or contributionSplits classification specifically.
 *
 * =============================================================================
 * Gaps flagged before writing
 * =============================================================================
 *
 * GAP (resolved by reading the contract): The CONTRACT block explicitly lists
 * accommodation.breakfastAdult and accommodation.breakfastChild as
 * cost-affecting fields, and contributionSplits as cost-affecting. These are
 * unambiguous — tests assert exactly these string labels.
 *
 * GAP (unresolved — flagging, not inventing): The CONTRACT's FAILURE BEHAVIOR
 * says "If comparison is ambiguous (e.g., null vs undefined), treats them as
 * equal." breakfastAdult/breakfastChild on the domain Registration type are
 * typed as plain `number` (not nullable) — so a null/undefined breakfast value
 * should never occur at this boundary in practice. The isDifferent() null/
 * undefined equivalence is tested here as a general classifier property (using
 * whatever field the type system allows to be nullable — mobileAlternate),
 * not fabricated onto breakfast fields the type forbids.
 *
 * @module edit-classifier.test
 */

import { describe, it, expect } from "vitest";
import { classifyChanges } from "../edit-classifier.js";
import type { Registration } from "../types.js";

function makeRegistration(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 1,
    regCode: "SMRT-TEST0001",
    status: "pending",
    fullName: "Ravi Kumar",
    branch: "Computer Science & Engineering",
    email: "ravi@example.com",
    whatsapp: "+919876543210",
    mobileAlternate: null,
    city: "Kochi",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    gender: "male",
    tshirtSize: "L",
    alumniMeal: "non_veg",
    accommodation: "private",
    checkIn: "2026-08-14",
    checkOut: "2026-08-15",
    extraBed: false,
    breakfastAdult: 0,
    breakfastChild: 0,
    donationAmount: 0,
    publicAck: false,
    ackDisplayName: null,
    felicitation: false,
    contributionSplits: {},
    pricingSnapshot: { base: 8500, collegeContribution: 0, lines: [], donation: 0, total: 8500 },
    totalAmount: 8500,
    idNote: null,
    photoFileKey: null,
    photoThumbKey: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("classifyChanges — breakfast fields are cost-affecting (CLASSIFY_COST_AFFECTING)", () => {
  it("breakfastAdult change alone is classified cost-affecting, not cosmetic", () => {
    // Catches: generator omitting breakfast from cost-affecting classification,
    // which would let staff change breakfast counts without triggering
    // pricing recompute or the pending_verification block.
    const oldReg = makeRegistration({ breakfastAdult: 0 });
    const newReg = makeRegistration({ breakfastAdult: 2 });

    const result = classifyChanges(oldReg, newReg);

    expect(result.costAffecting).toContain("accommodation.breakfastAdult");
    expect(result.cosmetic).not.toContain("accommodation.breakfastAdult");
  });

  it("breakfastChild change alone is classified cost-affecting, not cosmetic", () => {
    const oldReg = makeRegistration({ breakfastChild: 0 });
    const newReg = makeRegistration({ breakfastChild: 3 });

    const result = classifyChanges(oldReg, newReg);

    expect(result.costAffecting).toContain("accommodation.breakfastChild");
    expect(result.cosmetic).not.toContain("accommodation.breakfastChild");
  });

  it("both breakfastAdult and breakfastChild changing together are both classified", () => {
    // Catches: generator using an early-return/else-if that only flags one field
    // when both change in the same edit
    const oldReg = makeRegistration({ breakfastAdult: 1, breakfastChild: 1 });
    const newReg = makeRegistration({ breakfastAdult: 3, breakfastChild: 0 });

    const result = classifyChanges(oldReg, newReg);

    expect(result.costAffecting).toContain("accommodation.breakfastAdult");
    expect(result.costAffecting).toContain("accommodation.breakfastChild");
  });

  it("no breakfast change does not spuriously flag breakfast fields", () => {
    // Catches: generator flagging breakfast fields unconditionally
    const oldReg = makeRegistration({ breakfastAdult: 2, breakfastChild: 1 });
    const newReg = makeRegistration({ breakfastAdult: 2, breakfastChild: 1, fullName: "Someone Else" });

    const result = classifyChanges(oldReg, newReg);

    expect(result.costAffecting).not.toContain("accommodation.breakfastAdult");
    expect(result.costAffecting).not.toContain("accommodation.breakfastChild");
    expect(result.cosmetic).toContain("fullName");
  });

  it("reducing breakfast counts to zero is still classified cost-affecting (not just increases)", () => {
    // Catches: generator only checking newValue > oldValue instead of any difference
    const oldReg = makeRegistration({ breakfastAdult: 2, breakfastChild: 2 });
    const newReg = makeRegistration({ breakfastAdult: 0, breakfastChild: 0 });

    const result = classifyChanges(oldReg, newReg);

    expect(result.costAffecting).toContain("accommodation.breakfastAdult");
    expect(result.costAffecting).toContain("accommodation.breakfastChild");
  });
});

describe("classifyChanges — contributionSplits is cost-affecting (CLASSIFY_COST_AFFECTING)", () => {
  it("adding a contribution split is classified cost-affecting", () => {
    // This is the field the persistence bug was about — the classifier itself
    // was correct; the bug was buildDbUpdate() not writing it to D1. This test
    // locks in the classifier half of the contract so a regression there is
    // caught independently of the persistence test.
    const oldReg = makeRegistration({ contributionSplits: {} });
    const newReg = makeRegistration({ contributionSplits: { green_energy: 1000 } });

    const result = classifyChanges(oldReg, newReg);

    expect(result.costAffecting).toContain("contributionSplits");
  });

  it("changing the amount for an existing cause is classified cost-affecting", () => {
    const oldReg = makeRegistration({ contributionSplits: { green_energy: 1000 } });
    const newReg = makeRegistration({ contributionSplits: { green_energy: 2000 } });

    const result = classifyChanges(oldReg, newReg);

    expect(result.costAffecting).toContain("contributionSplits");
  });

  it("removing a contribution split is classified cost-affecting", () => {
    const oldReg = makeRegistration({ contributionSplits: { scholarship: 500 } });
    const newReg = makeRegistration({ contributionSplits: {} });

    const result = classifyChanges(oldReg, newReg);

    expect(result.costAffecting).toContain("contributionSplits");
  });

  it("identical contributionSplits object (different reference, same content) is not flagged", () => {
    // Catches: generator using reference equality (===) instead of structural
    // comparison for the splits object
    const oldReg = makeRegistration({ contributionSplits: { green_energy: 1000 } });
    const newReg = makeRegistration({ contributionSplits: { green_energy: 1000 } });

    const result = classifyChanges(oldReg, newReg);

    expect(result.costAffecting).not.toContain("contributionSplits");
  });
});

describe("classifyChanges — EMAIL_GATED: email is neither cosmetic nor cost-affecting", () => {
  it("email change sets emailChanged=true and appears in neither list", () => {
    const oldReg = makeRegistration({ email: "old@example.com" });
    const newReg = makeRegistration({ email: "new@example.com" });

    const result = classifyChanges(oldReg, newReg);

    expect(result.emailChanged).toBe(true);
    expect(result.cosmetic).not.toContain("email");
    expect(result.costAffecting).not.toContain("email");
  });

  it("no email change sets emailChanged=false", () => {
    const oldReg = makeRegistration({ email: "same@example.com" });
    const newReg = makeRegistration({ email: "same@example.com" });

    const result = classifyChanges(oldReg, newReg);

    expect(result.emailChanged).toBe(false);
  });
});

describe("classifyChanges — PARTICIPATION_COUPLING", () => {
  it("participationType change also lists attendanceIntent in costAffecting", () => {
    const oldReg = makeRegistration({ participationType: "full_celebration", attendanceIntent: "attending" });
    const newReg = makeRegistration({ participationType: "donation_only", attendanceIntent: "donation_only" });

    const result = classifyChanges(oldReg, newReg);

    expect(result.costAffecting).toContain("participationType");
    expect(result.costAffecting).toContain("attendanceIntent");
  });
});

describe("classifyChanges — no changes produce empty classification (PURE)", () => {
  it("identical registrations produce empty cosmetic, empty costAffecting, emailChanged=false", () => {
    const reg = makeRegistration();
    const result = classifyChanges(reg, { ...reg });

    expect(result.cosmetic).toEqual([]);
    expect(result.costAffecting).toEqual([]);
    expect(result.emailChanged).toBe(false);
  });

  it("null vs undefined on a nullable field are treated as equal (FAILURE BEHAVIOR)", () => {
    // mobileAlternate is the only nullable cosmetic field on the domain type —
    // used here (not breakfast, which is non-nullable `number`) to test the
    // documented null/undefined-equivalence behavior without fabricating a
    // state breakfast fields cannot actually hold.
    const oldReg = makeRegistration({ mobileAlternate: null });
    const newReg = makeRegistration({ mobileAlternate: undefined as unknown as string | null });

    const result = classifyChanges(oldReg, newReg);

    expect(result.cosmetic).not.toContain("mobileAlternate");
  });
});
