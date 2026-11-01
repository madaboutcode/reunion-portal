/**
 * Registration Desk — feature tests (registration-desk-ui plan, BATCH WEB
 * item 8). Proves, through the REAL RequireScope + RegistrationDeskPage +
 * RegistrationDeskDetailPage + SiteNav wiring (only network/auth boundaries
 * mocked):
 *   1. desk-only navigation exposes only Registration Desk
 *   2. a non-desk scoped user is denied at /staff/check-in
 *   3. the desk page uses ONLY desk endpoints — no dashboard API calls
 *   4. search results show the public CDN photo (or an initial-letter
 *      placeholder), and selecting one navigates to the routed detail
 *   5. a scanned pass payload navigates straight to the detail route
 *   6. Back returns to check-in with the typed query and results intact
 *   7. the Ledger detail's facts grid renders the WhatsApp link and rooms,
 *      shows the pending-payment warning, and Confirm attendance is idempotent
 *   8. spot registration: opens in the shared SlideOver, uploads a photo,
 *      reviews BEFORE any create request, edits back preserving the photo,
 *      then creates one pending registration (req #3)
 *   9. desk-payment-collection: the footer gate hides Confirm attendance
 *      while pending and shows Collect payment instead; recording a payment
 *      returns the fresh confirmed overview and Confirm attendance reappears
 *  10. desk-payment-collection: Add charge raises the balance from any
 *      state; a 409 (payment under verification) shows the guard box instead
 *      of a generic error
 *  11. 2026-08-12 plan: review is validation-only, edit-back preserves
 *      fields/photo, dirty close protection (header/Escape/backdrop),
 *      payment hierarchy + collection identity safeguards, immediate
 *      add-charge result, and the 200px-first photo enhancement
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";

vi.mock("@/lib/auth");
vi.mock("@/lib/staff-api");
vi.mock("@/lib/api");

import { getAuthRole, isAdmin, isStaff, getAuthEmail, getAuthSub } from "@/lib/auth";
import {
  fetchMyPermissions,
  deskLookup,
  deskSearch,
  deskMarkAbsent,
  deskMarkPresent,
  deskPhoto,
  deskCreateSpotRegistration,
  deskCollectPayment,
  deskAddCharge,
  deskStats,
  fetchRegistrations,
  fetchDashboardStats,
  fetchRegistrationDetail,
} from "@/lib/staff-api";
import { getMyRegistration, publicPhotoUrl } from "@/lib/api";
import { RequireScope } from "@/components/staff/RequireScope";
import { RegistrationDeskPage } from "@/pages/RegistrationDeskPage";
import { RegistrationDeskDetailPage } from "@/pages/RegistrationDeskDetailPage";
import { SiteNav } from "@/components/SiteNav";
import { clearScopeCache } from "@/hooks/useStaffScopes";
import { ApiError } from "@/lib/http";
import { DeskCollectPayment } from "@/components/registration-desk/DeskCollectPayment";
import { DeskAddCharge } from "@/components/registration-desk/DeskAddCharge";
import type { DeskAttendeeOverview, DeskSearchResult } from "@/lib/staff-types";

// ── Fixtures ───────────────────────────────────────────────────────────────

const OVERVIEW: DeskAttendeeOverview = {
  id: 1001,
  fullName: "Ravi Kumar",
  regCode: "SMRT79WW4A25NWG1",
  branch: "Computer Science & Engineering",
  participationType: "full_celebration",
  photo: { available: true, url: "/api/staff/desk/registrations/1001/photo" },
  whatsapp: "+919876543210",
  mealPreference: "veg",
  accommodation: {
    type: "shared_double",
    checkIn: "2026-08-14",
    checkOut: "2026-08-16",
  },
  rooms: ["12", "14"],
  additionalAttendees: {
    spouse: [{ name: "Priya Kumar", mealPreference: "veg" }],
    children: [],
    guests: [],
  },
  payment: { state: "payment_pending", amountDue: 2500 },
  checkIn: { present: false, checkedInAt: null },
  tshirts: [{ size: "L", gender: "male", isIncluded: true }],
};

// Same attendee, balance already settled — for tests about check-in/undo
// mechanics that aren't about the payment gate itself (desk-payment-collection
// design §3: Confirm attendance only shows once payment.state is "confirmed").
const CONFIRMED_OVERVIEW: DeskAttendeeOverview = {
  ...OVERVIEW,
  payment: { state: "confirmed" },
};

const SEARCH_RESULTS: DeskSearchResult[] = [
  {
    id: 1001,
    fullName: "Ravi Kumar",
    branch: "Computer Science & Engineering",
    regCode: "SMRT79WW4A25NWG1",
    participationType: "full_celebration",
    hasPhoto: true,
    checkIn: { present: false, checkedInAt: null },
  },
  {
    id: 1002,
    fullName: "Anu Pillai",
    branch: "Electronics",
    regCode: "SMRT-ANU1",
    participationType: "campus_only",
    hasPhoto: false,
    checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
  },
];

const SEARCH_RESPONSE = {
  results: SEARCH_RESULTS,
  thumbsBaseUrl: "https://cdn.example/photos",
  photosVersion: 7,
};

const SPOT_CREATED = {
  registration: {
    id: 2001,
    regCode: "SMRT77ABC123XYZ4",
    participationType: "full_celebration" as const,
    payment: { state: "payment_pending" as const, amountDue: 8500 },
    checkIn: { present: false, checkedInAt: null },
    passUrl: "/pass#SMRT77ABC123XYZ4",
  },
};

// ── Test harness ───────────────────────────────────────────────────────────

function setUser(role: "staff" | "admin", scopes: string[] | null) {
  vi.mocked(getAuthRole).mockReturnValue(role);
  vi.mocked(isAdmin).mockReturnValue(role === "admin");
  vi.mocked(isStaff).mockReturnValue(true);
  vi.mocked(getAuthEmail).mockReturnValue("desk@example.com");
  vi.mocked(getAuthSub).mockReturnValue("42");
  vi.mocked(fetchMyPermissions).mockResolvedValue({
    permissions: scopes === null ? null : { scopes },
    role,
  });
}

/** Mounts the real nested-route pair: check-in (parent, stays mounted) + registration/:regCode (overlay). */
function renderDeskApp(initialPath = "/staff/check-in", initialState?: unknown) {
  return render(
    <MemoryRouter
      initialEntries={[
        { pathname: initialPath, ...(initialState !== undefined ? { state: initialState } : {}) },
      ]}
    >
      <Routes>
        <Route
          path="/staff/check-in"
          element={
            <RequireScope scope="registration_desk" pageLabel="registration desk">
              <RegistrationDeskPage />
            </RequireScope>
          }
        >
          <Route path="registration/:regCode" element={<RegistrationDeskDetailPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function renderBareDeskPage() {
  return render(
    <MemoryRouter initialEntries={["/staff/check-in"]}>
      <RegistrationDeskPage />
    </MemoryRouter>,
  );
}

function renderNav(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SiteNav />
    </MemoryRouter>,
  );
}

/**
 * Mounts ONLY the detail page on /reg/:regCode with a navigation probe, so a
 * test can change the :regCode param IN PLACE — the component stays mounted,
 * which is exactly the case where stale responses for the previous attendee
 * could leak into the new attendee's state. Returns a navigateTo(code) fn.
 */
function renderDetailWithNav(initialRegCode: string) {
  let navigateTo: ((code: string) => void) | undefined;
  function NavProbe() {
    const navigate = useNavigate();
    navigateTo = (code: string) => navigate(`/reg/${code}`);
    return null;
  }
  render(
    <MemoryRouter initialEntries={[`/reg/${initialRegCode}`]}>
      <Routes>
        <Route
          path="/reg/:regCode"
          element={
            <>
              <RegistrationDeskDetailPage />
              <NavProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return (code: string) => navigateTo?.(code);
}

/** Fake XHR that completes every photo upload with a 201 + fileKey. */
class FakeXHR {
  upload = { onprogress: null };
  status = 0;
  responseText = "";
  sentBody: unknown = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open() {}
  send(body: unknown) {
    this.sentBody = body;
    this.status = 201;
    this.responseText = JSON.stringify({
      fileKey: "photos/pending/cs/ravi-kumar/abc123.jpg",
    });
    this.onload?.();
  }
}

beforeEach(() => {
  clearScopeCache();
  vi.mocked(getMyRegistration).mockRejectedValue(new Error("no registration"));
  // vi.mock("@/lib/api") auto-mocks every export — restore the real URL builder
  // (registration-desk.spec.md R2.5: results use the public CDN thumbnail).
  vi.mocked(publicPhotoUrl).mockImplementation(
    (id, thumbsBaseUrl, photosVersion) => `${thumbsBaseUrl}/${id}.jpg?v=${photosVersion}`,
  );
  vi.mocked(deskPhoto).mockResolvedValue({
    url: "blob:test-photo",
    contentType: "image/jpeg",
  });
  vi.mocked(deskStats).mockResolvedValue({
    total: 0,
    checkedIn: 0,
    byType: {
      full_celebration: { total: 0, checkedIn: 0 },
      campus_only: { total: 0, checkedIn: 0 },
    },
  });
  // jsdom lacks Blob object URLs; the page only stores/revokes the URL string.
  URL.createObjectURL = vi.fn(() => "blob:test-photo");
  URL.revokeObjectURL = vi.fn();
  // jsdom has no matchMedia; the detail page uses it to pick the responsive
  // photo variant (plan Pre-Decisions). Desktop default (matches false → 960).
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  // Deterministic idempotency key for the spot-registration assertion.
  vi.stubGlobal("crypto", {
    ...(globalThis.crypto ?? {}),
    randomUUID: () => "test-idem-key",
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  clearScopeCache();
});

// ── 1. Desk-only navigation / access denial ─────────────────────────────────

describe("desk scope — navigation and page denial", () => {
  it("a desk-only user's staff nav shows only Registration Desk", async () => {
    setUser("staff", ["registration_desk"]);
    renderNav("/staff/check-in");

    expect(await screen.findByRole("link", { name: /registration desk/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^attendees$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^resources$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^reports$/i })).not.toBeInTheDocument();
  });

  it("a user without registration_desk is denied at /staff/check-in", async () => {
    setUser("staff", ["reports"]);
    renderDeskApp();

    expect(await screen.findByTestId("access-denied")).toBeInTheDocument();
    expect(screen.queryByText("Find an attendee.")).not.toBeInTheDocument();
  });
});

// ── 2. No dashboard API usage ───────────────────────────────────────────────

describe("desk page — data boundary", () => {
  it("search and check-in never call dashboard APIs", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskSearch).mockResolvedValue(SEARCH_RESPONSE);
    // Settled payment — this test is about API boundary, not the payment
    // gate (which hides Confirm attendance while pending).
    vi.mocked(deskLookup).mockResolvedValue({ attendee: CONFIRMED_OVERVIEW });
    vi.mocked(deskMarkPresent).mockResolvedValue({
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
    });
    renderDeskApp();

    await user.type(await screen.findByLabelText("Attendee name or registration code"), "Ravi");
    await waitFor(() => expect(deskSearch).toHaveBeenCalledWith("Ravi"));
    await user.click(await screen.findByRole("button", { name: /Ravi Kumar/i }));

    await user.click(await screen.findByTestId("desk-mark-present"));
    await waitFor(() => expect(deskMarkPresent).toHaveBeenCalledWith(1001));

    expect(fetchRegistrations).not.toHaveBeenCalled();
    expect(fetchDashboardStats).not.toHaveBeenCalled();
    expect(fetchRegistrationDetail).not.toHaveBeenCalled();
    expect(deskCreateSpotRegistration).not.toHaveBeenCalled();
  });

  it("debounces the search and never searches under 2 characters", async () => {
    vi.useFakeTimers();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskSearch).mockResolvedValue({ results: [], thumbsBaseUrl: "", photosVersion: 0 });
    renderBareDeskPage();

    vi.advanceTimersByTime(500);
    expect(deskSearch).not.toHaveBeenCalled();

    const input = screen.getByLabelText("Attendee name or registration code");
    fireEvent.change(input, { target: { value: "R" } });
    vi.advanceTimersByTime(500);
    expect(deskSearch).not.toHaveBeenCalled();

    // Enter below the 2-char threshold is a harmless no-op.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(deskSearch).not.toHaveBeenCalled();

    // Enter fires an immediate search, skipping the debounce wait.
    fireEvent.change(input, { target: { value: "Ravi" } });
    expect(deskSearch).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(deskSearch).toHaveBeenCalledWith("Ravi");

    // The debounce auto-search still fires on its own.
    vi.clearAllMocks();
    fireEvent.change(input, { target: { value: "Anu" } });
    expect(deskSearch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(449);
    expect(deskSearch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deskSearch).toHaveBeenCalledWith("Anu");
  });
});

// ── 3. Search results — photo split (R2.5) and navigation ──────────────────

describe("desk page — search results and navigation", () => {
  it("shows the public CDN photo when available and an initial-letter placeholder otherwise", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskSearch).mockResolvedValue(SEARCH_RESPONSE);
    renderDeskApp();

    await user.type(await screen.findByLabelText("Attendee name or registration code"), "a");
    await user.type(screen.getByLabelText("Attendee name or registration code"), "n");
    await waitFor(() => expect(deskSearch).toHaveBeenCalled());

    const photos = await screen.findAllByTestId("desk-result-photo");
    expect(photos).toHaveLength(2);
    expect(photos[0].tagName).toBe("IMG");
    expect(photos[0]).toHaveAttribute("src", "https://cdn.example/photos/1001.jpg?v=7");
    expect(photos[1].tagName).toBe("DIV");
    expect(photos[1]).toHaveTextContent("A");
  });

  it("selecting a search result navigates to the detail route", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskSearch).mockResolvedValue(SEARCH_RESPONSE);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    renderDeskApp();

    await user.type(await screen.findByLabelText("Attendee name or registration code"), "Ravi");
    await waitFor(() => expect(deskSearch).toHaveBeenCalledWith("Ravi"));

    const result = await screen.findByRole("button", { name: /Open attendee record for Ravi Kumar/i });
    await user.click(result);

    await waitFor(() => expect(deskLookup).toHaveBeenCalledWith("SMRT79WW4A25NWG1"));
    expect(await screen.findByTestId("desk-detail")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ravi Kumar" })).toBeInTheDocument();
  });

  it("a scanned pass payload navigates directly to the detail route", async () => {
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    renderDeskApp();

    // Set the query directly (no focus events) and press Enter in the input.
    // The scanned pass payload routes straight to the detail route.
    const input = await screen.findByLabelText("Attendee name or registration code");
    fireEvent.change(input, { target: { value: "https://app.example.test/pass#SMRT79WW4A25NWG1" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(deskLookup).toHaveBeenCalledWith("SMRT79WW4A25NWG1"));
    expect(await screen.findByTestId("desk-detail")).toBeInTheDocument();
    expect(deskSearch).not.toHaveBeenCalled();
  });

  it("an unknown pass code opens the detail route and shows the server's 404 message", async () => {
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockRejectedValue(new ApiError(404, "Attendee not found"));
    renderDeskApp();

    // Set the query directly (no focus events) and press Enter in the input.
    const input = await screen.findByLabelText("Attendee name or registration code");
    fireEvent.change(input, { target: { value: "https://app.example.test/pass#SMRT000000000000" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText(/attendee not found/i)).toBeInTheDocument();
    expect(screen.queryByTestId("desk-detail")).not.toBeInTheDocument();
  });

  it("Back returns to check-in with the typed query and results intact", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskSearch).mockResolvedValue(SEARCH_RESPONSE);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    renderDeskApp();

    const input = await screen.findByLabelText("Attendee name or registration code");
    await user.type(input, "Ravi");
    await waitFor(() => expect(deskSearch).toHaveBeenCalledWith("Ravi"));

    await user.click(await screen.findByRole("button", { name: /Open attendee record for Ravi Kumar/i }));
    expect(await screen.findByTestId("desk-detail")).toBeInTheDocument();

    await user.click(screen.getByTestId("desk-detail-back"));

    await waitFor(() => expect(screen.queryByTestId("desk-detail")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Attendee name or registration code")).toHaveValue("Ravi");
    expect(screen.getByRole("button", { name: /Open attendee record for Ravi Kumar/i })).toBeInTheDocument();
  });
});

// ── 4. Ledger detail — facts grid, pending warning, attendance ─────────────

describe("desk page — Ledger detail", () => {
  it("renders the WhatsApp link and assigned rooms in the facts grid, and shows the pending-payment warning", async () => {
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    expect(await screen.findByRole("heading", { name: "Ravi Kumar" })).toBeInTheDocument();
    // The identity photo starts as the initial-letter placeholder (a <div>) and
    // swaps to an <img> once the authenticated blob resolves — query the
    // settled alt text rather than the shared testid, which briefly exists on
    // both the outgoing placeholder and the incoming <img> during that swap.
    expect(await screen.findByAltText("Photo of Ravi Kumar")).toBeInTheDocument();
    // First paint is the authenticated 200px thumbnail (plan "Photo enhancement").
    expect(deskPhoto).toHaveBeenCalledWith(1001, 200);

    const facts = screen.getByTestId("desk-facts");
    const waLink = await screen.findByRole("link", { name: "+919876543210" });
    expect(waLink).toHaveAttribute("href", "https://wa.me/919876543210");
    expect(facts).toHaveTextContent("12");
    expect(facts).toHaveTextContent("14");
    expect(facts).toHaveTextContent("L (male)");

    expect(screen.getByTestId("desk-pending-warning")).toHaveTextContent("₹2,500");
  });

  it("marks attendance — the action button animates to a terminal green success state", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    // Settled payment — Confirm attendance only renders once payment is
    // confirmed (desk-payment-collection design §3); see the dedicated gate
    // tests below for the pending case.
    vi.mocked(deskLookup).mockResolvedValue({ attendee: CONFIRMED_OVERVIEW });
    vi.mocked(deskMarkPresent).mockResolvedValue({
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
    });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    expect(await screen.findByText("Not present")).toBeInTheDocument();
    await user.click(screen.getByTestId("desk-mark-present"));

    // The button drives its own idle → loading → success animation over the
    // server call, then lands on a terminal success state.
    await waitFor(() => expect(deskMarkPresent).toHaveBeenCalledWith(1001));
    // Success lands after the minimum loading floor (max(call, minLoadingMs)).
    await waitFor(() => expect(screen.getByTestId("desk-mark-present")).toHaveAttribute("data-phase", "success"), {
      timeout: 3000,
    });
    expect(screen.getByTestId("desk-mark-present")).toBeDisabled();
    // Status flips to Present.
    expect(screen.getByText("Present")).toBeInTheDocument();
    // Idempotent at the UI layer: the button is disabled once present, so it
    // cannot fire a second submission (ispec R4.1).
    expect(deskMarkPresent).toHaveBeenCalledTimes(1);
  });

  it("an already-present, SETTLED attendee shows the undo button next to the present state card, with no Collect-payment CTA (ispec R4.5)", async () => {
    setUser("staff", ["registration_desk"]);
    const presentOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: presentOverview });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    expect(await screen.findByTestId("desk-present-state")).toHaveTextContent("Present");
    const undo = screen.getByTestId("desk-mark-absent");
    expect(undo).toBeInTheDocument();
    expect(undo).not.toBeDisabled();
    // The Confirm-attendance button is NOT shown alongside the present card
    // (already present); no outstanding balance, so no Collect-payment CTA.
    expect(screen.queryByTestId("desk-mark-present")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desk-collect-payment-open")).not.toBeInTheDocument();
  });

  it("an already-present, PENDING attendee shows the present card, Undo, AND a Collect-payment CTA — a balance charged after check-in isn't stranded", async () => {
    setUser("staff", ["registration_desk"]);
    // Net rule (desk-payment-collection design §3): Collect payment shows
    // iff pending, Undo shows iff present — independently of each other.
    const presentOverview: DeskAttendeeOverview = {
      ...OVERVIEW,
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: presentOverview });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    expect(await screen.findByTestId("desk-present-state")).toHaveTextContent("Present");
    expect(screen.getByTestId("desk-mark-absent")).toBeInTheDocument();
    expect(screen.getByTestId("desk-collect-payment-open")).toBeInTheDocument();
    // Confirm attendance still never shows — they're already present.
    expect(screen.queryByTestId("desk-mark-present")).not.toBeInTheDocument();
  });

  it("collecting payment while present settles the balance and the Present state remains", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const presentOverview: DeskAttendeeOverview = {
      ...OVERVIEW,
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: presentOverview });
    vi.mocked(deskCollectPayment).mockResolvedValue({
      attendee: { ...CONFIRMED_OVERVIEW, checkIn: { present: true, checkedInAt: 1_780_000_000_000 } },
    });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    expect(await screen.findByTestId("desk-collect-payment-open")).toBeInTheDocument();
    await user.click(screen.getByTestId("desk-collect-payment-open"));
    expect(await screen.findByTestId("desk-collect-payment-form")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Cash" }));
    await user.click(screen.getByTestId("desk-collect-payment-submit"));

    await waitFor(() => expect(deskCollectPayment).toHaveBeenCalledWith(1001, { method: "cash", note: undefined }));

    // Settled: the form closes, Collect payment disappears — the Present
    // state (and Undo) remains exactly as before, untouched by the payment.
    await waitFor(() => expect(screen.queryByTestId("desk-collect-payment-open")).not.toBeInTheDocument());
    expect(screen.getByTestId("desk-present-state")).toHaveTextContent("Present");
    expect(screen.getByTestId("desk-mark-absent")).toBeInTheDocument();
    expect(screen.queryByTestId("desk-mark-present")).not.toBeInTheDocument();
  });

  it("undo attendance — fires deskMarkAbsent, status flips back to Not present, Confirm returns", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    // Settled payment — after undo this attendee should land back on Confirm
    // attendance, not the Collect-payment gate (that's covered separately).
    const presentOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: presentOverview });
    vi.mocked(deskMarkAbsent).mockResolvedValue({
      checkIn: { present: false, checkedInAt: null },
    });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-mark-absent"));
    await waitFor(() => expect(deskMarkAbsent).toHaveBeenCalledWith(1001));

    // Status returns to Not present + the Confirm-attendance action button.
    await waitFor(() =>
      expect(screen.getByTestId("desk-mark-present")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("desk-mark-absent")).not.toBeInTheDocument();
    expect(deskMarkPresent).not.toHaveBeenCalled();
  });

  it("undo keeps the button disabled while the request is in flight (no double-tap)", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const presentOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: presentOverview });
    let resolveAbsent: ((value: { checkIn: { present: false; checkedInAt: null } }) => void) | undefined;
    vi.mocked(deskMarkAbsent).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAbsent = resolve;
        }),
    );
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    const undo = await screen.findByTestId("desk-mark-absent");
    await user.click(undo);
    // While in flight the button is aria-busy and cannot fire a second call.
    expect(undo).toHaveAttribute("aria-busy", "true");
    await user.click(undo);
    expect(deskMarkAbsent).toHaveBeenCalledTimes(1);

    resolveAbsent?.({ checkIn: { present: false, checkedInAt: null } });
    await waitFor(() =>
      expect(screen.getByTestId("desk-mark-present")).toBeInTheDocument(),
    );
  });

  it("undo failure shows the inline error, re-enables the button, and does NOT create an unhandled rejection (latest review)", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const presentOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: presentOverview });
    vi.mocked(deskMarkAbsent).mockRejectedValue(
      new ApiError(500, "Could not undo attendance. Please try again."),
    );

    // Observe unhandled rejections directly: the Undo button's onClick does
    // not await/catch onMarkAbsent, so if the handler rethrew, this listener
    // would fire (vitest only REPORTS such rejections, it does not fail the
    // test). The listener is removed in finally so it cannot leak.
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);
    try {
      renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

      await user.click(await screen.findByTestId("desk-mark-absent"));

      // The inline error is displayed in the footer.
      expect(await screen.findByText(/Could not undo attendance\. Please try again\./i)).toBeInTheDocument();
      // The button leaves the busy state so the operator can retry.
      const undo = screen.getByTestId("desk-mark-absent");
      await waitFor(() => expect(undo).not.toHaveAttribute("aria-busy", "true"));
      expect(undo).not.toBeDisabled();
      // Give the event loop a beat to surface any rejection, then prove none
      // was generated — this is the regression assertion for the rethrow.
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.removeListener("unhandledRejection", onUnhandledRejection);
    }
  });
});

