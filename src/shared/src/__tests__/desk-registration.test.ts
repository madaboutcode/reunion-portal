/**
 * Unit tests for deskSpotRegistrationSchema.
 *
 * Email is now a required field for registration-desk spot registration
 * (docs/specs/interfaces/registration-desk-api.ispec.md R5) — the desk-collected
 * receipt/charge emails need a real address, so the old pseudo-email fallback
 * is gone. This test proves the schema enforces that: it must fail if the
 * `email` field reverts to optional.
 */

import { describe, it, expect } from "vitest";
import { deskSpotRegistrationSchema } from "../desk-registration.ts";

function validSpotBody(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Priya Nair",
    whatsapp: "+919812345678",
    branch: "ECE",
    participationType: "campus_only" as const,
    alumniMeal: "non_veg" as const,
    photoFileKey: "photos/pending/ece/priya/abc123.jpg",
    email: "priya.nair@example.com",
    children: [],
    guests: [],
    ...overrides,
  };
}

describe("deskSpotRegistrationSchema", () => {
  it("rejects a payload with email omitted", () => {
    const { email: _email, ...withoutEmail } = validSpotBody();
    const result = deskSpotRegistrationSchema.safeParse(withoutEmail);

    expect(result.success).toBe(false);
    if (!result.success) {
      const emailIssue = result.error.issues.find((issue) => issue.path.join(".") === "email");
      expect(emailIssue).toBeDefined();
    }
  });

  it("accepts a payload with a valid email", () => {
    const result = deskSpotRegistrationSchema.safeParse(validSpotBody());
    expect(result.success).toBe(true);
  });
});
