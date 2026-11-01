import { z } from "zod";
import type { WizardDraft } from "./types.ts";
import {
  PRICING_DEFAULTS,
  COLLEGE_CONTRIBUTION_COPY,
  CONTRIBUTION_CAUSE_VALUES,
} from "./constants.ts";

function hasCauseMissing(data: WizardDraft): boolean {
  return (
    (data.collegeContribution ?? 0) > 0 &&
    !(CONTRIBUTION_CAUSE_VALUES as readonly string[]).includes(data.collegeContributionCause)
  );
}

export interface ReviewIssue {
  section: "alumni" | "attendees" | "stay" | "giving_back" | "photo";
  step: number;
  field: string;
  message: string;
}

export interface ReviewValidation {
  ready: boolean;
  issues: ReviewIssue[];
}

function isIdRequired(data: WizardDraft): boolean {
  return data.participationType !== "donation_only";
}

export function validateForPayment(
  data: WizardDraft,
): ReviewValidation {
  const issues: ReviewIssue[] = [];
  const emailResult = z.string().trim().email().safeParse(data.email);

  // ── alumni-details (wizard 2) (all intents) ──
  if (!data.fullName?.trim()) {
    issues.push({ section: "alumni", step: 2, field: "fullName", message: "Add your full name" });
  }
  if (!data.branch?.trim()) {
    issues.push({ section: "alumni", step: 2, field: "branch", message: "Select your branch" });
  }
  if (!data.email?.trim()) {
    issues.push({ section: "alumni", step: 2, field: "email", message: "Add your email address" });
  } else if (!emailResult.success) {
    issues.push({ section: "alumni", step: 2, field: "email", message: "Enter a valid email address" });
  }
  if (!data.whatsapp?.trim()) {
    issues.push({ section: "alumni", step: 2, field: "whatsapp", message: "Add your WhatsApp number" });
  } else {
    const digits = data.whatsapp.replace(/\D/g, "");
    const indianDigits = digits.startsWith("91") ? digits.slice(2) : digits;
    if (digits.length < 7) {
      issues.push({ section: "alumni", step: 2, field: "whatsapp", message: "Add your WhatsApp number" });
    } else if (
      data.country === "India" &&
      digits.startsWith("91") &&
      !/^[6-9]\d{9}$/.test(indianDigits)
    ) {
      issues.push({ section: "alumni", step: 2, field: "whatsapp", message: "Enter a valid 10-digit Indian phone number" });
    }
  }
  if (!data.city?.trim()) {
    issues.push({ section: "alumni", step: 2, field: "city", message: "Add your city" });
  }

  // ── Donation-only: alumni-details + at least one amount + photo ──
  if (data.participationType === "donation_only") {
    const donation = parseFloat(data.donationAmount || "0") || 0;
    const contribution = data.collegeContribution ?? 0;
    if (donation <= 0 && contribution <= 0) {
      issues.push({
        section: "giving_back",
        step: 5,
        field: "donationAmount",
        message: "Add a donation or a college contribution",
      });
    }
    if (hasCauseMissing(data)) {
      issues.push({
        section: "giving_back",
        step: 5,
        field: "collegeContributionCause",
        message: COLLEGE_CONTRIBUTION_COPY.causeRequiredError,
      });
    }
    if (!data.photoFileKey) {
      issues.push({ section: "photo", step: 6, field: "photoFileKey", message: "Upload a photo" });
    }
    return { ready: issues.length === 0, issues };
  }

  // ── attendees-meals (wizard 3) ──
  if (!data.tshirtSize) {
    issues.push({ section: "attendees", step: 3, field: "tshirtSize", message: "Select your t-shirt size" });
  }
  if (!data.alumniMeal) {
    issues.push({ section: "attendees", step: 3, field: "alumniMeal", message: "Pick your meal preference" });
  }
  (data.children ?? []).forEach((child, index) => {
    if (!Number.isFinite(child.age)) {
      issues.push({
        section: "attendees",
        step: 3,
        field: `children.${index}.age`,
        message: "Enter each child's age before continuing",
      });
    }
  });

  // ── accommodation (wizard 4) ──
  const hasMultipleAttendees =
    data.spouseName.trim().length > 0 ||
    (data.children || []).length > 0 ||
    (data.guests || []).length > 0;

  const isSharedAccommodation =
    data.accommodation === "shared_double" || data.accommodation === "shared_triple";
  if (isSharedAccommodation && hasMultipleAttendees) {
    issues.push({
      section: "stay",
      step: 4,
      field: "accommodation",
      message: "Shared room is only available for solo attendees — choose Private Room or No Accommodation",
    });
  }

  if (data.accommodation !== "none") {
    if (!data.checkIn) {
      issues.push({ section: "stay", step: 4, field: "checkIn", message: "Select a check-in date" });
    }
    if (!data.checkOut) {
      issues.push({ section: "stay", step: 4, field: "checkOut", message: "Select a check-out date" });
    }
  }

  // ── college-contribution (wizard 5) ──
  if (
    data.collegeContribution != null &&
    data.collegeContribution < PRICING_DEFAULTS.collegeContributionMinimum
  ) {
    issues.push({
      section: "giving_back",
      step: 5,
      field: "collegeContribution",
      message: `College contribution must be at least ₹${PRICING_DEFAULTS.collegeContributionMinimum}`,
    });
  }
  if (hasCauseMissing(data)) {
    issues.push({
      section: "giving_back",
      step: 5,
      field: "collegeContributionCause",
      message: COLLEGE_CONTRIBUTION_COPY.causeRequiredError,
    });
  }

  // ── photo-id (wizard 6) ──
  if (!data.photoFileKey) {
    issues.push({ section: "photo", step: 6, field: "photoFileKey", message: "Upload a photo" });
  }

  if (isIdRequired(data) && !data.idFileKey) {
    issues.push({
      section: "photo",
      step: 6,
      field: "idFileKey",
      message: "Upload an ID document — needed for venue check-in",
    });
  }

  return { ready: issues.length === 0, issues };
}
