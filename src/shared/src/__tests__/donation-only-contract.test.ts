/**
 * Contract tests for the donation-only registration path.
 *
 * Boundary: the package's public API — toRegistration(), registrationSchema,
 * calculateTotal(), getAttendeeCounts(), validateForPayment() — as consumed by
 * the web wizard and the server. Tests feed WizardDraft/Registration in and
 * assert on the returned Registration / PricingBreakup / AttendeeCounts /
 * ReviewValidation, exercising the full internal pipeline (mapping + sanitize).
 *
 * Spec sources:
 *  - docs/specs/pricing-engine.spec.md R9 (Donation-Only Registrations)
 *  - docs/specs/giving-back.spec.md R1 (Donation-Only Path)
 *  - docs/specs/review-pay.spec.md R1.7, R6 (Donation-Only Path)
 *  - docs/specs/validation.spec.md R6.3, R11, R11.1, R15.1, R15.2
 *  - docs/specs/photo-id.spec.md R4, R9.2, R10
 *  - docs/specs/submission-api.spec.md (Edge Cases — contributionSplits/donation)
 *  - src/shared/src/types.ts, registration-schema.ts, sanitize.ts (canonical
 *    field-presence contract for Registration — no docs/specs file covers
 *    wire-level presence, so these source files are the authority)
 *
 * `attendance.tshirtSize` / `attendance.alumniMeal` are now optional on
 * `Registration`, and `registrationSchema` enforces a two-sided rule via
 * superRefine: FORBIDDEN when `intent === "donation_only"`, REQUIRED
 * otherwise. Independently verified against types.ts, registration-schema.ts,
 * and sanitize.ts before writing section A's absence tests and section B2's
 * schema-rejection tests below — this reverses an earlier version of this
 * file where the caller's claim contradicted the shipped code; the contract
 * has since changed and the contradiction is resolved.
 */

import { describe, it, expect } from "vitest";
import { toRegistration } from "../mapping.ts";
import { registrationSchema } from "../registration-schema.ts";
import { calculateTotal, getAttendeeCounts } from "../pricing.ts";
import { validateForPayment } from "../review-validation.ts";
import type { WizardDraft } from "../types.ts";

// =============================================================================
// FIXTURES
// =============================================================================

/**
 * Minimal valid donation-only WizardDraft — the shape produced by a user who
 * went straight through Step 1 → 2 → 5 → 6 → 7 (skipping 3 and 4, per
 * registration-page.spec.md R9).
 */
function makeDonationOnlyDraft(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return {
    fullName: "Georgekutty",
    branch: "Civil Engineering",
    gender: "male",
    email: "georgekutty@example.com",
    whatsapp: "+919876543210",
    city: "Thiruvananthapuram",
    country: "India",
    attendanceIntent: "donation_only",
    participationType: "donation_only",
    alumniMeal: "veg",
    tshirtSize: undefined,
    spouseName: "",
    spouseMeal: "veg",
    children: [],
    guests: [],
    accommodation: "none",
    extraBed: false,
    checkIn: "",
    checkOut: "",
    donationAmount: "5000",
    publicAcknowledgement: false,
    acknowledgementDisplayName: "",
    felicitationConsent: false,
    idFileName: "",
    idNote: "",
    idFileKey: undefined,
    idFileType: undefined,
    idFileSizeBytes: undefined,
    collegeContribution: 0,
    collegeContributionCause: "",
    photoFileName: "photo.jpg",
    photoFileKey: "key-photo",
    photoFileType: "image/jpeg",
    photoFileSizeBytes: 1024000,
    ...overrides,
  };
}

/**
 * A donation-only draft carrying leftover attendee/accommodation data — as if
 * the user filled Steps 3–4 while participationType was full_celebration,
 * then went back to Step 1 and switched to donation_only. Per
 * attendees-meals.spec.md edge case and accommodation.spec.md R1.2, this data
 * is retained in the draft but must be ignored by every downstream consumer.
 */
function makeLeftoverHeavyDonationDraft(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return makeDonationOnlyDraft({
    tshirtSize: "M",
    spouseName: "Priya",
    spouseMeal: "non_veg",
    children: [{ id: "c1", name: "Arjun", age: 10, meal: "non_veg" }],
    guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
    accommodation: "private",
    extraBed: true,
    checkIn: "2026-08-14",
    checkOut: "2026-08-16",
    idFileName: "id.jpg",
    idFileKey: "key-id",
    idFileType: "image/jpeg",
    idFileSizeBytes: 200000,
    ...overrides,
  });
}

