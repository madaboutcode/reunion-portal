/**
 * Vitest tests for step-config.ts — wizard navigation logic.
 *
 * Covers:
 *   - getDisabledSteps: which steps are skipped per participationType
 *   - resolveNextStep: forward navigation (including skip logic)
 *   - resolveBackStep: backward navigation (including skip logic)
 *
 * Step map (7 steps):
 *   1 Participation, 2 About You, 3 Your Group, 4 Your Stay,
 *   5 Giving Back, 6 Photo & ID, 7 Review & Pay
 *
 * Skip rules:
 *   - donation_only: steps 3 (Your Group) and 4 (Your Stay) skipped
 *   - campus_only: step 4 (Your Stay) skipped
 *   - full_celebration: no skips
 */

import { describe, it, expect } from "vitest";
import { getDisabledSteps, resolveNextStep, resolveBackStep } from "../step-config";
import type { WizardState, WizardStep } from "../../types/registration";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mkState(participationType: "full_celebration" | "campus_only" | "donation_only"): WizardState {
  return {
    fullName: "Test",
    branch: "Computer Science & Engineering",
    gender: "male" as const,
    email: "test@test.com",
    whatsapp: "+919876543210",
    mobileAlternate: "",
    city: "Kochi",
    country: "India",
    attendanceIntent: participationType === "donation_only" ? "donation_only" : "attending",
    participationType,
    alumniMeal: "veg",
    tshirtSize: "M" as const,
    spouseName: "",
    spouseMeal: "veg",
    children: [],
    guests: [],
    accommodation: "none",
    extraBed: false,
    checkIn: "",
    checkOut: "",
    donationAmount: "",
    publicAcknowledgement: false,
    acknowledgementDisplayName: "",
    felicitationConsent: false,
    idFileName: "",
    idNote: "",
    collegeContribution: 500,
    collegeContributionCause: "",
    photoFileName: "",
    currentStep: 1,
    maxReachedStep: 1,
  };
}

// ── getDisabledSteps ─────────────────────────────────────────────────────────

describe("getDisabledSteps", () => {
  it("full_celebration: no steps disabled", () => {
    const disabled = getDisabledSteps(mkState("full_celebration"));
    expect(disabled.size).toBe(0);
  });

  it("campus_only: step 4 (Your Stay) disabled only", () => {
    const disabled = getDisabledSteps(mkState("campus_only"));
    expect(disabled.size).toBe(1);
    expect(disabled.has(4)).toBe(true);
  });

  it("donation_only: steps 3 and 4 disabled", () => {
    const disabled = getDisabledSteps(mkState("donation_only"));
    expect(disabled.has(3)).toBe(true);
    expect(disabled.has(4)).toBe(true);
  });

  it("donation_only: only steps 3 and 4 disabled (not 1, 2, 5, 6, 7)", () => {
    const disabled = getDisabledSteps(mkState("donation_only"));
    expect(disabled.size).toBe(2);
    expect(disabled.has(1)).toBe(false);
    expect(disabled.has(2)).toBe(false);
    expect(disabled.has(5)).toBe(false);
    expect(disabled.has(6)).toBe(false);
    expect(disabled.has(7)).toBe(false);
  });
});

// ── resolveNextStep — donation_only navigation ────────────────────────────────

describe("resolveNextStep — donation_only: steps 3 & 4 skipped", () => {
  const donorDisabled = new Set([3, 4]);

  it("step 1 → step 2 (normal)", () => {
    expect(resolveNextStep(1, donorDisabled)).toBe(2);
  });

  it("step 2 → step 5 (skips steps 3 and 4)", () => {
    expect(resolveNextStep(2, donorDisabled)).toBe(5);
  });

  it("step 5 → step 6", () => {
    expect(resolveNextStep(5, donorDisabled)).toBe(6);
  });

  it("step 6 → step 7", () => {
    expect(resolveNextStep(6, donorDisabled)).toBe(7);
  });

  it("step 7 → confirmation", () => {
    expect(resolveNextStep(7, donorDisabled)).toBe("confirmation");
  });
});

