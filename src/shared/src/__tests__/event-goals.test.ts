/**
 * Unit tests for EVENT_GOALS constants.
 *
 * Asserts the exact values specified in design.md C1 and the context doc.
 */

import { describe, it, expect } from "vitest";
import { EVENT_GOALS } from "../constants.ts";
import type { EventGoals } from "../constants.ts";

describe("EVENT_GOALS", () => {
  it("has fullCelebrationTarget = 200", () => {
    expect(EVENT_GOALS.fullCelebrationTarget).toBe(200);
  });

  it("has campusOnlyTarget = 50", () => {
    expect(EVENT_GOALS.campusOnlyTarget).toBe(50);
  });

  it("has registrationTargetDate = '2026-07-15'", () => {
    expect(EVENT_GOALS.registrationTargetDate).toBe("2026-07-15");
  });

  it("has pendingAgeAmberDays = 3", () => {
    expect(EVENT_GOALS.pendingAgeAmberDays).toBe(3);
  });

  it("satisfies the EventGoals interface shape (all four fields present)", () => {
    // Type-level check: ensure all required fields exist at runtime too
    const goals: EventGoals = EVENT_GOALS;
    expect(typeof goals.fullCelebrationTarget).toBe("number");
    expect(typeof goals.campusOnlyTarget).toBe("number");
    expect(typeof goals.registrationTargetDate).toBe("string");
    expect(typeof goals.pendingAgeAmberDays).toBe("number");
  });

  it("registrationTargetDate is a valid ISO date string (YYYY-MM-DD)", () => {
    expect(EVENT_GOALS.registrationTargetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(new Date(EVENT_GOALS.registrationTargetDate).getTime())).toBe(false);
  });
});
