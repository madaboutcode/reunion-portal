import { describe, it, expect } from "vitest";
import { toRegistration } from "../mapping.ts";
import { registrationSchema, calculateTotal, validateForPayment } from "../index.ts";
import { WIZARD_DRAFT_GOLDENS, type WizardDraftGoldenId } from "./fixtures/wizard-draft-goldens.ts";

const SUBMITTABLE: WizardDraftGoldenId[] = [
  "full_celebration_minimal",
  "full_celebration_private_room",
  "full_celebration_family",
  "campus_only_attending",
  "donation_only_5000",
];

describe("wizard draft → toRegistration → registrationSchema", () => {
  it.each(SUBMITTABLE)("%s parses and has positive total", (id) => {
    const draft = WIZARD_DRAFT_GOLDENS[id];
    const reg = toRegistration(draft);
    const parsed = registrationSchema.safeParse(reg);
    expect(parsed.success, JSON.stringify(parsed.error?.flatten())).toBe(true);
    expect(calculateTotal(reg).total).toBeGreaterThan(0);

    const review = validateForPayment(draft);
    expect(review.ready, JSON.stringify(review.issues)).toBe(true);
  });

  it("donation_only without tshirtSize in draft maps to an absent field, not a default", () => {
    const reg = toRegistration(WIZARD_DRAFT_GOLDENS.donation_only_5000);
    expect(reg.attendance.tshirtSize).toBeUndefined();
    expect(registrationSchema.safeParse(reg).success).toBe(true);
  });

  it("full_celebration_private_room includes accommodation block", () => {
    const reg = toRegistration(WIZARD_DRAFT_GOLDENS.full_celebration_private_room);
    expect(reg.accommodation?.type).toBe("private");
    expect(reg.accommodation?.checkIn).toBe("2026-08-15");
  });

  it("full_celebration_family maps spouse, children, and guests", () => {
    const reg = toRegistration(WIZARD_DRAFT_GOLDENS.full_celebration_family);
    expect(reg.attendees.spouse?.name).toBe("Karuthamma");
    expect(reg.attendees.children).toHaveLength(2);
    expect(reg.attendees.guests).toHaveLength(1);
  });

  it("attending_missing_photo fails validateForPayment", () => {
    const review = validateForPayment(WIZARD_DRAFT_GOLDENS.attending_missing_photo);
    expect(review.ready).toBe(false);
    expect(review.issues.some((i) => i.field === "photoFileKey")).toBe(true);
  });
});