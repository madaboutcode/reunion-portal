/**
 * Unit tests for per-step Zod validation schemas.
 *
 * Tests alumniDetailsSchema through photoIdSchema DIRECTLY — not via registrationSchema
 * or the service layer. These schemas are what the form UI applies step-by-step.
 *
 * Also tests validateForPayment from review-validation.ts.
 *
 * NOTE: Several spec/implementation discrepancies exist (see comments with [GAP]).
 * These tests verify the ACTUAL schema behavior, not the spec's stated intent.
 * Where behavior differs from what a reader might expect, [GAP] comments flag it.
 */

import { describe, it, expect } from "vitest";
import {
  alumniDetailsSchema,
  attendeesMealsSchema,
  accommodationSchema,
  collegeContributionSchema,
  givingBackSchema,
  photoIdSchema,
  childSchema,
  guestSchema,
  MAX_ID_FILE_SIZE,
  MAX_PHOTO_FILE_SIZE,
} from "../validation.ts";
import { PRICING_DEFAULTS } from "../constants.ts";
import { validateForPayment } from "../review-validation.ts";
import type { WizardDraft } from "../types.ts";

// =============================================================================
// HELPERS
// =============================================================================

function validAlumniDetails(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Ravi Kumar",
    branch: "Computer Science & Engineering",
    gender: "male" as const,
    email: "ravi@example.com",
    whatsapp: "+919876543210",
    city: "Kochi",
    country: "India",
    attendanceIntent: "attending" as const,
    ...overrides,
  };
}

function validAttendeesMeals(overrides: Record<string, unknown> = {}) {
  return {
    alumniMeal: "non_veg" as const,
    tshirtSize: "L" as const,
    spouseName: "",
    spouseMeal: "veg" as const,
    children: [] as { id: string; name: string; age: number; meal: "veg" | "non_veg" }[],
    guests: [] as { id: string; name: string; relationship: string; meal: "veg" | "non_veg" }[],
    ...overrides,
  };
}

function validAccommodation(overrides: Record<string, unknown> = {}) {
  return {
    accommodation: "none" as const,
    extraBed: false as boolean,
    checkIn: "",
    checkOut: "",
    ...overrides,
  };
}

function validGivingBack(overrides: Record<string, unknown> = {}) {
  return {
    collegeContribution: 500,
    collegeContributionCause: "green_energy" as const,
    donationAmount: "",
    publicAcknowledgement: false,
    acknowledgementDisplayName: "",
    felicitationConsent: false,
    participationType: "full_celebration" as const,
    ...overrides,
  };
}

function validCollegeContribution(overrides: Record<string, unknown> = {}) {
  return {
    collegeContribution: 500,
    ...overrides,
  };
}

function validPhotoId(overrides: Record<string, unknown> = {}) {
  return {
    photoFileName: "photo.jpg",
    photoFileKey: "uploads/photo.jpg",
    photoFileType: "image/jpeg",
    photoFileSizeBytes: 1024,
    idFileName: "",
    idNote: "",
    ...overrides,
  };
}

function paymentBaseData(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return {
    fullName: "Test User",
    branch: "Computer Science & Engineering",
    gender: "male",
    email: "test@test.com",
    whatsapp: "+919876543210",
    mobileAlternate: "",
    city: "Kochi",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    alumniMeal: "non_veg",
    tshirtSize: "L",
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
    idFileName: "id.jpg",
    idNote: "",
    idFileKey: "uploads/test-id.pdf",
    idFileType: "image/jpeg",
    idFileSizeBytes: 1024,
    collegeContribution: 500,
    collegeContributionCause: "green_energy" as const,
    photoFileName: "photo.jpg",
    photoFileKey: "uploads/test-photo.jpg",
    ...overrides,
  };
}

// =============================================================================
// childSchema (reusable, also covered by attendeesMealsSchema tests)
// =============================================================================

