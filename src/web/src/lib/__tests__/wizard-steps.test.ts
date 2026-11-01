import { describe, it, expect } from "vitest";
import {
  STEP_DEFINITIONS,
  WIZARD_STEP_COUNT,
  formatStepAriaLabel,
  formatStepCount,
  getMobileProgressPct,
  getStepDefinition,
  isStepInBounds,
  isWizardStepNumber,
} from "../wizard-steps";

describe("wizard-steps", () => {
  it("defines 7 registration steps with sequential ids", () => {
    expect(WIZARD_STEP_COUNT).toBe(7);
    expect(STEP_DEFINITIONS).toHaveLength(7);
    expect(STEP_DEFINITIONS[0].mobileLabel).toBe("Participation");
    expect(STEP_DEFINITIONS[6].mobileLabel).toBe("Review");
    STEP_DEFINITIONS.forEach((step, i) => {
      expect(step.id).toBe(i + 1);
    });
  });

  it("isWizardStepNumber accepts 1–7 only", () => {
    expect(isWizardStepNumber(1)).toBe(true);
    expect(isWizardStepNumber(7)).toBe(true);
    expect(isWizardStepNumber(0)).toBe(false);
    expect(isWizardStepNumber(8)).toBe(false);
  });

  it("getStepDefinition returns undefined out of bounds", () => {
    expect(getStepDefinition(2)?.mobileLabel).toBe("About You");
    expect(getStepDefinition(0)).toBeUndefined();
    expect(getStepDefinition(8)).toBeUndefined();
  });

  it("isStepInBounds matches getStepDefinition", () => {
    expect(isStepInBounds(3)).toBe(true);
    expect(isStepInBounds(99)).toBe(false);
  });

  it("formatStepCount produces consistent copy", () => {
    expect(formatStepCount(2)).toBe("Step 2 of 7");
    expect(formatStepCount(2, 3)).toBe("Step 2 of 3");
  });

  it("formatStepAriaLabel optionally includes step name", () => {
    expect(formatStepAriaLabel(2)).toBe("Step 2 of 7");
    expect(formatStepAriaLabel(2, { includeStepName: true })).toBe(
      "Step 2 of 7: About You",
    );
  });

  it("getMobileProgressPct spans 20%–100%", () => {
    expect(getMobileProgressPct(1)).toBe(20);
    expect(getMobileProgressPct(7)).toBe(100);
    expect(getMobileProgressPct(4)).toBe(60);
  });
});