// ── 5. Spot registration ─────────────────────────────────────────────────────

describe("desk page — spot registration flow", () => {
  it("opens spot registration in the shared SlideOver from the landing button", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    renderDeskApp();

    await user.click(await screen.findByTestId("desk-open-spot"));

    expect(screen.getByTestId("desk-spot-panel")).toBeInTheDocument();
    expect(screen.getByTestId("desk-spot-form")).toBeInTheDocument();
  });

  it("reviews before creating: no POST on Review, edit-back preserves the photo, only final create calls the endpoint", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    vi.mocked(deskLookup).mockResolvedValue({
      attendee: { ...OVERVIEW, id: 2001, regCode: "SMRT77ABC123XYZ4", checkIn: { present: false, checkedInAt: null } },
    });
    vi.mocked(deskCreateSpotRegistration).mockResolvedValue(SPOT_CREATED);
    renderDeskApp();

    await user.click(await screen.findByTestId("desk-open-spot"));
    expect(screen.getByTestId("desk-spot-form")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Full name *"), "Ravi Kumar");
    await user.type(screen.getByLabelText("WhatsApp *"), "+919876543210");
    await user.selectOptions(screen.getByLabelText("Branch *"), "Computer Science & Engineering");
    await user.type(screen.getByLabelText("Email *"), "ravi.kumar@example.com");

    const file = new File(["photo-bytes"], "ravi.jpg", { type: "image/jpeg" });
    const fileInput = screen.getByTestId("upload-spot-photo-input");
    await user.upload(fileInput, file);
    await waitFor(() => expect(screen.getByTestId("desk-spot-review")).not.toBeDisabled());

    // 1. Review — validation only. NO create request is made (plan step 2/3).
    await user.click(screen.getByTestId("desk-spot-review"));
    expect(await screen.findByTestId("desk-spot-review-panel")).toBeInTheDocument();
    expect(deskCreateSpotRegistration).not.toHaveBeenCalled();
    // The grouped review shows the fields that can change identity/price, and
    // the preview total is explicitly informational (plan "Preview copy").
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.getByText("Estimated total (preview)")).toBeInTheDocument();
    expect(screen.getByText(/Informational only\. The final amount is calculated by the server after creation\./)).toBeInTheDocument();

    // 2. Edit details — returns to the SAME populated form, photo intact.
    await user.click(screen.getByTestId("desk-spot-edit"));
    expect(screen.getByTestId("desk-spot-form")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name *")).toHaveValue("Ravi Kumar");
    expect(screen.getByLabelText("Email *")).toHaveValue("ravi.kumar@example.com");
    expect(screen.getByText("abc123.jpg")).toBeInTheDocument(); // uploaded photo reference
    expect(screen.getByTestId("desk-spot-review")).not.toBeDisabled();

    // 3. Review again, then the ONLY create request fires.
    await user.click(screen.getByTestId("desk-spot-review"));
    await user.click(await screen.findByTestId("desk-spot-create"));

    await waitFor(() => {
      expect(deskCreateSpotRegistration).toHaveBeenCalledTimes(1);
      expect(deskCreateSpotRegistration).toHaveBeenCalledWith(
        {
          fullName: "Ravi Kumar",
          whatsapp: "+919876543210",
          branch: "Computer Science & Engineering",
          participationType: "full_celebration",
          alumniMeal: "veg",
          photoFileKey: "photos/pending/cs/ravi-kumar/abc123.jpg",
          email: "ravi.kumar@example.com",
          children: [],
          guests: [],
        },
        "test-idem-key",
      );
    });

    expect(await screen.findByTestId("desk-payment-review")).toHaveTextContent("SMRT-77AB-C123-XYZ4");
    await user.click(screen.getByTestId("desk-payment-continue"));

    await waitFor(() => expect(deskLookup).toHaveBeenCalledWith("SMRT77ABC123XYZ4"));
    // The spot-created registration lands on a pending balance (SPOT_CREATED
    // payment.state is "payment_pending") — the detail page's gate covers it
    // automatically: Collect payment shows, Confirm attendance is hidden.
    expect(await screen.findByTestId("desk-collect-payment-open")).toBeInTheDocument();
    expect(screen.queryByTestId("desk-mark-present")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desk-spot-panel")).not.toBeInTheDocument();
  });

  it("blocks review until a photo is uploaded", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    renderDeskApp();

    await user.click(await screen.findByTestId("desk-open-spot"));

    await user.type(screen.getByLabelText("Full name *"), "Ravi Kumar");
    await user.type(screen.getByLabelText("WhatsApp *"), "+919876543210");
    await user.selectOptions(screen.getByLabelText("Branch *"), "Computer Science & Engineering");

    const review = screen.getByTestId("desk-spot-review");
    expect(review).toBeDisabled();
    await user.click(review);
    expect(deskCreateSpotRegistration).not.toHaveBeenCalled();
    expect(screen.getByText(/upload a photo to enable review/i)).toBeInTheDocument();
  });

  it("blocks review and shows an inline error when email is left blank", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    renderDeskApp();

    await user.click(await screen.findByTestId("desk-open-spot"));

    await user.type(screen.getByLabelText("Full name *"), "Ravi Kumar");
    await user.type(screen.getByLabelText("WhatsApp *"), "+919876543210");
    await user.selectOptions(screen.getByLabelText("Branch *"), "Computer Science & Engineering");

    const file = new File(["photo-bytes"], "ravi.jpg", { type: "image/jpeg" });
    const fileInput = screen.getByTestId("upload-spot-photo-input");
    await user.upload(fileInput, file);
    await waitFor(() => expect(screen.getByTestId("desk-spot-review")).not.toBeDisabled());

    // Email is left blank — the review button is enabled (only the photo
    // gates it), but the schema rejects the empty email on review.
    await user.click(screen.getByTestId("desk-spot-review"));

    expect(deskCreateSpotRegistration).not.toHaveBeenCalled();
    expect(screen.getByText("Email is required")).toBeInTheDocument();
  });
});

