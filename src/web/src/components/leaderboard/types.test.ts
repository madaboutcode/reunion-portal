import { describe, expect, it } from "vitest";
import { assignDenseRanks, parseLeaderboardData } from "./types";

describe("assignDenseRanks", () => {
  it("assigns dense ranks with ties and no skipped positions", () => {
    const ranked = assignDenseRanks([
      { name: "A", department: "CSE", points: 35, mainPts: 0 },
      { name: "B", department: "EEE", points: 32, mainPts: 0 },
      { name: "C", department: "EEE", points: 32, mainPts: 0 },
      { name: "D", department: "ECE", points: 30, mainPts: 0 },
      { name: "E", department: "ECE", points: 30, mainPts: 0 },
      { name: "F", department: "CIVIL", points: 30, mainPts: 0 },
      { name: "G", department: "CHEM", points: 27, mainPts: 0 },
      { name: "H", department: "CHEM", points: 27, mainPts: 0 },
      { name: "I", department: "CHEM", points: 27, mainPts: 0 },
    ]);

    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 2, 3, 3, 3, 4, 4, 4]);
  });

  it("gives every entry a stable unique id even when ranks repeat", () => {
    const ranked = assignDenseRanks([
      { name: "A", department: "CSE", points: 10, mainPts: 0 },
      { name: "B", department: "CSE", points: 10, mainPts: 0 },
    ]);

    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(1);
    expect(ranked[0].id).not.toBe(ranked[1].id);
  });
});

describe("parseLeaderboardData", () => {
  it("maps canonical column names (DisplayName, Batch, Total)", () => {
    const entries = parseLeaderboardData([
      { DisplayName: "Alice", Batch: "CSE", Total: "500" },
      { DisplayName: "Bob", Batch: "EEE", Total: "300" },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ name: "Alice", department: "CSE", points: 500, rank: 1 });
    expect(entries[1]).toMatchObject({ name: "Bob", department: "EEE", points: 300, rank: 2 });
  });

  it("falls back to Name, Department, Points columns", () => {
    const entries = parseLeaderboardData([
      { Name: "Charlie", Department: "MECH", Points: "200" },
    ]);

    expect(entries[0]).toMatchObject({ name: "Charlie", department: "MECH", points: 200, mainPts: 0 });
  });

  it("falls back to lowercase column names", () => {
    const entries = parseLeaderboardData([
      { name: "Dana", department: "ECE", points: "150" },
    ]);

    expect(entries[0]).toMatchObject({ name: "Dana", department: "ECE", points: 150, mainPts: 0 });
  });

  it("filters out rows with empty names", () => {
    const entries = parseLeaderboardData([
      { DisplayName: "Alice", Total: "100" },
      { DisplayName: "", Total: "50" },
      { Total: "25" },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Alice");
  });

  it("treats non-numeric points as 0", () => {
    const entries = parseLeaderboardData([
      { DisplayName: "Alice", Total: "abc" },
      { DisplayName: "Bob", Total: "" },
    ]);

    expect(entries[0].points).toBe(0);
    expect(entries[1].points).toBe(0);
  });

  it("sorts by points descending, then name alphabetically for ties", () => {
    const entries = parseLeaderboardData([
      { DisplayName: "Zara", Total: "100" },
      { DisplayName: "Alice", Total: "100" },
      { DisplayName: "Bob", Total: "200" },
    ]);

    expect(entries.map((e) => e.name)).toEqual(["Bob", "Alice", "Zara"]);
  });

  it("assigns dense ranks to parsed data", () => {
    const entries = parseLeaderboardData([
      { DisplayName: "A", Total: "300" },
      { DisplayName: "B", Total: "300" },
      { DisplayName: "C", Total: "100" },
    ]);

    expect(entries.map((e) => e.rank)).toEqual([1, 1, 2]);
  });
});