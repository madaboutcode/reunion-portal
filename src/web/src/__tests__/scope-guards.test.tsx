/**
 * Client-side scope guards — adversarial black-box tests (RBAC t11).
 *
 * Spec source (source of truth):
 *   docs/specs/access-control.spec.md — R5 (four client mechanisms), R7 (per-page scope)
 *
 * Boundary: rendered React tree via MemoryRouter + RTL. Consumer input = the
 * user's scopes/role (fed through the real useStaffScopes hook, mocked only at
 * its data sources: fetchMyPermissions + auth). Consumer output = which of the
 * page content vs the "Access denied" state vs a redirect the DOM shows.
 *
 * These tests drive the REAL RequireScope + ProtectedRoute + useStaffScopes
 * together — only the network (fetchMyPermissions) and localStorage-backed auth
 * are mocked — so a passing test proves the wiring, not a stubbed guard.
 *
 * ── Coverage table ───────────────────────────────────────────────────────────
 *
 * Ref   | Guarantee                                                     | Test
 * ------|---------------------------------------------------------------|-----------------
 * R5.4  | scoped user, wrong page → inline "Access denied", not 403     | reports→dashboard
 * R7    | scoped user, right page → page renders                        | reports→reports
 * R5.4  | admin bypasses every scope gate                               | admin bypass ×2
 * R5.5  | full-access staff (permissions null) bypasses every gate      | null-scope bypass
 * R7    | multi-scope user: allowed on granted, denied on ungranted     | bank_txns split
 * R5.4  | direct-URL (bookmark) gated identically to nav-click          | direct URL deny
 * R5.4  | no raw "403" string ever surfaces on a denied page            | no-403 assertion
 * R5    | RequireScope renders nothing until permissions load           | loading gate
 * R5(2) | ProtectedRoute requiredScopes redirects to dashboard?denied=1 | redirect gate
 * R5.1  | SiteNav filters links via the shared hook (scoped staff)      | nav filter
 * R5.4  | permissions FETCH FAILURE fails closed (denies every page)    | fetch-failure fail-closed
 * R5.4  | AccessDeniedPage links to a reachable route, never dashboard  | denied-page link
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// Auth reads localStorage; staff-api hits the network — mock both boundaries.
// Only the account-lookup functions are mocked (auto-mock would otherwise
// also blank out STAFF_LANDING_ROUTES, which AccessDeniedPage reads for real).
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getAuthRole: vi.fn(),
    isAdmin: vi.fn(),
    isStaff: vi.fn(),
    getAuthEmail: vi.fn(),
    getAuthSub: vi.fn(),
    clearAuth: vi.fn(),
  };
});
vi.mock("@/lib/staff-api");
vi.mock("@/lib/api");

import { getAuthRole, isAdmin, isStaff, getAuthEmail, getAuthSub } from "@/lib/auth";
import { fetchMyPermissions } from "@/lib/staff-api";
import { getMyRegistration } from "@/lib/api";
import { RequireScope } from "@/components/staff/RequireScope";
import { ProtectedRoute } from "@/components/staff/ProtectedRoute";
import { SiteNav } from "@/components/SiteNav";
import { clearScopeCache } from "@/hooks/useStaffScopes";
import type { StaffScope } from "@/lib/staff-types";

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

/** Set the current user as staff/admin whose permissions FETCH itself fails. */
function setUserFetchError(role: "staff" | "admin") {
  vi.mocked(getAuthRole).mockReturnValue(role);
  vi.mocked(isAdmin).mockReturnValue(role === "admin");
  vi.mocked(isStaff).mockReturnValue(true);
  vi.mocked(getAuthEmail).mockReturnValue("staff@example.com");
  vi.mocked(getAuthSub).mockReturnValue("42");
  vi.mocked(fetchMyPermissions).mockRejectedValue(new Error("network"));
}

/** A minimal staff route tree mirroring App.tsx's per-page RequireScope wiring. */
function StaffRoutes() {
  return (
    <Routes>
      <Route
        path="/staff/dashboard"
        element={
          <RequireScope scope="dashboard" pageLabel="the dashboard">
            <div>DASHBOARD CONTENT</div>
          </RequireScope>
        }
      />
      <Route
        path="/staff/reports"
        element={
          <RequireScope scope="reports" pageLabel="reports">
            <div>REPORTS CONTENT</div>
          </RequireScope>
        }
      />
      <Route
        path="/staff/bank-transactions"
        element={
          <RequireScope scope="bank_txns" pageLabel="bank transactions">
            <div>BANK CONTENT</div>
          </RequireScope>
        }
      />
      <Route
        path="/staff/allocation"
        element={
          <RequireScope scope="allocation" pageLabel="allocation">
            <div>ALLOCATION CONTENT</div>
          </RequireScope>
        }
      />
    </Routes>
  );
}

function renderStaffAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StaffRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearScopeCache();
  vi.mocked(getMyRegistration).mockRejectedValue(new Error("no registration"));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  clearScopeCache();
});

// ── R5.4 / R7: scoped user, wrong page vs right page ─────────────────────────

describe("RequireScope — scoped user reaches the wrong page", () => {
  it("shows inline 'Access denied' (not the page) when scope is missing", async () => {
    setUser("staff", ["reports"]);
    renderStaffAt("/staff/dashboard");

    expect(await screen.findByTestId("access-denied")).toBeInTheDocument();
    expect(screen.getByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByText("DASHBOARD CONTENT")).not.toBeInTheDocument();
  });

  it("renders the page when the user holds the required scope", async () => {
    setUser("staff", ["reports"]);
    renderStaffAt("/staff/reports");

    expect(await screen.findByText("REPORTS CONTENT")).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
  });

  it("never surfaces a raw 403 string on the denied state", async () => {
    setUser("staff", ["reports"]);
    const { container } = renderStaffAt("/staff/dashboard");

    await screen.findByTestId("access-denied");
    expect(container.textContent).not.toMatch(/403/);
  });
});

// ── R5.4: admin + full-access bypass ─────────────────────────────────────────

describe("RequireScope — bypass paths", () => {
  it("admin sees every page regardless of scope (admin bypass)", async () => {
    setUser("admin", []); // admin with an empty scope list still bypasses
    renderStaffAt("/staff/dashboard");
    expect(await screen.findByText("DASHBOARD CONTENT")).toBeInTheDocument();

    cleanup();
    renderStaffAt("/staff/allocation");
    expect(await screen.findByText("ALLOCATION CONTENT")).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
  });

  it("full-access staff (permissions null) sees every page", async () => {
    setUser("staff", null);
    renderStaffAt("/staff/allocation");
    expect(await screen.findByText("ALLOCATION CONTENT")).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
  });
});

// ── R7: multi-scope user allowed on one page, denied on another ──────────────

describe("RequireScope — multi-scope user", () => {
  it("['dashboard','bank_txns'] → bank-transactions renders, allocation denied", async () => {
    setUser("staff", ["dashboard", "bank_txns"]);

    renderStaffAt("/staff/bank-transactions");
    expect(await screen.findByText("BANK CONTENT")).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();

    cleanup();
    renderStaffAt("/staff/allocation");
    expect(await screen.findByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByText("ALLOCATION CONTENT")).not.toBeInTheDocument();
  });
});

// ── R5.4: direct URL (bookmark) gated the same as a nav-click ────────────────

describe("RequireScope — direct URL access", () => {
  it("gates a bookmarked deep link identically to in-app navigation", async () => {
    // initialEntries simulates a fresh direct load of the URL (no nav-click).
    setUser("staff", ["reports"]);
    renderStaffAt("/staff/allocation");
    expect(await screen.findByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByText("ALLOCATION CONTENT")).not.toBeInTheDocument();
  });
});

// ── R5: RequireScope renders nothing until permissions resolve ───────────────