// ── resolveNextStep — campus_only navigation ──────────────────────────────────

describe("resolveNextStep — campus_only: step 4 skipped", () => {
  const campusDisabled = new Set([4]);

  it("step 3 → step 5 (skips step 4)", () => {
    expect(resolveNextStep(3, campusDisabled)).toBe(5);
  });

  it("step 2 → step 3 (normal)", () => {
    expect(resolveNextStep(2, campusDisabled)).toBe(3);
  });
});

// ── resolveNextStep — full_celebration (no disabled steps) ───────────────────

describe("resolveNextStep — full_celebration: sequential 1→2→3→4→5→6→7→confirmation", () => {
  const noDisabled = new Set<number>();

  it("1 → 2", () => expect(resolveNextStep(1, noDisabled)).toBe(2));
  it("2 → 3", () => expect(resolveNextStep(2, noDisabled)).toBe(3));
  it("3 → 4", () => expect(resolveNextStep(3, noDisabled)).toBe(4));
  it("4 → 5", () => expect(resolveNextStep(4, noDisabled)).toBe(5));
  it("5 → 6", () => expect(resolveNextStep(5, noDisabled)).toBe(6));
  it("6 → 7", () => expect(resolveNextStep(6, noDisabled)).toBe(7));
  it("7 → confirmation", () => expect(resolveNextStep(7, noDisabled)).toBe("confirmation"));
  it("confirmation → confirmation (idempotent)", () => {
    expect(resolveNextStep("confirmation" as WizardStep, noDisabled)).toBe("confirmation");
  });
});

// ── resolveBackStep — donation_only navigation ────────────────────────────────

describe("resolveBackStep — donation_only: steps 3 & 4 skipped", () => {
  const donorDisabled = new Set([3, 4]);

  it("step 5 → step 2 (skips back over steps 4 and 3)", () => {
    expect(resolveBackStep(5, donorDisabled)).toBe(2);
  });

  it("step 6 → step 5", () => {
    expect(resolveBackStep(6, donorDisabled)).toBe(5);
  });

  it("step 7 → step 6", () => {
    expect(resolveBackStep(7, donorDisabled)).toBe(6);
  });

  it("confirmation → step 7 (last non-disabled step before confirmation)", () => {
    expect(resolveBackStep("confirmation" as WizardStep, donorDisabled)).toBe(7);
  });
});

// ── resolveBackStep — full_celebration ───────────────────────────────────────

describe("resolveBackStep — full_celebration: sequential 2→1, 3→2, etc.", () => {
  const noDisabled = new Set<number>();

  it("2 → 1", () => expect(resolveBackStep(2, noDisabled)).toBe(1));
  it("3 → 2", () => expect(resolveBackStep(3, noDisabled)).toBe(2));
  it("4 → 3", () => expect(resolveBackStep(4, noDisabled)).toBe(3));
  it("5 → 4", () => expect(resolveBackStep(5, noDisabled)).toBe(4));
  it("6 → 5", () => expect(resolveBackStep(6, noDisabled)).toBe(5));
  it("7 → 6", () => expect(resolveBackStep(7, noDisabled)).toBe(6));
  it("confirmation → 7", () => {
    expect(resolveBackStep("confirmation" as WizardStep, noDisabled)).toBe(7);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("resolveNextStep — edge cases", () => {
  it("all steps disabled: step 1 → confirmation (nothing left)", () => {
    const allDisabled = new Set([1, 2, 3, 4, 5, 6, 7]);
    expect(resolveNextStep(1, allDisabled)).toBe("confirmation");
  });
});

describe("resolveBackStep — edge cases", () => {
  it("all steps disabled: back from step 7 → step 1 (floor fallback)", () => {
    const allDisabled = new Set([1, 2, 3, 4, 5, 6, 7]);
    expect(resolveBackStep(7, allDisabled)).toBe(1);
  });

  it("all steps disabled: back from confirmation → step 1 (no active steps)", () => {
    const allDisabled = new Set([1, 2, 3, 4, 5, 6, 7]);
    expect(resolveBackStep("confirmation" as WizardStep, allDisabled)).toBe(1);
  });
});
