import { describe, expect, it } from "vitest";
import { BRANCHES, BRANCH_SHORT_NAMES } from "@/lib/constants";
import { BRANCH_CATALOG, getBranchInfo } from "./branchCatalog";

const EXPECTED: Record<string, { short: string; panelTitle: string; quote: string }> = {
  Architecture: {
    short: "Arch",
    panelTitle: "Architecture",
    quote: "Drew the campus better than anyone actually built it.",
  },
  "Chemical Engineering": {
    short: "Chem",
    panelTitle: "Chemical Engineering",
    quote: "Balanced every equation but the canteen bill.",
  },
  "Civil Engineering": {
    short: "Civil",
    panelTitle: "Civil Engineering",
    quote: "Surveyed half of Kerala. Still can't parallel park.",
  },
  "Computer Science & Engineering": {
    short: "CSE",
    panelTitle: "Computer Science",
    quote: "Compiled at 3am. Debugged at the tea shop by five.",
  },
  "Electrical & Electronics Engineering": {
    short: "EEE",
    panelTitle: "Electrical & Electronics",
    quote: "Lit up three continents. Never fixed the hostel fan.",
  },
  "Electronics & Communication Engineering": {
    short: "ECE",
    panelTitle: "Electronics",
    quote: "Twenty years of noise, and the signal still got through.",
  },
  "Mechanical Engineering": {
    short: "ME",
    panelTitle: "Mechanical",
    quote: "Workshop bell at 8:15. Still wakes us up.",
  },
  "Production Engineering": {
    short: "PE",
    panelTitle: "Production",
    quote: "Optimised every process except getting here on time.",
  },
};

describe("BRANCH_CATALOG", () => {
  it("has exactly the 8 canonical branch names as keys", () => {
    expect(Object.keys(BRANCH_CATALOG).sort()).toEqual([...BRANCHES].sort());
  });

  it("holds the exact short / panelTitle / quote values from the spec table", () => {
    expect(BRANCH_CATALOG).toEqual(EXPECTED);
  });

  it("derives every short name from the shared BRANCH_SHORT_NAMES", () => {
    for (const branch of BRANCHES) {
      expect(BRANCH_CATALOG[branch].short).toBe(BRANCH_SHORT_NAMES[branch]);
    }
  });
});

describe("getBranchInfo", () => {
  it("returns the catalog entry for a known branch", () => {
    expect(getBranchInfo("Computer Science & Engineering")).toEqual(
      BRANCH_CATALOG["Computer Science & Engineering"],
    );
  });

  it("falls back to the raw name with an empty quote for an unknown branch", () => {
    expect(getBranchInfo("Time Travel")).toEqual({
      short: "Time Travel",
      panelTitle: "Time Travel",
      quote: "",
    });
  });
});
