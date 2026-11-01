import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportsPage } from "./ReportsPage";
import { fetchReports } from "@/lib/staff-api";

vi.mock("@/lib/staff-api");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("reports timeline", () => {
  it("plots Full Event actuals against the Full Event target", async () => {
    vi.mocked(fetchReports).mockResolvedValue({
      revenue: { collected: 0, expected: 0, pending: 0 },
      branchBreakdown: [],
      timeline: [
        { date: "2026-06-01", count: 40, fullCelebration: 2, campusOnly: 38 },
        { date: "2026-06-02", count: 60, fullCelebration: 1, campusOnly: 59 },
      ],
      contributions: [],
      donations: { count: 0, total: 0 },
      geography: { cities: [], countries: [] },
      donorRecognition: { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 },
      budgetProgress: {
        event: { actual: 0, target: 0 },
        accommodation: { actual: 0, target: 0 },
      },
    });

    const { container } = render(<ReportsPage />);
    await waitFor(() => expect(container.querySelector("svg")).not.toBeNull());

    const chart = container.querySelector("svg")!;
    expect(chart.textContent).toContain("Actual Full Event");
    // The latest plotted actual is 2 + 1 Full Event registrations, not 100 total attendees.
    expect([...chart.querySelectorAll("text")].some((node) => node.textContent === "3")).toBe(true);
    // 100 appears once as a y-axis tick; plotting total attendees would add a second
    // 100 as the latest-value label.
    expect([...chart.querySelectorAll("text")].filter((node) => node.textContent === "100"))
      .toHaveLength(1);
  });
});