describe("childSchema", () => {
  const validChild = { id: "c1", name: "Arjun", age: 8, meal: "non_veg" as const };

  it("accepts valid child", () => {
    expect(childSchema.safeParse(validChild).success).toBe(true);
  });

  it("rejects child with missing id", () => {
    const result = childSchema.safeParse({ name: "Arjun", age: 8, meal: "non_veg" });
    expect(result.success).toBe(false);
  });

  it("rejects child with age < 0", () => {
    const result = childSchema.safeParse({ ...validChild, age: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects child with age > 99", () => {
    const result = childSchema.safeParse({ ...validChild, age: 100 });
    expect(result.success).toBe(false);
  });

  it("accepts child with age 0 (newborn)", () => {
    const result = childSchema.safeParse({ ...validChild, age: 0 });
    expect(result.success).toBe(true);
  });

  it("accepts child with age 99 (boundary)", () => {
    const result = childSchema.safeParse({ ...validChild, age: 99 });
    expect(result.success).toBe(true);
  });

  it("rejects invalid meal preference on child", () => {
    const result = childSchema.safeParse({ ...validChild, meal: "vegan" });
    expect(result.success).toBe(false);
  });

  it("defaults empty name to ''", () => {
    const result = childSchema.safeParse({ id: "c2", age: 5, meal: "veg" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("");
  });
});

// =============================================================================
// guestSchema
// =============================================================================

describe("guestSchema", () => {
  const validGuest = { id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" as const };

  it("accepts valid guest", () => {
    expect(guestSchema.safeParse(validGuest).success).toBe(true);
  });

  it("rejects guest with missing id", () => {
    const result = guestSchema.safeParse({ name: "Ravi", meal: "veg" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid meal preference on guest", () => {
    const result = guestSchema.safeParse({ ...validGuest, meal: "vegan" });
    expect(result.success).toBe(false);
  });

  it("defaults empty name to ''", () => {
    const result = guestSchema.safeParse({ id: "g2", meal: "non_veg" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe("");
  });

  it("defaults empty relationship to ''", () => {
    const result = guestSchema.safeParse({ id: "g3", meal: "veg" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.relationship).toBe("");
  });
});

// =============================================================================
// alumniDetailsSchema — Alumni Details
// =============================================================================

describe("alumniDetailsSchema", () => {
  // ── Happy path ──

  it("accepts valid alumni details data", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails());
    expect(result.success).toBe(true);
  });

  it("accepts data with mobileAlternate (optional field)", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ mobileAlternate: "+919876543211" }));
    expect(result.success).toBe(true);
  });

  it("accepts data with attendanceIntent 'donation_only'", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ attendanceIntent: "donation_only" }));
    expect(result.success).toBe(true);
  });

  it("accepts all gender enum values", () => {
    for (const g of ["male", "female"]) {
      expect(alumniDetailsSchema.safeParse(validAlumniDetails({ gender: g })).success).toBe(true);
    }
  });

  // ── Required field rejections ──

  it("rejects empty fullName", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ fullName: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("fullName"))).toBe(true);
    }
  });

  it("rejects empty branch", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ branch: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("branch"))).toBe(true);
    }
  });

  it("rejects empty city", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ city: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("city"))).toBe(true);
    }
  });

  // [GAP] Spec R2.4 says country is optional. Schema requires min(1).
  it("rejects empty country ([GAP]: spec R2.4 says optional, schema requires it)", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ country: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("country"))).toBe(true);
    }
  });

  it("rejects empty email", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ email: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects empty whatsapp", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ whatsapp: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects missing gender (excluded from object)", () => {
    const { gender: _, ...noGender } = validAlumniDetails();
    const result = alumniDetailsSchema.safeParse(noGender);
    expect(result.success).toBe(false);
  });

  // ── Email format validation ──

  it("rejects invalid email 'not-an-email'", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ email: "not-an-email" }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid email 'user@'", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ email: "user@" }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid email '@domain.com'", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ email: "@domain.com" }));
    expect(result.success).toBe(false);
  });

  // ── Gender enum validation ──

  it("rejects invalid gender value", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ gender: "attack_helicopter" }));
    expect(result.success).toBe(false);
  });

  // ── WhatsApp validation (superRefine) ──

  it("rejects whatsapp without + prefix", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ whatsapp: "9876543210" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Include your country code (e.g. +91)");
    }
  });

  it("rejects whatsapp with + but fewer than 7 digits after stripping", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ whatsapp: "+123456" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Enter a valid phone number");
    }
  });

  // [GAP] Task says "Indian mobile: starts with 6-9, 10 digits."
  // Actual schema: starts with "+", ≥7 non-digit-stripped characters.
  // Non-Indian numbers pass.
  it("accepts international number with + prefix (US number)", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ whatsapp: "+11234567890" }));
    expect(result.success).toBe(true);
  });

  it("accepts number with spaces — strips non-digits, only counts remaining", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ whatsapp: "+91 98765 43210" }));
    expect(result.success).toBe(true);
  });

  // ── Branch: any non-empty string passes ([GAP]: no BRANCHES enum check) ──

  it("accepts any non-empty branch string (not limited to BRANCHES list) ([GAP]: spec doesn't require this, but no enum guard exists)", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ branch: "Some Random Branch" }));
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// attendeesMealsSchema — Attendees & Meals
// =============================================================================