// ── 6. Desk payment collection — the footer gate (req #1) ──────────────────

describe("desk page — payment collection", () => {
  it("hides Confirm attendance while pending, shows Collect payment, and recording a payment reveals Confirm attendance", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    vi.mocked(deskCollectPayment).mockResolvedValue({ attendee: CONFIRMED_OVERVIEW });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    // Gate: a pending attendee shows Collect payment, NOT Confirm attendance.
    // This assertion (and the one after submit below) would FAIL if the
    // footer gate were removed — Confirm attendance would show unconditionally.
    expect(await screen.findByTestId("desk-collect-payment-open")).toBeInTheDocument();
    expect(screen.queryByTestId("desk-mark-present")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("desk-collect-payment-open"));
    expect(await screen.findByTestId("desk-collect-payment-form")).toBeInTheDocument();

    // Default mode is Cash; add a comment and submit.
    await user.click(screen.getByRole("radio", { name: "Cash" }));
    await user.type(screen.getByLabelText("Comment (optional)"), "Received by Ajith at 3pm");
    await user.click(screen.getByTestId("desk-collect-payment-submit"));

    await waitFor(() =>
      expect(deskCollectPayment).toHaveBeenCalledWith(1001, { method: "cash", note: "Received by Ajith at 3pm" }),
    );

    // The fresh confirmed overview replaces the attendee — no extra refetch.
    // Confirm attendance now shows; the collect form and gate are gone.
    expect(await screen.findByTestId("desk-mark-present")).toBeInTheDocument();
    expect(screen.queryByTestId("desk-collect-payment-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desk-collect-payment-open")).not.toBeInTheDocument();

    // And it behaves like a normal, already-settled check-in from here.
    vi.mocked(deskMarkPresent).mockResolvedValue({ checkIn: { present: true, checkedInAt: 1_780_000_000_000 } });
    await user.click(screen.getByTestId("desk-mark-present"));
    await waitFor(() => expect(deskMarkPresent).toHaveBeenCalledWith(1001));
  });

  it("selecting UPI submits that mode; a settle failure keeps the form open and shows the error", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    vi.mocked(deskCollectPayment).mockRejectedValue(new ApiError(409, "Already settled"));
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-collect-payment-open"));
    await user.click(screen.getByRole("radio", { name: "UPI" }));
    await user.click(screen.getByTestId("desk-collect-payment-submit"));

    await waitFor(() => expect(deskCollectPayment).toHaveBeenCalledWith(1001, { method: "upi" }));
    expect(await screen.findByTestId("desk-collect-payment-error")).toHaveTextContent("Already settled");
    // The failure leaves the form open (for retry) and the gate still holds.
    expect(screen.getByTestId("desk-collect-payment-form")).toBeInTheDocument();
    expect(screen.queryByTestId("desk-mark-present")).not.toBeInTheDocument();
  });

  it("opening Add charge while Collect payment is open closes it (one form at a time)", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-collect-payment-open"));
    expect(await screen.findByTestId("desk-collect-payment-form")).toBeInTheDocument();

    await user.click(screen.getByTestId("desk-add-charge-open"));
    expect(await screen.findByTestId("desk-add-charge-form")).toBeInTheDocument();
    expect(screen.queryByTestId("desk-collect-payment-form")).not.toBeInTheDocument();
  });

  it("disables both footer entry points while a payment request is in flight", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    let resolveCollect: ((value: { attendee: DeskAttendeeOverview }) => void) | undefined;
    vi.mocked(deskCollectPayment).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCollect = resolve;
        }),
    );
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-collect-payment-open"));
    await user.click(screen.getByRole("radio", { name: "Cash" }));
    await user.click(screen.getByTestId("desk-collect-payment-submit"));
    await waitFor(() => expect(deskCollectPayment).toHaveBeenCalled());

    // In flight: both entry points are disabled — a second "open" can't race
    // the pending submit's success handler (which would otherwise close
    // whatever the user opened after it started, or clobber fresh state).
    expect(screen.getByTestId("desk-collect-payment-open")).toBeDisabled();
    expect(screen.getByTestId("desk-add-charge-open")).toBeDisabled();
    // Ignored while disabled — no second form opens.
    await user.click(screen.getByTestId("desk-add-charge-open"));
    expect(screen.queryByTestId("desk-add-charge-form")).not.toBeInTheDocument();

    resolveCollect?.({ attendee: CONFIRMED_OVERVIEW });
    await waitFor(() => expect(screen.getByTestId("desk-mark-present")).toBeInTheDocument());
    // Re-enabled once the request settles.
    expect(screen.getByTestId("desk-add-charge-open")).not.toBeDisabled();
  });

  it("disables the form's own Close button while submitting, so a failure's error doesn't get unmounted", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    let rejectCollect: ((err: unknown) => void) | undefined;
    vi.mocked(deskCollectPayment).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectCollect = reject;
        }),
    );
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-collect-payment-open"));
    await user.click(screen.getByRole("radio", { name: "Cash" }));
    await user.click(screen.getByTestId("desk-collect-payment-submit"));
    await waitFor(() => expect(deskCollectPayment).toHaveBeenCalled());

    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toBeDisabled();

    rejectCollect?.(new ApiError(409, "Already settled"));
    expect(await screen.findByTestId("desk-collect-payment-error")).toHaveTextContent("Already settled");
    // Re-enabled once the request settles, so the user can dismiss the error.
    expect(screen.getByRole("button", { name: "Close" })).not.toBeDisabled();
  });
});

