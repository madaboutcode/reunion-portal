import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RotationLayer } from "./RotationLayer";
import { computeLayout } from "./layout";
import { getBranchInfo } from "./branchCatalog";
import { DEFAULT_PARAMS } from "./defaults";
import type { PresentAttendee } from "./types";

afterEach(() => cleanup());

const VIEWPORT = { w: 1280, h: 720 };
const BRANCH = getBranchInfo("Computer Science & Engineering");

function makeAttendees(count: number): PresentAttendee[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    fullName: `Person ${i + 1}`,
    branch: "Computer Science & Engineering",
    portraitUrl: null,
    thumbnailUrl: null,
    checkedInAt: 1_780_000_000_000 + i * 1000,
  }));
}

describe("RotationLayer — FIX D: no silent positional fallback", () => {
  it("renders normally when layout and attendees agree", () => {
    const attendees = makeAttendees(3);
    const layout = computeLayout(DEFAULT_PARAMS, VIEWPORT, BRANCH, attendees);

    expect(() =>
      render(<RotationLayer layout={layout} attendees={attendees} visible idle={false} showPanel />),
    ).not.toThrow();
  });

  it("throws instead of silently substituting a different attendee when layout and attendees desync", () => {
    const attendees = makeAttendees(3);
    const layout = computeLayout(DEFAULT_PARAMS, VIEWPORT, BRANCH, attendees);
    // The layout's cards still reference ids 1-3; hand the layer a list missing id 2 —
    // simulating a stale-memo desync between `computeLayout`'s input and this prop.
    const desynced = attendees.filter((attendee) => attendee.id !== 2);

    expect(() =>
      render(<RotationLayer layout={layout} attendees={desynced} visible idle={false} showPanel />),
    ).toThrow(/attendee 2/);
  });
});
