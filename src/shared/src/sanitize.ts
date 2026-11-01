import type { Registration } from "./types.ts";

/**
 * Strip fields that don't apply to the selected participation type.
 * Called client-side (inside toRegistration) and server-side (after schema validation).
 */
export function sanitizeRegistration(reg: Registration): Registration {
  const { participationType } = reg.attendance;

  if (participationType === "donation_only") {
    // contributionSplits is intentionally preserved — donation-only registrants
    // can contribute to college causes.
    const { alumniMeal: _meal, tshirtSize: _tshirt, ...attendance } = reg.attendance;
    return {
      ...reg,
      attendance,
      attendees: { children: [], guests: [] },
      accommodation: undefined,
    };
  }

  if (participationType === "campus_only") {
    return {
      ...reg,
      accommodation: undefined,
    };
  }

  return reg;
}
