/**
 * GoalCard — adversarial black-box tests.
 *
 * Spec source: tasks/staff-dashboard-gaps.design.md §C7
 *              tasks/staff-dashboard-gaps.decisions.md §D7
 *
 * ── Coverage table ────────────────────────────────────────────────────────────
 *
 * Ref      | Guarantee                                           | Test(s)
 * ---------|-----------------------------------------------------|-------------------
 * D7       | counted derived internally from confirmed+pending+  | over-cap pill, zero
 *          | pendingVerification — never a prop                  |
 * D7/R4    | Over-cap pill appears iff counted > target          | over-cap, near-cap
 * D7/R4    | Over-cap pill shows correct "+N" amount             | over-cap pill text
 * D7/R4    | Count figure turns red when over-cap                | count red class
 * C7       | Zero-state renders without crash                    | zero-state
 * C7       | Segment widths clamped — sum never exceeds 100%     | segment clamp
 * C7       | slotsNote suppressed when over-cap                  | over-cap slotsNote
 * C7       | slotsNote rendered when not over-cap and provided   | near-cap slotsNote
 * C7       | footnote rendered when provided                     | footnote
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GoalCard } from "./GoalCard";

afterEach(cleanup);

describe("GoalCard", () => {
  // ── D7/R4: Over-cap pill appears exactly when counted > target ───────────
  // Uses DISTINCT values for each of the three counts (never a pre-summed total).

  it("shows +N over cap pill when confirmed + pending + pendingVerification > target", () => {
    // confirmed=40, pending=9, pendingVerification=3 → counted=52, target=50 → over by 2
    render(
      <GoalCard
        title="Campus Only"
        target={50}
        confirmed={40}
        pending={9}
        pendingVerification={3}
      />,
    );

    expect(screen.getByTestId("overcap-pill")).toBeInTheDocument();
    expect(screen.getByTestId("overcap-pill")).toHaveTextContent("+2 over cap");
  });

  it("does NOT show over-cap pill when counted === target (exactly at cap)", () => {
    // confirmed=30, pending=15, pendingVerification=5 → counted=50, target=50 → equal, not over
    render(
      <GoalCard
        title="Campus Only"
        target={50}
        confirmed={30}
        pending={15}
        pendingVerification={5}
      />,
    );

    expect(screen.queryByTestId("overcap-pill")).not.toBeInTheDocument();
  });

  it("does NOT show over-cap pill when counted < target", () => {
    // confirmed=38, pending=7, pendingVerification=2 → counted=47, target=50 → 3 under
    render(
      <GoalCard
        title="Campus Only"
        target={50}
        confirmed={38}
        pending={7}
        pendingVerification={2}
      />,
    );

    expect(screen.queryByTestId("overcap-pill")).not.toBeInTheDocument();
  });

  // ── D7/R4: Count figure turns red when over-cap ──────────────────────────

  it("renders count in red when over-cap", () => {
    render(
      <GoalCard
        title="Campus Only"
        target={50}
        confirmed={40}
        pending={9}
        pendingVerification={3}
      />,
    );

    const countEl = screen.getByTestId("goal-count");
    expect(countEl).toHaveClass("text-red-600");
  });

  it("does NOT render count in red when not over-cap", () => {
    render(
      <GoalCard
        title="Campus Only"
        target={50}
        confirmed={38}
        pending={7}
        pendingVerification={2}
      />,
    );

    const countEl = screen.getByTestId("goal-count");
    expect(countEl).not.toHaveClass("text-red-600");
  });

  // ── C7: Zero-state renders without crash ─────────────────────────────────

  it("renders without crash when all counts are 0 (zero-state)", () => {
    render(
      <GoalCard
        title="Full Celebration"
        target={200}
        confirmed={0}
        pending={0}
        pendingVerification={0}
      />,
    );

    // Count shown as 0 / 200
    expect(screen.getByTestId("goal-count")).toHaveTextContent("0");
    expect(screen.getByText("/ 200")).toBeInTheDocument();

    // No over-cap pill in zero state
    expect(screen.queryByTestId("overcap-pill")).not.toBeInTheDocument();

    // Segments exist (width 0 is fine)
    expect(screen.getByTestId("segment-confirmed")).toBeInTheDocument();
    expect(screen.getByTestId("segment-pending")).toBeInTheDocument();
  });

  // ── C7: Segment widths — sum never exceeds 100% ──────────────────────────
  // When both segments together would exceed 100%, pending is clamped.

  it("clamps segment widths so their sum does not exceed 100%", () => {
    // confirmed=180 (90%), pending=60, pendingVerification=20 (combined 80/200=40%)
    // Without clamping sum would be 130%; with clamping pending should be 10%
    render(
      <GoalCard
        title="Full Celebration"
        target={200}
        confirmed={180}
        pending={60}
        pendingVerification={20}
      />,
    );

    const confirmedSeg = screen.getByTestId("segment-confirmed");
    const pendingSeg = screen.getByTestId("segment-pending");

    const confirmedWidth = parseFloat(
      (confirmedSeg as HTMLElement).style.width,
    );
    const pendingWidth = parseFloat(
      (pendingSeg as HTMLElement).style.width,
    );

    expect(confirmedWidth).toBeLessThanOrEqual(100);
    expect(pendingWidth).toBeLessThanOrEqual(100);
    expect(confirmedWidth + pendingWidth).toBeLessThanOrEqual(100);
  });

  it("confirmed segment width does not exceed 100% when confirmed alone exceeds target", () => {
    // confirmed=250 with target=200 → clamped to 100%
    render(
      <GoalCard
        title="Full Celebration"
        target={200}
        confirmed={250}
        pending={0}
        pendingVerification={0}
      />,
    );

    const confirmedSeg = screen.getByTestId("segment-confirmed");
    const confirmedWidth = parseFloat(
      (confirmedSeg as HTMLElement).style.width,
    );
    expect(confirmedWidth).toBeLessThanOrEqual(100);
  });

  // ── C7: slotsNote suppressed when over-cap ───────────────────────────────

  it("does NOT render slotsNote when over-cap", () => {
    render(
      <GoalCard
        title="Campus Only"
        target={50}
        confirmed={40}
        pending={9}
        pendingVerification={3}
        slotsNote="3 slots left — pending registrations hold a slot"
      />,
    );

    expect(screen.queryByTestId("slots-note")).not.toBeInTheDocument();
  });

  // ── C7: slotsNote rendered when not over-cap and provided ───────────────

  it("renders slotsNote when not over-cap and slotsNote is provided", () => {
    render(
      <GoalCard
        title="Campus Only"
        target={50}
        confirmed={38}
        pending={7}
        pendingVerification={2}
        slotsNote="3 slots left — pending registrations hold a slot"
      />,
    );

    expect(screen.getByTestId("slots-note")).toHaveTextContent(
      "3 slots left — pending registrations hold a slot",
    );
  });

  // ── C7: footnote rendered when provided ─────────────────────────────────

  it("renders footnote when provided", () => {
    render(
      <GoalCard
        title="Full Celebration"
        target={200}
        confirmed={87}
        pending={31}
        pendingVerification={0}
        footnote="Pending holds a slot toward the goal"
      />,
    );

    expect(screen.getByTestId("footnote")).toHaveTextContent(
      "Pending holds a slot toward the goal",
    );
  });

  it("does NOT render footnote element when footnote is omitted", () => {
    render(
      <GoalCard
        title="Full Celebration"
        target={200}
        confirmed={87}
        pending={31}
        pendingVerification={0}
      />,
    );

    expect(screen.queryByTestId("footnote")).not.toBeInTheDocument();
  });

  // ── Legend and counted display ───────────────────────────────────────────

  it("displays derived counted value (confirmed+pending+pendingVerification) as the headline number", () => {
    // confirmed=87, pending=31, pendingVerification=0 → counted=118
    render(
      <GoalCard
        title="Full Celebration"
        target={200}
        confirmed={87}
        pending={31}
        pendingVerification={0}
      />,
    );

    expect(screen.getByTestId("goal-count")).toHaveTextContent("118");
  });

  it("goal marker is present in the bar", () => {
    render(
      <GoalCard
        title="Full Celebration"
        target={200}
        confirmed={87}
        pending={31}
        pendingVerification={0}
      />,
    );

    expect(screen.getByTestId("goal-marker")).toBeInTheDocument();
  });
});
