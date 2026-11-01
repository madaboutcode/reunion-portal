import { describe, it, expect } from "vitest";
import { toRegistration } from "../mapping.ts";
import { registrationSchema } from "../registration-schema.ts";
import type { WizardDraft } from "../types.ts";

function emptyDraft(overrides?: Partial<WizardDraft>): WizardDraft {
  return {
    fullName: "",
    branch: "",
    gender: "male",
    email: "",
    whatsapp: "",
    city: "",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    alumniMeal: "non_veg",
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
    collegeContributionCause: "green_energy" as const,
    photoFileName: "",
    ...overrides,
  };
}

describe("toRegistration", () => {
  it("empty draft produces minimal Registration", () => {
    const reg = toRegistration(emptyDraft());
    expect(reg.contact.fullName).toBe("");
    expect(reg.attendees.spouse).toBeUndefined();
    expect(reg.accommodation).toBeUndefined();
    expect(reg.donation).toBeUndefined();
    expect(reg.idDocument).toBeUndefined();
  });

  it("draft with spouse name produces spouse present", () => {
    const reg = toRegistration(emptyDraft({ spouseName: "Jane", spouseMeal: "veg" }));
    expect(reg.attendees.spouse).toEqual({ name: "Jane", meal: "veg" });
  });

  it("draft with whitespace-only spouse name produces spouse absent", () => {
    const reg = toRegistration(emptyDraft({ spouseName: "   ", spouseMeal: "non_veg" }));
    expect(reg.attendees.spouse).toBeUndefined();
  });

  it("donation = '0' string produces no donation", () => {
    const reg = toRegistration(emptyDraft({ donationAmount: "0" }));
    expect(reg.donation).toBeUndefined();
  });

  it("donation = '' produces no donation", () => {
    const reg = toRegistration(emptyDraft({ donationAmount: "" }));
    expect(reg.donation).toBeUndefined();
  });

  it("donation = non-numeric string produces no donation", () => {
    const reg = toRegistration(emptyDraft({ donationAmount: "abc" }));
    expect(reg.donation).toBeUndefined();
  });

  it("donationAmount '500' produces donation present", () => {
    const reg = toRegistration(emptyDraft({
      donationAmount: "500",
      publicAcknowledgement: true,
      felicitationConsent: false,
    }));
    expect(reg.donation).toEqual({
      amount: 500,
      publicAcknowledgement: true,
      acknowledgementDisplayName: undefined,
      felicitationConsent: false,
    });
  });

  it("donationAmount '0.01' produces donation present with amount 0.01", () => {
    const reg = toRegistration(emptyDraft({ donationAmount: "0.01" }));
    expect(reg.donation).toBeDefined();
    expect(reg.donation!.amount).toBe(0.01);
  });

  it("accommodation 'none' produces undefined", () => {
    const reg = toRegistration(emptyDraft({ accommodation: "none" }));
    expect(reg.accommodation).toBeUndefined();
  });

  it("accommodation 'shared_double' produces present with dates and extraBed", () => {
    const reg = toRegistration(emptyDraft({
      accommodation: "shared_double",
      extraBed: false,
      checkIn: "2026-08-14",
      checkOut: "2026-08-16",
    }));
    expect(reg.accommodation).toEqual({
      type: "shared_double",
      checkIn: "2026-08-14",
      checkOut: "2026-08-16",
      extraBed: false,
    });
  });

  it("accommodation 'private' produces present with dates and extraBed", () => {
    const reg = toRegistration(emptyDraft({
      accommodation: "private",
      extraBed: false,
      checkIn: "2026-08-15",
      checkOut: "2026-08-16",
    }));
    expect(reg.accommodation).toEqual({
      type: "private",
      checkIn: "2026-08-15",
      checkOut: "2026-08-16",
      extraBed: false,
    });
  });

  it("idFileKey present produces idDocument present", () => {
    const reg = toRegistration(emptyDraft({
      idFileKey: "uploads/id-abc.pdf",
      idFileType: "application/pdf",
      idFileSizeBytes: 1024,
      idFileName: "aadhaar.pdf",
      idNote: "ID proof",
    }));
    expect(reg.idDocument).toEqual({
      fileKey: "uploads/id-abc.pdf",
      fileType: "application/pdf",
      sizeBytes: 1024,
      fileName: "aadhaar.pdf",
      note: "ID proof",
    });
  });

  it("idFileKey absent produces idDocument absent", () => {
    const reg = toRegistration(emptyDraft({ idFileKey: undefined }));
    expect(reg.idDocument).toBeUndefined();
  });

  it("acknowledgementDisplayName whitespace becomes undefined", () => {
    const reg = toRegistration(emptyDraft({
      donationAmount: "100",
      acknowledgementDisplayName: "   ",
    }));
    expect(reg.donation!.acknowledgementDisplayName).toBeUndefined();
  });

  it("mobileAlternate whitespace becomes undefined", () => {
    const reg = toRegistration(emptyDraft({ mobileAlternate: "  " }));
    expect(reg.contact.mobileAlternate).toBeUndefined();
  });

  it("full draft with all optional fields produces complete Registration", () => {
    const draft = emptyDraft({
      fullName: "Ravi",
      branch: "Computer Science & Engineering",
      email: "a@b.com",
      whatsapp: "+919876543210",
      city: "Kochi",
      spouseName: "Jane",
      spouseMeal: "veg",
      accommodation: "private",
      extraBed: false,
      checkIn: "2026-08-14",
      checkOut: "2026-08-16",
      donationAmount: "1000",
      publicAcknowledgement: true,
      acknowledgementDisplayName: "Ravi",
      felicitationConsent: true,
      idFileKey: "uploads/id.pdf",
      idFileType: "application/pdf",
      idFileSizeBytes: 2048,
      idFileName: "id.pdf",
      idNote: "my id",
    });

    const reg = toRegistration(draft);

    expect(reg.contact.fullName).toBe("Ravi");
    expect(reg.attendees.spouse).toEqual({ name: "Jane", meal: "veg" });
    expect(reg.accommodation).toEqual({
      type: "private",
      checkIn: "2026-08-14",
      checkOut: "2026-08-16",
      extraBed: false,
    });
    expect(reg.donation).toEqual({
      amount: 1000,
      publicAcknowledgement: true,
      acknowledgementDisplayName: "Ravi",
      felicitationConsent: true,
    });
    expect(reg.idDocument).toEqual({
      fileKey: "uploads/id.pdf",
      fileType: "application/pdf",
      sizeBytes: 2048,
      fileName: "id.pdf",
      note: "my id",
    });
  });
});