// ── 7. Desk payment collection — Add charge (req #2) ────────────────────────

describe("desk page — add charge", () => {
  it("adding a charge raises the balance from any state, including settled and not present", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: CONFIRMED_OVERVIEW });
    const chargedOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      payment: { state: "payment_pending", amountDue: 500 },
    };
    vi.mocked(deskAddCharge).mockResolvedValue({ attendee: chargedOverview });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    // Available even though the attendee is already settled.
    await user.click(await screen.findByTestId("desk-add-charge-open"));
    expect(await screen.findByTestId("desk-add-charge-form")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Reason *"), "Extra t-shirt XL");
    await user.type(screen.getByLabelText("Amount ₹ *"), "500");
    await user.click(screen.getByTestId("desk-add-charge-submit"));

    await waitFor(() =>
      expect(deskAddCharge).toHaveBeenCalledWith(1001, { description: "Extra t-shirt XL", amount: 500 }),
    );

    // The fresh overview reflects the new pending balance — the form closes
    // and the same footer gate now hides Confirm attendance again.
    expect(await screen.findByTestId("desk-pending-warning")).toHaveTextContent("₹500");
    expect(screen.queryByTestId("desk-add-charge-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desk-mark-present")).not.toBeInTheDocument();
    expect(await screen.findByTestId("desk-collect-payment-open")).toBeInTheDocument();
  });

  it("adding a charge right after check-in keeps the Present/Undo card (plus the new balance's Collect payment), not the stale celebration", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: CONFIRMED_OVERVIEW });
    vi.mocked(deskMarkPresent).mockResolvedValue({ checkIn: { present: true, checkedInAt: 1_780_000_000_000 } });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    // Live check-in — lands in the celebratory ActionButton success state
    // (justCheckedIn/celebrate is true; present-card+Undo hasn't mounted yet).
    await user.click(await screen.findByTestId("desk-mark-present"));
    await waitFor(() => expect(screen.getByTestId("desk-mark-present")).toHaveAttribute("data-phase", "success"), {
      timeout: 3000,
    });

    // Add a charge right after — this flips payment back to pending while
    // still present and still (until fixed) "celebrating".
    const chargedOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
      payment: { state: "payment_pending", amountDue: 500 },
    };
    vi.mocked(deskAddCharge).mockResolvedValue({ attendee: chargedOverview });

    await user.click(screen.getByTestId("desk-add-charge-open"));
    await user.type(screen.getByLabelText("Reason *"), "Extra t-shirt XL");
    await user.type(screen.getByLabelText("Amount ₹ *"), "500");
    await user.click(screen.getByTestId("desk-add-charge-submit"));
    await waitFor(() => expect(deskAddCharge).toHaveBeenCalled());

    // The present attendee keeps the calm Present/Undo card, PLUS Collect
    // payment for the new balance (net rule: Collect payment shows iff
    // pending, regardless of present) — NOT the (now stale) celebratory
    // button. Would FAIL if justCheckedIn/celebrate weren't reset on a
    // successful charge.
    expect(await screen.findByTestId("desk-present-state")).toBeInTheDocument();
    expect(screen.getByTestId("desk-mark-absent")).toBeInTheDocument();
    expect(screen.getByTestId("desk-collect-payment-open")).toBeInTheDocument();
    expect(screen.queryByTestId("desk-mark-present")).not.toBeInTheDocument();
  });

  it("a 409 (payment under verification) shows the guard box, not a generic error", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    vi.mocked(deskAddCharge).mockRejectedValue(
      new ApiError(409, "Cost-affecting changes blocked while payment verification is pending."),
    );
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-add-charge-open"));
    await user.type(screen.getByLabelText("Reason *"), "Extra t-shirt XL");
    await user.type(screen.getByLabelText("Amount ₹ *"), "500");
    await user.click(screen.getByTestId("desk-add-charge-submit"));

    await waitFor(() => expect(deskAddCharge).toHaveBeenCalled());
    expect(await screen.findByTestId("desk-add-charge-guard")).toHaveTextContent(/under verification/i);
    expect(screen.queryByTestId("desk-add-charge-error")).not.toBeInTheDocument();
    // Stays open for retry once the payment clears.
    expect(screen.getByTestId("desk-add-charge-form")).toBeInTheDocument();
  });

  it("rejects an empty reason and a non-positive amount without calling the API", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: CONFIRMED_OVERVIEW });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-add-charge-open"));
    await user.click(screen.getByTestId("desk-add-charge-submit"));

    expect(await screen.findByTestId("desk-add-charge-error")).toBeInTheDocument();
    expect(deskAddCharge).not.toHaveBeenCalled();
  });

  it("disables the form's own Close button while submitting, so the pending_verification guard doesn't get unmounted", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: CONFIRMED_OVERVIEW });
    let rejectCharge: ((err: unknown) => void) | undefined;
    vi.mocked(deskAddCharge).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectCharge = reject;
        }),
    );
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-add-charge-open"));
    await user.type(screen.getByLabelText("Reason *"), "Extra t-shirt XL");
    await user.type(screen.getByLabelText("Amount ₹ *"), "500");
    await user.click(screen.getByTestId("desk-add-charge-submit"));
    await waitFor(() => expect(deskAddCharge).toHaveBeenCalled());

    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toBeDisabled();

    rejectCharge?.(new ApiError(409, "Cost-affecting changes blocked while payment verification is pending."));
    expect(await screen.findByTestId("desk-add-charge-guard")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).not.toBeDisabled();
  });
});

// ── 8. Fail-closed attendance gate ──────────────────────────────────────────