// =============================================================================
// A. toRegistration() — field-presence contract (mapping.spec via
//    pricing-engine.spec.md R9.2, giving-back.spec.md R1, accommodation.spec.md
//    R1.2, attendees-meals.spec.md R1 edge case)
// =============================================================================

describe("toRegistration — donation_only field-presence contract", () => {
  it("attendees.spouse is undefined even when the draft carries a leftover spouse name", () => {
    // R9.2: no attendee charges regardless of other data in the registration.
    // Catches: generator that maps spouseName straight through without checking participationType.
    const reg = toRegistration(makeLeftoverHeavyDonationDraft());
    expect(reg.attendees.spouse).toBeUndefined();
  });

  it("attendees.children is [] even when the draft carries leftover children", () => {
    const reg = toRegistration(makeLeftoverHeavyDonationDraft());
    expect(reg.attendees.children).toEqual([]);
  });

  it("attendees.guests is [] even when the draft carries leftover guests", () => {
    const reg = toRegistration(makeLeftoverHeavyDonationDraft());
    expect(reg.attendees.guests).toEqual([]);
  });

  it("accommodation is undefined even when the draft carries a leftover private-room booking", () => {
    // accommodation.spec.md R1.2: accommodation data is retained in state but ignored.
    const reg = toRegistration(makeLeftoverHeavyDonationDraft());
    expect(reg.accommodation).toBeUndefined();
  });

  it("idDocument round-trips as undefined when no ID was uploaded (ID optional per photo-id.spec.md R9.2)", () => {
    const reg = toRegistration(makeDonationOnlyDraft());
    expect(reg.idDocument).toBeUndefined();
  });

  it("idDocument is still mapped through if present — upload is optional, not forbidden", () => {
    // photo-id.spec.md R9.2 says upload is optional, not that an uploaded ID is discarded.
    const reg = toRegistration(makeLeftoverHeavyDonationDraft());
    expect(reg.idDocument).toEqual({
      fileKey: "key-id",
      fileType: "image/jpeg",
      sizeBytes: 200000,
      fileName: "id.jpg",
      note: "",
    });
  });

  it("contact carries full alumni details (fullName, branch, gender, email, whatsapp, city, country)", () => {
    const reg = toRegistration(makeDonationOnlyDraft());
    expect(reg.contact).toEqual({
      fullName: "Georgekutty",
      branch: "Civil Engineering",
      gender: "male",
      email: "georgekutty@example.com",
      whatsapp: "+919876543210",
      mobileAlternate: undefined,
      city: "Thiruvananthapuram",
      country: "India",
    });
  });

  it("attendance.intent is 'donation_only'", () => {
    const reg = toRegistration(makeDonationOnlyDraft());
    expect(reg.attendance.intent).toBe("donation_only");
  });

  it("attendance.participationType is 'donation_only'", () => {
    const reg = toRegistration(makeDonationOnlyDraft());
    expect(reg.attendance.participationType).toBe("donation_only");
  });

  it("photo is mapped through when uploaded", () => {
    // photo-id.spec.md R4: photo is required for all participation types.
    const reg = toRegistration(makeDonationOnlyDraft());
    expect(reg.photo).toEqual({
      fileKey: "key-photo",
      fileType: "image/jpeg",
      sizeBytes: 1024000,
      fileName: "photo.jpg",
    });
  });

  it("contributionSplits is preserved — donation-only registrants can fund a cause", () => {
    const reg = toRegistration(
      makeDonationOnlyDraft({ donationAmount: "", collegeContribution: 2000, collegeContributionCause: "scholarship" }),
    );
    expect(reg.contributionSplits).toEqual({ scholarship: 2000 });
  });

  it("attendance.tshirtSize is omitted entirely — no fallback fabrication, even when the draft carries a leftover size", () => {
    // types.ts: Registration.attendance.tshirtSize is optional. mapping.ts conditionally
    // spreads alumniMeal/tshirtSize only when participationType !== "donation_only".
    // Catches: generator that reintroduces a `?? "L"` fallback for the required-field case.
    const reg = toRegistration(makeLeftoverHeavyDonationDraft());
    expect(reg.attendance.tshirtSize).toBeUndefined();
    expect("tshirtSize" in reg.attendance).toBe(false);
  });

  it("attendance.alumniMeal is omitted entirely, even when the draft carries a leftover meal preference", () => {
    const reg = toRegistration(makeLeftoverHeavyDonationDraft());
    expect(reg.attendance.alumniMeal).toBeUndefined();
    expect("alumniMeal" in reg.attendance).toBe(false);
  });
});

