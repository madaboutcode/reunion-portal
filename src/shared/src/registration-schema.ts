import { z } from "zod";
import {
  attendanceIntentSchema,
  participationTypeSchema,
  mealPreferenceSchema,
  genderSchema,
  tshirtSizeSchema,
  childSchema,
  guestSchema,
  validatePhoneNumber,
  ALLOWED_ID_FILE_TYPES,
  MAX_ID_FILE_SIZE,
} from "./validation.ts";
import { CONTRIBUTION_CAUSE_VALUES } from "./constants.ts";

const spouseRegSchema = z.object({
  name: z.string().trim().min(1, "Spouse name cannot be blank"),
  meal: mealPreferenceSchema,
});

const accommodationRegSchema = z.object({
  type: z.enum(["private", "shared_double", "shared_triple"]),
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
  extraBed: z.boolean(),
});

const donationRegSchema = z.object({
  amount: z.number().positive(),
  publicAcknowledgement: z.boolean(),
  acknowledgementDisplayName: z.string().optional(),
  felicitationConsent: z.boolean(),
});

const idDocumentRegSchema = z.object({
  fileKey: z.string().min(1),
  fileType: z.enum(ALLOWED_ID_FILE_TYPES),
  sizeBytes: z.number().min(1).max(MAX_ID_FILE_SIZE),
  fileName: z.string(),
  note: z.string(),
});

const contactRegSchema = z
  .object({
    fullName: z.string().min(1),
    branch: z.string().min(1),
    gender: genderSchema,
    email: z.string().min(1).email(),
    whatsapp: z.string().min(1),
    mobileAlternate: z.string().optional(),
    city: z.string().min(1),
    country: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    const phoneError = validatePhoneNumber(data.whatsapp, data.country);
    if (phoneError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["whatsapp"],
        message: phoneError,
      });
    }
  });

export const registrationSchema = z
  .object({
    contact: contactRegSchema,
    attendance: z.object({
      intent: attendanceIntentSchema,
      participationType: participationTypeSchema,
      alumniMeal: mealPreferenceSchema.optional(),
      tshirtSize: tshirtSizeSchema.optional(),
    }).superRefine((data, ctx) => {
      if (data.intent === "donation_only") {
        if (data.alumniMeal !== undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["alumniMeal"], message: "Meal preference is not applicable for donation-only registration" });
        }
        if (data.tshirtSize !== undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tshirtSize"], message: "T-shirt size is not applicable for donation-only registration" });
        }
      } else {
        if (!data.alumniMeal) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["alumniMeal"], message: "Meal preference is required" });
        }
        if (!data.tshirtSize) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tshirtSize"], message: "T-shirt size is required" });
        }
      }
    }),
    attendees: z.object({
      spouse: spouseRegSchema.optional(),
      children: z.array(childSchema),
      guests: z.array(guestSchema),
    }),
    accommodation: accommodationRegSchema.optional(),
    donation: donationRegSchema.optional(),
    // Keyed by cause; every present amount must be a positive integer
    contributionSplits: z
      .record(z.enum(CONTRIBUTION_CAUSE_VALUES), z.number().int().positive())
      .optional(),
    idDocument: idDocumentRegSchema.optional(),
  })
  .superRefine((data, ctx) => {
    // Shared room is only available for solo attendees
    if (data.accommodation) {
      const t = data.accommodation.type;
      const isShared = t === "shared_double" || t === "shared_triple";
      if (isShared) {
        const hasSpouse = !!data.attendees.spouse;
        const hasChildren = data.attendees.children.length > 0;
        const hasGuests = data.attendees.guests.length > 0;
        if (hasSpouse || hasChildren || hasGuests) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["accommodation", "type"],
            message:
              "Shared room is only available for solo attendees — choose Private Room or No Accommodation",
          });
        }
      }
    }

    // Extra bed is only available with a Private Room
    if (
      data.accommodation &&
      data.accommodation.type !== "private" &&
      data.accommodation.extraBed === true
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accommodation", "extraBed"],
        message: "Extra bed is only available with a Private Room",
      });
    }

    // Donation-only registrations must carry at least one positive amount —
    // a reunion donation, a college contribution, or both
    const hasContribution =
      !!data.contributionSplits && Object.keys(data.contributionSplits).length > 0;
    if (data.attendance.intent === "donation_only" && !data.donation && !hasContribution) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["donation"],
        message:
          "A donation or college contribution is required for donation-only registration",
      });
    }

    // ID document required for attending (any in-person participation)
    const needsId = data.attendance.intent === "attending";
    if (needsId && !data.idDocument) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["idDocument"],
        message: "An ID document is required for event check-in",
      });
    }
  });

export type RegistrationSchema = z.infer<typeof registrationSchema>;