describe("desk page — fail-closed attendance gate", () => {
  it("shows Confirm attendance for a confirmed payment; hides it for a pending one", async () => {
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: CONFIRMED_OVERVIEW });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    expect(await screen.findByTestId("desk-mark-present")).toBeInTheDocument();
    expect(screen.queryByTestId("desk-collect-payment-open")).not.toBeInTheDocument();
  });

  it("fails closed for a payment.state that is neither 'confirmed' nor 'payment_pending' — no Confirm attendance, no Collect payment", async () => {
    setUser("staff", ["registration_desk"]);
    // Simulates the state the server mapper should never emit — proves the
    // gate checks payment.state === 'confirmed' explicitly rather than just
    // "not pending" (the old `!pending` check would have wrongly shown
    // Confirm attendance here).
    const weirdOverview: DeskAttendeeOverview = {
      ...OVERVIEW,
      payment: { state: "something_unexpected" as unknown as DeskAttendeeOverview["payment"]["state"] },
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: weirdOverview });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await screen.findByTestId("desk-detail");
    expect(screen.queryByTestId("desk-mark-present")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desk-collect-payment-open")).not.toBeInTheDocument();
  });

  it("the payment status label fails closed too — 'confirmed' only for an explicit confirmed state", async () => {
    setUser("staff", ["registration_desk"]);
    // Same unreasoned state as above. The old label logic was `pending ?
    // "Payment pending" : "Payment confirmed"`, which would have falsely
    // shown "Payment confirmed" here (this state is not 'confirmed' either).
    const weirdOverview: DeskAttendeeOverview = {
      ...OVERVIEW,
      payment: { state: "something_unexpected" as unknown as DeskAttendeeOverview["payment"]["state"] },
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: weirdOverview });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    const facts = await screen.findByTestId("desk-facts");
    expect(screen.queryByText("Payment confirmed")).not.toBeInTheDocument();
    expect(screen.getAllByText("Payment status unknown").length).toBeGreaterThan(0);
    expect(facts).toHaveTextContent("Payment status unknown");
  });

  it("shows 'Payment confirmed' only for the confirmed state, and 'Payment pending' for pending", async () => {
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: CONFIRMED_OVERVIEW });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    expect(await screen.findByTestId("desk-detail")).toHaveTextContent("Payment confirmed");
    expect(screen.queryByText("Payment pending")).not.toBeInTheDocument();
  });
});

// ── 9. Unified busy guard — checking/undoing/mutating disable one another ──

describe("desk page — unified busy guard", () => {
  it("a check-in in flight disables Add charge", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: CONFIRMED_OVERVIEW });
    let resolvePresent: ((value: { checkIn: { present: boolean; checkedInAt: number | null } }) => void) | undefined;
    vi.mocked(deskMarkPresent).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePresent = resolve;
        }),
    );
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-mark-present"));
    await waitFor(() => expect(deskMarkPresent).toHaveBeenCalled());

    expect(screen.getByTestId("desk-add-charge-open")).toBeDisabled();

    resolvePresent?.({ checkIn: { present: true, checkedInAt: 1_780_000_000_000 } });
    await waitFor(() => expect(screen.getByTestId("desk-add-charge-open")).not.toBeDisabled());
  });

  it("an undo in flight disables Add charge", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const presentOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: presentOverview });
    let resolveAbsent: ((value: { checkIn: { present: boolean; checkedInAt: number | null } }) => void) | undefined;
    vi.mocked(deskMarkAbsent).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAbsent = resolve;
        }),
    );
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-mark-absent"));
    expect(screen.getByTestId("desk-add-charge-open")).toBeDisabled();

    resolveAbsent?.({ checkIn: { present: false, checkedInAt: null } });
    await waitFor(() => expect(screen.getByTestId("desk-add-charge-open")).not.toBeDisabled());
  });

  it("a charge in flight (while present) disables Undo", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const presentOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: presentOverview });
    let resolveCharge: ((value: { attendee: DeskAttendeeOverview }) => void) | undefined;
    vi.mocked(deskAddCharge).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCharge = resolve;
        }),
    );
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-add-charge-open"));
    await user.type(screen.getByLabelText("Reason *"), "Extra t-shirt XL");
    await user.type(screen.getByLabelText("Amount ₹ *"), "500");
    await user.click(screen.getByTestId("desk-add-charge-submit"));
    await waitFor(() => expect(deskAddCharge).toHaveBeenCalled());

    expect(screen.getByTestId("desk-mark-absent")).toBeDisabled();

    resolveCharge?.({ attendee: { ...presentOverview, payment: { state: "payment_pending", amountDue: 500 } } });
    await waitFor(() => expect(screen.getByTestId("desk-mark-absent")).not.toBeDisabled());
  });

  it("disables Undo the moment the add-charge form opens — before submit is even clicked", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const presentOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: presentOverview });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    expect(await screen.findByTestId("desk-mark-absent")).not.toBeDisabled();
    await user.click(screen.getByTestId("desk-add-charge-open"));
    expect(await screen.findByTestId("desk-add-charge-form")).toBeInTheDocument();

    // Not mutating yet (nothing submitted) — disabled purely because a
    // payment form is open.
    expect(deskAddCharge).not.toHaveBeenCalled();
    expect(screen.getByTestId("desk-mark-absent")).toBeDisabled();
  });

  it("disables Confirm attendance the moment the add-charge form opens (settled, not present)", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: CONFIRMED_OVERVIEW });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    expect(await screen.findByTestId("desk-mark-present")).not.toBeDisabled();
    await user.click(screen.getByTestId("desk-add-charge-open"));
    expect(await screen.findByTestId("desk-add-charge-form")).toBeInTheDocument();

    expect(deskAddCharge).not.toHaveBeenCalled();
    expect(screen.getByTestId("desk-mark-present")).toBeDisabled();
  });
});

// ── 10. Forms refuse to submit while a DIFFERENT mutation is in flight ─────

describe("DeskCollectPayment / DeskAddCharge — busy prop", () => {
  const collectProps = {
    amountDue: 2500,
    attendeeName: "Ravi Kumar",
    regCode: "SMRT79WW4A25NWG1",
    onSubmit: vi.fn(),
    onClose: vi.fn(),
  };

  it("DeskCollectPayment: submit is disabled when busy, independent of its own submitting state", () => {
    render(<DeskCollectPayment {...collectProps} busy />);
    expect(screen.getByTestId("desk-collect-payment-submit")).toBeDisabled();
  });

  it("DeskCollectPayment: submit stays disabled until a payment method is explicitly selected (plan Collection safeguards)", () => {
    render(<DeskCollectPayment {...collectProps} />);
    expect(screen.getByTestId("desk-collect-payment-submit")).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Cash" }));
    expect(screen.getByTestId("desk-collect-payment-submit")).not.toBeDisabled();
  });

  it("DeskCollectPayment: payment method options meet the 44px mobile touch target (P2, 2026-08-12 review)", () => {
    render(<DeskCollectPayment {...collectProps} />);
    // The shared Toggle default is 40px (h-10) — the payment method controls
    // opt into the taller 44px option buttons via optionClassName.
    expect(screen.getByRole("radio", { name: "Cash" }).className).toContain("h-11");
    expect(screen.getByRole("radio", { name: "UPI" }).className).toContain("h-11");
    expect(screen.getByRole("radio", { name: "Bank transfer" }).className).toContain("h-11");
  });

  it("DeskCollectPayment: an unselected method group is keyboard-selectable with the radio-group arrow pattern (P2, third review)", () => {
    render(<DeskCollectPayment {...collectProps} />);
    const group = screen.getByRole("radiogroup");
    const submit = screen.getByTestId("desk-collect-payment-submit");
    expect(submit).toBeDisabled();

    // No method is selected yet — any arrow key selects the FIRST option
    // (ARIA radio-group behavior for an unchecked group). Would fail if the
    // empty-selection state were not keyboard-selectable.
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Cash" })).toHaveAttribute("aria-checked", "true");
    expect(submit).not.toBeDisabled();

    // And a second arrow advances the selection as usual.
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "UPI" })).toHaveAttribute("aria-checked", "true");
  });

  it("DeskAddCharge: submit is disabled when busy, independent of its own submitting state", () => {
    render(<DeskAddCharge busy onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("desk-add-charge-submit")).toBeDisabled();
  });

  it("DeskAddCharge: submit is enabled when not busy", () => {
    render(<DeskAddCharge onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("desk-add-charge-submit")).not.toBeDisabled();
  });
});

// ── 11. Spot review & dirty close protection (2026-08-12 plan) ──────────────

