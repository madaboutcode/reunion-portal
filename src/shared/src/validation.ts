import { z } from "zod";
import {
  PRICING_DEFAULTS,
  COLLEGE_CONTRIBUTION_COPY,
  CONTRIBUTION_CAUSE_VALUES,
} from "./constants.ts";

export function validatePhoneNumber(value: string, country?: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!trimmed.startsWith("+")) {
    return "Include your country code (e.g. +91)";
  }

  const digits = trimmed.replace(/\D/g, "");
  if ((country ?? "").trim().toLowerCase() === "india") {
    if (digits.startsWith("91")) {
      const localDigits = digits.slice(2);
      if (!/^[6-9]\d{9}$/.test(localDigits)) {
        return "Enter a valid 10-digit Indian phone number";
      }
      return null;
    }
    if (digits.length < 7 || digits.length > 15) {
      return "Enter a valid phone number";
    }
    return null;
  }

  if (digits.length < 7 || digits.length > 15) {
    return "Enter a valid phone number";
  }

  return null;
}

export const mealPreferenceSchema = z.enum(["veg", "non_veg"]);

export const attendanceIntentSchema = z.enum(["attending", "donation_only"]);

export const participationTypeSchema = z.enum(["full_celebration", "campus_only", "donation_only"]);

export const participationSchema = z.object({
  participationType: participationTypeSchema,
});

export const genderSchema = z.enum(["male", "female"]);

export const tshirtSizeSchema = z.enum(["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"]);

export const childSchema = z.object({
  id: z.string(),
  name: z.string().optional().default(""),
  age: z.number().min(0).max(99),
  meal: mealPreferenceSchema,
});

export const guestSchema = z.object({
  id: z.string(),
  name: z.string().optional().default(""),
  relationship: z.string().optional().default(""),
  meal: mealPreferenceSchema,
});

// alumni-details (wizard 2)
export const alumniDetailsSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  branch: z.string().min(1, "Branch is required"),
  gender: genderSchema,
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  whatsapp: z.string().min(1, "WhatsApp number is required"),
  mobileAlternate: z.string().optional(),
  city: z.string().min(1, "City is required"),
  country: z.string().min(1, "Country is required"),
}).superRefine((data, ctx) => {
  const phoneError = validatePhoneNumber(data.whatsapp, data.country);
  if (phoneError) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["whatsapp"],
      message: phoneError,
    });
  }
});

// attendees-meals (wizard 3)
// Note: hasSpouse toggle is local component state in Step2, not in the draft.
// The schema validates the data fields only — spouse name is optional in the draft.
export const attendeesMealsSchema = z.object({
  alumniMeal: mealPreferenceSchema,
  tshirtSize: tshirtSizeSchema,
  spouseName: z.string().optional().default(""),
  spouseMeal: mealPreferenceSchema.optional().default("veg"),
  children: z.array(childSchema),
  guests: z.array(guestSchema),
});

export const accommodationSchema = z.object({
  accommodation: z.enum(["none", "private", "shared_double", "shared_triple"]),
  extraBed: z.boolean().optional().default(false),
  checkIn: z.string().optional().default(""),
  checkOut: z.string().optional().default(""),
});

export const donationSchema = z.object({
  donationAmount: z.string().optional().default(""),
  publicAcknowledgement: z.boolean().optional().default(false),
  acknowledgementDisplayName: z.string().optional().default(""),
  felicitationConsent: z.boolean().optional().default(false),
});

// accommodation (wizard 4)
export type AccommodationData = z.infer<typeof accommodationSchema>;

// college-contribution (wizard 5)
export const collegeContributionSchema = z.object({
  collegeContribution: z
    .number({ invalid_type_error: "College contribution must be a number" })
    .min(
      PRICING_DEFAULTS.collegeContributionMinimum,
      `Minimum contribution is ₹${PRICING_DEFAULTS.collegeContributionMinimum}`,
    ),
});

