/**
 * LED wall — branch catalog.
 *
 * Static mapping from canonical branch name (the `Branch` values in
 * `@smriti/shared`) to the wall's display data: the card-caption short name,
 * the left-panel title, and the branch quote (spec R6).
 *
 * The `short` values are derived from `BRANCH_SHORT_NAMES` — the shared
 * constant is the single source of truth, so the two can never drift.
 */
import { BRANCH_SHORT_NAMES } from "@/lib/constants";
import type { Branch } from "@/lib/constants";

export interface BranchInfo {
  /** Short caption name, from `BRANCH_SHORT_NAMES` (e.g. "CSE"). */
  short: string;
  /** Left-panel title, the mockup's shorter display form (e.g. "Computer Science"). */
  panelTitle: string;
  /** The branch's handwritten quote on the panel. */
  quote: string;
}

export const BRANCH_CATALOG: Record<Branch, BranchInfo> = {
  Architecture: {
    short: BRANCH_SHORT_NAMES["Architecture"],
    panelTitle: "Architecture",
    quote: "Drew the campus better than anyone actually built it.",
  },
  "Chemical Engineering": {
    short: BRANCH_SHORT_NAMES["Chemical Engineering"],
    panelTitle: "Chemical Engineering",
    quote: "Balanced every equation but the canteen bill.",
  },
  "Civil Engineering": {
    short: BRANCH_SHORT_NAMES["Civil Engineering"],
    panelTitle: "Civil Engineering",
    quote: "Surveyed half of Kerala. Still can't parallel park.",
  },
  "Computer Science & Engineering": {
    short: BRANCH_SHORT_NAMES["Computer Science & Engineering"],
    panelTitle: "Computer Science",
    quote: "Compiled at 3am. Debugged at the tea shop by five.",
  },
  "Electrical & Electronics Engineering": {
    short: BRANCH_SHORT_NAMES["Electrical & Electronics Engineering"],
    panelTitle: "Electrical & Electronics",
    quote: "Lit up three continents. Never fixed the hostel fan.",
  },
  "Electronics & Communication Engineering": {
    short: BRANCH_SHORT_NAMES["Electronics & Communication Engineering"],
    panelTitle: "Electronics",
    quote: "Twenty years of noise, and the signal still got through.",
  },
  "Mechanical Engineering": {
    short: BRANCH_SHORT_NAMES["Mechanical Engineering"],
    panelTitle: "Mechanical",
    quote: "Workshop bell at 8:15. Still wakes us up.",
  },
  "Production Engineering": {
    short: BRANCH_SHORT_NAMES["Production Engineering"],
    panelTitle: "Production",
    quote: "Optimised every process except getting here on time.",
  },
};

/**
 * Resolve a canonical branch name to its wall display data.
 *
 * GUARANTEES: returns `{ short, panelTitle, quote }` for the eight catalog
 * branches, and `{ short: canonical, panelTitle: canonical, quote: "" }` for
 * any other string — the wall still renders the attendee's card, but the
 * branch has no panel/quote (spec edge case: unknown branch).
 */
export function getBranchInfo(canonical: string): BranchInfo {
  return (
    BRANCH_CATALOG[canonical as Branch] ?? {
      short: canonical,
      panelTitle: canonical,
      quote: "",
    }
  );
}