// =============================================================================
// B. registrationSchema — API-boundary submission contract
//    (submission-api.spec.md edge case; validation.spec.md; pricing-engine.spec.md R9.5)
// =============================================================================

describe("registrationSchema — donation_only submission contract", () => {
  it("accepts a donation-only registration with only a positive donation, no contributionSplits", () => {
    const reg = toRegistration(makeDonationOnlyDraft({ donationAmount: "1000" }));
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(true);
  });

  it("accepts a donation-only registration with only contributionSplits, no donation", () => {
    const reg = toRegistration(
      makeDonationOnlyDraft({ donationAmount: "", collegeContribution: 500, collegeContributionCause: "green_energy" }),
    );
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(true);
  });

  it("accepts a donation-only registration with both donation and contributionSplits", () => {
    const reg = toRegistration(
      makeDonationOnlyDraft({ donationAmount: "3000", collegeContribution: 1000, collegeContributionCause: "scholarship" }),
    );
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(true);
  });

  it("rejects a donation-only registration with neither donation nor contributionSplits (the 'must give something' rule)", () => {
    // Catches: generator that only enforces this rule at the WizardDraft/UI layer, not at the API boundary.
    const reg = toRegistration(makeDonationOnlyDraft({ donationAmount: "" }));
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("donation or college contribution"))).toBe(true);
    }
  });

  it("rejects a donation-only registration with donationAmount '0' and no contribution", () => {
    const reg = toRegistration(makeDonationOnlyDraft({ donationAmount: "0" }));
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(false);
  });

  it("does NOT require idDocument for donation_only", () => {
    // R15.1 (validation.spec.md): ID never required for donation_only.
    // Catches: generator that reuses the "attending" idDocument-required branch unconditionally.
    const reg = toRegistration(makeDonationOnlyDraft());
    expect(reg.idDocument).toBeUndefined();
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(true);
  });

  it("does NOT require accommodation, spouse, children, or guests to be present", () => {
    const reg = toRegistration(makeDonationOnlyDraft());
    expect(reg.accommodation).toBeUndefined();
    expect(reg.attendees.spouse).toBeUndefined();
    expect(reg.attendees.children).toEqual([]);
    expect(reg.attendees.guests).toEqual([]);
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(true);
  });

  it("[FINDING] registrationSchema does not declare a `photo` field at all — photo presence is not enforced at this boundary for any participation type, donation_only included", () => {
    // photo-id.spec.md R4 requires a photo client-side (photoIdSchema + validateForPayment),
    // but registrationSchema (registration-schema.ts) has no `photo` key in its object shape.
    // A registration with no photo passes registrationSchema. This is a real gap between the
    // client-side "required" guarantee and the API-boundary schema — flagged, not asserted as a bug.
    const reg = toRegistration(makeDonationOnlyDraft({ photoFileKey: undefined, photoFileName: "" }));
    expect(reg.photo).toBeUndefined();
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// B2. registrationSchema — tshirtSize/alumniMeal two-sided rule
//     (registration-schema.ts superRefine: forbidden for donation_only,
//     required for attending — both branches must be enforced, or the
//     rule isn't a rule, it's a coincidence)
// =============================================================================

describe("registrationSchema — tshirtSize/alumniMeal forbidden for donation_only", () => {
  it("accepts a donation_only registration with tshirtSize and alumniMeal both absent (the mapped shape)", () => {
    const reg = toRegistration(makeDonationOnlyDraft());
    expect(reg.attendance.tshirtSize).toBeUndefined();
    expect(reg.attendance.alumniMeal).toBeUndefined();
    expect(registrationSchema.safeParse(reg).success).toBe(true);
  });

  it("rejects a donation_only registration where tshirtSize is present", () => {
    // Catches: generator that makes the field optional but forgets to reject its presence
    // for donation_only — i.e. treats "optional" as "don't care" instead of "forbidden".
    const reg = toRegistration(makeDonationOnlyDraft());
    const tampered = { ...reg, attendance: { ...reg.attendance, tshirtSize: "L" as const } };
    const result = registrationSchema.safeParse(tampered);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("attendance.tshirtSize");
    }
  });

  it("rejects a donation_only registration where alumniMeal is present", () => {
    const reg = toRegistration(makeDonationOnlyDraft());
    const tampered = { ...reg, attendance: { ...reg.attendance, alumniMeal: "veg" as const } };
    const result = registrationSchema.safeParse(tampered);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("attendance.alumniMeal");
    }
  });

  it("the mirror rule: rejects an attending (full_celebration) registration where tshirtSize/alumniMeal are ABSENT", () => {
    // The other side of the same superRefine — required, not just permitted, when attending.
    // Without this half, "optional" tests alone can't prove the rule branches on intent at all.
    const reg = toRegistration(
      makeDonationOnlyDraft({ participationType: "full_celebration", attendanceIntent: "attending", tshirtSize: "M" }),
    );
    const tampered = { ...reg, attendance: { ...reg.attendance, tshirtSize: undefined, alumniMeal: undefined } };
    const result = registrationSchema.safeParse(tampered);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("attendance.tshirtSize");
      expect(paths).toContain("attendance.alumniMeal");
    }
  });
});

