import { describe, it, expect } from "vitest";
import {
  buildInitialWizardState,
  clampResumeStep,
} from "@/lib/build-initial-wizard-state";
import { createInitialData } from "@/lib/pricing";

describe("clampResumeStep", () => {
  it("clamps donation_only step 4 down to step 2 (steps 3–4 skipped)", () => {
    expect(clampResumeStep("donation_only", 4)).toBe(2);
  });

  it("allows donation_only step 5", () => {
    expect(clampResumeStep("donation_only", 5)).toBe(5);
  });

  it("keeps campus_only step 3 when step 4 is disabled", () => {
    expect(clampResumeStep("campus_only", 3)).toBe(3);
    expect(clampResumeStep("campus_only", 4)).toBe(3);
  });
});

describe("buildInitialWizardState", () => {
  it("restores currentStep from saved draft (R19)", () => {
    const base = createInitialData();
    const state = buildInitialWizardState({
      ...base,
      fullName: "Saved User",
      participationType: "full_celebration",
      currentStep: 6,
    });
    expect(state.currentStep).toBe(6);
    expect(state.fullName).toBe("Saved User");
  });

  it("clamps invalid step for donation_only", () => {
    const base = createInitialData();
    const state = buildInitialWizardState({
      ...base,
      participationType: "donation_only",
      currentStep: 4,
      donationAmount: "5000",
    });
    expect(state.currentStep).toBe(2);
  });
});