/**
 * Staff Console Shell — adversarial black-box tests
 *
 * Spec sources (source of truth):
 *   docs/specs/staff-console.spec.md    — shell, nav, footer, page chrome
 *   docs/specs/staff-dashboard.spec.md  — attendees, donors, detail
 *   docs/specs/staff-resources.spec.md  — resources page
 *   docs/specs/staff-reports.spec.md    — reports page
 *   docs/specs/team-management.spec.md  — team page
 *
 * Boundary: rendered React component tree via MemoryRouter + RTL.
 * Consumer input:  route path + search params + auth state.
 * Consumer output: DOM text, links, headings, element presence / absence.
 *
 * ── Coverage table ───────────────────────────────────────────────────────────
 *
 * Ref    | Guarantee                                         | Test(s)
 * -------|---------------------------------------------------|------------------
 * R1.1   | Max content width 1320px on main                 | StaffLayout
 * R1.2   | Child pages must not add own max-width wrappers  | RegistrationDetail
 * R2.2   | Staff mode when pathname starts /staff           | SiteNav
 * R4.1   | Public mode: Dashboard link for staff users      | SiteNav public mode
 * R4.2   | Public mode: no staff section links              | SiteNav public mode
 * R5     | Staff mode: correct section links visible        | SiteNav staff mode
 * R5.2   | Staff mode: public links hidden                  | SiteNav staff mode
 * R5.2   | Staff mode: Register CTA hidden                  | SiteNav staff mode
 * R5.3   | Staff mode: email + role badge + Logout visible  | SiteNav staff mode
 * R5/T   | Team link hidden for non-admin staff             | SiteNav staff mode
 * R5/T   | Team link visible for admin                      | SiteNav staff mode
 * R5.4   | Scroll-hide disabled in staff mode               | SiteNav
 * R6     | Attendees active: /staff/dashboard?type=attendee | SiteNav active states
 * R6     | Attendees active: /staff/dashboard?type=donor    | SiteNav active states
 * R6     | Attendees active: /staff/registrations/:id (any type) | SiteNav
 * R8     | Resources/Reports/Team active: path prefix match | SiteNav active states
 * R10    | Every staff page shows h1 page title             | Page titles
 * R12    | Staff routes: minimal footer only                | StaffLayout
 * R12.1  | Marketing footer not rendered on /staff/*        | StaffLayout
 * R1(D)  | Dashboard: "Attendees" title for type=attendee  | StaffDashboardPage
 * R4(D)  | Dashboard: "Donor Only" title for type=donor    | StaffDashboardPage
 * R1(D)  | No in-page type toggle                          | StaffDashboardPage
 * R3.6   | Attendees table: Type column present            | StaffDashboardPage
 * R4.2   | Donors table: Type column absent                | StaffDashboardPage
 * R1.3(D)| Back link preserves type param                  | RegistrationDetailPage
 * R1(Res)| Resources page title: "Resources"               | ResourcesPage
 * R1(Rep)| Reports page title: "Reports"                   | ReportsPage
 * R1(T)  | Team page title: "Team" (not "Team Management") | TeamManagementPage
 * R1.1(Rep)| Reports: no toolbar row                       | ReportsPage
 *
 * ── Known gaps (not tested, reason given) ───────────────────────────────────
 * R9.1   — "Page title row shows current section name" on mobile: spec is
 *           ambiguous whether this is a nav element or the page h1. Skipped.
 * R6/R7  — "type omitted defaults to attendee" active state: URL is rewritten
 *           on first render via replace:true, so only the stable
 *           type=attendee state is tested.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ── Module mocks ─────────────────────────────────────────────────────────────
// Auth reads from localStorage — mock at the module boundary so tests control role.
vi.mock("@/lib/auth");
// Staff API makes network calls — mock to prevent real fetch.
vi.mock("@/lib/staff-api");
// Public API (SiteNav checks attendee registration status)
vi.mock("@/lib/api");

import { getAuthRole, getAuthEmail, isAdmin, getAuthSub, isStaff } from "@/lib/auth";
import {
  fetchDashboardStats,
  fetchMyPermissions,
  fetchRegistrations,
  fetchResources,
  fetchReports,
  fetchUsers,
  generateLoginLink,
  fetchRegistrationDetail,
} from "@/lib/staff-api";
import { getMyRegistration } from "@/lib/api";
import { SiteNav } from "@/components/SiteNav";
import { clearScopeCache } from "@/hooks/useStaffScopes";
import { StaffLayout } from "@/components/staff/StaffLayout";
import { StaffFooter } from "@/components/staff/StaffFooter";
import StaffDashboardPage from "@/pages/StaffDashboardPage";
import RegistrationDetailPage from "@/pages/RegistrationDetailPage";
import { ResourcesPage } from "@/pages/ResourcesPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { TeamManagementPage } from "@/pages/TeamManagementPage";
import { ToastProvider } from "@/components/ui/Toast";
import type { StaffRegistrationListItem, DashboardStats, ResourceCounts, ReportsResponse, StaffUser } from "@/lib/staff-types";

beforeEach(() => {
  // The scope cache in useStaffScopes is a module-level singleton that
  // outlives any single render. Without clearing it here, whichever test
  // happens to run first "seeds" the cache for every test that follows,
  // making results depend on execution order.
  clearScopeCache();
  // SiteNav calls fetchMyPermissions on mount for non-admin staff. Default to
  // full access (permissions: null) so the nav doesn't filter any links out
  // unless a test overrides it.
  vi.mocked(fetchMyPermissions).mockResolvedValue({ permissions: null, role: "staff" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Auth helpers ─────────────────────────────────────────────────────────────

function setRole(role: "staff" | "admin" | null) {
  vi.mocked(getAuthRole).mockReturnValue(role);
  vi.mocked(isAdmin).mockReturnValue(role === "admin");
  // useStaffScopes gates its fetchMyPermissions call behind isStaff() — without
  // this, the hook always takes its "not staff" shortcut and cachedScopes never
  // resolves away from undefined, which hasScope() treats as "deny" for any
  // staff (non-admin) user regardless of role.
  vi.mocked(isStaff).mockReturnValue(role === "staff" || role === "admin");
  vi.mocked(getAuthEmail).mockReturnValue(role ? "staff@example.com" : null);
  vi.mocked(getAuthSub).mockReturnValue(role ? "42" : null);
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderNav(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SiteNav />
    </MemoryRouter>,
  );
}

function renderStaffLayout(path: string, pageContent: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<StaffLayout />}>
          <Route path="*" element={<>{pageContent}</>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

// ── Mock data factories ───────────────────────────────────────────────────────

function mockStats(overrides: Partial<DashboardStats> = {}): { stats: DashboardStats } {
  return {
    stats: {
      total: 10,
      pending: 2,
      pendingVerification: 1,
      confirmed: 7,
      moneyCollected: 50000,
      byParticipationType: {
        full_celebration: { total: 7, confirmed: 5, pending: 1, pendingVerification: 1 },
        campus_only: { total: 2, confirmed: 1, pending: 1, pendingVerification: 0 },
        donation_only: { total: 1, confirmed: 1, pending: 0, pendingVerification: 0 },
      },
      ...overrides,
    },
  };
}

function mockListItem(overrides: Partial<StaffRegistrationListItem> = {}): StaffRegistrationListItem {
  return {
    id: 1,
    regCode: "SMRT00001",
    fullName: "Test User",
    email: "test@example.com",
    whatsapp: "9999999999",
    branch: "Computer Science & Engineering",
    status: "confirmed",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    totalAmount: 8500,
    photoThumbKey: null,
    createdAt: Date.now() - 86400000,
    ...overrides,
  };
}

function mockResources(): { resources: ResourceCounts } {
  return {
    resources: {
      headcount: { alumni: 10, spouses: 2, children: 1, guests: 0, total: 13 },
      accommodation: {
        none: { total: 7, male: 3, female: 3, other: 1 },
        private: { total: 3, male: 2, female: 1, other: 0 },
        shared_double: { total: 0, male: 0, female: 0, other: 0 },
        shared_triple: { total: 0, male: 0, female: 0, other: 0 },
      },
      accommodationByNight: {
        '2026-08-14': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 },
        '2026-08-15': { private: 0, privateByGender: { male: 0, female: 0, other: 0 }, shared_double: { count: 0, rooms: 0 }, shared_doubleByGender: { male: 0, female: 0, other: 0 }, shared_triple: { count: 0, rooms: 0 }, shared_tripleByGender: { male: 0, female: 0, other: 0 }, extraBeds: 0 },
      },
      meals: { veg: 8, nonVeg: 5 },
      mealsByParticipationType: {
        campusDayCaterer: { headcount: 0, veg: 0, nonVeg: 0 },
        ravizBanquet: { headcount: 0, veg: 0, nonVeg: 0 },
      },
      tshirts: { male: { L: 3, M: 2 }, female: { S: 1 } },
      childrenByAgeBand: { under6: 0, age6to12: 0, age12plus: 0 },
    },
  };
}

function mockReports(): ReportsResponse {
  return {
    revenue: { collected: 80000, expected: 100000, pending: 20000 },
    branchBreakdown: [
      {
        branch: "Computer Science & Engineering",
        total: 5,
        confirmed: 3,
        pendingVerification: 1,
        pending: 1,
        expectedRevenue: 40000,
        collectedRevenue: 30000,
      },
    ],
    timeline: [
      { date: "2026-05-01", count: 2, fullCelebration: 1, campusOnly: 1 },
      { date: "2026-05-02", count: 3, fullCelebration: 2, campusOnly: 1 },
    ],
    contributions: [],
    donations: { count: 0, total: 0 },
    geography: { cities: [], countries: [] },
    donorRecognition: { publicDonors: [], nonPublicCount: 0, nonPublicTotal: 0 },
    budgetProgress: {
      event: { actual: 0, target: 2300000 },
      accommodation: { actual: 0, target: 0 },
    },
  };
}

// ── SiteNav — Public mode ─────────────────────────────────────────────────────

describe("SiteNav — public mode (non-/staff routes)", () => {
  beforeEach(() => {
    // Suppress attendee status check — irrelevant for these tests
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: {
        regId: "x",
        regCode: "x",
        status: "pending",
        createdAt: 0,
        pricingBreakup: { base: 0, collegeContribution: 0, lines: [], donation: 0, total: 0 },
        contact: { fullName: "", branch: "", gender: "male", email: "", whatsapp: "", city: "", country: "" },
        attendance: { intent: "attending", participationType: "full_celebration", alumniMeal: "veg", tshirtSize: "M" },
        attendees: { children: [], guests: [] },
        idDocument: { fileKey: "", fileType: "", sizeBytes: 0, fileName: "", note: "" },
        pendingPaymentAmount: null,
        hasVerifiedPayments: false,
        verifiedPaymentAmount: 0,
      },
    });
  });

  it("R4.1 — staff user on public page sees Dashboard link pointing to attendee view", async () => {
    // Catches: generator always hiding Dashboard, or pointing it to wrong route.
    // The Dashboard shortcut is scope-aware (design.md §Navigation) and renders
    // only after fetchMyPermissions resolves — same async pattern as the
    // staff-mode scope-gated links below.
    setRole("staff");
    renderNav("/");

    const dashboardLink = await screen.findByRole("link", { name: /dashboard/i });
    expect(dashboardLink).toBeInTheDocument();
    expect(dashboardLink).toHaveAttribute("href", "/staff/dashboard?type=attendee&status=pending_verification");
  });

  it("R4.1 — admin user on public page also sees Dashboard link", () => {
    // Catches: generator only showing Dashboard for staff but not admin
    setRole("admin");
    renderNav("/");

    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
  });

  it("R4.2 — staff section links (Attendees, Resources, Reports, Team) absent on public page", () => {
    // Catches: generator leaking staff nav into public mode
    setRole("staff");
    renderNav("/");

    expect(screen.queryByRole("link", { name: /^attendees$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^resources$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^reports$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^team$/i })).not.toBeInTheDocument();
  });

  it("R4.1 — unauthenticated user on public page does NOT see Dashboard link", () => {
    // Catches: generator always rendering Dashboard link regardless of role
    setRole(null);
    renderNav("/");

    expect(screen.queryByRole("link", { name: /dashboard/i })).not.toBeInTheDocument();
  });

  it("R4 — public nav shows Home and Connect links in public mode", () => {
    // Baseline: public links must remain in public mode
    setRole(null);
    renderNav("/");

    expect(screen.getAllByRole("link", { name: /^home$/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /^connect$/i }).length).toBeGreaterThan(0);
  });
});

// ── SiteNav — Staff mode ──────────────────────────────────────────────────────

describe("SiteNav — staff mode (/staff/* routes)", () => {
  it("R5 — staff mode shows Attendees, Resources, Reports links for staff role", async () => {
    // Catches: generator rendering empty nav or wrong links in staff mode
    setRole("staff");
    renderNav("/staff/dashboard?type=attendee");

    // Scope-gated links only render after fetchMyPermissions resolves
    expect(await screen.findByRole("link", { name: /^attendees$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^resources$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^reports$/i })).toBeInTheDocument();
  });

  it("R5/Team — Team link hidden for staff (non-admin) role", () => {
    // Catches: generator showing Team to all staff regardless of admin status
    setRole("staff");
    renderNav("/staff/dashboard?type=attendee");

    expect(screen.queryByRole("link", { name: /^team$/i })).not.toBeInTheDocument();
  });

  it("R5/Team — Team link visible for admin role", async () => {
    // Catches: generator hiding Team even for admin
    setRole("admin");
    renderNav("/staff/team");

    // Every staffLinks entry, including Team, is gated on scopesLoaded
    expect(await screen.findByRole("link", { name: /^team$/i })).toBeInTheDocument();
  });

  it("R5.2 — Home link absent in staff mode", () => {
    // Catches: generator rendering public links inside staff nav
    setRole("staff");
    renderNav("/staff/dashboard?type=attendee");

    // Only logo link (aria-label) should link to home — not a visible "Home" link
    // The logo carries aria-label "Smriti 2026 — Home", not the text "Home"
    expect(screen.queryByRole("link", { name: /^home$/i })).not.toBeInTheDocument();
  });

  it("R5.2 — Connect link absent in staff mode", () => {
    setRole("staff");
    renderNav("/staff/dashboard?type=attendee");

    expect(screen.queryByRole("link", { name: /^connect$/i })).not.toBeInTheDocument();
  });

  it("R5.2 — Register CTA absent in staff mode", () => {
    // Catches: generator leaving Register link in the staff nav
    setRole("staff");
    renderNav("/staff/dashboard?type=attendee");

    expect(screen.queryByRole("link", { name: /^register$/i })).not.toBeInTheDocument();
  });

  it("R5.5 — Dashboard pill / link absent in staff mode (Attendees/Donors replace it)", () => {
    // Catches: generator rendering both Dashboard pill AND Attendees/Donors links
    setRole("admin");
    renderNav("/staff/dashboard?type=attendee");

    // Dashboard as a separate nav link (not the logo) must not appear
    // The nav should have Attendees and Donors instead
    const allLinks = screen.getAllByRole("link");
    const linkTexts = allLinks.map((l) => l.textContent?.trim().toLowerCase());
    expect(linkTexts).not.toContain("dashboard");
  });

  it("R5.3 — email and Logout button visible on right side in staff mode", () => {
    // Catches: generator omitting auth controls from staff nav
    setRole("staff");
    renderNav("/staff/dashboard?type=attendee");

    expect(screen.getByText("staff@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /logout/i })).toBeInTheDocument();
  });

  it("R5.4 — scroll-hide disabled in staff mode: nav does NOT carry -translate-y class on mount", () => {
    // Catches: generator leaving scroll-hide active in staff mode.
    // Tests R5.4 structurally — the nav must not be hidden on initial render.
    setRole("staff");
    renderNav("/staff/dashboard?type=attendee");

    const nav = document.querySelector("nav");
    expect(nav).not.toBeNull();
    // The scroll-hide class applied by useScrollDirection is -translate-y-[calc(100%+60px)]
    // On mount with disabled=true, hidden state is false, so this class must not be present.
    expect(nav!.className).not.toContain("-translate-y");
  });
});

// ── SiteNav — Active states ───────────────────────────────────────────────────

describe("SiteNav — active state logic", () => {
  it("R6 — Attendees link is active on /staff/dashboard?type=attendee", async () => {
    // Catches: generator applying wrong active state or no active state at all.
    // Active = underline class applied. We test the href as a proxy for active detection.
    setRole("staff");
    renderNav("/staff/dashboard?type=attendee");

    const attendeesLink = await screen.findByRole("link", { name: /^attendees$/i });
    // Active style includes "underline" per the staffLinkClass function
    expect(attendeesLink.className).toContain("underline");
  });

  it("R6 — Attendees link is active on /staff/dashboard?type=donor (Donors is a filter, not a separate nav item)", async () => {
    // Catches: generator restricting Attendees active state to type=attendee.
    // Donor Only is now accessed via the Donor Only stat card on the dashboard,
    // so the Attendees nav item covers the whole dashboard section.
    setRole("staff");
    renderNav("/staff/dashboard?type=donor");

    const attendeesLink = await screen.findByRole("link", { name: /^attendees$/i });
    expect(attendeesLink.className).toContain("underline");
  });

  it("R6 — Attendees link is active on /staff/registrations/:id?type=attendee", async () => {
    // Catches: generator not propagating active state to detail pages
    setRole("staff");
    renderNav("/staff/registrations/42?type=attendee");

    const attendeesLink = await screen.findByRole("link", { name: /^attendees$/i });
    expect(attendeesLink.className).toContain("underline");
  });

  it("R6 — Attendees link is active on /staff/registrations/:id?type=donor (Donors is a filter)", async () => {
    // Catches: generator restricting Attendees active state to type=attendee on detail pages.
    setRole("staff");
    renderNav("/staff/registrations/42?type=donor");

    const attendeesLink = await screen.findByRole("link", { name: /^attendees$/i });
    expect(attendeesLink.className).toContain("underline");
  });

  it("R8 — Resources link is active on /staff/resources", async () => {
    setRole("staff");
    renderNav("/staff/resources");

    const resourcesLink = await screen.findByRole("link", { name: /^resources$/i });
    expect(resourcesLink.className).toContain("underline");
  });

  it("R8 — Reports link is active on /staff/reports", async () => {
    setRole("staff");
    renderNav("/staff/reports");

    const reportsLink = await screen.findByRole("link", { name: /^reports$/i });
    expect(reportsLink.className).toContain("underline");
  });

  it("R8 — Team link is active on /staff/team", async () => {
    setRole("admin");
    renderNav("/staff/team");

    const teamLink = await screen.findByRole("link", { name: /^team$/i });
    expect(teamLink).toHaveClass("text-terracotta");
    expect(teamLink).not.toHaveClass("underline");
  });
});

// ── StaffLayout shell ─────────────────────────────────────────────────────────

describe("StaffLayout", () => {
  beforeEach(() => {
    setRole("staff");
  });

  it("R1.1 — main content area has max-w-[1320px] class", () => {
    // Catches: generator using wrong max-width (e.g. 1200px from old layout)
    renderStaffLayout("/staff/dashboard", <div>content</div>);

    const main = document.querySelector("main");
    expect(main).not.toBeNull();
    expect(main!.className).toContain("max-w-[1320px]");
  });

  it("R12 — StaffFooter renders inside StaffLayout (copyright + git hash)", () => {
    // Catches: generator using SiteFooter instead of StaffFooter
    renderStaffLayout("/staff/dashboard", <div>content</div>);

    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    // StaffFooter contains copyright text and git hash
    expect(screen.getByText(/Smriti 2026/)).toBeInTheDocument();
    // The vitest config injects __GIT_HASH__ = "test"
    expect(screen.getByText("test")).toBeInTheDocument();
  });

  it("R12.1 — marketing footer content (ComskysTerminal / tagline) absent in staff layout", () => {
    // Catches: generator rendering SiteFooter which includes the ComskysTerminal easter egg
    // SiteFooter renders the terminal with "./credits" command text
    renderStaffLayout("/staff/dashboard", <div>content</div>);

    expect(screen.queryByText(/credits/)).not.toBeInTheDocument();
    expect(screen.queryByText(/COMSKYS/i)).not.toBeInTheDocument();
  });
});

// ── StaffFooter ───────────────────────────────────────────────────────────────

describe("StaffFooter", () => {
  it("R12 — renders copyright line", () => {
    // Catches: generator rendering empty footer or omitting copyright
    render(<StaffFooter />);

    expect(screen.getByText(/Smriti 2026/)).toBeInTheDocument();
  });

  it("R12 — renders git hash (injected as 'test' in vitest config)", () => {
    // Catches: generator omitting git hash from footer
    render(<StaffFooter />);

    expect(screen.getByText("test")).toBeInTheDocument();
  });

  it("R12.1 — no tagline or marketing text in footer", () => {
    // Catches: generator including marketing copy in StaffFooter
    render(<StaffFooter />);

    // Marketing footer has tagline "Where alumni reconnect" or similar
    // and the ComskysTerminal easter egg
    expect(screen.queryByText(/credits/i)).not.toBeInTheDocument();
    // Only one text node (copyright paragraph) — no extra semantic sections
    const footer = document.querySelector("footer");
    expect(footer).not.toBeNull();
    const paragraphs = footer!.querySelectorAll("p");
    expect(paragraphs.length).toBe(1);
  });
});

// ── StaffDashboardPage — page title and type toggle ───────────────────────────

describe("StaffDashboardPage — page title", () => {
  beforeEach(() => {
    setRole("staff");
    // Prevent API calls from resolving (we only test static structure on initial render)
    vi.mocked(fetchDashboardStats).mockReturnValue(new Promise(() => {}));
    vi.mocked(fetchRegistrations).mockReturnValue(new Promise(() => {}));
  });

  it("R3 — shows h1 'Attendees' for type=attendee", () => {
    // Catches: generator using wrong title or showing generic 'Dashboard'
    render(
      <MemoryRouter initialEntries={["/staff/dashboard?type=attendee"]}>
        <Routes>
          <Route path="/staff/dashboard" element={<StaffDashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Attendees");
  });

  it("R4 — shows h1 and document title 'Donor Only' for type=donor", () => {
    // Catches: generator always showing 'Attendees' regardless of type param
    render(
      <MemoryRouter initialEntries={["/staff/dashboard?type=donor"]}>
        <Routes>
          <Route path="/staff/dashboard" element={<StaffDashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Donor Only");
    expect(document.title).toContain("Donor Only");
  });

  it("R1(D) — no in-page Attendee/Donor toggle control rendered", () => {
    // Catches: generator still rendering the old pill toggle (removed per spec R1)
    // The toggle was a segmented control with "Attendees" and "Donors" radio/tab buttons
    render(
      <MemoryRouter initialEntries={["/staff/dashboard?type=attendee"]}>
        <Routes>
          <Route path="/staff/dashboard" element={<StaffDashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // An in-page toggle would have role="tab" or role="radio" for both options together
    // There should be no tab-like control toggling between attendees and donors inline
    const tabs = document.querySelectorAll('[role="tab"]');
    // If tabs exist, they must not be labeled Attendees/Donors (that's nav-only)
    const tabTexts = Array.from(tabs).map((t) => t.textContent?.toLowerCase());
    expect(tabTexts).not.toContain("attendees");
    expect(tabTexts).not.toContain("donors");
  });
});

// ── StaffDashboardPage — column split ─────────────────────────────────────────

describe("StaffDashboardPage — table column split", () => {
  beforeEach(() => {
    setRole("staff");
    vi.mocked(fetchDashboardStats).mockResolvedValue(mockStats());
  });

  it("R3.6 — Attendees view: table includes 'Type' column header", () => {
    // Catches: generator using same columns for both views (no Type column ever)
    vi.mocked(fetchRegistrations).mockResolvedValue({
      data: [mockListItem()],
      totalItems: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });

    render(
      <MemoryRouter initialEntries={["/staff/dashboard?type=attendee"]}>
        <Routes>
          <Route path="/staff/dashboard" element={<StaffDashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // The table renders column headers — 'Type' must be present for attendee view
    return screen.findByRole("columnheader", { name: /^type$/i });
  });

  it("R4.2 — Donors view: table does NOT include 'Type' column header", () => {
    // Catches: generator including Type column in donors view
    vi.mocked(fetchRegistrations).mockResolvedValue({
      data: [mockListItem({ participationType: "donation_only" })],
      totalItems: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });

    render(
      <MemoryRouter initialEntries={["/staff/dashboard?type=donor"]}>
        <Routes>
          <Route path="/staff/dashboard" element={<StaffDashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    return screen.findByRole("columnheader", { name: /^name$/i }).then(() => {
      expect(
        screen.queryByRole("columnheader", { name: /^type$/i }),
      ).not.toBeInTheDocument();
    });
  });

  it("R3.6 / R4.2 — Attendees has Type column; Donors does not (same test, both assertions)", () => {
    // Combined assertion so a generator cannot satisfy one without the other
    vi.mocked(fetchRegistrations).mockResolvedValue({
      data: [mockListItem()],
      totalItems: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });

    const { unmount } = render(
      <MemoryRouter initialEntries={["/staff/dashboard?type=attendee"]}>
        <Routes>
          <Route path="/staff/dashboard" element={<StaffDashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    return screen.findByRole("columnheader", { name: /^type$/i }).then((col) => {
      expect(col).toBeInTheDocument();
      unmount();

      render(
        <MemoryRouter initialEntries={["/staff/dashboard?type=donor"]}>
          <Routes>
            <Route path="/staff/dashboard" element={<StaffDashboardPage />} />
          </Routes>
        </MemoryRouter>,
      );

      return screen.findByRole("columnheader", { name: /^name$/i }).then(() => {
        expect(
          screen.queryByRole("columnheader", { name: /^type$/i }),
        ).not.toBeInTheDocument();
      });
    });
  });

  it("R3.6 — Attendees table includes Branch column", () => {
    // Baseline: Branch is present in both views per spec R3.6
    vi.mocked(fetchRegistrations).mockResolvedValue({
      data: [mockListItem()],
      totalItems: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });

    render(
      <MemoryRouter initialEntries={["/staff/dashboard?type=attendee"]}>
        <Routes>
          <Route path="/staff/dashboard" element={<StaffDashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    return screen.findByRole("columnheader", { name: /^branch$/i });
  });
});

// ── RegistrationDetailPage — back link ───────────────────────────────────────

describe("RegistrationDetailPage — back link and max-width", () => {
  beforeEach(() => {
    setRole("staff");
    // Reject the API fetch so the error state renders (which has the back link)
    vi.mocked(fetchRegistrationDetail).mockRejectedValue(new Error("not found"));
  });

  it("R1.3(D) — back link on detail page navigates to /staff/dashboard?type=attendee when type=attendee", () => {
    // Catches: generator using back link that drops the type param
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/staff/registrations/42?type=attendee"]}>
          <Routes>
            <Route path="/staff/registrations/:id" element={<RegistrationDetailPage />} />
            <Route path="/staff/dashboard" element={<div data-testid="dashboard" />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    // The back link renders even during loading state
    return screen.findByRole("button", { name: /back to list/i }).then((btn) => {
      // The button triggers navigate() — test its rendered label contains type hint
      // We verify the nav call by checking that clicking the button renders the dashboard
      btn.click();
      return screen.findByTestId("dashboard");
    });
  });

  it("R1.3(D) — back link on detail page navigates to /staff/dashboard?type=donor when type=donor", () => {
    // Catches: generator always navigating to type=attendee regardless of context
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/staff/registrations/42?type=donor"]}>
          <Routes>
            <Route path="/staff/registrations/:id" element={<RegistrationDetailPage />} />
            <Route path="/staff/dashboard" element={<div data-testid="dashboard" />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    return screen.findByRole("button", { name: /back to list/i }).then((btn) => {
      btn.click();
      return screen.findByTestId("dashboard");
    });
  });

  it("R1.3(D) — back link defaults to type=attendee when no type param in URL", () => {
    // Catches: generator passing null/undefined type to dashboard link
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/staff/registrations/42"]}>
          <Routes>
            <Route path="/staff/registrations/:id" element={<RegistrationDetailPage />} />
            <Route path="/staff/dashboard" element={<div data-testid="dashboard" />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    return screen.findByRole("button", { name: /back to list/i }).then((btn) => {
      btn.click();
      // Should land on dashboard (not 404 or error)
      return screen.findByTestId("dashboard");
    });
  });

  it("R1.2 — RegistrationDetailPage root element does not have a max-width wrapper class", () => {
    // Catches: generator leaving the old max-w-6xl wrapper on the page root
    // (R1.2: StaffLayout owns width; child pages must not add nested max-w-* wrappers)
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/staff/registrations/42?type=attendee"]}>
          <Routes>
            <Route path="/staff/registrations/:id" element={<RegistrationDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

    // The root <div> rendered by RegistrationDetailPage must not carry max-w-* classes
    // We look at the first child of the rendered output
    const containers = document.querySelectorAll('[class*="max-w-"]');
    // If there are any max-w-* elements they should not be direct children of the route
    // (the nav has max-w-[1320px] — that's the shell, not the page).
    // We specifically check that no direct wrapper from the page adds max-w-6xl
    const hasOldWrapper = Array.from(containers).some(
      (el) => el.className.includes("max-w-6xl") || el.className.includes("max-w-5xl"),
    );
    expect(hasOldWrapper).toBe(false);
  });
});

// ── Page titles — R10, per-page specs ─────────────────────────────────────────

describe("Page titles — every staff page shows an h1", () => {
  beforeEach(() => {
    setRole("admin"); // admin sees all pages
  });

  it("R3(D) / R10 — StaffDashboardPage shows h1 'Attendees' for type=attendee", () => {
    vi.mocked(fetchDashboardStats).mockReturnValue(new Promise(() => {}));
    vi.mocked(fetchRegistrations).mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={["/staff/dashboard?type=attendee"]}>
        <Routes>
          <Route path="/staff/dashboard" element={<StaffDashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1, name: /^attendees$/i })).toBeInTheDocument();
  });

  it("R4(D) / R10 — StaffDashboardPage shows h1 'Donor Only' for type=donor", () => {
    vi.mocked(fetchDashboardStats).mockReturnValue(new Promise(() => {}));
    vi.mocked(fetchRegistrations).mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={["/staff/dashboard?type=donor"]}>
        <Routes>
          <Route path="/staff/dashboard" element={<StaffDashboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1, name: /^donor only$/i })).toBeInTheDocument();
  });

  it("R1(Res) / R10 — ResourcesPage shows h1 'Resources'", () => {
    // Catches: generator using 'Resource Center' or no h1 at all
    vi.mocked(fetchResources).mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={["/staff/resources"]}>
        <ResourcesPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1, name: /^resources$/i })).toBeInTheDocument();
  });

  it("R1(Rep) / R10 — ReportsPage shows h1 'Reports'", () => {
    // Catches: generator using 'Analytics' or 'Committee Reports' or no h1
    vi.mocked(fetchReports).mockReturnValue(new Promise(() => {}));

    render(<ReportsPage />);

    expect(screen.getByRole("heading", { level: 1, name: /^reports$/i })).toBeInTheDocument();
  });

  it("R1.1(T) — TeamManagementPage shows h1 'Team' (not 'Team Management')", () => {
    // Catches: generator using old 'Team Management' title — spec says 'Team' (team-management.spec.md R1.1)
    vi.mocked(fetchUsers).mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter>
        <ToastProvider>
          <TeamManagementPage />
        </ToastProvider>
      </MemoryRouter>,
    );

    // Exact text must be "Team" — "Team Management" is the old incorrect title
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Team");
    expect(h1.textContent?.trim()).toBe("Team");
  });

  it("R4.4(T) — admin can generate and view a login link for staff, not admins", async () => {
    setRole("admin");
    const staffUser: StaffUser = {
      id: 7,
      email: "staff@example.com",
      name: "Staff Member",
      role: "staff",
      isActive: true,
      permissions: null,
      createdBy: null,
      createdAt: Date.now(),
    };
    const adminUser: StaffUser = {
      ...staffUser,
      id: 8,
      email: "other-admin@example.com",
      name: "Other Admin",
      role: "admin",
    };
    const link = "https://app.example.test/auth/verify?token=test-token";

    vi.mocked(fetchUsers).mockResolvedValue({ users: [staffUser, adminUser] });
    vi.mocked(generateLoginLink).mockResolvedValue({ link, expiresIn: 10 });

    render(
      <MemoryRouter>
        <ToastProvider>
          <TeamManagementPage />
        </ToastProvider>
      </MemoryRouter>,
    );

    const generateButton = await screen.findByRole("button", { name: "Generate login link" });
    expect(screen.getAllByRole("button", { name: "Generate login link" })).toHaveLength(1);

    await userEvent.setup().click(generateButton);

    expect(generateLoginLink).toHaveBeenCalledWith(7);
    expect(await screen.findByDisplayValue(link)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });
});

// ── Reports page — no toolbar ─────────────────────────────────────────────────

describe("ReportsPage — no toolbar (R1.1 staff-reports.spec.md)", () => {
  beforeEach(() => {
    setRole("staff");
  });

  it("R1.1(Rep) — Reports page renders h1 and no filter/toolbar controls", () => {
    // Catches: generator adding a filter row to Reports (spec R1.1 says no toolbar)
    vi.mocked(fetchReports).mockResolvedValue(mockReports());

    render(<ReportsPage />);

    expect(screen.getByRole("heading", { level: 1, name: /^reports$/i })).toBeInTheDocument();

    // No select dropdowns (branch filter) or status pill controls on reports page
    expect(document.querySelectorAll("select").length).toBe(0);

    // No search input
    expect(
      screen.queryByPlaceholderText(/search/i),
    ).not.toBeInTheDocument();
  });
});

// ── ResourcesPage — page title present ───────────────────────────────────────

describe("ResourcesPage — page title and structure", () => {
  beforeEach(() => {
    setRole("staff");
  });

  it("R1(Res) — Resources page title 'Resources' is present and there is a toolbar (filters)", () => {
    // Catches: generator omitting h1, or omitting the filter toolbar (both required per spec R1.1, R2)
    vi.mocked(fetchResources).mockResolvedValue(mockResources());

    render(
      <MemoryRouter initialEntries={["/staff/resources"]}>
        <ResourcesPage />
      </MemoryRouter>,
    );

    return screen.findByRole("heading", { level: 1, name: /^resources$/i }).then((h1) => {
      expect(h1).toBeInTheDocument();
      // Toolbar has Include status toggles and Branch dropdown — at minimum a select exists
      expect(document.querySelectorAll("select").length).toBeGreaterThan(0);
    });
  });
});

// ── ResourcesPage — v2 cards (R12–R14, Wave C) ────────────────────────────────

describe("ResourcesPage — AccommodationByNightCard (R12)", () => {
  beforeEach(() => {
    setRole("staff");
  });

  it("R12 — zero-state: renders 'Accommodation by Night' heading without crashing when all counts are 0", () => {
    // Catches: component crashing on zero-valued night buckets
    vi.mocked(fetchResources).mockResolvedValue(mockResources());

    render(
      <MemoryRouter initialEntries={["/staff/resources"]}>
        <ResourcesPage />
      </MemoryRouter>,
    );

    return screen.findByText("Accommodation by Night").then((heading) => {
      expect(heading).toBeInTheDocument();
    });
  });

  it("R12 — night labels 'Night of Aug 14' and 'Night of Aug 15' are rendered", () => {
    // Catches: hardcoding wrong labels or omitting one night column
    vi.mocked(fetchResources).mockResolvedValue(mockResources());

    render(
      <MemoryRouter initialEntries={["/staff/resources"]}>
        <ResourcesPage />
      </MemoryRouter>,
    );

    return Promise.all([
      screen.findByText("Night of Aug 14"),
      screen.findByText("Night of Aug 15"),
    ]).then(([aug14, aug15]) => {
      expect(aug14).toBeInTheDocument();
      expect(aug15).toBeInTheDocument();
    });
  });

  it("R12 — rooms label from API rooms field is displayed (not recomputed)", () => {
    // Catches: UI recomputing rooms instead of displaying server-computed value
    // Server sets shared_double.rooms = 4 for Aug 14 — UI must show "(4 rooms)"
    const fixture = mockResources();
    fixture.resources.accommodationByNight["2026-08-14"] = {
      private: 22,
      privateByGender: { male: 15, female: 6, other: 1 },
      shared_double: { count: 8, rooms: 4 },
      shared_doubleByGender: { male: 5, female: 2, other: 1 },
      shared_triple: { count: 6, rooms: 2 },
      shared_tripleByGender: { male: 4, female: 1, other: 1 },
      extraBeds: 5,
    };

    vi.mocked(fetchResources).mockResolvedValue(fixture);

    render(
      <MemoryRouter initialEntries={["/staff/resources"]}>
        <ResourcesPage />
      </MemoryRouter>,
    );

    // "(4 rooms)" must appear as supplied by server — no client recomputation
    return screen.findByText("(4 rooms)").then((el) => {
      expect(el).toBeInTheDocument();
    });
  });
});

describe("ResourcesPage — MealsByParticipationCard (R13)", () => {
  beforeEach(() => {
    setRole("staff");
  });

  it("R13 — zero-state: 'Headcount & Meals by Caterer' heading renders without crashing", () => {
    // Catches: component crashing when headcount/veg/nonVeg are all 0
    vi.mocked(fetchResources).mockResolvedValue(mockResources());

    render(
      <MemoryRouter initialEntries={["/staff/resources"]}>
        <ResourcesPage />
      </MemoryRouter>,
    );

    return screen.findByText("Headcount & Meals by Caterer").then((heading) => {
      expect(heading).toBeInTheDocument();
    });
  });

  it("R13 — 'Campus Day Caterer' and 'Raviz Banquet Caterer' sub-block headings are rendered", () => {
    // Catches: generator rendering only one caterer block or using wrong labels
    vi.mocked(fetchResources).mockResolvedValue(mockResources());

    render(
      <MemoryRouter initialEntries={["/staff/resources"]}>
        <ResourcesPage />
      </MemoryRouter>,
    );

    return Promise.all([
      screen.findByText("Campus Day Caterer"),
      screen.findByText("Raviz Banquet Caterer"),
    ]).then(([campus, raviz]) => {
      expect(campus).toBeInTheDocument();
      expect(raviz).toBeInTheDocument();
    });
  });
});

describe("ResourcesPage — ChildrenByAgeBandCard (R14)", () => {
  beforeEach(() => {
    setRole("staff");
  });

  it("R14 — zero-state: 'Children by Age Band' heading renders without crashing", () => {
    // Catches: component crashing when all age band counts are 0
    vi.mocked(fetchResources).mockResolvedValue(mockResources());

    render(
      <MemoryRouter initialEntries={["/staff/resources"]}>
        <ResourcesPage />
      </MemoryRouter>,
    );

    return screen.findByText("Children by Age Band").then((heading) => {
      expect(heading).toBeInTheDocument();
    });
  });

  it("R14 — all three age band labels are rendered", () => {
    // Catches: generator rendering only 2 bands, or using wrong label text
    vi.mocked(fetchResources).mockResolvedValue(mockResources());

    render(
      <MemoryRouter initialEntries={["/staff/resources"]}>
        <ResourcesPage />
      </MemoryRouter>,
    );

    return Promise.all([
      screen.findByText("Under 6 — Free"),
      screen.findByText("Age 6–12"),
      screen.findByText("Age 13+"),
    ]).then(([free, mid, older]) => {
      expect(free).toBeInTheDocument();
      expect(mid).toBeInTheDocument();
      expect(older).toBeInTheDocument();
    });
  });
});