// =============================================================================
// C. calculateTotal + getAttendeeCounts — pricing contract (R9, R11.5)
// =============================================================================

describe("calculateTotal — donation_only pricing contract (R9)", () => {
  it("base fee is 0 (R9.1)", () => {
    const reg = toRegistration(makeDonationOnlyDraft());
    expect(calculateTotal(reg).base).toBe(0);
  });

  it("ignores leftover spouse/children/guests/accommodation data end-to-end through toRegistration (R9.2)", () => {
    // Distinguishes from pricing.test.ts's hand-built Registration cases: this drives the
    // *real* consumer boundary (WizardDraft → toRegistration → calculateTotal) so mapping's
    // sanitize step is exercised too, not just the pricing function in isolation.
    const reg = toRegistration(makeLeftoverHeavyDonationDraft({ donationAmount: "1000" }));
    const result = calculateTotal(reg);
    expect(result.lines).toEqual([]);
    expect(result.total).toBe(1000);
  });

  it("total equals donation + sum(contributionSplits) — the baked-in ₹1,000 college contribution is never charged (R9.4, R9.5)", () => {
    const reg = toRegistration(
      makeDonationOnlyDraft({ donationAmount: "2000", collegeContribution: 500, collegeContributionCause: "green_energy" }),
    );
    const result = calculateTotal(reg);
    expect(result.donation).toBe(2000);
    expect(result.collegeContribution).toBe(500);
    expect(result.total).toBe(2500);
    expect(result.lines).toEqual([
      { label: "Batch Contribution to College — Green Energy Project", fee: 500, free: false, category: "event" },
    ]);
  });

  it("breakdown shows only college contribution line items and the donation — no base/attendee/accommodation/platform lines (R9.3)", () => {
    const reg = toRegistration(
      makeLeftoverHeavyDonationDraft({ donationAmount: "4000", collegeContribution: 1000, collegeContributionCause: "scholarship" }),
    );
    const result = calculateTotal(reg);
    expect(result.base).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].label).toContain("Scholarship");
    expect(result.total).toBe(5000);
  });
});

describe("getAttendeeCounts — donation_only headcount contract (R11.5)", () => {
  it("headcount is zero even when the draft carries a full leftover attendee list", () => {
    // Resolves the [REVIEW] flag on pricing-engine.spec.md R11.5: confirms the primary
    // registrant is NOT counted for donation_only, unlike every other participation type.
    const reg = toRegistration(makeLeftoverHeavyDonationDraft());
    const counts = getAttendeeCounts(reg);
    expect(counts).toEqual({ veg: 0, nonveg: 0, total: 0 });
  });
});

// =============================================================================
// D. validateForPayment — donation-only short-circuit (R11, R11.1)
// =============================================================================

