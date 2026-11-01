/**
 * Daily-report page scope guard — adversarial black-box tests (RBAC t10).
 *
 * Spec source (source of truth):
 *   docs/specs/access-control.spec.md — R7 (/staff/daily-report row = admin-tools)
 *   Decision: Open Scoping Questions Q3, door R2 ("yes admin tools").
 *
 * Boundary: rendered React tree via MemoryRouter + RTL. The REAL DailyReportPage
 * is mounted through the REAL RequireScope guard with scope="admin-tools" (exactly
 * how App.tsx wires the /staff/daily-report route). Only the data boundaries are
 * mocked — auth (localStorage), fetchMyPermissions (the useStaffScopes source),
 * and the page's own data fetches (fetchReports/fetchRegistrations/fetchFile).
 *
 * A passing test therefore proves the wiring — that the guard actually gates the
 * real page — not a stubbed guard.
 *
 * ── Coverage ──────────────────────────────────────────────────────────────────
 * Ref  | Guarantee                                                      | Test
 * -----|----------------------------------------------------------------|-------------
 * R7   | admin-tools user → the real Daily Report page renders          | admin-tools sees page
 * R7   | dashboard+reports user (no admin-tools) → inline Access denied | denied, page never mounts
 * R5.4 | admin bypasses the admin-tools gate                            | admin bypass
 * R5.5 | full-access staff (permissions null) bypasses the gate         | null-scope bypass
 * R5.4 | denied state never surfaces a raw 403 string                   | no-403 assertion
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// Mock the data boundaries only — the guard, hook, and page are the real thing.
vi.mock("@/lib/auth");
vi.mock("@/lib/staff-api");

import { getAuthRole, isAdmin, isStaff, getAuthEmail, getAuthSub } from "@/lib/auth";
import {
  fetchMyPermissions,
  fetchReports,
  fetchRegistrations,
  fetchFile,
} from "@/lib/staff-api";
import { RequireScope } from "@/components/staff/RequireScope";
import DailyReportPage from "@/pages/DailyReportPage";
import { clearScopeCache } from "@/hooks/useStaffScopes";
import type { StaffScope, ReportsResponse } from "@/lib/staff-types";

// ── Test harness ─────────────────────────────────────────────────────────────

/** Set the current user's role + scopes. `scopes: null` = full access. */
function setUser(role: "staff" | "admin", scopes: StaffScope[] | null) {
  vi.mocked(getAuthRole).mockReturnValue(role);
  vi.mocked(isAdmin).mockReturnValue(role === "admin");
  vi.mocked(isStaff).mockReturnValue(true);
  vi.mocked(getAuthEmail).mockReturnValue("staff@example.com");
  vi.mocked(getAuthSub).mockReturnValue("42");
  vi.mocked(fetchMyPermissions).mockResolvedValue({
    permissions: scopes === null ? null : { scopes },
    role,
  });
}

/** A minimal-but-valid ReportsResponse so the real page renders past its loading state. */
function emptyReports(): ReportsResponse {
  return {
    branchBreakdown: [],
    timeline: [],
    revenue: { collected: 0, expected: 0, pending: 0 },
    contributions: [],
    donations: { count: 0, total: 0 },
    geography: { cities: [], countries: [] },
    donorRecognition: { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 },
    budgetProgress: {
      event: { actual: 0, target: 0 },
      accommodation: { actual: 0, target: 0 },
    },
  };
}

/** Mount the real /staff/daily-report route element exactly as App.tsx wires it. */
function renderDailyReportRoute() {
  return render(
    <MemoryRouter initialEntries={["/staff/daily-report"]}>
      <Routes>
        <Route
          path="/staff/daily-report"
          element={
            <RequireScope scope="admin-tools" pageLabel="the daily report">
              <DailyReportPage />
            </RequireScope>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearScopeCache();
  vi.mocked(fetchReports).mockResolvedValue(emptyReports());
  vi.mocked(fetchRegistrations).mockResolvedValue({
    data: [],
    page: 1,
    pageSize: 500,
    totalItems: 0,
    totalPages: 1,
  });
  vi.mocked(fetchFile).mockResolvedValue({ url: "blob:stub", contentType: "image/jpeg" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  clearScopeCache();
});

// ── R7: admin-tools user sees the real page ──────────────────────────────────

describe("DailyReportPage guard — admin-tools user", () => {
  it("renders the real Daily Report page when the user holds admin-tools", async () => {
    setUser("staff", ["admin-tools"]);
    renderDailyReportRoute();

    // The real page loads its data then renders the "Daily Report" heading.
    expect(
      await screen.findByRole("heading", { name: "Daily Report" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
    // The page mounted past the guard → it fetched its data.
    expect(fetchReports).toHaveBeenCalled();
  });
});

// ── R7: scoped user WITHOUT admin-tools is denied, page never mounts ─────────

describe("DailyReportPage guard — dashboard+reports user (no admin-tools)", () => {
  it("shows inline 'Access denied' and never mounts the page (no data fetch)", async () => {
    setUser("staff", ["dashboard", "reports"]);
    renderDailyReportRoute();

    expect(await screen.findByTestId("access-denied")).toBeInTheDocument();
    expect(screen.getByText("Access denied")).toBeInTheDocument();
    // The real page must not render or fetch when the guard denies access.
    expect(screen.queryByRole("heading", { name: "Daily Report" })).not.toBeInTheDocument();
    expect(fetchReports).not.toHaveBeenCalled();
  });

  it("never surfaces a raw 403 string on the denied state", async () => {
    setUser("staff", ["dashboard", "reports"]);
    const { container } = renderDailyReportRoute();

    await screen.findByTestId("access-denied");
    expect(container.textContent).not.toMatch(/403/);
  });
});

// ── R5.4 / R5.5: bypass paths still reach the page ───────────────────────────

describe("DailyReportPage guard — bypass paths", () => {
  it("admin (empty scope list) bypasses the admin-tools gate", async () => {
    setUser("admin", []);
    renderDailyReportRoute();

    expect(
      await screen.findByRole("heading", { name: "Daily Report" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
  });

  it("full-access staff (permissions null) bypasses the admin-tools gate", async () => {
    setUser("staff", null);
    renderDailyReportRoute();

    expect(
      await screen.findByRole("heading", { name: "Daily Report" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
  });
});