// giving-back (wizard 5 — combined college contribution + donation)
export const givingBackSchema = z.object({
  collegeContribution: z
    .number({ invalid_type_error: "College contribution must be a number" })
    .optional(),
  collegeContributionCause: z.string().optional().default(""),
  donationAmount: z.string().optional().default(""),
  publicAcknowledgement: z.boolean().optional().default(false),
  acknowledgementDisplayName: z.string().optional().default(""),
  felicitationConsent: z.boolean().optional().default(false),
  participationType: z.string(),
}).superRefine((data, ctx) => {
  const contribution = data.collegeContribution ?? 0;
  const donation = parseInt(data.donationAmount ?? "", 10);
  const hasDonation = !isNaN(donation) && donation > 0;

  // A contribution must be routed to a cause — for every participation type.
  if (
    contribution > 0 &&
    !(CONTRIBUTION_CAUSE_VALUES as readonly string[]).includes(data.collegeContributionCause)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["collegeContributionCause"],
      message: COLLEGE_CONTRIBUTION_COPY.causeRequiredError,
    });
  }

  if (data.participationType === "donation_only") {
    // Donation-only registrants must give *something* — reunion donation,
    // college contribution, or both.
    if (!hasDonation && contribution <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["donationAmount"],
        message: "Add a donation or a college contribution to continue.",
      });
    }
  } else {
    if (
      data.collegeContribution == null ||
      data.collegeContribution < PRICING_DEFAULTS.collegeContributionMinimum
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collegeContribution"],
        message: `Minimum contribution is ₹${PRICING_DEFAULTS.collegeContributionMinimum}`,
      });
    }
  }
});

// photo-id (wizard 6)

export const ALLOWED_ID_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const;

export const MAX_ID_FILE_SIZE = 5 * 1024 * 1024;

export const ALLOWED_PHOTO_FILE_TYPES = [
  "image/jpeg",
  "image/png",
] as const;

export const MAX_PHOTO_FILE_SIZE = 10 * 1024 * 1024;

export const photoIdSchema = z
  .object({
    // Photo — required for all intents
    photoFileName: z.string().min(1, "Upload a photo"),
    photoFileKey: z.string().optional(),
    photoFileType: z.string().optional(),
    photoFileSizeBytes: z.number().optional(),
    // ID document — optional in the draft; upload requirement enforced at payment review
    idFileName: z.string().optional().default(""),
    idFileType: z.string().optional(),
    idFileSizeBytes: z.number().optional(),
    idNote: z.string().optional().default(""),
  })
  .superRefine((data, ctx) => {
    // Photo: when a filename is present, a fileKey must also be present (upload complete)
    if (data.photoFileName && !data.photoFileKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["photoFileKey"],
        message: "Photo upload is incomplete — please wait for the upload to finish",
      });
    }
    // Photo: when uploaded, validate type and size
    if (data.photoFileType) {
      const validType = (ALLOWED_PHOTO_FILE_TYPES as readonly string[]).includes(data.photoFileType);
      const validSize =
        data.photoFileSizeBytes != null &&
        data.photoFileSizeBytes > 0 &&
        data.photoFileSizeBytes <= MAX_PHOTO_FILE_SIZE;
      if (!validType || !validSize) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["photoFileType"],
          message: "Photo must be a JPEG or PNG and no larger than 10 MB",
        });
      }
    }
    // ID: when a file IS uploaded, validate type and size
    if (data.idFileType) {
      const valid =
        (ALLOWED_ID_FILE_TYPES as readonly string[]).includes(data.idFileType) &&
        data.idFileSizeBytes != null &&
        data.idFileSizeBytes > 0 &&
        data.idFileSizeBytes <= MAX_ID_FILE_SIZE;
      if (!valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["idFileType"],
          message: "ID file must be JPEG, PNG, or PDF and no larger than 5 MB",
        });
      }
    }
  });

export type AlumniDetailsData = z.infer<typeof alumniDetailsSchema>;
export type AttendeesMealsData = z.infer<typeof attendeesMealsSchema>;
export type CollegeContributionData = z.infer<typeof collegeContributionSchema>;
export type GivingBackData = z.infer<typeof givingBackSchema>;
export type PhotoIdData = z.infer<typeof photoIdSchema>;
