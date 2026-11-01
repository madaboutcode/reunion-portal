/**
 * StaffAccessDeniedPage — the role-only, scope-free landing for empty scopes
 * and permission-fetch failure (tasks/registration-desk.design.md
 * "No-access landing page", §Redirect algorithm steps 5–6).
 *
 * Proves: the two explanations (no feature assigned vs permissions fetch
 * failure), the retry action that re-resolves the landing, and logout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/lib/auth");
vi.mock("@/lib/staff-api");

import { StaffAccessDeniedPage } from "@/pages/StaffAccessDeniedPage";
import { clearAuth, getAuthRole, resolveStaffLanding } from "@/lib/auth";
import { fetchMyPermissions } from "@/lib/staff-api";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/staff/access-denied${search}`]}>
      <Routes>
        <Route path="/staff/access-denied" element={<StaffAccessDeniedPage />} />
        <Route path="/" element={<div data-testid="home-page" />} />
        <Route path="/staff/check-in" element={<div data-testid="check-in-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StaffAccessDeniedPage — no feature assigned", () => {
  it("explains that no staff features are assigned and offers Logout", () => {
    renderPage();

    expect(
      screen.getByText(/no staff features are assigned/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /logout/i }),
    ).toBeInTheDocument();
    // No retry action when the cause is not a fetch failure.
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    // It never claims a 403.
    expect(screen.queryByText(/403/)).not.toBeInTheDocument();
  });

  it("Logout clears auth and navigates to /", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /logout/i }));

    expect(clearAuth).toHaveBeenCalled();
    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
  });
});

describe("StaffAccessDeniedPage — permission-fetch failure (?reason=fetch)", () => {
  beforeEach(() => {
    vi.mocked(getAuthRole).mockReturnValue("staff");
    vi.mocked(resolveStaffLanding).mockReturnValue("/staff/check-in");
  });

  it("explains permissions could not be loaded and offers Retry + Logout", () => {
    renderPage("?reason=fetch");

    expect(
      screen.getByText(/couldn't load your permissions/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /retry/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /logout/i }),
    ).toBeInTheDocument();
  });

  it("Retry re-fetches permissions and navigates to the resolved landing", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchMyPermissions).mockResolvedValue({
      permissions: { scopes: ["registration_desk"] },
      role: "staff",
    });
    renderPage("?reason=fetch");

    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(fetchMyPermissions).toHaveBeenCalledTimes(1);
    expect(resolveStaffLanding).toHaveBeenCalledWith(
      ["registration_desk"],
      null,
      "staff",
    );
    expect(await screen.findByTestId("check-in-page")).toBeInTheDocument();
  });

  it("a failed retry stays on the page (button remains for another attempt)", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchMyPermissions).mockRejectedValue(new Error("network down"));
    renderPage("?reason=fetch");

    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByTestId("check-in-page")).not.toBeInTheDocument();
  });
});
