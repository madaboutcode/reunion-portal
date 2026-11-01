/**
 * LoginPage — permission-aware landing for an already-authenticated staff user
 * (design.md "Post-Login Destination Design": "This applies both when the user
 * follows a magic link and when an already authenticated staff user opens
 * /login").
 *
 * Proves the page resolves current scopes before navigating and never falls
 * back to /staff/dashboard on a permission-fetch failure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/lib/auth");
vi.mock("@/lib/staff-api");
vi.mock("@/lib/api");

import LoginPage from "@/pages/LoginPage";
import { isStaff, getAuthRole, resolveStaffLanding } from "@/lib/auth";
import { fetchMyPermissions } from "@/lib/staff-api";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderLogin(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/login${search}`]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/staff/check-in" element={<div data-testid="check-in-page" />} />
        <Route path="/staff/dashboard" element={<div data-testid="staff-dashboard" />} />
        <Route path="/staff/access-denied" element={<div data-testid="access-denied-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(isStaff).mockReturnValue(true);
  vi.mocked(getAuthRole).mockReturnValue("staff");
});

describe("LoginPage — already-authenticated staff landing", () => {
  it("desk-only staff opening /login lands on /staff/check-in", async () => {
    vi.mocked(fetchMyPermissions).mockResolvedValue({
      permissions: { scopes: ["registration_desk"] },
      role: "staff",
    });
    vi.mocked(resolveStaffLanding).mockReturnValue("/staff/check-in");
    renderLogin();

    await waitFor(() => {
      expect(resolveStaffLanding).toHaveBeenCalledWith(
        ["registration_desk"],
        null,
        "staff",
      );
    });
    expect(await screen.findByTestId("check-in-page")).toBeInTheDocument();
    expect(screen.queryByTestId("staff-dashboard")).not.toBeInTheDocument();
  });

  it("permission-fetch failure goes to /staff/access-denied?reason=fetch — never dashboard", async () => {
    vi.mocked(fetchMyPermissions).mockRejectedValue(new Error("network down"));
    renderLogin();

    expect(await screen.findByTestId("access-denied-page")).toBeInTheDocument();
    expect(screen.queryByTestId("staff-dashboard")).not.toBeInTheDocument();
  });

  it("an in-scope returnTo is resolved through the shared resolver", async () => {
    vi.mocked(fetchMyPermissions).mockResolvedValue({
      permissions: { scopes: ["dashboard"] },
      role: "staff",
    });
    vi.mocked(resolveStaffLanding).mockReturnValue("/staff/dashboard");
    renderLogin("?returnTo=%2Fstaff%2Fregistrations%2F42");

    await waitFor(() => {
      expect(resolveStaffLanding).toHaveBeenCalledWith(
        ["dashboard"],
        "/staff/registrations/42",
        "staff",
      );
    });
  });
});