describe("attendeesMealsSchema", () => {
  // ── Happy path ──

  it("accepts minimal valid attendees & meals data (no spouse, no children, no guests)", () => {
    const result = attendeesMealsSchema.safeParse(validAttendeesMeals());
    expect(result.success).toBe(true);
  });

  it("accepts data with spouse and default spouseMeal", () => {
    const result = attendeesMealsSchema.safeParse(
      validAttendeesMeals({ spouseName: "Priya", spouseMeal: "veg" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.spouseMeal).toBe("veg");
  });

  it("accepts data with children array (empty)", () => {
    const result = attendeesMealsSchema.safeParse(validAttendeesMeals());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.children).toEqual([]);
  });

  it("accepts data with one child", () => {
    const result = attendeesMealsSchema.safeParse(
      validAttendeesMeals({
        children: [{ id: "c1", name: "Arjun", age: 8, meal: "non_veg" }],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts data with one guest", () => {
    const result = attendeesMealsSchema.safeParse(
      validAttendeesMeals({
        guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts all tshirt sizes", () => {
    for (const size of ["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"]) {
      expect(attendeesMealsSchema.safeParse(validAttendeesMeals({ tshirtSize: size })).success).toBe(true);
    }
  });

  // ── Required field rejections ──

  it("rejects missing alumniMeal", () => {
    const { alumniMeal: _, ...rest } = validAttendeesMeals();
    const result = attendeesMealsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects invalid alumniMeal value", () => {
    const result = attendeesMealsSchema.safeParse(validAttendeesMeals({ alumniMeal: "vegan" }));
    expect(result.success).toBe(false);
  });

  it("rejects missing tshirtSize", () => {
    const { tshirtSize: _, ...rest } = validAttendeesMeals();
    const result = attendeesMealsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects invalid tshirtSize value", () => {
    const result = attendeesMealsSchema.safeParse(validAttendeesMeals({ tshirtSize: "XXS" }));
    expect(result.success).toBe(false);
  });

  // ── Spouse fields (lenient in attendeesMealsSchema) ──

  // [GAP] Spec R3.2: "when has-spouse is true, spouse name after trimming must have length > 0"
  // attendeesMealsSchema has NO cross-field rule — spouseName is just optional with default "".
  it("accepts empty spouseName ([GAP]: spec R3.2 would require name when hasSpouse=true — not enforced in attendeesMealsSchema)", () => {
    const result = attendeesMealsSchema.safeParse(validAttendeesMeals({ spouseName: "" }));
    expect(result.success).toBe(true);
  });

  it("accepts whitespace-only spouseName ([GAP]: no trim check in attendeesMealsSchema)", () => {
    const result = attendeesMealsSchema.safeParse(validAttendeesMeals({ spouseName: "   " }));
    expect(result.success).toBe(true);
  });

  it("defaults spouseMeal to 'veg' when not provided", () => {
    const result = attendeesMealsSchema.safeParse(validAttendeesMeals());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.spouseMeal).toBe("veg");
  });

  // ── Children array validation ──

  it("rejects child with invalid age (< 0)", () => {
    const result = attendeesMealsSchema.safeParse(
      validAttendeesMeals({
        children: [{ id: "c1", name: "X", age: -1, meal: "veg" }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects child with invalid age (> 99)", () => {
    const result = attendeesMealsSchema.safeParse(
      validAttendeesMeals({
        children: [{ id: "c1", name: "X", age: 100, meal: "veg" }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects child with invalid meal", () => {
    const result = attendeesMealsSchema.safeParse(
      validAttendeesMeals({
        children: [{ id: "c1", name: "X", age: 5, meal: "vegan" }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects child with missing id", () => {
    const result = attendeesMealsSchema.safeParse(
      validAttendeesMeals({
        children: [{ name: "X", age: 5, meal: "veg" }],
      }),
    );
    expect(result.success).toBe(false);
  });

  // ── Guests array validation ──

  it("rejects guest with invalid meal", () => {
    const result = attendeesMealsSchema.safeParse(
      validAttendeesMeals({
        guests: [{ id: "g1", name: "Ravi", meal: "vegan" }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts guest with minimal fields (just id and meal)", () => {
    const result = attendeesMealsSchema.safeParse(
      validAttendeesMeals({
        guests: [{ id: "g1", meal: "non_veg" }],
      }),
    );
    expect(result.success).toBe(true);
  });

  // ── Multiple children and guests ──

  it("accepts mixed valid attendees (spouse + children + guests)", () => {
    const result = attendeesMealsSchema.safeParse(
      validAttendeesMeals({
        spouseName: "Priya",
        spouseMeal: "veg",
        children: [
          { id: "c1", name: "Arjun", age: 10, meal: "non_veg" },
          { id: "c2", name: "Meera", age: 4, meal: "veg" },
        ],
        guests: [
          { id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" },
          { id: "g2", name: "Sita", relationship: "Colleague", meal: "non_veg" },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// accommodationSchema — Accommodation
// =============================================================================

describe("accommodationSchema", () => {
  // ── Happy path ──

  it("accepts minimal valid accommodation data (accommodation=none)", () => {
    const result = accommodationSchema.safeParse(validAccommodation());
    expect(result.success).toBe(true);
  });

  it("accepts accommodation 'shared_double' with dates", () => {
    const result = accommodationSchema.safeParse(
      validAccommodation({
        accommodation: "shared_double",
        checkIn: "2026-08-14",
        checkOut: "2026-08-16",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts accommodation 'private' with dates", () => {
    const result = accommodationSchema.safeParse(
      validAccommodation({
        accommodation: "private",
        checkIn: "2026-08-15",
        checkOut: "2026-08-16",
      }),
    );
    expect(result.success).toBe(true);
  });

  // ── Accommodation type enum validation ──

  it("rejects invalid accommodation type", () => {
    const result = accommodationSchema.safeParse(validAccommodation({ accommodation: "penthouse" }));
    expect(result.success).toBe(false);
  });

  it("rejects missing accommodation type", () => {
    const { accommodation: _, ...noAcc } = validAccommodation();
    const result = accommodationSchema.safeParse(noAcc);
    expect(result.success).toBe(false);
  });

  // ── Accommodation dates: any string passes (no cross-field validation) ──

  // [GAP] Neither spec nor schema enforce checkOut > checkIn.
  it("accepts checkIn after checkOut ([GAP]: no date-order validation)", () => {
    const result = accommodationSchema.safeParse(
      validAccommodation({
        accommodation: "private",
        checkIn: "2026-08-17",
        checkOut: "2026-08-14",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts empty checkIn and checkOut with accommodation=none", () => {
    const result = accommodationSchema.safeParse(validAccommodation());
    expect(result.success).toBe(true);
  });

  it("accepts accommodation other than 'none' with empty checkIn/checkOut ([GAP]: no cross-field requirement for dates when accommodation is selected)", () => {
    const result = accommodationSchema.safeParse(
      validAccommodation({ accommodation: "shared_double", checkIn: "", checkOut: "" }),
    );
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// collegeContributionSchema — College Contribution
// =============================================================================

describe("collegeContributionSchema", () => {
  it("accepts valid college contribution (₹500)", () => {
    const result = collegeContributionSchema.safeParse(validCollegeContribution());
    expect(result.success).toBe(true);
  });

  it("accepts contribution above minimum", () => {
    const result = collegeContributionSchema.safeParse(validCollegeContribution({ collegeContribution: 2000 }));
    expect(result.success).toBe(true);
  });

  it("accepts contribution of 499 (above minimum of 0)", () => {
    const result = collegeContributionSchema.safeParse(validCollegeContribution({ collegeContribution: 499 }));
    expect(result.success).toBe(true);
  });

  it("accepts contribution of 0 (minimum is now 0)", () => {
    const result = collegeContributionSchema.safeParse(validCollegeContribution({ collegeContribution: 0 }));
    expect(result.success).toBe(true);
  });

  it("rejects negative contribution", () => {
    const result = collegeContributionSchema.safeParse(validCollegeContribution({ collegeContribution: -100 }));
    expect(result.success).toBe(false);
  });

  it("rejects non-number contribution", () => {
    const result = collegeContributionSchema.safeParse(validCollegeContribution({ collegeContribution: "500" }));
    expect(result.success).toBe(false);
  });

  it("rejects missing collegeContribution", () => {
    const result = collegeContributionSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("strips unknown fields (Zod default)", () => {
    const result = collegeContributionSchema.safeParse({ ...validCollegeContribution(), extraField: "ignored" });
    expect(result.success).toBe(true);
  });

  it("accepts exact 500 (above minimum of 0)", () => {
    const result = collegeContributionSchema.safeParse(validCollegeContribution({ collegeContribution: 500 }));
    expect(result.success).toBe(true);
  });

  // [GAP] Spec R5.3 says custom college contribution must be a "valid integer ≥ 500".
  // The schema uses z.number().min(0) which also accepts floats.
  it("accepts non-integer float above minimum ([GAP]: spec R5.3 says integer, schema allows floats)", () => {
    const result = collegeContributionSchema.safeParse(validCollegeContribution({ collegeContribution: 750.5 }));
    expect(result.success).toBe(true);
  });

  it("rejects float below minimum (negative float)", () => {
    const result = collegeContributionSchema.safeParse(validCollegeContribution({ collegeContribution: -0.01 }));
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// photoIdSchema — Photo & ID Upload
// =============================================================================

describe("photoIdSchema", () => {
  // ── Happy path ──

  it("accepts valid photo with optional ID", () => {
    const result = photoIdSchema.safeParse(validPhotoId());
    expect(result.success).toBe(true);
  });

  it("accepts photo without ID (ID is optional in schema)", () => {
    const result = photoIdSchema.safeParse(validPhotoId({ idFileName: "", idFileType: undefined }));
    expect(result.success).toBe(true);
  });

  it("accepts photo with idNote only (no ID file)", () => {
    const result = photoIdSchema.safeParse(validPhotoId({ idNote: "Will upload Aadhaar later" }));
    expect(result.success).toBe(true);
  });

  // ── Photo validation ──

  it("rejects missing photoFileName", () => {
    const result = photoIdSchema.safeParse(validPhotoId({ photoFileName: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects photo with fileName but no fileKey (upload incomplete)", () => {
    const result = photoIdSchema.safeParse(validPhotoId({ photoFileKey: undefined }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid photo MIME type", () => {
    const result = photoIdSchema.safeParse(validPhotoId({ photoFileType: "application/pdf" }));
    expect(result.success).toBe(false);
  });

  it("rejects photo exceeding max size (10 MB + 1 byte)", () => {
    const result = photoIdSchema.safeParse(validPhotoId({ photoFileSizeBytes: MAX_PHOTO_FILE_SIZE + 1 }));
    expect(result.success).toBe(false);
  });

  it("accepts photo at exact max size boundary (10 MB)", () => {
    const result = photoIdSchema.safeParse(validPhotoId({ photoFileSizeBytes: MAX_PHOTO_FILE_SIZE }));
    expect(result.success).toBe(true);
  });

  it("accepts PNG photo", () => {
    const result = photoIdSchema.safeParse(validPhotoId({ photoFileType: "image/png" }));
    expect(result.success).toBe(true);
  });

  // ── ID file validation ──

  it("accepts valid JPEG ID upload", () => {
    const result = photoIdSchema.safeParse(
      validPhotoId({ idFileName: "id.jpg", idFileType: "image/jpeg", idFileSizeBytes: 1024 }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts valid PNG ID upload", () => {
    const result = photoIdSchema.safeParse(
      validPhotoId({ idFileName: "id.png", idFileType: "image/png", idFileSizeBytes: 2048 }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts valid PDF ID upload", () => {
    const result = photoIdSchema.safeParse(
      validPhotoId({ idFileName: "id.pdf", idFileType: "application/pdf", idFileSizeBytes: 4000000 }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts ID at exact max size boundary (5 MB)", () => {
    const result = photoIdSchema.safeParse(
      validPhotoId({ idFileName: "large.pdf", idFileType: "application/pdf", idFileSizeBytes: MAX_ID_FILE_SIZE }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects ID with invalid MIME type", () => {
    const result = photoIdSchema.safeParse(
      validPhotoId({ idFileName: "data.txt", idFileType: "text/plain", idFileSizeBytes: 100 }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects ID with size 0", () => {
    const result = photoIdSchema.safeParse(
      validPhotoId({ idFileName: "empty.jpg", idFileType: "image/jpeg", idFileSizeBytes: 0 }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects ID exceeding max size (5 MB + 1 byte)", () => {
    const result = photoIdSchema.safeParse(
      validPhotoId({ idFileName: "too-big.pdf", idFileType: "application/pdf", idFileSizeBytes: MAX_ID_FILE_SIZE + 1 }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects when idFileType is set but idFileSizeBytes is undefined", () => {
    const result = photoIdSchema.safeParse(
      validPhotoId({ idFileName: "id.jpg", idFileType: "image/jpeg", idFileSizeBytes: undefined }),
    );
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// validateForPayment — Pre-submission business logic checks
// =============================================================================

describe("validateForPayment", () => {
  // ── Full valid data (attending, with idDocument, tshirtSize, all fields) ──

  it("returns ready:true for complete attending registration with idDocument and tshirtSize", () => {
    const result = validateForPayment(paymentBaseData());
    expect(result.ready).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  // ── Missing Step 1 required fields ──

  it("flags missing fullName", () => {
    const result = validateForPayment(paymentBaseData({ fullName: "" }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "fullName")).toBe(true);
  });

  it("flags missing branch", () => {
    const result = validateForPayment(paymentBaseData({ branch: "" }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "branch")).toBe(true);
  });

  it("flags missing email", () => {
    const result = validateForPayment(paymentBaseData({ email: "" }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "email")).toBe(true);
  });

  it("flags missing city", () => {
    const result = validateForPayment(paymentBaseData({ city: "" }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "city")).toBe(true);
  });

  it("flags whatsapp with too few digits", () => {
    const result = validateForPayment(paymentBaseData({ whatsapp: "123456" }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "whatsapp")).toBe(true);
  });

  it("flags empty whatsapp", () => {
    const result = validateForPayment(paymentBaseData({ whatsapp: "" }));
    expect(result.ready).toBe(false);
  });

  // ── Donation-only path ──

  it("donation_only with donation > 0 → ready:true", () => {
    const result = validateForPayment(
      paymentBaseData({
        attendanceIntent: "donation_only",
        participationType: "donation_only",
        donationAmount: "5000",
        idFileKey: undefined, // no ID needed for donation_only
        tshirtSize: undefined, // tshirt not needed
      }),
    );
    expect(result.ready).toBe(true);
  });

  it("donation_only with no donation and no contribution → ready:false", () => {
    const result = validateForPayment(
      paymentBaseData({
        attendanceIntent: "donation_only",
        participationType: "donation_only",
        donationAmount: "",
        collegeContribution: 0,
        collegeContributionCause: "" as const,
        idFileKey: undefined,
        tshirtSize: undefined,
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "donationAmount")).toBe(true);
  });

  it("donation_only with donation '0' and no contribution → ready:false", () => {
    const result = validateForPayment(
      paymentBaseData({
        attendanceIntent: "donation_only",
        participationType: "donation_only",
        donationAmount: "0",
        collegeContribution: 0,
        collegeContributionCause: "" as const,
        idFileKey: undefined,
        tshirtSize: undefined,
      }),
    );
    expect(result.ready).toBe(false);
  });

  it("donation_only returns early — ignores tshirtSize/idDocument/attendee issues", () => {
    // Even with missing tshirtSize and no idFileKey, donation_only only checks donation
    const result = validateForPayment(
      paymentBaseData({
        attendanceIntent: "donation_only",
        participationType: "donation_only",
        donationAmount: "1000",
        tshirtSize: undefined,
        idFileKey: undefined,
      }),
    );
    expect(result.ready).toBe(true);
  });

  // ── Attending — idDocument required ──

  it("attending without idFileKey → ready:false (ID required)", () => {
    const result = validateForPayment(
      paymentBaseData({ idFileKey: undefined }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "idFileKey")).toBe(true);
  });

  it("attending with idFileKey → ready:true (ID present)", () => {
    const result = validateForPayment(
      paymentBaseData({ idFileKey: "uploads/id.pdf" }),
    );
    expect(result.ready).toBe(true);
  });

  // ── Attending — tshirtSize required ──

  it("attending without tshirtSize → ready:false", () => {
    const result = validateForPayment(
      paymentBaseData({ tshirtSize: undefined }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "tshirtSize")).toBe(true);
  });

  // ── Shared room solo check ──

  it("shared_double room with no attendees → ready:true", () => {
    const result = validateForPayment(
      paymentBaseData({
        accommodation: "shared_double",
        checkIn: "2026-08-14",
        checkOut: "2026-08-16",
        spouseName: "",
        children: [],
        guests: [],
      }),
    );
    expect(result.ready).toBe(true);
  });

  it("shared_double room with spouse → ready:false (solo-only rule)", () => {
    const result = validateForPayment(
      paymentBaseData({
        accommodation: "shared_double",
        checkIn: "2026-08-14",
        checkOut: "2026-08-16",
        spouseName: "Priya",
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "accommodation")).toBe(true);
  });

  it("shared_double room with children → ready:false", () => {
    const result = validateForPayment(
      paymentBaseData({
        accommodation: "shared_double",
        checkIn: "2026-08-14",
        checkOut: "2026-08-16",
        children: [{ id: "c1", name: "Arjun", age: 8, meal: "veg" }],
      }),
    );
    expect(result.ready).toBe(false);
  });

  it("shared_double room with guests → ready:false", () => {
    const result = validateForPayment(
      paymentBaseData({
        accommodation: "shared_double",
        checkIn: "2026-08-14",
        checkOut: "2026-08-16",
        guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
      }),
    );
    expect(result.ready).toBe(false);
  });

  it("private room with attendees → ready:true (private room is OK)", () => {
    const result = validateForPayment(
      paymentBaseData({
        accommodation: "private",
        checkIn: "2026-08-14",
        checkOut: "2026-08-16",
        spouseName: "Priya",
        children: [{ id: "c1", name: "Arjun", age: 8, meal: "veg" }],
        guests: [{ id: "g1", name: "Ravi", relationship: "Friend", meal: "veg" }],
      }),
    );
    expect(result.ready).toBe(true);
  });

  // ── Accommodation dates ──

  it("accommodation not 'none' without checkIn → ready:false", () => {
    const result = validateForPayment(
      paymentBaseData({
        accommodation: "private",
        checkIn: "",
        checkOut: "2026-08-16",
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "checkIn")).toBe(true);
  });

  it("accommodation not 'none' without checkOut → ready:false", () => {
    const result = validateForPayment(
      paymentBaseData({
        accommodation: "private",
        checkIn: "2026-08-14",
        checkOut: "",
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "checkOut")).toBe(true);
  });

  it("accommodation 'none' without dates → ready:true (dates not required)", () => {
    const result = validateForPayment(
      paymentBaseData({ accommodation: "none", checkIn: "", checkOut: "" }),
    );
    expect(result.ready).toBe(true);
  });

  // ── Multiple issues aggregated ──

  it("returns multiple issues when multiple problems exist", () => {
    const result = validateForPayment(
      paymentBaseData({
        fullName: "",
        email: "",
        whatsapp: "123",
        tshirtSize: undefined,
        accommodation: "shared_double",
        checkIn: "",
        checkOut: "",
        spouseName: "Priya",
        idFileKey: undefined,
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(4);
  });

  // ── Whitespace trimming on fullName ──

  it("flags whitespace-only fullName as missing", () => {
    const result = validateForPayment(paymentBaseData({ fullName: "   " }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "fullName")).toBe(true);
  });

  // ── alumniMeal check (attending only) ──

  it("attending without alumniMeal → ready:false", () => {
    // alumniMeal is required in the WizardDraft type, but we can pass undefined
    const result = validateForPayment(
      paymentBaseData({ alumniMeal: undefined as unknown as "non_veg" }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "alumniMeal")).toBe(true);
  });

  // ── Step 4: collegeContribution — attending vs donation_only ──

  it("attending with collegeContribution of 499 → ready:true (minimum is 0)", () => {
    const result = validateForPayment(paymentBaseData({ collegeContribution: 499 }));
    expect(result.ready).toBe(true);
    expect(result.issues.some((i) => i.field === "collegeContribution")).toBe(false);
  });

  it("attending with collegeContribution of 100 → ready:true (minimum is 0)", () => {
    const result = validateForPayment(
      paymentBaseData({
        collegeContribution: 100,
      }),
    );
    expect(result.ready).toBe(true);
    expect(result.issues.some((i) => i.field === "collegeContribution")).toBe(false);
  });

  it("attending with negative collegeContribution → ready:false (below minimum of 0)", () => {
    const result = validateForPayment(
      paymentBaseData({
        collegeContribution: -1,
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "collegeContribution")).toBe(true);
  });

  it("attending with collegeContribution at minimum (0) → ready:true", () => {
    const result = validateForPayment(
      paymentBaseData({
        collegeContribution: 0,
      }),
    );
    expect(result.ready).toBe(true);
  });

  it("donation_only: collegeContribution=0 with valid donation → ready:true (contribution not required)", () => {
    // donation_only can pass with only a donation; zero contribution is fine.
    const result = validateForPayment(
      paymentBaseData({
        attendanceIntent: "donation_only",
        participationType: "donation_only",
        donationAmount: "1000",
        photoFileKey: "photo-key",
        idFileKey: undefined,
        tshirtSize: undefined,
        collegeContribution: 0,
        collegeContributionCause: "" as const,
      }),
    );
    expect(result.ready).toBe(true);
    expect(result.issues.some((i) => i.field === "collegeContribution")).toBe(false);
  });

  // ── Step 5: photoFileKey required for ALL intents ─────────────────────────

  it("attending without photoFileKey → ready:false", () => {
    const result = validateForPayment(
      paymentBaseData({ photoFileKey: undefined }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "photoFileKey")).toBe(true);
  });

  it("attending without photoFileKey (no idFileKey either) → ready:false, flags photoFileKey", () => {
    const result = validateForPayment(
      paymentBaseData({
        photoFileKey: undefined,
        idFileKey: undefined,
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "photoFileKey")).toBe(true);
  });

  it("donation_only without photoFileKey → ready:false (photo required for all intents)", () => {
    const result = validateForPayment(
      paymentBaseData({
        attendanceIntent: "donation_only",
        participationType: "donation_only",
        donationAmount: "1000",
        photoFileKey: undefined,
        idFileKey: undefined,
        tshirtSize: undefined,
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "photoFileKey")).toBe(true);
  });

  it("attending with photoFileKey → photo issue absent", () => {
    const result = validateForPayment(
      paymentBaseData({ photoFileKey: "uploads/photo.jpg" }),
    );
    expect(result.issues.some((i) => i.field === "photoFileKey")).toBe(false);
  });

  // ── Felicitation consent at ₹50,000 threshold ─────────────────────────────
  //
  // [GAP] Spec (§ Giving Back / line 292): "Contributions above ₹50,000 are
  // eligible for on-stage felicitation." and line 820: "felicitationConsent
  // is Required if donation > felicitation threshold."
  //
  // PRICING_DEFAULTS.donationFelicitationThreshold = 50000 exists in constants.ts,
  // but validateForPayment() does NOT check felicitationConsent against this
  // threshold. These tests document the expected behavior per spec.
  // When the implementation is added to review-validation.ts, remove the
  // [SPEC GAP] markers and the .toBe(true) ready assertions below.

  it("[SPEC GAP] donation_only with donation ≥ 50000 and felicitationConsent=false → should be ready:false per spec, but currently ready:true", () => {
    const result = validateForPayment(
      paymentBaseData({
        attendanceIntent: "donation_only",
        participationType: "donation_only",
        donationAmount: "50000",
        felicitationConsent: false,
        photoFileKey: "uploads/photo.jpg",
        idFileKey: undefined,
        tshirtSize: undefined,
      }),
    );
    // [SPEC GAP]: validateForPayment does not enforce felicitationConsent.
    // Per spec, ready should be false here. Change to toBe(false) once implemented.
    expect(result.ready).toBe(true);
    expect(result.issues.some((i) => i.field === "felicitationConsent")).toBe(false);
  });

  it("[SPEC GAP] donation_only with donation ≥ 50000 and felicitationConsent=true → ready:true (both current and spec agree)", () => {
    const result = validateForPayment(
      paymentBaseData({
        attendanceIntent: "donation_only",
        participationType: "donation_only",
        donationAmount: "50000",
        felicitationConsent: true,
        photoFileKey: "uploads/photo.jpg",
        idFileKey: undefined,
        tshirtSize: undefined,
      }),
    );
    expect(result.ready).toBe(true);
  });

  it("[SPEC GAP] donation_only with donation just below threshold (49999) and felicitationConsent=false → ready:true (no consent needed below threshold)", () => {
    const result = validateForPayment(
      paymentBaseData({
        attendanceIntent: "donation_only",
        participationType: "donation_only",
        donationAmount: "49999",
        felicitationConsent: false,
        photoFileKey: "uploads/photo.jpg",
        idFileKey: undefined,
        tshirtSize: undefined,
      }),
    );
    // Below threshold: felicitationConsent is not required by spec or implementation.
    expect(result.ready).toBe(true);
  });

  it("[SPEC GAP] attending with donation ≥ 50000 and felicitationConsent=false → currently ready:true; per spec should flag felicitationConsent", () => {
    const result = validateForPayment(
      paymentBaseData({
        donationAmount: "75000",
        felicitationConsent: false,
      }),
    );
    // [SPEC GAP]: same gap applies for attending flows.
    // Change to toBe(false) and add field assertion once implemented.
    expect(result.ready).toBe(true);
    expect(result.issues.some((i) => i.field === "felicitationConsent")).toBe(false);
  });
});

describe("alumniDetailsSchema Indian phone guard", () => {
  it("rejects Indian numbers longer than 10 digits after +91", () => {
    const result = alumniDetailsSchema.safeParse(validAlumniDetails({ whatsapp: "+91 98765 432101" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Enter a valid 10-digit Indian phone number");
    }
  });
});

describe("validateForPayment strengthened checks", () => {
  it("flags invalid email formats", () => {
    const result = validateForPayment(paymentBaseData({ email: "not-an-email" }));
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "email")).toBe(true);
  });

  it("flags children whose age is missing", () => {
    const result = validateForPayment(
      paymentBaseData({
        children: [{ id: "c1", name: "Kid", age: Number.NaN, meal: "veg" }],
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "children.0.age")).toBe(true);
  });
});

// =============================================================================
// givingBackSchema — Combined Giving Back (college contribution + donation)
// =============================================================================

describe("givingBackSchema", () => {
  const min = PRICING_DEFAULTS.collegeContributionMinimum;

  // ── donation_only path ──

  it("donation_only: rejects when both donationAmount and collegeContribution are zero", () => {
    // New rule: at least one of (donation, contribution) must be > 0
    const result = givingBackSchema.safeParse(
      validGivingBack({
        participationType: "donation_only",
        donationAmount: "",
        collegeContribution: 0,
        collegeContributionCause: "",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("donationAmount"))).toBe(true);
    }
  });

  it("donation_only: rejects '0' donation when contribution is also 0", () => {
    const result = givingBackSchema.safeParse(
      validGivingBack({
        participationType: "donation_only",
        donationAmount: "0",
        collegeContribution: 0,
        collegeContributionCause: "",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("donationAmount"))).toBe(true);
    }
  });

  it("donation_only: accepts valid donationAmount (no college contribution needed)", () => {
    const result = givingBackSchema.safeParse(
      validGivingBack({
        participationType: "donation_only",
        donationAmount: "1000",
        collegeContribution: 0,
        collegeContributionCause: "",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("donation_only: passes with contribution-only — no donation required", () => {
    // New behavior: donation_only can pass with only a college contribution
    const result = givingBackSchema.safeParse(
      validGivingBack({
        participationType: "donation_only",
        donationAmount: "",
        collegeContribution: 5000,
        collegeContributionCause: "scholarship",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("donation_only: does not require collegeContribution when donation is present", () => {
    const result = givingBackSchema.safeParse(
      validGivingBack({
        participationType: "donation_only",
        donationAmount: "500",
        collegeContribution: undefined,
        collegeContributionCause: "",
      }),
    );
    expect(result.success).toBe(true);
  });

  // ── attending path ──

  it("attending: rejects collegeContribution below minimum", () => {
    const result = givingBackSchema.safeParse(
      validGivingBack({ participationType: "full_celebration", collegeContribution: min - 1 }),
    );
    // Only fails if min > 0; if min === 0, -1 would fail
    if (min > 0) {
      expect(result.success).toBe(false);
    } else {
      // min === 0, so -1 is below minimum
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("collegeContribution"))).toBe(true);
      }
    }
  });

  it("attending: rejects null/missing collegeContribution", () => {
    const result = givingBackSchema.safeParse(
      validGivingBack({ participationType: "full_celebration", collegeContribution: undefined }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("collegeContribution"))).toBe(true);
    }
  });

  it("attending: accepts valid collegeContribution at minimum", () => {
    const result = givingBackSchema.safeParse(
      validGivingBack({ participationType: "full_celebration", collegeContribution: min }),
    );
    expect(result.success).toBe(true);
  });

  it("attending: accepts valid collegeContribution above minimum", () => {
    const result = givingBackSchema.safeParse(
      validGivingBack({ participationType: "full_celebration", collegeContribution: 1000 }),
    );
    expect(result.success).toBe(true);
  });

  it("attending: does not require donationAmount", () => {
    const result = givingBackSchema.safeParse(
      validGivingBack({
        participationType: "full_celebration",
        collegeContribution: 500,
        donationAmount: "",
      }),
    );
    expect(result.success).toBe(true);
  });

  // ── Cause-required rule (all participation types) ──

  it("cause required when contribution > 0 for full_celebration", () => {
    const result = givingBackSchema.safeParse(
      validGivingBack({
        participationType: "full_celebration",
        collegeContribution: 500,
        collegeContributionCause: "",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("collegeContributionCause"))).toBe(true);
      expect(result.error.issues.some((i) => i.message === "Select a cause for your contribution.")).toBe(true);
    }
  });

  it("cause required when contribution > 0 for campus_only", () => {
    const result = givingBackSchema.safeParse(
      validGivingBack({
        participationType: "campus_only",
        collegeContribution: 500,
        collegeContributionCause: "",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("collegeContributionCause"))).toBe(true);
    }
  });

  it("cause required when contribution > 0 for donation_only", () => {
    const result = givingBackSchema.safeParse(
      validGivingBack({
        participationType: "donation_only",
        donationAmount: "0",
        collegeContribution: 500,
        collegeContributionCause: "",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("collegeContributionCause"))).toBe(true);
    }
  });

  it("cause irrelevant when contribution is 0 — no cause error", () => {
    const result = givingBackSchema.safeParse(
      validGivingBack({
        participationType: "full_celebration",
        collegeContribution: 0,
        collegeContributionCause: "",
      }),
    );
    // contribution=0 → cause rule does not fire; only the minimum rule applies
    // Since minimum is 0, this should pass
    if (!result.success) {
      const hasCauseError = result.error.issues.some((i) => i.path.includes("collegeContributionCause"));
      expect(hasCauseError).toBe(false);
    }
  });

  it("valid cause passes the cause check", () => {
    const result = givingBackSchema.safeParse(
      validGivingBack({
        participationType: "full_celebration",
        collegeContribution: 500,
        collegeContributionCause: "scholarship",
      }),
    );
    expect(result.success).toBe(true);
  });
});

// =============================================================================
// validateForPayment — new cause-required and donation_only contribution behavior
// =============================================================================

describe("validateForPayment — cause and donation_only contribution rules", () => {
  it("donation_only with contribution-only (no donation) → ready:true", () => {
    const result = validateForPayment(
      paymentBaseData({
        attendanceIntent: "donation_only",
        participationType: "donation_only",
        donationAmount: "",
        collegeContribution: 5000,
        collegeContributionCause: "scholarship" as const,
        idFileKey: undefined,
        tshirtSize: undefined,
      }),
    );
    expect(result.ready).toBe(true);
  });

  it("attending: missing cause when contribution > 0 → ready:false", () => {
    const result = validateForPayment(
      paymentBaseData({
        collegeContribution: 500,
        collegeContributionCause: "" as const,
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "collegeContributionCause")).toBe(true);
  });

  it("donation_only: missing cause when contribution > 0 → ready:false", () => {
    const result = validateForPayment(
      paymentBaseData({
        attendanceIntent: "donation_only",
        participationType: "donation_only",
        donationAmount: "",
        collegeContribution: 3000,
        collegeContributionCause: "" as const,
        idFileKey: undefined,
        tshirtSize: undefined,
      }),
    );
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "collegeContributionCause")).toBe(true);
  });

  it("attending: cause present when contribution > 0 → no cause issue", () => {
    const result = validateForPayment(
      paymentBaseData({
        collegeContribution: 500,
        collegeContributionCause: "green_energy" as const,
      }),
    );
    expect(result.issues.some((i) => i.field === "collegeContributionCause")).toBe(false);
  });

  it("attending: contribution=0 with no cause → no cause issue", () => {
    const result = validateForPayment(
      paymentBaseData({
        collegeContribution: 0,
        collegeContributionCause: "" as const,
      }),
    );
    expect(result.issues.some((i) => i.field === "collegeContributionCause")).toBe(false);
  });
});
