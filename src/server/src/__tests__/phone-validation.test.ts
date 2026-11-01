import { describe, it, expect } from "vitest";
import { alumniDetailsSchema, validateForPayment } from "@smriti/shared";
import type { WizardDraft } from "@smriti/shared";

describe("alumniDetailsSchema phone validation", () => {
  const baseFields = {
    fullName: "Test User",
    branch: "Computer Science & Engineering",
    gender: "male" as const,
    email: "test@test.com",
    city: "Kochi",
    country: "India",
    attendanceIntent: "attending" as const,
  };

  it("accepts an Indian number with +91 and 10 digits", () => {
    const result = alumniDetailsSchema.safeParse({ ...baseFields, whatsapp: "+919876543210" });
    expect(result.success).toBe(true);
  });

  it("accepts a number with spaces and dashes", () => {
    const result = alumniDetailsSchema.safeParse({ ...baseFields, whatsapp: "+91 98765 43210" });
    expect(result.success).toBe(true);
  });

  it("accepts a UAE number with + prefix", () => {
    const result = alumniDetailsSchema.safeParse({ ...baseFields, whatsapp: "+971551234567" });
    expect(result.success).toBe(true);
  });

  it("rejects a number without + prefix", () => {
    const result = alumniDetailsSchema.safeParse({ ...baseFields, whatsapp: "9876543210" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Include your country code (e.g. +91)");
    }
  });

  it("rejects a number with + but fewer than 7 digits", () => {
    const result = alumniDetailsSchema.safeParse({ ...baseFields, whatsapp: "+123456" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Enter a valid phone number");
    }
  });

  it("rejects an Indian number longer than 10 digits", () => {
    const result = alumniDetailsSchema.safeParse({ ...baseFields, whatsapp: "+9198765432101" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Enter a valid 10-digit Indian phone number");
    }
  });

  it("rejects an empty string", () => {
    const result = alumniDetailsSchema.safeParse({ ...baseFields, whatsapp: "" });
    expect(result.success).toBe(false);
  });

  it("rejects an alphabetic string", () => {
    const result = alumniDetailsSchema.safeParse({ ...baseFields, whatsapp: "abcdefghij" });
    expect(result.success).toBe(false);
  });
});

describe("validateForPayment phone validation", () => {
  const baseData: WizardDraft = {
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
    alumniMeal: "veg",
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
    idFileName: "id.jpg",
    idNote: "",
    idFileKey: "test-key",
    collegeContribution: 0,
    collegeContributionCause: "",
    photoFileName: "photo.jpg",
    photoFileKey: "uploads/test-photo.jpg",
  };

  it("passes with a full international number", () => {
    const result = validateForPayment({ ...baseData, whatsapp: "+91 98765 43210" });
    expect(result.ready).toBe(true);
  });

  it("allows a missing country code at review time when the digit count is otherwise valid", () => {
    const result = validateForPayment({ ...baseData, whatsapp: "1234567" });
    expect(result.ready).toBe(true);
  });

  it("fails with fewer than 7 digits", () => {
    const result = validateForPayment({ ...baseData, whatsapp: "+123456" });
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "whatsapp")).toBe(true);
  });

  it("fails with an empty whatsapp field", () => {
    const result = validateForPayment({ ...baseData, whatsapp: "" });
    expect(result.ready).toBe(false);
  });

  it("fails with a purely alphabetic string", () => {
    const result = validateForPayment({ ...baseData, whatsapp: "abcdefghij" });
    expect(result.ready).toBe(false);
  });

  it("fails with an Indian number longer than 10 digits", () => {
    const result = validateForPayment({ ...baseData, whatsapp: "+9198765432101" });
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.field === "whatsapp")).toBe(true);
  });
});