describe("round-trip: toRegistration → registrationSchema", () => {
  it("full valid draft produces schema-valid Registration", () => {
    const draft: WizardDraft = {
      fullName: "Ravi",
      branch: "Computer Science & Engineering",
      gender: "male",
      email: "a@b.com",
      whatsapp: "+919876543210",
      city: "Kochi",
      country: "India",
      attendanceIntent: "attending",
      participationType: "full_celebration",
      alumniMeal: "veg",
      tshirtSize: "L",
      spouseName: "Jane",
      spouseMeal: "veg",
      children: [
        { id: "c1", name: "Kid", age: 5, meal: "veg" },
      ],
      guests: [
        { id: "g1", name: "Guest", relationship: "", meal: "non_veg" },
      ],
      accommodation: "private",
      extraBed: false,
      checkIn: "2026-08-14",
      checkOut: "2026-08-16",
      donationAmount: "1000",
      publicAcknowledgement: true,
      acknowledgementDisplayName: "Donor",
      felicitationConsent: true,
      idFileName: "id.pdf",
      idNote: "my id",
      idFileKey: "uploads/id.pdf",
      idFileType: "application/pdf",
      idFileSizeBytes: 2048,
      collegeContribution: 500,
      collegeContributionCause: "green_energy" as const,
      photoFileName: "",
    };

    const reg = toRegistration(draft);
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(true);
  });

  it("minimal draft produces schema-valid Registration", () => {
    const draft: WizardDraft = {
      fullName: "Min",
      branch: "Electronics & Communication Engineering",
      gender: "male",
      email: "min@test.com",
      whatsapp: "+919876543210",
      city: "TVM",
      country: "India",
      attendanceIntent: "attending",
      participationType: "full_celebration",
      alumniMeal: "non_veg",
      tshirtSize: "M",
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
      idFileName: "id.pdf",
      idNote: "",
      idFileKey: "uploads/id.pdf",
      idFileType: "application/pdf",
      idFileSizeBytes: 1024,
      collegeContribution: 500,
      collegeContributionCause: "green_energy" as const,
      photoFileName: "",
    };

    const reg = toRegistration(draft);
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(true);
    expect(reg.accommodation).toBeUndefined();
    expect(reg.donation).toBeUndefined();
    expect(reg.attendees.spouse).toBeUndefined();
  });

  it("shared_double room with spouse is rejected by registrationSchema (D4)", () => {
    const draft: WizardDraft = {
      fullName: "Solo",
      branch: "Mechanical Engineering",
      gender: "male",
      email: "solo@test.com",
      whatsapp: "+919876543210",
      city: "TVM",
      country: "India",
      attendanceIntent: "attending",
      participationType: "full_celebration",
      alumniMeal: "veg",
      tshirtSize: "L",
      spouseName: "Jane",
      spouseMeal: "veg",
      children: [],
      guests: [],
      accommodation: "shared_double",
      extraBed: false,
      checkIn: "2026-08-14",
      checkOut: "2026-08-16",
      donationAmount: "",
      publicAcknowledgement: false,
      acknowledgementDisplayName: "",
      felicitationConsent: false,
      idFileName: "",
      idNote: "",
      collegeContribution: 500,
      collegeContributionCause: "green_energy" as const,
      photoFileName: "",
    };

    const reg = toRegistration(draft);
    // shared_double + spouse → must be rejected (D4: shared = solo only)
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join("."));
      expect(paths).toContain("accommodation.type");
    }
  });

  it("donation_only without donation is rejected by registrationSchema", () => {
    const draft: WizardDraft = {
      fullName: "Donor",
      branch: "Civil Engineering",
      gender: "male",
      email: "donor@test.com",
      whatsapp: "+919876543210",
      city: "TVM",
      country: "India",
      attendanceIntent: "donation_only",
      participationType: "donation_only",
      alumniMeal: "non_veg",
      tshirtSize: "M",
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
      collegeContribution: 0,
      collegeContributionCause: "" as const,
      photoFileName: "",
    };

    const reg = toRegistration(draft);
    // donation_only + no donation, no contribution → should be rejected
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(i => i.message);
      expect(messages.some(m => m.includes("donation or college contribution"))).toBe(true);
    }
  });

  it("donation_only with undefined tshirtSize → omitted entirely, no fallback fabrication, and schema accepts its absence", () => {
    // tshirtSize is not applicable to donation_only (Step 2 is skipped). toRegistration()
    // must omit the field rather than defaulting it, and registrationSchema — which now
    // makes tshirtSize optional-and-forbidden for donation_only — accepts the absence.
    const draft = emptyDraft({
      fullName: "Donor",
      branch: "Civil Engineering",
      gender: "male",
      email: "donor@test.com",
      whatsapp: "+919876543210",
      city: "TVM",
      country: "India",
      attendanceIntent: "donation_only",
      participationType: "donation_only",
      donationAmount: "5000",
      // tshirtSize NOT set → undefined (simulates skipped Step 2)
    });

    const reg = toRegistration(draft);
    expect(reg.attendance.tshirtSize).toBeUndefined();

    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// toRegistration — extraBed mapping (§6 A4 GUARANTEES)
// =============================================================================

describe("toRegistration — extraBed mapping", () => {
  // ── Auto-on: >12 child + private → extraBed forced true (D6) ─────────────

  it("private + child age 14 → registration.accommodation.extraBed === true (auto-on)", () => {
    // Catches: toRegistration passes draft.extraBed through without applying the
    //          auto-on rule for >12 children on private rooms (D6)
    const reg = toRegistration(emptyDraft({
      accommodation: "private",
      extraBed: false, // draft says false, but should be forced true by >12 child
      checkIn: "2026-08-15",
      checkOut: "2026-08-16",
      children: [{ id: "c1", name: "Teen", age: 14, meal: "veg" }],
    }));
    expect(reg.accommodation).toBeDefined();
    expect(reg.accommodation!.extraBed).toBe(true);
  });

  // ── Manual: private + extraBed:true, no children → extraBed stays true ────

  it("private + manual extraBed:true, no children → extraBed === true", () => {
    // Catches: toRegistration resets extraBed to false even when manually set
    const reg = toRegistration(emptyDraft({
      accommodation: "private",
      extraBed: true,
      checkIn: "2026-08-15",
      checkOut: "2026-08-16",
    }));
    expect(reg.accommodation).toBeDefined();
    expect(reg.accommodation!.extraBed).toBe(true);
  });

  // ── No auto-on: private, all children ≤12, extraBed:false → stays false ──

  it("private + children all ≤12 + extraBed:false → extraBed === true (occupant count > 2)", () => {
    // Catches: toRegistration incorrectly ignores total occupants when computing extraBed.
    // With 2 children aged ≥6 → total = 3 > 2 → extraBed auto-true.
    const reg = toRegistration(emptyDraft({
      accommodation: "private",
      extraBed: false,
      checkIn: "2026-08-15",
      checkOut: "2026-08-16",
      children: [
        { id: "c1", name: "YoungOne", age: 8, meal: "veg" },
        { id: "c2", name: "AtBoundary", age: 12, meal: "veg" },
      ],
    }));
    expect(reg.accommodation).toBeDefined();
    expect(reg.accommodation!.extraBed).toBe(true);
  });

  // ── Shared: extraBed forced false regardless of draft value (§6 A4) ───────

  it("shared_double + extraBed:true in draft → mapped extraBed === false (forced)", () => {
    // Catches: toRegistration passes extraBed:true through for shared rooms
    //          (spec §6 A4: extraBed forced false for shared types)
    const reg = toRegistration(emptyDraft({
      accommodation: "shared_double",
      extraBed: true,
      checkIn: "2026-08-15",
      checkOut: "2026-08-16",
    }));
    expect(reg.accommodation).toBeDefined();
    expect(reg.accommodation!.extraBed).toBe(false);
  });

  it("shared_triple + extraBed:true in draft → mapped extraBed === false (forced)", () => {
    // Same guarantee for shared_triple
    const reg = toRegistration(emptyDraft({
      accommodation: "shared_triple",
      extraBed: true,
      checkIn: "2026-08-15",
      checkOut: "2026-08-16",
    }));
    expect(reg.accommodation).toBeDefined();
    expect(reg.accommodation!.extraBed).toBe(false);
  });

  // ── None: accommodation stays undefined ──────────────────────────────────

  it("accommodation 'none' → registration.accommodation === undefined", () => {
    // Existing behaviour retained — re-asserted here for the new type set
    const reg = toRegistration(emptyDraft({ accommodation: "none", extraBed: false }));
    expect(reg.accommodation).toBeUndefined();
  });

  // ── PRICE-002: Auto-on for >2 total occupants in private room ────────────

  it("private + self + spouse + child (8) → extraBed auto-true (>2 occupants)", () => {
    const reg = toRegistration(emptyDraft({
      accommodation: "private",
      extraBed: false,
      checkIn: "2026-08-15",
      checkOut: "2026-08-16",
      spouseName: "Priya",
      children: [{ id: "c1", name: "Arjun", age: 8, meal: "veg" }],
    }));
    expect(reg.accommodation).toBeDefined();
    expect(reg.accommodation!.extraBed).toBe(true);
  });

  it("private + self + spouse (exactly 2) → extraBed stays false", () => {
    const reg = toRegistration(emptyDraft({
      accommodation: "private",
      extraBed: false,
      checkIn: "2026-08-15",
      checkOut: "2026-08-16",
      spouseName: "Priya",
    }));
    expect(reg.accommodation).toBeDefined();
    expect(reg.accommodation!.extraBed).toBe(false);
  });

  it("private + self + spouse + guest → extraBed auto-true (3 occupants)", () => {
    const reg = toRegistration(emptyDraft({
      accommodation: "private",
      extraBed: false,
      checkIn: "2026-08-15",
      checkOut: "2026-08-16",
      spouseName: "Priya",
      guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
    }));
    expect(reg.accommodation).toBeDefined();
    expect(reg.accommodation!.extraBed).toBe(true);
  });

  it("private + self + 2 guests → extraBed auto-true (3 chargeable occupants)", () => {
    const reg = toRegistration(emptyDraft({
      accommodation: "private",
      extraBed: false,
      checkIn: "2026-08-15",
      checkOut: "2026-08-16",
      guests: [
        { id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" },
        { id: "g2", name: "Sita", relationship: "Colleague", meal: "non_veg" },
      ],
    }));
    expect(reg.accommodation).toBeDefined();
    expect(reg.accommodation!.extraBed).toBe(true);
  });
});

// =============================================================================
// registrationSchema — new accommodation type rules (§6 A5, D4)
// =============================================================================

// Helper: build a minimal but complete valid Registration for schema testing.
// "attending" intent requires an idDocument.
function makeValidSoloRegistration(
  accOverrides: Partial<NonNullable<import("../types.ts").Registration["accommodation"]>> = {},
): import("../types.ts").Registration {
  return {
    contact: {
      fullName: "Solo User",
      branch: "Mechanical Engineering",
      gender: "male",
      email: "solo@test.com",
      whatsapp: "+919876543210",
      city: "TVM",
      country: "India",
    },
    attendance: {
      intent: "attending",
      participationType: "full_celebration",
      alumniMeal: "veg",
      tshirtSize: "L",
    },
    attendees: {
      spouse: undefined,
      children: [],
      guests: [],
    },
    accommodation: accOverrides.type
      ? {
          type: accOverrides.type as import("../types.ts").NonNoneAccommodation,
          checkIn: accOverrides.checkIn ?? "2026-08-15",
          checkOut: accOverrides.checkOut ?? "2026-08-16",
          extraBed: accOverrides.extraBed ?? false,
        }
      : undefined,
    donation: undefined,
    idDocument: {
      fileKey: "uploads/id.pdf",
      fileType: "application/pdf",
      sizeBytes: 1024,
      fileName: "id.pdf",
      note: "",
    },
  };
}

describe("registrationSchema — shared rooms + party rejection (D4)", () => {
  it("shared_double solo (no spouse/children/guests) → schema passes", () => {
    // Catches: registrationSchema incorrectly rejects solo shared_double
    const reg = makeValidSoloRegistration({ type: "shared_double" });
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(true);
  });

  it("shared_triple solo (no spouse/children/guests) → schema passes", () => {
    const reg = makeValidSoloRegistration({ type: "shared_triple" });
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(true);
  });

  it("shared_double WITH spouse → schema fails with issue on accommodation.type", () => {
    // Catches: schema doesn't enforce D4 for shared_double
    const reg = makeValidSoloRegistration({ type: "shared_double" });
    reg.attendees = { spouse: { name: "Priya", meal: "veg" }, children: [], guests: [] };
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join("."));
      expect(paths).toContain("accommodation.type");
    }
  });

  it("shared_triple WITH children → schema fails with issue on accommodation.type", () => {
    // Catches: schema enforces D4 only for shared_double, not shared_triple
    const reg = makeValidSoloRegistration({ type: "shared_triple" });
    reg.attendees = {
      spouse: undefined,
      children: [{ id: "c1", name: "Kid", age: 8, meal: "veg" }],
      guests: [],
    };
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join("."));
      expect(paths).toContain("accommodation.type");
    }
  });

  it("shared_double WITH guests → schema fails with issue on accommodation.type", () => {
    // Catches: schema enforces D4 only for spouse/children, not guests
    const reg = makeValidSoloRegistration({ type: "shared_double" });
    reg.attendees = {
      spouse: undefined,
      children: [],
      guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
    };
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map(i => i.path.join("."));
      expect(paths).toContain("accommodation.type");
    }
  });

  it("private WITH spouse AND children → schema passes (D4: only shared restricted)", () => {
    // Catches: schema incorrectly rejects private with family
    const reg = makeValidSoloRegistration({ type: "private" });
    reg.attendees = {
      spouse: { name: "Priya", meal: "veg" },
      children: [{ id: "c1", name: "Kid", age: 8, meal: "veg" }],
      guests: [],
    };
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(true);
  });
});

