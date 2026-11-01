/**
 * CONTRACT
 *
 * GUARANTEE: CATALOG_SOURCE_OF_TRUTH — FEATURE_FLAG_CATALOG is the sole
 *   definition of every supported flag's label, description, group, default
 *   value, storage-failure value, exposure, and enforcement. Runtime DB rows
 *   are overrides only; they never carry these metadata fields
 *   (feature-flags.spec.md R1, R1.1, R2).
 *
 * EXPECTS: Catalog keys use lowercase snake_case matching
 *   `^[a-z][a-z0-9_]{0,63}$` (feature-flags.spec.md R1.2). Not enforced at
 *   the type level — enforce by convention when adding new entries.
 */

export interface FeatureFlagDefinition {
  label: string;
  description: string;
  group: "Memories" | "Navigation" | "Homepage" | "Operations" | "Registration";
  defaultValue: boolean;
  failureValue: boolean;
  exposure: "public" | "admin_only";
  enforcement: "ui" | "server" | "both";
}

export const FEATURE_FLAG_CATALOG = {
  navigation_show_stories: {
    label: "Show stories navigation",
    description: "Shows the Autograph link in the top navigation bar.",
    group: "Navigation",
    defaultValue: false,
    failureValue: false,
    exposure: "public",
    enforcement: "ui",
  },
  homepage_show_memory_stories: {
    label: "Show homepage stories section",
    description: "Shows the 'In Our Own Words' story preview section on the homepage.",
    group: "Homepage",
    defaultValue: false,
    failureValue: false,
    exposure: "public",
    enforcement: "ui",
  },
  memories_show_stories: {
    label: "Show stories page",
    description: "Makes the public stories page and read API available.",
    group: "Memories",
    defaultValue: false,
    failureValue: false,
    exposure: "public",
    enforcement: "both",
  },
  memory_stories_accept_submissions: {
    label: "Accept story submissions",
    description: "Allows authenticated users to create and edit stories.",
    group: "Memories",
    defaultValue: false,
    failureValue: false,
    exposure: "public",
    enforcement: "both",
  },
  navigation_show_my_pass: {
    label: "Show My Pass navigation",
    description: "Shows the 'My Pass' link in the navigation bar for confirmed attendees.",
    group: "Navigation",
    defaultValue: false,
    failureValue: false,
    exposure: "public",
    enforcement: "ui",
  },
  navigation_show_register: {
    label: "Show register navigation",
    description: "Shows the Register button in the top navigation bar.",
    group: "Navigation",
    defaultValue: false,
    failureValue: false,
    exposure: "public",
    enforcement: "ui",
  },
  registration_accept_new: {
    label: "Accept new registrations",
    description: "Allows new registration submissions. When disabled, the form shows a 'registration closed' message and POST /api/registrations returns 403.",
    group: "Registration",
    defaultValue: false,
    failureValue: false,
    exposure: "public",
    enforcement: "both",
  },
  registration_show_page: {
    label: "Show registration page",
    description: "Makes the registration form page visible. When disabled, /register and /new show a 'registration unavailable' message.",
    group: "Registration",
    defaultValue: false,
    failureValue: false,
    exposure: "public",
    enforcement: "ui",
  },
  debug_tools: {
    label: "Debug tools",
    description: "Enables debug routes and tools for administrators.",
    group: "Operations",
    defaultValue: false,
    failureValue: false,
    exposure: "admin_only",
    enforcement: "both",
  },
} as const satisfies Record<string, FeatureFlagDefinition>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAG_CATALOG;

export type PublicFeatureFlagKey = {
  [K in FeatureFlagKey]: (typeof FEATURE_FLAG_CATALOG)[K]["exposure"] extends "public" ? K : never;
}[FeatureFlagKey];

export function getPublicFlagKeys(): PublicFeatureFlagKey[] {
  return (Object.keys(FEATURE_FLAG_CATALOG) as FeatureFlagKey[]).filter(
    (key): key is PublicFeatureFlagKey => FEATURE_FLAG_CATALOG[key].exposure === "public",
  );
}

export function getPublicFailureValues(): Record<PublicFeatureFlagKey, boolean> {
  const result = {} as Record<PublicFeatureFlagKey, boolean>;
  for (const key of getPublicFlagKeys()) {
    result[key] = FEATURE_FLAG_CATALOG[key].failureValue;
  }
  return result;
}