describe("desk page — spot review & dirty close protection (2026-08-12 plan)", () => {
  /** Opens the spot panel and types a name — enough to make the form dirty. */
  async function fillDirtyForm(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByTestId("desk-open-spot"));
    await user.type(screen.getByLabelText("Full name *"), "Ravi Kumar");
  }

  it("header Close on a dirty form asks for discard; cancelling keeps the panel and form mounted", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    renderDeskApp();

    await fillDirtyForm(user);
    await user.click(screen.getByTestId("desk-spot-close"));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("desk-spot-panel")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name *")).toHaveValue("Ravi Kumar");
  });

  it("confirming the discard closes the dirty form", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    renderDeskApp();

    await fillDirtyForm(user);
    await user.click(screen.getByTestId("desk-spot-close"));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("desk-spot-panel")).not.toBeInTheDocument();
  });

  it("Escape on a dirty form asks for discard, and cancelling preserves the form", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    renderDeskApp();

    await fillDirtyForm(user);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("desk-spot-panel")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name *")).toHaveValue("Ravi Kumar");
  });

  it("backdrop click on a dirty form asks for discard, and cancelling preserves the form", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    renderDeskApp();

    await fillDirtyForm(user);
    fireEvent.click(screen.getByTestId("slide-over-backdrop"));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("desk-spot-panel")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name *")).toHaveValue("Ravi Kumar");
  });

  it("a clean form closes immediately without asking", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    renderDeskApp();

    await user.click(await screen.findByTestId("desk-open-spot"));
    await user.click(screen.getByTestId("desk-spot-close"));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("desk-spot-panel")).not.toBeInTheDocument();
  });

  it("Escape on a clean form closes immediately without asking", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    renderDeskApp();

    await user.click(await screen.findByTestId("desk-open-spot"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("desk-spot-panel")).not.toBeInTheDocument();
  });

  it("backdrop click on a clean form closes immediately without asking", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    renderDeskApp();

    await user.click(await screen.findByTestId("desk-open-spot"));
    fireEvent.click(screen.getByTestId("slide-over-backdrop"));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("desk-spot-panel")).not.toBeInTheDocument();
  });

  it("the post-create receipt closes immediately without asking", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    vi.mocked(deskCreateSpotRegistration).mockResolvedValue(SPOT_CREATED);
    renderDeskApp();

    await user.click(await screen.findByTestId("desk-open-spot"));
    await user.type(screen.getByLabelText("Full name *"), "Ravi Kumar");
    await user.type(screen.getByLabelText("WhatsApp *"), "+919876543210");
    await user.selectOptions(screen.getByLabelText("Branch *"), "Computer Science & Engineering");
    await user.type(screen.getByLabelText("Email *"), "ravi.kumar@example.com");
    const file = new File(["photo-bytes"], "ravi.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByTestId("upload-spot-photo-input"), file);
    await waitFor(() => expect(screen.getByTestId("desk-spot-review")).not.toBeDisabled());
    await user.click(screen.getByTestId("desk-spot-review"));
    await user.click(await screen.findByTestId("desk-spot-create"));
    expect(await screen.findByTestId("desk-payment-review")).toBeInTheDocument();

    await user.click(screen.getByTestId("desk-spot-close"));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("desk-spot-panel")).not.toBeInTheDocument();
  });

  it("every close path is blocked while the final create POST is in flight (P1 race)", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    let resolveCreate: ((value: typeof SPOT_CREATED) => void) | undefined;
    vi.mocked(deskCreateSpotRegistration).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    renderDeskApp();

    await user.click(await screen.findByTestId("desk-open-spot"));
    await user.type(screen.getByLabelText("Full name *"), "Ravi Kumar");
    await user.type(screen.getByLabelText("WhatsApp *"), "+919876543210");
    await user.selectOptions(screen.getByLabelText("Branch *"), "Computer Science & Engineering");
    await user.type(screen.getByLabelText("Email *"), "ravi.kumar@example.com");
    const file = new File(["photo-bytes"], "ravi.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByTestId("upload-spot-photo-input"), file);
    await waitFor(() => expect(screen.getByTestId("desk-spot-review")).not.toBeDisabled());
    await user.click(screen.getByTestId("desk-spot-review"));
    await user.click(await screen.findByTestId("desk-spot-create"));
    await waitFor(() => expect(deskCreateSpotRegistration).toHaveBeenCalled());

    // Header Close is disabled, and Escape/backdrop are no-ops — discarding
    // mid-flight would lose the receipt for a registration the server already
    // created. No discard confirm is asked.
    expect(screen.getByTestId("desk-spot-close")).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("slide-over-backdrop"));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("desk-spot-panel")).toBeInTheDocument();

    // The POST resolves → the receipt appears inside the still-open panel.
    await act(async () => {
      resolveCreate?.(SPOT_CREATED);
    });
    expect(await screen.findByTestId("desk-payment-review")).toBeInTheDocument();
    // Close is usable again now that nothing is in flight.
    expect(screen.getByTestId("desk-spot-close")).not.toBeDisabled();
  });

  it("a failed create re-enables the close paths and keeps the review mounted for retry", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    vi.mocked(deskCreateSpotRegistration).mockRejectedValue(
      new ApiError(409, "A registration with this WhatsApp number already exists"),
    );
    renderDeskApp();

    await user.click(await screen.findByTestId("desk-open-spot"));
    await user.type(screen.getByLabelText("Full name *"), "Ravi Kumar");
    await user.type(screen.getByLabelText("WhatsApp *"), "+919876543210");
    await user.selectOptions(screen.getByLabelText("Branch *"), "Computer Science & Engineering");
    await user.type(screen.getByLabelText("Email *"), "ravi.kumar@example.com");
    const file = new File(["photo-bytes"], "ravi.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByTestId("upload-spot-photo-input"), file);
    await waitFor(() => expect(screen.getByTestId("desk-spot-review")).not.toBeDisabled());
    await user.click(screen.getByTestId("desk-spot-review"));
    await user.click(await screen.findByTestId("desk-spot-create"));

    // Error surfaces on the review; the close path is usable again.
    expect(await screen.findByTestId("desk-spot-error")).toHaveTextContent(
      /A registration with this WhatsApp number already exists/i,
    );
    expect(screen.getByTestId("desk-spot-close")).not.toBeDisabled();
    expect(screen.getByTestId("desk-spot-review-panel")).toBeInTheDocument();
  });

  it("the post-create receipt shows the SERVER amount — not the client preview — and Payment due / Not checked in as separate facts", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    // The server prices this registration DIFFERENTLY from the client preview
    // (₹8,700 vs the preview's ₹8,500) — the receipt must show the server
    // amount and never the preview (plan "Client pricing preview").
    vi.mocked(deskCreateSpotRegistration).mockResolvedValue({
      registration: {
        id: 2001,
        regCode: "SMRT77ABC123XYZ4",
        participationType: "full_celebration",
        payment: { state: "payment_pending", amountDue: 8700 },
        checkIn: { present: false, checkedInAt: null },
        passUrl: "/pass#SMRT77ABC123XYZ4",
      },
    });
    renderDeskApp();

    await user.click(await screen.findByTestId("desk-open-spot"));
    await user.type(screen.getByLabelText("Full name *"), "Ravi Kumar");
    await user.type(screen.getByLabelText("WhatsApp *"), "+919876543210");
    await user.selectOptions(screen.getByLabelText("Branch *"), "Computer Science & Engineering");
    await user.type(screen.getByLabelText("Email *"), "ravi.kumar@example.com");
    const file = new File(["photo-bytes"], "ravi.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByTestId("upload-spot-photo-input"), file);
    await waitFor(() => expect(screen.getByTestId("desk-spot-review")).not.toBeDisabled());
    await user.click(screen.getByTestId("desk-spot-review"));

    // The pre-create review shows the client-side PREVIEW (₹8,500) with the
    // informational copy.
    expect(await screen.findByTestId("desk-spot-review-panel")).toHaveTextContent("₹8,500");
    expect(screen.getByText(/Informational only\. The final amount is calculated by the server after creation\./)).toBeInTheDocument();

    await user.click(screen.getByTestId("desk-spot-create"));

    // The receipt is the AUTHORITATIVE amount — the server's response (₹8,700),
    // NOT the preview's ₹8,500 (would fail if the receipt rendered the client
    // preview total).
    const receipt = await screen.findByTestId("desk-payment-review");
    expect(receipt).toHaveTextContent("Registration created");
    expect(receipt).toHaveTextContent("Payment due");
    expect(receipt).toHaveTextContent("₹8,700");
    expect(receipt).not.toHaveTextContent("₹8,500");
    expect(receipt).toHaveTextContent("Not checked in");
    // The preview's informational copy lives on the pre-create review, not here.
    expect(receipt).not.toHaveTextContent("Estimated total (preview)");
  });

  it("one visible Close control on the spot panel across form AND review (the form-card Close is removed)", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    renderDeskApp();

    await user.click(await screen.findByTestId("desk-open-spot"));
    expect(screen.getAllByRole("button", { name: /close/i })).toHaveLength(1);

    await user.type(screen.getByLabelText("Full name *"), "Ravi Kumar");
    await user.type(screen.getByLabelText("WhatsApp *"), "+919876543210");
    await user.selectOptions(screen.getByLabelText("Branch *"), "Computer Science & Engineering");
    await user.type(screen.getByLabelText("Email *"), "ravi@example.com");
    await user.upload(
      screen.getByTestId("upload-spot-photo-input"),
      new File(["photo-bytes"], "ravi.jpg", { type: "image/jpeg" }),
    );
    await waitFor(() => expect(screen.getByTestId("desk-spot-review")).not.toBeDisabled());
    await user.click(screen.getByTestId("desk-spot-review"));
    expect(await screen.findByTestId("desk-spot-review-panel")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /close/i })).toHaveLength(1);
  });

  it("the review-stage dialog is announced as 'Review registration', matching the visible heading (P2, latest review)", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    renderDeskApp();

    // Form stage: announced as "New spot registration".
    await user.click(await screen.findByTestId("desk-open-spot"));
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "New spot registration");

    await user.type(screen.getByLabelText("Full name *"), "Ravi Kumar");
    await user.type(screen.getByLabelText("WhatsApp *"), "+919876543210");
    await user.selectOptions(screen.getByLabelText("Branch *"), "Computer Science & Engineering");
    await user.type(screen.getByLabelText("Email *"), "ravi@example.com");
    await user.upload(
      screen.getByTestId("upload-spot-photo-input"),
      new File(["photo-bytes"], "ravi.jpg", { type: "image/jpeg" }),
    );
    await waitFor(() => expect(screen.getByTestId("desk-spot-review")).not.toBeDisabled());
    await user.click(screen.getByTestId("desk-spot-review"));

    // Review stage: announced as "Review registration" — matches the heading.
    expect(await screen.findByTestId("desk-spot-review-panel")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Review registration");
  });
});

// ── 12. Payment hierarchy & collection safeguards (2026-08-12 plan) ─────────

describe("desk page — payment hierarchy & collection safeguards (2026-08-12 plan)", () => {
  it("a pending attendee sees the prominent PAYMENT DUE block with the exact amount and the full-payment CTA", async () => {
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    const block = await screen.findByTestId("desk-pending-warning");
    expect(block).toHaveTextContent("Payment due");
    expect(block).toHaveTextContent("₹2,500");
    expect(block).toHaveTextContent("Full balance must be collected before attendance");

    const cta = screen.getByTestId("desk-collect-payment-open");
    expect(cta).toHaveTextContent("Collect full payment · ₹2,500");
    expect(screen.queryByTestId("desk-mark-present")).not.toBeInTheDocument();
  });

  it("the collection form repeats attendee identity and the read-only amount, has no amount input, and requires an explicit method", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-collect-payment-open"));
    const form = await screen.findByTestId("desk-collect-payment-form");
    // Identity + read-only full amount repeated at the point of commitment.
    expect(form).toHaveTextContent("Ravi Kumar");
    expect(form).toHaveTextContent("SMRT-79WW-4A25-NWG1");
    expect(form).toHaveTextContent("₹2,500");
    expect(form).toHaveTextContent("Full settlement");
    // No amount input — the server settles the full outstanding balance.
    expect(form.querySelector("input[type='number']")).toBeNull();

    // Method must be explicitly selected before submit enables.
    const submit = screen.getByTestId("desk-collect-payment-submit");
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "UPI" }));
    expect(submit).not.toBeDisabled();
    expect(screen.getByTestId("desk-collect-payment-submit")).toHaveTextContent("Record full payment · ₹2,500");
  });
});

// ── 13. Immediate add-charge result (2026-08-12 plan) ───────────────────────