describe("RequireScope — loading gate", () => {
  it("renders neither the page nor 'Access denied' before scopes load", async () => {
    let resolvePerms: (v: { permissions: { scopes: string[] } | null; role: string }) => void = () => {};
    vi.mocked(getAuthRole).mockReturnValue("staff");
    vi.mocked(isAdmin).mockReturnValue(false);
    vi.mocked(isStaff).mockReturnValue(true);
    vi.mocked(fetchMyPermissions).mockReturnValue(
      new Promise((resolve) => {
        resolvePerms = resolve;
      }),
    );

    renderStaffAt("/staff/dashboard");
    // Nothing decided yet.
    expect(screen.queryByText("DASHBOARD CONTENT")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();

    resolvePerms({ permissions: { scopes: ["dashboard"] }, role: "staff" });
    expect(await screen.findByText("DASHBOARD CONTENT")).toBeInTheDocument();
  });
});

// ── R5 mechanism 2: ProtectedRoute requiredScopes redirect ───────────────────

describe("ProtectedRoute requiredScopes — redirect gate", () => {
  function renderProtected(path: string, requiredScopes: StaffScope[]) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ProtectedRoute requiredRoles={["staff", "admin"]} requiredScopes={requiredScopes} />}>
            <Route path="/staff/reports" element={<div>REPORTS CONTENT</div>} />
          </Route>
          <Route path="/staff/dashboard" element={<div>DASHBOARD REDIRECT TARGET</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("redirects to /staff/dashboard?denied=1 when the scope is missing", async () => {
    setUser("staff", ["reports"]);
    renderProtected("/staff/reports", ["allocation"]);
    expect(await screen.findByText("DASHBOARD REDIRECT TARGET")).toBeInTheDocument();
    expect(screen.queryByText("REPORTS CONTENT")).not.toBeInTheDocument();
  });

  it("renders the outlet when the scope is present", async () => {
    setUser("staff", ["reports"]);
    renderProtected("/staff/reports", ["reports"]);
    expect(await screen.findByText("REPORTS CONTENT")).toBeInTheDocument();
  });
});

// ── R5.1: SiteNav filters links via the shared useStaffScopes hook ───────────

describe("SiteNav — link filtering via shared hook", () => {
  it("hides links whose scope the staff user lacks, shows the ones they hold", async () => {
    setUser("staff", ["reports"]);
    render(
      <MemoryRouter initialEntries={["/staff/dashboard"]}>
        <SiteNav />
      </MemoryRouter>,
    );

    // Reports link is in scope → visible once scopes load.
    expect(await screen.findByText("Reports")).toBeInTheDocument();
    // Attendees (dashboard scope) + Allocation (allocation scope) are out of scope → hidden.
    expect(screen.queryByText("Attendees")).not.toBeInTheDocument();
    expect(screen.queryByText("Allocation")).not.toBeInTheDocument();
  });
});

// ── R5.4: a permissions FETCH failure must fail closed, not open ────────────
// Regression test for the bug where cachedScopes === null was used for both
// "fetch failed" and "legit full-access staff", so a network error granted
// every scope instead of none.

describe("RequireScope — permissions fetch failure fails closed", () => {
  it("denies a non-admin staff user every page when fetchMyPermissions rejects", async () => {
    setUserFetchError("staff");

    renderStaffAt("/staff/dashboard");
    expect(await screen.findByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByText("DASHBOARD CONTENT")).not.toBeInTheDocument();

    cleanup();
    renderStaffAt("/staff/reports");
    expect(await screen.findByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByText("REPORTS CONTENT")).not.toBeInTheDocument();
  });

  it("still lets admin through when the fetch itself fails", async () => {
    setUserFetchError("admin");
    renderStaffAt("/staff/dashboard");
    expect(await screen.findByText("DASHBOARD CONTENT")).toBeInTheDocument();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
  });

  it("fetch-error and full-access-null are distinguishable at the hasScope boundary", async () => {
    // Same non-admin staff user, same page — the only variable is WHY
    // cachedScopes isn't an array. A conflated implementation would treat
    // both as "grant everything"; the fix must not.
    setUser("staff", null); // legit full-access staff
    renderStaffAt("/staff/allocation");
    expect(await screen.findByText("ALLOCATION CONTENT")).toBeInTheDocument();

    cleanup();
    clearScopeCache();

    setUserFetchError("staff"); // permissions fetch failed
    renderStaffAt("/staff/allocation");
    expect(await screen.findByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByText("ALLOCATION CONTENT")).not.toBeInTheDocument();
  });
});

// ── R5.4: AccessDeniedPage links to a reachable route, never a dead dashboard ─

describe("AccessDeniedPage — dashboard link", () => {
  it("desk-only staff hitting a dashboard-gated page sees a link to their reachable route, not /staff/dashboard", async () => {
    setUser("staff", ["registration_desk"]);
    renderStaffAt("/staff/dashboard");

    await screen.findByTestId("access-denied");
    expect(screen.getByText("Go to your workspace")).toBeInTheDocument();
    expect(screen.getByText("Go to your workspace").closest("a")).toHaveAttribute(
      "href",
      "/staff/check-in",
    );
    expect(screen.queryByRole("link", { name: /back to dashboard/i })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/staff/dashboard"]')).not.toBeInTheDocument();
  });

  it("renders no link at all when no route is reachable (fetch failure)", async () => {
    setUserFetchError("staff");
    renderStaffAt("/staff/dashboard");

    await screen.findByTestId("access-denied");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