describe("validateForPayment — donation_only short-circuit contract (R11)", () => {
  it("ready:true with only a donation, no contribution, no ID, no tshirt, no attendees data", () => {
    const result = validateForPayment(makeDonationOnlyDraft());
    expect(result.ready).toBe(true);
  });

  it("ready:false with neither donation nor contribution — error routes to donationAmount", () => {
    const result = validateForPayment(makeDonationOnlyDraft({ donationAmount: "" }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "donationAmount" && i.step === 5)).toBe(true);
  });

  it("ready:false when collegeContribution > 0 but no cause selected", () => {
    const result = validateForPayment(
      makeDonationOnlyDraft({ donationAmount: "", collegeContribution: 500, collegeContributionCause: "" }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "collegeContributionCause")).toBe(true);
  });

  it("ready:false when photo is missing, even with a valid donation", () => {
    // R15.2: photo required for all participation types, including donation_only.
    const result = validateForPayment(makeDonationOnlyDraft({ photoFileKey: undefined, photoFileName: "" }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "photoFileKey")).toBe(true);
  });

  it("R11.1 — Step 3/4 issues in leftover data do NOT block submission: invalid child age is ignored", () => {
    // Catches: generator that runs the shared child-age check unconditionally before the
    // donation_only branch, instead of returning early per R11.
    const draft = makeLeftoverHeavyDonationDraft({
      children: [{ id: "c1", name: "Arjun", age: Number.NaN, meal: "non_veg" }],
    });
    const result = validateForPayment(draft);
    expect(result.ready).toBe(true);
    expect(result.issues.some((i) => i.field.startsWith("children"))).toBe(false);
  });

  it("R11.1 — Step 3/4 issues in leftover data do NOT block submission: shared-room-with-family conflict is ignored", () => {
    // Leftover accommodation = shared_double with a spouse present would fail the solo-room
    // rule (R13.1) for an attending registrant. For donation_only it must never be evaluated.
    const draft = makeLeftoverHeavyDonationDraft({ accommodation: "shared_double" });
    const result = validateForPayment(draft);
    expect(result.ready).toBe(true);
    expect(result.issues.some((i) => i.section === "stay")).toBe(false);
  });

  it("R11.1 — missing tshirtSize/alumniMeal in the draft does not block submission (Step 3 is skipped)", () => {
    const draft = makeDonationOnlyDraft({ tshirtSize: undefined });
    const result = validateForPayment(draft);
    expect(result.ready).toBe(true);
    expect(result.issues.some((i) => i.field === "tshirtSize")).toBe(false);
  });

  it("does not require an ID document even when Step 6 was reached without one", () => {
    const result = validateForPayment(makeDonationOnlyDraft({ idFileKey: undefined }));
    expect(result.ready).toBe(true);
    expect(result.issues.some((i) => i.field === "idFileKey")).toBe(false);
  });
});

// =============================================================================
// E. Integrated end-to-end — one leftover-heavy draft through the whole pipeline
// =============================================================================

describe("donation_only — full pipeline integration (WizardDraft → Registration → schema → pricing → validateForPayment)", () => {
  it("a user who switched from full_celebration to donation_only submits cleanly with the entire contract holding at once", () => {
    const draft = makeLeftoverHeavyDonationDraft({ donationAmount: "5000", collegeContribution: 1000, collegeContributionCause: "green_energy" });

    const reg = toRegistration(draft);

    // Field-presence contract
    expect(reg.attendees.spouse).toBeUndefined();
    expect(reg.attendees.children).toEqual([]);
    expect(reg.attendees.guests).toEqual([]);
    expect(reg.accommodation).toBeUndefined();
    expect(reg.attendance.tshirtSize).toBeUndefined();
    expect(reg.attendance.alumniMeal).toBeUndefined();
    expect(reg.contributionSplits).toEqual({ green_energy: 1000 });

    // API-boundary contract
    const parsed = registrationSchema.safeParse(reg);
    expect(parsed.success, JSON.stringify(parsed.error?.flatten())).toBe(true);

    // Pricing contract
    const pricing = calculateTotal(reg);
    expect(pricing.base).toBe(0);
    expect(pricing.total).toBe(6000);

    // Headcount contract
    expect(getAttendeeCounts(reg)).toEqual({ veg: 0, nonveg: 0, total: 0 });

    // Pre-submission checklist contract
    const review = validateForPayment(draft);
    expect(review.ready, JSON.stringify(review.issues)).toBe(true);
  });
});