describe("desk page — immediate add-charge result (2026-08-12 plan)", () => {
  it("a successful charge shows the reason, charge amount, and authoritative updated total while keeping the attendee Present", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const presentOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: presentOverview });
    const chargedOverview: DeskAttendeeOverview = {
      ...presentOverview,
      payment: { state: "payment_pending", amountDue: 800 },
    };
    vi.mocked(deskAddCharge).mockResolvedValue({ attendee: chargedOverview });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-add-charge-open"));
    await user.type(screen.getByLabelText("Reason *"), "Extra t-shirt XL");
    await user.type(screen.getByLabelText("Amount ₹ *"), "300");
    await user.click(screen.getByTestId("desk-add-charge-submit"));
    await waitFor(() =>
      expect(deskAddCharge).toHaveBeenCalledWith(1001, { description: "Extra t-shirt XL", amount: 300 }),
    );

    // Immediate feedback: reason, entered amount, authoritative new total.
    const result = await screen.findByTestId("desk-charge-result");
    expect(result).toHaveTextContent("Charge added");
    expect(result).toHaveTextContent("Extra t-shirt XL");
    expect(result).toHaveTextContent("₹300 added");
    expect(result).toHaveTextContent("₹800"); // updatedTotalDue from the fresh overview

    // Present is preserved — a charge never undoes check-in (plan "Add charge").
    expect(screen.getByTestId("desk-present-state")).toHaveTextContent("Present");
    expect(screen.getByTestId("desk-mark-absent")).toBeInTheDocument();
    // No historical charge rows — only the immediate result (plan Add-charge result).
    expect(result).not.toHaveTextContent(/history|paid on|ledger/i);
  });

  it("collecting the new balance after a charge clears the stale total result", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const presentOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      checkIn: { present: true, checkedInAt: 1_780_000_000_000 },
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: presentOverview });
    const chargedOverview: DeskAttendeeOverview = {
      ...presentOverview,
      payment: { state: "payment_pending", amountDue: 300 },
    };
    vi.mocked(deskAddCharge).mockResolvedValue({ attendee: chargedOverview });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await user.click(await screen.findByTestId("desk-add-charge-open"));
    await user.type(screen.getByLabelText("Reason *"), "Extra t-shirt XL");
    await user.type(screen.getByLabelText("Amount ₹ *"), "300");
    await user.click(screen.getByTestId("desk-add-charge-submit"));
    expect(await screen.findByTestId("desk-charge-result")).toBeInTheDocument();

    vi.mocked(deskCollectPayment).mockResolvedValue({
      attendee: { ...CONFIRMED_OVERVIEW, checkIn: { present: true, checkedInAt: 1_780_000_000_000 } },
    });
    await user.click(screen.getByTestId("desk-collect-payment-open"));
    await user.click(screen.getByRole("radio", { name: "Cash" }));
    await user.click(screen.getByTestId("desk-collect-payment-submit"));
    await waitFor(() => expect(deskCollectPayment).toHaveBeenCalled());

    // The result is gone — "New total due ₹300" would be stale once settled.
    expect(screen.queryByTestId("desk-charge-result")).not.toBeInTheDocument();
  });
});

// ── 14. Photo first paint & enhancement (2026-08-12 plan) ───────────────────

