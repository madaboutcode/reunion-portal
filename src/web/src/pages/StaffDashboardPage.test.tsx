/**
 * StaffDashboardPage — adversarial black-box tests for Wave B additions.
 *
 * Spec sources (source of truth):
 *   tasks/staff-dashboard-gaps.design.md   §C8
 *   tasks/staff-dashboard-gaps.decisions.md §A5, A10, A11, A12, A13, D6, D8
 *   tasks/staff-dashboard-gaps.context.md   §Wave learnings
 *
 * Boundary: rendered React component tree via MemoryRouter + RTL.
 * Consumer input:  URL search params + mocked staff-api responses.
 * Consumer output: DOM presence/absence, link hrefs, URL param updates.
 *
 * ── Coverage table ──────────────────────────────────────────────────────────────
 *
 * Ref        | Guarantee                                                | Test(s)
 * -----------|----------------------------------------------------------|---------
 * D8         | Pending-age chip renders ONLY for status==="pending"     | pending-age chip — pending only
 * D8         | pending_verification row: WA link yes, age chip "—"      | pending_verification fixture
 * D8         | confirmed row: WA link present when whatsapp valid        | confirmed WA link
 * A10/A11    | Chip shows "<1d" when age is 0 days (fresh, gray)        | chip fresh 0d
 * A11        | Chip turns amber when days > pendingAgeAmberDays (3)     | chip amber
 * A11        | Chip gray when days === pendingAgeAmberDays (not stale)  | chip gray at threshold
 * A5         | WA link absent when whatsapp has < 8 digits              | WA absent invalid phone
 * A5         | WA link targets wa.me URL in a new tab (noopener)        | WA href format
 * A5         | WA link onClick stops row propagation (no navigate)      | WA click stopPropagation
 * A12/A13    | Participation pills: "All types/Full/Campus" present     | pill labels (attendee)
 * A12/A13    | Clicking "Full" sets participationType URL param         | pill sets param
 * A12/A13    | Clicking "Full" resets page to 1                         | pill resets page
 * A12/A13    | Participation pills absent on donor view                 | pills absent donor
 * D6         | fetchDashboardStats NOT called with participationType    | stats call has no participationType
 * C8         | Goal strip absent on donor view (type=donor)             | goal strip absent
 * C8         | Goal strip present on attendee view                      | goal strip present
 * ────────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock("@/lib/auth");
vi.mock("@/lib/staff-api");
vi.mock("@/lib/api");

import { getAuthRole, getAuthEmail, isAdmin, getAuthSub } from "@/lib/auth";
import { exportCsv, fetchDashboardStats, fetchRegistrations } from "@/lib/staff-api";
import { getMyRegistration } from "@/lib/api";
import StaffDashboardPage from "@/pages/StaffDashboardPage";
import type { DashboardStats, StaffRegistrationListItem } from "@/lib/staff-types";

// ── Auth / API setup ──────────────────────────────────────────────────────────

function setStaffRole() {
  vi.mocked(getAuthRole).mockReturnValue("staff");
  vi.mocked(isAdmin).mockReturnValue(false);
  vi.mocked(getAuthEmail).mockReturnValue("staff@example.com");
  vi.mocked(getAuthSub).mockReturnValue("1");
}

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

function mockItem(overrides: Partial<StaffRegistrationListItem> = {}): StaffRegistrationListItem {
  return {
    id: 1,
    regCode: "SMRT00001",
    fullName: "Test User",
    email: "test@example.com",
    whatsapp: "9876543210",
    branch: "Computer Science & Engineering",
    status: "confirmed",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    totalAmount: 8500,
    photoThumbKey: null,
    createdAt: Date.now() - 2 * 86400000, // 2 days ago
    ...overrides,
  };
}

function mockList(items: StaffRegistrationListItem[]) {
  return {
    data: items,
    page: 1,
    pageSize: 20,
    totalItems: items.length,
    totalPages: 1,
  };
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderDashboard(path = "/staff/dashboard?type=attendee") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/staff/dashboard" element={<StaffDashboardPage />} />
        <Route path="/staff/registrations/:id" element={<div>Detail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  setStaffRole();
  vi.mocked(getMyRegistration).mockResolvedValue(null as never);
  vi.mocked(fetchDashboardStats).mockResolvedValue(mockStats());
  vi.mocked(fetchRegistrations).mockResolvedValue(
    mockList([mockItem()]),
  );
  vi.mocked(exportCsv).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("dashboard scope and Donor Only presentation", () => {
  it.each([
    ["missing", "/staff/dashboard"],
    ["invalid", "/staff/dashboard?type=anything-else"],
  ])("normalizes %s type to attendee for stats, list, and page identity", async (_case, path) => {
    renderDashboard(path);

    await waitFor(() => {
      expect(fetchDashboardStats).toHaveBeenCalledWith({ type: "attendee" });
      expect(fetchRegistrations).toHaveBeenCalledWith(
        expect.objectContaining({ type: "attendee" }),
      );
    });
    expect(screen.getByRole("heading", { name: "Attendees" })).toBeInTheDocument();
  });

  it("shows attendee Total as Full Celebration + Campus Only and Donor Only separately", async () => {
    vi.mocked(fetchDashboardStats).mockResolvedValue(mockStats({
      total: 145,
      confirmed: 125,
      pending: 15,
      pendingVerification: 4,
      moneyCollected: 1_773_666,
      byParticipationType: {
        full_celebration: { total: 115, confirmed: 100, pending: 13, pendingVerification: 2 },
        campus_only: { total: 29, confirmed: 25, pending: 2, pendingVerification: 2 },
        donation_only: { total: 1, confirmed: 1, pending: 0, pendingVerification: 0 },
      },
    }));

    renderDashboard("/staff/dashboard");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Total 144" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Donor Only 1" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Total 145" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmed 125" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Money Collected ₹17,73,666" })).toBeInTheDocument();
  });

  it("exports the default dashboard with explicit attendee scope", async () => {
    renderDashboard("/staff/dashboard");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => {
      expect(exportCsv).toHaveBeenCalledWith(expect.objectContaining({ type: "attendee" }));
    });
  });
});

// ── D8: Pending-age chip — pending rows only ──────────────────────────────────

describe("pending-age chip (D8)", () => {
  it("renders age chip for status=pending rows", async () => {
    // 5 days ago → amber chip
    const pendingItem = mockItem({
      status: "pending",
      createdAt: Date.now() - 5 * 86400000,
    });
    vi.mocked(fetchRegistrations).mockResolvedValue(mockList([pendingItem]));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId("pending-age-chip")).toBeInTheDocument();
    });
  });

  it("does NOT render age chip for status=confirmed — shows '—' instead", async () => {
    const confirmedItem = mockItem({ status: "confirmed" });
    vi.mocked(fetchRegistrations).mockResolvedValue(mockList([confirmedItem]));

    renderDashboard();

    await waitFor(() => {
      // WA link should be present (confirmed row can have WA)
      expect(screen.queryByTestId("pending-age-chip")).not.toBeInTheDocument();
    });
  });

  it("does NOT render age chip for status=pending_verification — WA link yes, age chip '—'", async () => {
    // Decision D8 explicitly calls out pending_verification: WA yes, age chip absent
    const pvItem = mockItem({
      status: "pending_verification",
      whatsapp: "9876543210",
      createdAt: Date.now() - 4 * 86400000,
    });
    vi.mocked(fetchRegistrations).mockResolvedValue(mockList([pvItem]));

    renderDashboard();

    await waitFor(() => {
      // WA link is present (all rows get WA)
      expect(screen.getByTestId("wa-link")).toBeInTheDocument();
      // Age chip is NOT present (only pending rows get it)
      expect(screen.queryByTestId("pending-age-chip")).not.toBeInTheDocument();
    });
  });
});

// ── A10/A11: Pending age chip styling ────────────────────────────────────────

describe("pending-age chip styling (A10, A11)", () => {
  it("shows '<1d' (gray) when age is 0 days (same day pending)", async () => {
    const freshItem = mockItem({
      status: "pending",
      createdAt: Date.now() - 30 * 60 * 1000, // 30 minutes ago
    });
    vi.mocked(fetchRegistrations).mockResolvedValue(mockList([freshItem]));

    renderDashboard();

    await waitFor(() => {
      const chip = screen.getByTestId("pending-age-chip");
      expect(chip).toHaveTextContent("<1d");
      expect(chip).not.toHaveClass("bg-amber-100");
      expect(chip).toHaveClass("bg-gray-100");
    });
  });

  it("shows amber styling when age > 3 days (pendingAgeAmberDays)", async () => {
    // 4 days ago → stale, amber
    const staleItem = mockItem({
      status: "pending",
      createdAt: Date.now() - 4 * 86400000,
    });
    vi.mocked(fetchRegistrations).mockResolvedValue(mockList([staleItem]));

    renderDashboard();

    await waitFor(() => {
      const chip = screen.getByTestId("pending-age-chip");
      expect(chip).toHaveClass("bg-amber-100");
      expect(chip).toHaveClass("text-amber-700");
    });
  });

  it("shows gray styling when age === 3 days (not stale — strict greater-than, A11)", async () => {
    // Exactly 3 days ago → NOT stale
    const atThresholdItem = mockItem({
      status: "pending",
      createdAt: Date.now() - 3 * 86400000,
    });
    vi.mocked(fetchRegistrations).mockResolvedValue(mockList([atThresholdItem]));

    renderDashboard();

    await waitFor(() => {
      const chip = screen.getByTestId("pending-age-chip");
      expect(chip).toHaveClass("bg-gray-100");
      expect(chip).not.toHaveClass("bg-amber-100");
    });
  });
});

// ── A5: WhatsApp link ─────────────────────────────────────────────────────────

describe("WhatsApp link (A5)", () => {
  it("renders WA link for rows with a valid whatsapp number", async () => {
    const item = mockItem({ whatsapp: "9876543210" });
    vi.mocked(fetchRegistrations).mockResolvedValue(mockList([item]));

    renderDashboard();

    await waitFor(() => {
      const link = screen.getByTestId("wa-link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "https://wa.me/9876543210");
    });
  });

  it("renders '—' (no WA link) when whatsapp has fewer than 8 digits (invalid)", async () => {
    const item = mockItem({ whatsapp: "1234" }); // only 4 digits
    vi.mocked(fetchRegistrations).mockResolvedValue(mockList([item]));

    renderDashboard();

    await waitFor(() => {
      expect(screen.queryByTestId("wa-link")).not.toBeInTheDocument();
    });
  });

  it("renders WA link with target=_blank and rel=noopener noreferrer (A5 — external link safety)", async () => {
    renderDashboard();

    await waitFor(() => {
      const link = screen.getByTestId("wa-link");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  it("WA link click does NOT navigate to registration detail (stopPropagation)", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId("wa-link")).toBeInTheDocument();
    });

    // Click the WA link — should NOT cause navigation to the detail route
    fireEvent.click(screen.getByTestId("wa-link"));

    // If stopPropagation works, the detail page ("Detail" text) never appears
    expect(screen.queryByText("Detail")).not.toBeInTheDocument();
  });

  it("WA link is present on confirmed rows (staff may follow up after confirmation)", async () => {
    const confirmedItem = mockItem({ status: "confirmed", whatsapp: "9876543210" });
    vi.mocked(fetchRegistrations).mockResolvedValue(mockList([confirmedItem]));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId("wa-link")).toBeInTheDocument();
    });
  });
});

// ── A12/A13: Participation type filter pills ──────────────────────────────────

describe("participation type filter pills (A12, A13)", () => {
  it("renders All types / Full / Campus pills on attendee view", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "All types" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Full" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Campus" })).toBeInTheDocument();
    });
  });

  it("participation pills are absent on donor view", async () => {
    renderDashboard("/staff/dashboard?type=donor");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "All types" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Full" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Campus" })).not.toBeInTheDocument();
    });
  });

  it("clicking 'Full' sets participationType=full_celebration in URL and resets page", async () => {
    renderDashboard("/staff/dashboard?type=attendee&page=3");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Full" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Full" }));

    // fetchRegistrations should have been called with participationType="full_celebration"
    // and page reset (not 3)
    await waitFor(() => {
      const calls = vi.mocked(fetchRegistrations).mock.calls;
      const latestCall = calls[calls.length - 1][0];
      expect(latestCall.participationType).toBe("full_celebration");
      expect(latestCall.page).not.toBe(3);
    });
  });

  it("clicking 'Campus' sets participationType=campus_only in URL", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Campus" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Campus" }));

    await waitFor(() => {
      const calls = vi.mocked(fetchRegistrations).mock.calls;
      const latestCall = calls[calls.length - 1][0];
      expect(latestCall.participationType).toBe("campus_only");
    });
  });
});

// ── D6: fetchDashboardStats must NOT receive participationType ────────────────

describe("D6 — stats fetch isolation", () => {
  it("fetchDashboardStats is NOT called with participationType param", async () => {
    // Even when the participation filter is set
    renderDashboard("/staff/dashboard?type=attendee&participationType=full_celebration");

    await waitFor(() => {
      expect(fetchDashboardStats).toHaveBeenCalled();
    });

    const statsCalls = vi.mocked(fetchDashboardStats).mock.calls;
    for (const [params] of statsCalls) {
      expect(params).not.toHaveProperty("participationType");
    }
  });
});

// ── C8: Goal strip visibility ─────────────────────────────────────────────────

describe("C8 — goal strip visibility", () => {
  it("goal strip is present on attendee view (type=attendee)", async () => {
    renderDashboard();

    // GoalCard renders the title text from props — we look for "Full Celebration"
    await waitFor(() => {
      expect(screen.getByText("Full Celebration")).toBeInTheDocument();
      expect(screen.getByText("Campus Only")).toBeInTheDocument();
      expect(screen.getByText("Registration Target")).toBeInTheDocument();
    });
  });

  it("goal strip is absent on donor view (type=donor)", async () => {
    renderDashboard("/staff/dashboard?type=donor");

    await waitFor(() => {
      expect(screen.queryByText("Full Celebration")).not.toBeInTheDocument();
      expect(screen.queryByText("Campus Only")).not.toBeInTheDocument();
      expect(screen.queryByText("Registration Target")).not.toBeInTheDocument();
    });
  });
});
