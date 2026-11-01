/**
 * CONTRACT: Registration-desk spot-registration request schema
 * (docs/specs/interfaces/registration-desk-api.ispec.md R5).
 *
 * GUARANTEE: STRICT_SHAPE — every object level is `.strict()`: unknown fields
 *   (accommodation, t-shirts, ID documents, donation causes, public
 *   acknowledgement, felicitation, internal notes) are rejected, never
 *   silently stripped or stored (registration-desk.spec.md R5.1).
 *
 * GUARANTEE: EXACT_ALLOWLIST — accepts only the documented fields:
 *   required fullName, whatsapp, branch, participationType, alumniMeal,
 *   photoFileKey, email; optional donationAmount, spouse, children, guests.
 *   Guests carry only name + mealPreference (requirements R21); children
 *   carry name, age, mealPreference.
 *
 * GUARANTEE: POSITIVE_DONATION — donationAmount, when present, is a positive
 *   number (registration-desk.spec.md R5.2).
 *
 * EXPECTS: the schema is applied at the API boundary before any DB or
 *   pricing access. The client cannot set totalAmount, paymentStatus,
 *   pricing lines, or payment records — those keys are rejected as unknown.
 *
 * FAILURE BEHAVIOR: z.parse / safeParse failures report field-specific
 *   issues in the standard zod shape; the route maps them to 422.
 */

import { z } from "zod";

const mealPreference = z.enum(["veg", "non_veg"]);

const spouseSchema = z
  .object({
    name: z.string().trim().min(1, "Spouse name cannot be blank"),
    mealPreference,
  })
  .strict();

const childSchema = z
  .object({
    name: z.string().trim().min(1, "Child name cannot be blank"),
    age: z.number().int().min(0).max(99),
    mealPreference,
  })
  .strict();

const guestSchema = z
  .object({
    name: z.string().trim().min(1, "Guest name cannot be blank"),
    mealPreference,
  })
  .strict();

export const deskSpotRegistrationSchema = z
  .object({
    fullName: z.string().trim().min(1, "Full name is required"),
    whatsapp: z.string().trim().min(1, "WhatsApp number is required"),
    branch: z.string().trim().min(1, "Branch is required"),
    participationType: z.enum(["full_celebration", "campus_only"]),
    alumniMeal: mealPreference,
    photoFileKey: z
      .string()
      .trim()
      .min(1, "Photo file reference is required")
      .refine(
        (key) => key.startsWith("photos/pending/"),
        "photoFileKey must be a reference returned by the photo upload flow",
      ),
    email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
    donationAmount: z.number().positive("Donation amount must be positive").optional(),
    spouse: spouseSchema.optional(),
    children: z.array(childSchema).default([]),
    guests: z.array(guestSchema).default([]),
  })
  .strict();

export type DeskSpotRegistrationRequest = z.infer<typeof deskSpotRegistrationSchema>;

/**
 * CONTRACT: Registration-desk payment-collection request schema
 * (docs/specs/interfaces/registration-desk-api.ispec.md, desk-payment-collection
 * plan "Data Models" — req #1).
 *
 * GUARANTEE: EXACT_ALLOWLIST — accepts only `method` (required) and `note`
 *   (optional); unknown fields are rejected, never silently stripped.
 *
 * GUARANTEE: METHOD_ENUM — method is one of the three desk collection modes
 *   the desk supports: cash, upi, bank_transfer.
 *
 * EXPECTS: the schema is applied at the API boundary before the settle
 *   service runs; a full outstanding-balance settle, not a partial amount —
 *   there is no amount field here by design (Pre-Decisions: settlement
 *   granularity).
 *
 * FAILURE BEHAVIOR: z.parse / safeParse failures report field-specific
 *   issues in the standard zod shape; the route maps them to 422.
 */
const deskPaymentMethodValues = ["cash", "upi", "bank_transfer"] as const;

export type DeskPaymentMethod = (typeof deskPaymentMethodValues)[number];

export const deskCollectPaymentSchema = z
  .object({
    method: z.enum(deskPaymentMethodValues),
    note: z.string().trim().max(500, "Note must be 500 characters or fewer").optional(),
  })
  .strict();

export type DeskCollectPaymentRequest = z.infer<typeof deskCollectPaymentSchema>;

/**
 * CONTRACT: Registration-desk add-charge request schema
 * (docs/specs/interfaces/registration-desk-api.ispec.md, desk-payment-collection
 * plan "Data Models" — req #2).
 *
 * GUARANTEE: EXACT_ALLOWLIST — accepts only `description` (required) and
 *   `amount` (required); unknown fields are rejected, never silently
 *   stripped.
 *
 * GUARANTEE: POSITIVE_INTEGER_AMOUNT — amount is a whole-rupee integer
 *   greater than zero, mirroring the server guard on `additional_charges`
 *   (`db/schema.sql`: `amount INTEGER NOT NULL CHECK (amount > 0)`).
 *
 * EXPECTS: the schema is applied at the API boundary before the charge is
 *   created; the desk add-charge path reuses the existing charge pipeline
 *   but suppresses the payment-link email (Pre-Decisions: additional-charge
 *   email).
 *
 * FAILURE BEHAVIOR: z.parse / safeParse failures report field-specific
 *   issues in the standard zod shape; the route maps them to 422.
 */
export const deskAddChargeSchema = z
  .object({
    description: z.string().trim().min(1, "Description is required"),
    amount: z.number().int().positive("Amount must be a positive whole number"),
  })
  .strict();

export type DeskAddChargeRequest = z.infer<typeof deskAddChargeSchema>;