describe("desk page — photo first paint & enhancement (2026-08-12 plan)", () => {
  it("requests the 200px thumbnail first, then the responsive desktop (960) variant, revoking the thumbnail on replacement", async () => {
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    // First paint: the authenticated 200px thumbnail (plan step 1).
    await screen.findByAltText("Photo of Ravi Kumar");
    expect(deskPhoto).toHaveBeenNthCalledWith(1, 1001, 200);
    // Then the desktop variant (jsdom default matchMedia: matches=false → 960).
    await waitFor(() => expect(deskPhoto).toHaveBeenNthCalledWith(2, 1001, 960));
    // The thumbnail object URL was revoked when the larger variant replaced it.
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("requests the 560px mobile variant when max-width: 767px matches", async () => {
    setUser("staff", ["registration_desk"]);
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await screen.findByAltText("Photo of Ravi Kumar");
    expect(deskPhoto).toHaveBeenNthCalledWith(1, 1001, 200);
    await waitFor(() => expect(deskPhoto).toHaveBeenNthCalledWith(2, 1001, 560));
  });

  it("a failed larger request leaves the already-rendered thumbnail in place (plan Enhancement failure)", async () => {
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    vi.mocked(deskPhoto)
      .mockResolvedValueOnce({ url: "blob:thumb", contentType: "image/jpeg" })
      .mockRejectedValueOnce(new Error("enhancement failed"));
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    const img = await screen.findByAltText("Photo of Ravi Kumar");
    await waitFor(() => expect(deskPhoto).toHaveBeenNthCalledWith(2, 1001, 960));
    // The larger request failed — the thumbnail URL stays, never a placeholder.
    expect(img).toHaveAttribute("src", "blob:thumb");
  });

  it("clears the previous attendee's photo before the next attendee can render (P1 privacy race)", async () => {
    // A (Ravi, id 1001) has a photo that resolves immediately. B (Maya) is a
    // DIFFERENT registration whose lookup we hold, and whose photo fetch we
    // ALSO hold — so between B rendering and B's photo arriving, the only
    // photo that could show is A's (the leak) or the placeholder (the fix).
    const bOverview: DeskAttendeeOverview = {
      ...OVERVIEW,
      id: 2002,
      fullName: "Maya Nair",
      regCode: "SMRT77ZZZ2222222",
      photo: { available: true, url: "/api/staff/desk/registrations/2002/photo" },
    };
    let resolveBLookup: ((value: { attendee: DeskAttendeeOverview }) => void) | undefined;
    vi.mocked(deskLookup).mockImplementation((code: string) => {
      if (code === OVERVIEW.regCode) return Promise.resolve({ attendee: OVERVIEW });
      return new Promise((resolve) => {
        resolveBLookup = resolve;
      });
    });
    let resolveBPhoto: ((value: { url: string; contentType: string }) => void) | undefined;
    vi.mocked(deskPhoto).mockImplementation((id: number, size?: 200 | 560 | 960) => {
      if (id === OVERVIEW.id) {
        return Promise.resolve({
          url: size === 200 ? "blob:ravi-200" : "blob:ravi-960",
          contentType: "image/jpeg",
        });
      }
      return new Promise((resolve) => {
        resolveBPhoto = resolve;
      });
    });

    // Capture a navigate so we can change the :regCode param IN PLACE — the
    // detail page stays mounted, exactly the case where the race occurs.
    let navigateTo: ((code: string) => void) | undefined;
    function NavProbe() {
      const navigate = useNavigate();
      navigateTo = (code: string) => navigate(`/reg/${code}`);
      return null;
    }
    render(
      <MemoryRouter initialEntries={["/reg/SMRT79WW4A25NWG1"]}>
        <Routes>
          <Route
            path="/reg/:regCode"
            element={
              <>
                <RegistrationDeskDetailPage />
                <NavProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    // A's photo is rendered first — the 960 enhancement replaces the 200.
    const raviImg = await screen.findByAltText("Photo of Ravi Kumar");
    await waitFor(() => expect(raviImg).toHaveAttribute("src", "blob:ravi-960"));

    // Navigate in place to B. The lookup effect must revoke + clear A's photo
    // BEFORE B can render — otherwise B briefly shows A's private photo.
    await act(async () => {
      navigateTo?.(bOverview.regCode);
    });

    // B's lookup resolves; B's photo fetch stays in flight.
    await act(async () => {
      resolveBLookup?.({ attendee: bOverview });
    });

    // B is on screen now. The placeholder shows — never A's image — and A's
    // displayed object URL (the enhanced 960 variant) was revoked. Would fail
    // without the lookup-effect clear.
    expect(await screen.findByRole("heading", { name: "Maya Nair" })).toBeInTheDocument();
    expect(screen.queryByAltText("Photo of Ravi Kumar")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:ravi-960");

    // Release B's photo — B's own photo replaces the placeholder.
    await act(async () => {
      resolveBPhoto?.({ url: "blob:maya", contentType: "image/jpeg" });
    });
    await waitFor(() =>
      expect(screen.getByAltText("Photo of Maya Nair")).toHaveAttribute("src", "blob:maya"),
    );
  });

  it("A's LATE photo response never appears for B (regression: B lookup fast, B photo held, A's 960 resolves last)", async () => {
    // B's lookup resolves quickly, B's photo is held, and A's 960 response is
    // STILL IN FLIGHT when the route changes — it resolves only after B is on
    // screen. A's image must never repopulate B's photo state.
    const bOverview: DeskAttendeeOverview = {
      ...OVERVIEW,
      id: 2002,
      fullName: "Maya Nair",
      regCode: "SMRT77ZZZ2222222",
      photo: { available: true, url: "/api/staff/desk/registrations/2002/photo" },
    };
    let resolveA960: ((value: { url: string; contentType: string }) => void) | undefined;
    let resolveBPhoto: ((value: { url: string; contentType: string }) => void) | undefined;
    vi.mocked(deskLookup).mockImplementation((code: string) =>
      Promise.resolve({ attendee: code === OVERVIEW.regCode ? OVERVIEW : bOverview }),
    );
    vi.mocked(deskPhoto).mockImplementation((id: number, size?: 200 | 560 | 960) => {
      if (id === OVERVIEW.id) {
        // A's 200px thumbnail paints first; A's 960 is held (still in flight
        // when the route changes to B).
        return size === 200
          ? Promise.resolve({ url: "blob:ravi-200", contentType: "image/jpeg" })
          : new Promise((resolve) => {
              resolveA960 = resolve;
            });
      }
      return new Promise((resolve) => {
        resolveBPhoto = resolve;
      });
    });

    const navigateTo = renderDetailWithNav(OVERVIEW.regCode);

    // A's 200px thumbnail is the first paint; the 960 upgrade is in flight.
    const raviImg = await screen.findByAltText("Photo of Ravi Kumar");
    expect(raviImg).toHaveAttribute("src", "blob:ravi-200");

    // In-place route change to B — B's lookup resolves immediately, B renders
    // with the placeholder (B's own photo is held).
    await act(async () => {
      navigateTo(bOverview.regCode);
    });
    expect(await screen.findByRole("heading", { name: "Maya Nair" })).toBeInTheDocument();
    expect(screen.queryByAltText("Photo of Ravi Kumar")).not.toBeInTheDocument();

    // A's LATE 960 response resolves now — it must be discarded and its object
    // URL revoked, never displayed under B (P1, third review).
    await act(async () => {
      resolveA960?.({ url: "blob:ravi-960", contentType: "image/jpeg" });
    });
    expect(screen.queryByAltText("Photo of Ravi Kumar")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Photo of Maya Nair" })).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:ravi-960");

    // B's own photo then resolves and replaces the placeholder.
    await act(async () => {
      resolveBPhoto?.({ url: "blob:maya", contentType: "image/jpeg" });
    });
    await waitFor(() =>
      expect(screen.getByAltText("Photo of Maya Nair")).toHaveAttribute("src", "blob:maya"),
    );
  });
});

// ── 15. Stale mutation responses (P1, third review) ─────────────────────────

describe("desk page — stale mutation responses for a previous attendee (P1, third review)", () => {
  it("a late add-charge response for attendee A never updates attendee B's state", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    // A is pending; B is settled (confirmed, no balance).
    const bOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      id: 2002,
      fullName: "Maya Nair",
      regCode: "SMRT77ZZZ2222222",
    };
    vi.mocked(deskLookup).mockImplementation((code: string) =>
      Promise.resolve({ attendee: code === OVERVIEW.regCode ? OVERVIEW : bOverview }),
    );
    let resolveACharge: ((value: { attendee: DeskAttendeeOverview }) => void) | undefined;
    vi.mocked(deskAddCharge).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveACharge = resolve;
        }),
    );

    const navigateTo = renderDetailWithNav(OVERVIEW.regCode);

    // A's add-charge form opens and submits; the POST stays in flight.
    await user.click(await screen.findByTestId("desk-add-charge-open"));
    await user.type(screen.getByLabelText("Reason *"), "Extra t-shirt XL");
    await user.type(screen.getByLabelText("Amount ₹ *"), "300");
    await user.click(screen.getByTestId("desk-add-charge-submit"));
    await waitFor(() => expect(deskAddCharge).toHaveBeenCalled());

    // In-place route change to B — B resolves immediately and renders settled.
    await act(async () => {
      navigateTo(bOverview.regCode);
    });
    expect(await screen.findByRole("heading", { name: "Maya Nair" })).toBeInTheDocument();
    expect(screen.queryByTestId("desk-charge-result")).not.toBeInTheDocument();

    // A's charge response arrives LATE — it must be discarded entirely.
    await act(async () => {
      resolveACharge?.({
        attendee: { ...OVERVIEW, payment: { state: "payment_pending", amountDue: 800 } },
      });
    });

    // B is untouched: no charge result, no pending balance, Confirm attendance
    // still shown. Would fail if the stale response were applied to B.
    expect(screen.queryByTestId("desk-charge-result")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desk-pending-warning")).not.toBeInTheDocument();
    expect(screen.queryByTestId("desk-collect-payment-open")).not.toBeInTheDocument();
    expect(screen.getByTestId("desk-mark-present")).toBeInTheDocument();
  });

  it("a late mark-present ERROR for attendee A never surfaces under attendee B", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const aOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      fullName: "Ravi Kumar",
    };
    const bOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      id: 2002,
      fullName: "Maya Nair",
      regCode: "SMRT77ZZZ2222222",
    };
    vi.mocked(deskLookup).mockImplementation((code: string) =>
      Promise.resolve({ attendee: code === OVERVIEW.regCode ? aOverview : bOverview }),
    );
    let rejectAPresent: ((err: unknown) => void) | undefined;
    vi.mocked(deskMarkPresent).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectAPresent = reject;
        }),
    );

    const navigateTo = renderDetailWithNav(OVERVIEW.regCode);

    // A's Confirm attendance fires; the POST stays in flight.
    await user.click(await screen.findByTestId("desk-mark-present"));
    await waitFor(() => expect(deskMarkPresent).toHaveBeenCalled());

    // In-place route change to B.
    await act(async () => {
      navigateTo(bOverview.regCode);
    });
    await screen.findByRole("heading", { name: "Maya Nair" });

    // A's mark-present FAILS late — the error must not appear under B.
    await act(async () => {
      rejectAPresent?.(new ApiError(500, "Could not confirm arrival. Please try again."));
    });
    expect(screen.queryByText(/Could not confirm arrival/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("desk-mark-present")).toBeInTheDocument();
  });

  it("a response from the FIRST A generation is ignored after returning to A with a newer generation (A → B → A)", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    const bOverview: DeskAttendeeOverview = {
      ...CONFIRMED_OVERVIEW,
      id: 2002,
      fullName: "Maya Nair",
      regCode: "SMRT77ZZZ2222222",
    };
    vi.mocked(deskLookup).mockImplementation((code: string) =>
      Promise.resolve({ attendee: code === OVERVIEW.regCode ? OVERVIEW : bOverview }),
    );
    let resolveFirstACharge: ((value: { attendee: DeskAttendeeOverview }) => void) | undefined;
    vi.mocked(deskAddCharge).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirstACharge = resolve;
        }),
    );

    const navigateTo = renderDetailWithNav(OVERVIEW.regCode);

    // On A (generation 1): the add-charge form submits; the POST stays in
    // flight for the WHOLE A → B → A journey.
    await user.click(await screen.findByTestId("desk-add-charge-open"));
    await user.type(screen.getByLabelText("Reason *"), "Extra t-shirt XL");
    await user.type(screen.getByLabelText("Amount ₹ *"), "300");
    await user.click(screen.getByTestId("desk-add-charge-submit"));
    await waitFor(() => expect(deskAddCharge).toHaveBeenCalled());

    // A → B (generation 2).
    await act(async () => {
      navigateTo(bOverview.regCode);
    });
    await screen.findByRole("heading", { name: "Maya Nair" });

    // B → A again (generation 3 — a FRESH A lookup).
    await act(async () => {
      navigateTo(OVERVIEW.regCode);
    });
    await screen.findByRole("heading", { name: "Ravi Kumar" });
    expect(screen.getByTestId("desk-pending-warning")).toHaveTextContent("₹2,500");

    // The FIRST A generation's charge response resolves late — it must be
    // ignored entirely: no charge result, and A's balance stays ₹2,500.
    await act(async () => {
      resolveFirstACharge?.({
        attendee: { ...OVERVIEW, payment: { state: "payment_pending", amountDue: 800 } },
      });
    });
    expect(screen.queryByTestId("desk-charge-result")).not.toBeInTheDocument();
    expect(screen.getByTestId("desk-pending-warning")).toHaveTextContent("₹2,500");
  });

  it("never renders a loaded attendee whose regCode does not match the current route (P1 render guard)", async () => {
    setUser("staff", ["registration_desk"]);
    // The lookup returns a record for a DIFFERENT code than the route param
    // (a server inconsistency the guard must fail closed on).
    const mismatched: DeskAttendeeOverview = {
      ...OVERVIEW,
      regCode: "SMRT999999999999",
    };
    vi.mocked(deskLookup).mockResolvedValue({ attendee: mismatched });
    renderDeskApp("/staff/check-in/registration/SMRT79WW4A25NWG1");

    await waitFor(() => expect(deskLookup).toHaveBeenCalled());
    // The ledger (and any photo) must not render under the wrong route param.
    expect(screen.queryByTestId("desk-detail")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ravi Kumar" })).not.toBeInTheDocument();
  });

  it("renders the attendee detail for a direct lowercase/hyphenated code URL (render guard normalizes, latest review)", async () => {
    setUser("staff", ["registration_desk"]);
    vi.mocked(deskLookup).mockResolvedValue({ attendee: OVERVIEW });
    // The server lookup boundary accepts lowercase/hyphenated codes (it
    // normalizes them server-side); the client passes the route code through
    // unchanged. The attendee comes back with the CANONICAL code.
    renderDeskApp("/staff/check-in/registration/smrt-79ww-4a25-nwg1");

    await waitFor(() => expect(deskLookup).toHaveBeenCalledWith("smrt-79ww-4a25-nwg1"));
    // The render guard compares NORMALIZED codes — otherwise this direct URL
    // would look up successfully and then render blank (fail-closed mismatch).
    expect(await screen.findByRole("heading", { name: "Ravi Kumar" })).toBeInTheDocument();
    expect(screen.getByTestId("desk-detail")).toBeInTheDocument();
  });

  it("retries the lookup after spot-create until the finalized photo appears, then renders it (P1 waitForPhoto)", async () => {
    const user = userEvent.setup();
    setUser("staff", ["registration_desk"]);
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    vi.mocked(deskCreateSpotRegistration).mockResolvedValue(SPOT_CREATED);
    // First lookup (right after Continue): the fresh attendee with NO photo —
    // relocateFiles finalizes it off the create response path. Second lookup:
    // the thumbnail now exists.
    const noPhoto: DeskAttendeeOverview = {
      ...OVERVIEW,
      id: 2001,
      regCode: "SMRT77ABC123XYZ4",
      photo: { available: false, url: null },
    };
    const withPhoto: DeskAttendeeOverview = {
      ...noPhoto,
      photo: { available: true, url: "/api/staff/desk/registrations/2001/photo" },
    };
    vi.mocked(deskLookup)
      .mockResolvedValueOnce({ attendee: noPhoto })
      .mockResolvedValueOnce({ attendee: withPhoto });

    renderDeskApp();

    // Spot-create → receipt.
    await user.click(await screen.findByTestId("desk-open-spot"));
    await user.type(screen.getByLabelText("Full name *"), "Ravi Kumar");
    await user.type(screen.getByLabelText("WhatsApp *"), "+919876543210");
    await user.selectOptions(screen.getByLabelText("Branch *"), "Computer Science & Engineering");
    await user.type(screen.getByLabelText("Email *"), "ravi.kumar@example.com");
    const file = new File(["photo-bytes"], "ravi.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByTestId("upload-spot-photo-input"), file);
    await waitFor(() => expect(screen.getByTestId("desk-spot-review")).not.toBeDisabled());
    await user.click(screen.getByTestId("desk-spot-review"));
    await user.click(await screen.findByTestId("desk-spot-create"));
    expect(await screen.findByTestId("desk-payment-review")).toBeInTheDocument();

    // Continue navigates with the one-shot waitForPhoto hint. The first lookup
    // returns no photo → the bounded retry fires → the second lookup returns
    // the photo → the attendee renders and the photo loads.
    await user.click(screen.getByTestId("desk-payment-continue"));

    await waitFor(() => expect(deskLookup).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(await screen.findByRole("heading", { name: "Ravi Kumar" })).toBeInTheDocument();
    await waitFor(() => expect(deskPhoto).toHaveBeenCalledWith(2001, 200));
    expect(await screen.findByAltText("Photo of Ravi Kumar")).toBeInTheDocument();
  });
});
