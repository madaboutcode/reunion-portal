import { describe, expect, it, vi } from "vitest";
import { createMockSource, MOCK_FIXTURE, MockLedWallSource } from "./mockSource";
import type { PresentAttendee } from "./types";

describe("MockLedWallSource", () => {
  it("returns the initial present subset and preserves fixture order", async () => {
    const source = createMockSource();
    const snapshot = await source.getSnapshot();

    expect(snapshot.length).toBe(16);
    expect(snapshot.map((attendee) => attendee.id)).toEqual(
      MOCK_FIXTURE.filter((_, index) => index % 5 < 2).map((attendee) => attendee.id),
    );
  });

  it("delivers each injected attendee once and includes it in later snapshots", async () => {
    const source = createMockSource();
    const arrivals: number[] = [];
    source.subscribe((attendee) => arrivals.push(attendee.id));

    const first = source.inject();
    expect(first).not.toBeNull();
    expect(arrivals).toEqual([first!.id]);
    expect((await source.getSnapshot()).some((attendee) => attendee.id === first!.id)).toBe(true);

    expect(source.inject()!.id).not.toBe(first!.id);
    expect(new Set(arrivals).size).toBe(arrivals.length);
  });

  it("removes a present attendee from later snapshots", async () => {
    const source = createMockSource();
    const removed = source.removeRandom();

    expect(removed).not.toBeNull();
    expect((await source.getSnapshot()).some((attendee) => attendee.id === removed!.id)).toBe(false);
  });

  it("returns null when no attendees are present", () => {
    const source = new MockLedWallSource([]);

    expect(source.removeRandom()).toBeNull();
  });

  it("tracks the present count across add and remove operations", () => {
    const source = createMockSource();
    const initialCount = source.presentCount();

    source.inject();
    expect(source.presentCount()).toBe(initialCount + 1);

    source.removeRandom();
    expect(source.presentCount()).toBe(initialCount);
  });

  it("chooses from the absent pool instead of following fixture order", () => {
    const source = createMockSource();
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);

    const injected = source.inject();

    const lastAbsent = MOCK_FIXTURE.filter((_, index) => index % 5 >= 2).at(-1);
    expect(injected?.id).toBe(lastAbsent?.id);
    random.mockRestore();
  });

  it("recycles after exhaustion without delivering already-present attendees", async () => {
    const source = createMockSource();
    const arrivals: number[] = [];
    source.subscribe((attendee) => arrivals.push(attendee.id));

    const absentCount = MOCK_FIXTURE.filter((_, index) => index % 5 >= 2).length;
    for (let i = 0; i < absentCount; i += 1) source.inject();
    expect(new Set(arrivals).size).toBe(arrivals.length);
    const recycled = source.inject();
    expect(recycled).not.toBeNull();
    expect((await source.getSnapshot()).some((attendee) => attendee.id === recycled!.id)).toBe(true);
  });

  it("replaceBranch swaps a branch's present members for its absent alternates, silently", async () => {
    const source = createMockSource();
    const arrivals: number[] = [];
    source.subscribe((attendee) => arrivals.push(attendee.id));

    const before = (await source.getSnapshot()).filter((a) => a.branch === "Architecture");
    expect(before.length).toBeGreaterThan(0);

    source.replaceBranch("Architecture");

    const after = (await source.getSnapshot()).filter((a) => a.branch === "Architecture");
    expect(after.length).toBe(before.length);
    expect(after.map((a) => a.id)).not.toEqual(before.map((a) => a.id));
    expect(arrivals).toEqual([]); // silent — no onArrival subscriber fired
  });

  it("replaceBranch no-ops when the branch has no absent alternates", async () => {
    // A 2-person fixture, both within the constructor's initial-present window — no one left to rotate in.
    const twoPresent: PresentAttendee[] = [
      { id: 1, fullName: "A", branch: "Test Branch", portraitUrl: null, thumbnailUrl: null, checkedInAt: 1 },
      { id: 2, fullName: "B", branch: "Test Branch", portraitUrl: null, thumbnailUrl: null, checkedInAt: 2 },
    ];
    const source = new MockLedWallSource(twoPresent);
    const before = (await source.getSnapshot()).map((a) => a.id).sort();
    expect(before).toEqual([1, 2]);

    source.replaceBranch("Test Branch");

    const after = (await source.getSnapshot()).map((a) => a.id).sort();
    expect(after).toEqual(before);
  });

  it("clear empties the present set silently", async () => {
    const source = createMockSource();
    const arrivals: number[] = [];
    source.subscribe((attendee) => arrivals.push(attendee.id));
    expect(source.presentCount()).toBeGreaterThan(0);

    source.clear();

    expect(source.presentCount()).toBe(0);
    expect(await source.getSnapshot()).toEqual([]);
    expect(arrivals).toEqual([]);
  });

  it("setBranchCount grows a branch silently and clamps above total", async () => {
    const source = createMockSource();
    const arrivals: number[] = [];
    source.subscribe((attendee) => arrivals.push(attendee.id));

    const before = source.branchSummaries().find((summary) => summary.branch === "Architecture");
    expect(before).toEqual({ branch: "Architecture", total: 5, present: 2 });

    source.setBranchCount("Architecture", 4);
    expect(arrivals).toEqual([]); // silent — no onArrival subscriber fired
    expect(source.branchSummaries().find((summary) => summary.branch === "Architecture")?.present).toBe(4);
    expect((await source.getSnapshot()).filter((a) => a.branch === "Architecture")).toHaveLength(4);

    source.setBranchCount("Architecture", 999); // clamp above total
    expect(arrivals).toEqual([]);
    expect(source.branchSummaries().find((summary) => summary.branch === "Architecture")?.present).toBe(5);
  });

  it("setBranchCount shrinks a branch to 0 silently", async () => {
    const source = createMockSource();
    const arrivals: number[] = [];
    source.subscribe((attendee) => arrivals.push(attendee.id));

    source.setBranchCount("Architecture", 0);

    expect(arrivals).toEqual([]);
    expect(source.branchSummaries().find((summary) => summary.branch === "Architecture")?.present).toBe(0);
    expect((await source.getSnapshot()).some((a) => a.branch === "Architecture")).toBe(false);
  });

  it("branchSummaries lists branches in fixture order with total and present counts", () => {
    const source = createMockSource();
    const summaries = source.branchSummaries();

    expect(summaries.map((s) => s.branch)).toEqual([
      "Architecture",
      "Chemical Engineering",
      "Civil Engineering",
      "Computer Science & Engineering",
      "Electrical & Electronics Engineering",
      "Electronics & Communication Engineering",
      "Mechanical Engineering",
      "Production Engineering",
    ]);
    expect(summaries.every((s) => s.total === 5 && s.present === 2)).toBe(true);
  });

  it("exercises all three photo tiers in the fixture", () => {
    // Tier 2: thumbnail only (a desk walk-in with no transparent cutout).
    const asha = MOCK_FIXTURE.find((attendee) => attendee.id === 1080);
    expect(asha).toMatchObject({ portraitUrl: null, thumbnailUrl: "https://cdn.example.test/1080.jpg" });

    // Tier 3: neither — falls back to initials.
    const ishan = MOCK_FIXTURE.find((attendee) => attendee.id === 1085);
    expect(ishan).toMatchObject({ portraitUrl: null, thumbnailUrl: null });

    // Tier 1: cutout + thumbnail.
    const withCutout = MOCK_FIXTURE.find((attendee) => attendee.id === 1179);
    expect(withCutout?.portraitUrl).toBe("https://cdn.example.test/portraits/1179.webp");
    expect(withCutout?.thumbnailUrl).toBe("https://cdn.example.test/1179.jpg");
  });
});