describe("registrationSchema — extraBed on shared rooms (§6 A5)", () => {
  it("extraBed:true on shared_double → schema fails", () => {
    // Catches: schema accepts extraBed:true on shared rooms
    // (spec §6 A5: extraBed forced false for shared; a truthy value in the DB
    //  would represent an inconsistent state that the schema must reject)
    const reg = makeValidSoloRegistration({ type: "shared_double", extraBed: true });
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// toRegistration — contributionSplits mapping
// =============================================================================

describe("toRegistration — contributionSplits mapping", () => {
  it("draft with contribution > 0 and valid cause → contributionSplits set", () => {
    const reg = toRegistration(emptyDraft({
      collegeContribution: 5000,
      collegeContributionCause: "scholarship",
    }));
    expect(reg.contributionSplits).toEqual({ scholarship: 5000 });
  });

  it("draft with contribution > 0 and cause '' → contributionSplits undefined", () => {
    // cause not selected → no splits emitted even if amount is present
    const reg = toRegistration(emptyDraft({
      collegeContribution: 5000,
      collegeContributionCause: "",
    }));
    expect(reg.contributionSplits).toBeUndefined();
  });

  it("draft with contribution 0 and valid cause → contributionSplits undefined", () => {
    const reg = toRegistration(emptyDraft({
      collegeContribution: 0,
      collegeContributionCause: "green_energy",
    }));
    expect(reg.contributionSplits).toBeUndefined();
  });

  it("donation_only draft with contribution + cause → keeps splits (no longer stripped)", () => {
    const reg = toRegistration(emptyDraft({
      participationType: "donation_only",
      attendanceIntent: "donation_only",
      donationAmount: "0",
      collegeContribution: 3000,
      collegeContributionCause: "green_energy",
    }));
    expect(reg.contributionSplits).toEqual({ green_energy: 3000 });
  });

  it("attending draft carries cause through to splits", () => {
    const reg = toRegistration(emptyDraft({
      participationType: "full_celebration",
      collegeContribution: 2000,
      collegeContributionCause: "green_energy",
    }));
    expect(reg.contributionSplits).toEqual({ green_energy: 2000 });
  });
});

// =============================================================================
// registrationSchema — contributionSplits field validation
// =============================================================================

describe("registrationSchema — contributionSplits validation", () => {
  it("accepts contributionSplits with {green_energy: 5000}", () => {
    const reg = makeValidSoloRegistration();
    const result = registrationSchema.safeParse({
      ...reg,
      contributionSplits: { green_energy: 5000 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts contributionSplits with both causes", () => {
    const reg = makeValidSoloRegistration();
    const result = registrationSchema.safeParse({
      ...reg,
      contributionSplits: { green_energy: 3000, scholarship: 2000 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects contributionSplits with unknown cause key", () => {
    const reg = makeValidSoloRegistration();
    const result = registrationSchema.safeParse({
      ...reg,
      contributionSplits: { unknown_cause: 5000 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects contributionSplits with zero amount", () => {
    const reg = makeValidSoloRegistration();
    const result = registrationSchema.safeParse({
      ...reg,
      contributionSplits: { green_energy: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects contributionSplits with negative amount", () => {
    const reg = makeValidSoloRegistration();
    const result = registrationSchema.safeParse({
      ...reg,
      contributionSplits: { scholarship: -100 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects contributionSplits with non-integer amount", () => {
    const reg = makeValidSoloRegistration();
    const result = registrationSchema.safeParse({
      ...reg,
      contributionSplits: { green_energy: 999.5 },
    });
    expect(result.success).toBe(false);
  });

  it("donation_only with only contributionSplits (no donation) passes schema", () => {
    const reg = {
      ...makeValidSoloRegistration(),
      attendance: {
        intent: "donation_only" as const,
        participationType: "donation_only" as const,
      },
      attendees: { children: [], guests: [] },
      idDocument: undefined,
      contributionSplits: { scholarship: 5000 } as { scholarship: number },
    };
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(true);
  });

  it("donation_only with neither donation nor contributionSplits fails schema", () => {
    const reg = {
      ...makeValidSoloRegistration(),
      attendance: {
        intent: "donation_only" as const,
        participationType: "donation_only" as const,
      },
      attendees: { children: [], guests: [] },
      idDocument: undefined,
    };
    const result = registrationSchema.safeParse(reg);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes("donation or college contribution"))).toBe(true);
    }
  });
});
