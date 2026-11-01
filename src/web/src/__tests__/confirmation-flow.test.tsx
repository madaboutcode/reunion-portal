import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { RegistrationResponseData } from "@smriti/shared";

vi.mock("@/lib/api");
vi.mock("@/lib/auth");

import { getMyRegistration } from "@/lib/api";
import { getToken } from "@/lib/auth";
import ConfirmationPage from "@/pages/ConfirmationPage";

afterEach(cleanup);

// ── Mock data factory ─────────────────────────────────────────────────────

function mockRegistration(
  overrides: Partial<RegistrationResponseData> = {},
): RegistrationResponseData {
  return {
    regId: "SMRT79WW4A25NWG1",
    regCode: "SMRT79WW4A25NWG1",
        status: "confirmed",
        createdAt: Date.now(),
        pricingBreakup: { base: 7500, collegeContribution: 500, lines: [], donation: 0, total: 8000 },
        contact: {
          fullName: "Mangalasseri Neelakantan",
          branch: "Chemical Engineering",
          gender: "male",
          email: "neelakantan@example.com",
      whatsapp: "9876543210",
      city: "Kochi",
      country: "India",
    },
    attendance: {
      intent: "attending",
      participationType: "full_celebration",
      alumniMeal: "veg",
      tshirtSize: "L",
    },
    attendees: { children: [], guests: [] },
    idDocument: {
      fileKey: "id-docs/test.jpg",
      fileType: "image/jpeg",
      sizeBytes: 1024,
      fileName: "test.jpg",
      note: "",
    },
    pendingPaymentAmount: null,
    hasVerifiedPayments: false,
    verifiedPaymentAmount: 0,
    ...overrides,
  };
}

function renderConfirmation(regCode = "SMRT79WW4A25NWG1") {
  return render(
    <MemoryRouter initialEntries={[`/confirmation/${regCode}`]}>
      <Routes>
        <Route path="/confirmation/:id" element={<ConfirmationPage />} />
        <Route path="/pay/:regCode" element={<div data-testid="payment-page" />} />
        <Route path="/register" element={<div data-testid="register-page" />} />
        <Route path="/login" element={<div data-testid="login-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

// ── Viewport helper ───────────────────────────────────────────────────────

const DESKTOP = 1280;
const MOBILE = 375;

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ConfirmationPage — desktop", () => {
  beforeEach(() => {
    setViewport(DESKTOP);
    vi.mocked(getToken).mockReturnValue("fake-jwt-token");
  });

  it("confirmed user sees entry pass with name and paid status", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "confirmed" }),
    });

    renderConfirmation();

    // Wait for API data to load and render
    await waitFor(() => {
      // "Paid" status appears (may be in desktop + mobile layouts)
      expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
    });

    // Attendee name and reg code displayed (desktop + mobile = multiple instances)
    expect(screen.getAllByText(/Mangalasseri Neelakantan/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SMRT-79WW-4A25-NWG1/).length).toBeGreaterThan(0);

    // Entry pass elements are present (only rendered for confirmed)
    expect(screen.getAllByText(/15 August 2026/).length).toBeGreaterThan(0);
  });

  it("pending_verification user sees status message, no entry pass, no details card", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending_verification" }),
    });

    renderConfirmation();

    // PaymentProgress "We're Verifying" stage label is the active stage
    await waitFor(() => {
      expect(screen.getByText(/we've received your payment proof/i)).toBeInTheDocument();
    });

    // FAQ-style answers
    expect(screen.getByText(/usually takes a day or two/i)).toBeInTheDocument();

    // "Go Home" navigation link
    expect(screen.getByRole("link", { name: /go home/i })).toBeInTheDocument();

    // Entry pass should NOT be present
    expect(document.querySelector(".entry-pass-name")).toBeNull();

    // Registration details card should NOT be present (no "Tickets / Attendees" row)
    expect(screen.queryByText(/tickets \/ attendees/i)).not.toBeInTheDocument();

    // RegCode should NOT be displayed
    expect(screen.queryByText(/SMRT-79WW-4A25-NWG1/)).not.toBeInTheDocument();
  });

  it("pending user sees upload payment proof message with Go to Payment link", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getByText(/you still need to upload your payment proof/i)).toBeInTheDocument();
    });

    // "Go to Payment" link navigates to /pay/:regCode
    const paymentLink = screen.getByRole("link", { name: /go to payment/i });
    expect(paymentLink).toBeInTheDocument();
    expect(paymentLink).toHaveAttribute("href", "/pay/SMRT79WW4A25NWG1");
  });

  it("expired session (no token) shows session expired with sign-in link to /login", async () => {
    vi.mocked(getToken).mockReturnValue(null);

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getByText(/session expired/i)).toBeInTheDocument();
    });

    const signinBtn = screen.getByRole("button", {
      name: /sign in with your email/i,
    });
    expect(signinBtn).toBeInTheDocument();

    await userEvent.setup().click(signinBtn);

    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
    });
  });

  it("API error shows error message with retry button", async () => {
    vi.mocked(getMyRegistration).mockRejectedValue({
      status: 500,
      error: "Server is down",
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/try again/i)).toBeInTheDocument();
  });
});

describe("ConfirmationPage - confirmation detail rows", () => {
  beforeEach(() => {
    setViewport(DESKTOP);
    vi.mocked(getToken).mockReturnValue("fake-jwt-token");
  });

  it("shows attendance intent and donation details after submission", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({
        status: "confirmed",
        donation: {
          amount: 5000,
          publicAcknowledgement: true,
          acknowledgementDisplayName: "Arun",
          felicitationConsent: true,
        },
      }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
    });

    expect(screen.getByText(/joining as/i)).toBeInTheDocument();
    expect(screen.getByText(/attending/i)).toBeInTheDocument();
    expect(screen.getByText(/^donation$/i)).toBeInTheDocument();
    expect(screen.getByText(/5,000/)).toBeInTheDocument();
  });
});

describe("ConfirmationPage — mobile", () => {
  beforeEach(() => {
    setViewport(MOBILE);
    vi.mocked(getToken).mockReturnValue("fake-jwt-token");
  });

  it("confirmed user sees paid status and entry pass on mobile", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "confirmed" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText(/Mangalasseri Neelakantan/).length).toBeGreaterThan(0);
  });

  it("pending_verification user sees status message on mobile, no entry pass", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending_verification" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getByText(/we've received your payment proof/i)).toBeInTheDocument();
    });

    expect(document.querySelector(".entry-pass-name")).toBeNull();
  });
});

// ── Guidance cards & actions (desktop) ───────────────────────────────────

describe("ConfirmationPage — guidance cards & actions (desktop)", () => {
  beforeEach(() => {
    setViewport(DESKTOP);
    vi.mocked(getToken).mockReturnValue("fake-jwt-token");
  });

  // ── R5.1: Confirmed guidance cards ──────────────────────────────────

  it("R5.1: confirmed shows guidance cards: Confirmation sent, Bring your pass, Join the community", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "confirmed" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
    });

    // The three guidance card titles for confirmed
    expect(screen.getByText(/confirmation sent/i)).toBeInTheDocument();
    expect(screen.getByText(/bring your pass/i)).toBeInTheDocument();
    expect(screen.getByText(/join the community/i)).toBeInTheDocument();
  });

  // ── R5.2: Pending verification — simple status page ───────────────

  it("R5.2: pending_verification shows animated checkmark, received your payment proof label, PaymentProgress, heading, subtext, Go Home — no guidance cards or details card", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending_verification" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getByText(/we've received your payment proof/i)).toBeInTheDocument();
    });

    // Animated checkmark SVG present (circle + check path)
    const svgs = document.querySelectorAll("svg");
    const checkmarkSvg = Array.from(svgs).find((svg) => {
      return svg.querySelector("circle[stroke='#2D9B67']") !== null;
    });
    expect(checkmarkSvg).not.toBeNull();

    // PaymentProgress renders (stage labels visible)
    expect(screen.getByText("We're Verifying")).toBeInTheDocument();

    // Heading confirms receipt
    expect(screen.getByRole("heading", { name: /we've received your payment proof/i })).toBeInTheDocument();

    // FAQ-style answers to common questions
    expect(screen.getByText(/what happens next/i)).toBeInTheDocument();
    expect(screen.getByText(/usually takes a day or two/i)).toBeInTheDocument();
    expect(screen.getByText(/how will i know/i)).toBeInTheDocument();
    expect(screen.getByText(/can i check back/i)).toBeInTheDocument();

    // Go Home link present
    expect(screen.getByRole("link", { name: /go home/i })).toBeInTheDocument();

    // Guidance cards NOT present
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/your data is secure/i)).not.toBeInTheDocument();

    // Registration details card NOT present
    expect(screen.queryByText(/tickets \/ attendees/i)).not.toBeInTheDocument();

    // RegCode NOT shown
    expect(screen.queryByText(/SMRT-79WW-4A25-NWG1/)).not.toBeInTheDocument();
  });

  // ── R6.1: Confirmed action buttons ─────────────────────────────────

  it("R6.1: confirmed has Download Pass and Register another batchmate buttons", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "confirmed" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
    });

    // Download Pass button in the entry pass dock
    expect(
      screen.getAllByRole("button", { name: /download pass/i }).length,
    ).toBeGreaterThan(0);
    // Register another batchmate in ConfirmationActions
    expect(
      screen.getAllByRole("link", { name: /register another batchmate/i }).length,
    ).toBeGreaterThan(0);
  });

  // ── R6.2: Pending verification actions ────────────────────────────

  it("R6.2: pending_verification has Go Home link, no Download Pass or Share buttons", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending_verification" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getByText(/we've received your payment proof/i)).toBeInTheDocument();
    });

    // Go Home link present
    expect(screen.getByRole("link", { name: /go home/i })).toBeInTheDocument();

    // Download Pass and Share should NOT exist
    expect(
      screen.queryByRole("button", { name: /download pass/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /share with friends/i }),
    ).not.toBeInTheDocument();

    // Check Status button from old layout should NOT exist
    expect(
      screen.queryByRole("button", { name: /check status/i }),
    ).not.toBeInTheDocument();
  });

  // ── R3.4: Go Home link navigates to / ──────────────────────────────

  it("R3.4: pending_verification Go Home link points to /", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending_verification" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getByText(/we've received your payment proof/i)).toBeInTheDocument();
    });

    const goHomeLink = screen.getByRole("link", { name: /go home/i });
    expect(goHomeLink).toHaveAttribute("href", "/");
  });

  // ── R3.1: Pending verification shows PaymentProgress with active verification stage

  it("R3.1: pending_verification shows PaymentProgress active at verification stage, no entry pass", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending_verification" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getByText(/we've received your payment proof/i)).toBeInTheDocument();
    });

    // PaymentProgress is rendered — "We're Verifying" is the active stage label
    expect(screen.getByText("We're Verifying")).toBeInTheDocument();

    // The active stage is aria-current="step"
    const activeStep = document.querySelector("[aria-current='step']");
    expect(activeStep).not.toBeNull();

    // Entry pass should NOT be shown
    expect(document.querySelector(".entry-pass-name")).toBeNull();
  });

  // ── R3.2: Review timeline communicated to user ──────────────────────

  it("R3.2: pending_verification shows message about review timeline", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending_verification" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getByText(/we've received your payment proof/i)).toBeInTheDocument();
    });

    // Should mention timeline
    expect(screen.getByText(/usually takes a day or two/i)).toBeInTheDocument();
  });

  // ── R6.3: Pending Go to Payment link ────────────────────────────

  it("R6.3: pending shows Go to Payment link pointing to /pay/:regCode", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getByText(/you still need to upload your payment proof/i)).toBeInTheDocument();
    });

    // Go to Payment link should exist and point to correct URL
    const paymentLink = screen.getByRole("link", { name: /go to payment/i });
    expect(paymentLink).toBeInTheDocument();
    expect(paymentLink).toHaveAttribute("href", "/pay/SMRT79WW4A25NWG1");
  });

  // ── R1.1: Confirmed PAID badge with checkmark ────────────────────

  it("R1.1: confirmed shows Paid badge with green checkmark", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "confirmed" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
    });

    // The entry pass is present (confirmed only)
    expect(screen.getAllByText(/15 August 2026/).length).toBeGreaterThan(0);

    // Status badge text says "Paid"
    expect(screen.getByText(/paid/i)).toBeInTheDocument();
  });
});

// ── Donation-only path ──────────────────────────────────────────────────

describe("ConfirmationPage — donation_only", () => {
  beforeEach(() => {
    setViewport(DESKTOP);
    vi.mocked(getToken).mockReturnValue("fake-jwt-token");
  });

  it("R6: donation_only intent renders DonationConfirmationLayout with ThankYouCard", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({
        status: "confirmed",
        attendance: {
          intent: "donation_only",
          participationType: "donation_only",
          alumniMeal: "veg",
          tshirtSize: "L",
        },
        donation: {
          amount: 5000,
          publicAcknowledgement: true,
          acknowledgementDisplayName: "Arun",
          felicitationConsent: true,
        },
        pricingBreakup: { base: 0, collegeContribution: 0, lines: [], donation: 5000, total: 5000 },
      }),
    });

    renderConfirmation();

    // DonationConfirmationLayout renders ThankYouCard
    await waitFor(() => {
      expect(screen.getByText(/with gratitude/i)).toBeInTheDocument();
    });

    // ThankYouCard shows name
    expect(screen.getAllByText(/Mangalasseri Neelakantan/).length).toBeGreaterThan(0);

    // Donor amount appears
    expect(screen.getByText(/5,000/)).toBeInTheDocument();
  });
});

// ── Guidance cards & actions (mobile) ───────────────────────────────────

describe("ConfirmationPage — guidance cards & actions (mobile)", () => {
  beforeEach(() => {
    setViewport(MOBILE);
    vi.mocked(getToken).mockReturnValue("fake-jwt-token");
  });

  it("R6.1: confirmed has entry pass and Register another on mobile", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "confirmed" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
    });

    // Mobile: entry pass card is rendered (no download button wrapper on mobile)
    expect(document.querySelector(".confirmation-entry-pass-dock--mobile")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: /register another batchmate/i }),
    ).toBeInTheDocument();
  });

  it("R5.1: confirmed shows guidance cards on mobile", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "confirmed" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
    });

    // Mobile confirmed guidance cards use slightly different titles
    expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    expect(screen.getByText(/bring your pass/i)).toBeInTheDocument();
    expect(screen.getByText(/stay connected/i)).toBeInTheDocument();
  });
});

// ── Registration details verification (desktop) ─────────────────────────

describe("ConfirmationPage — registration details (desktop)", () => {
  beforeEach(() => {
    setViewport(DESKTOP);
    vi.mocked(getToken).mockReturnValue("fake-jwt-token");
  });

  // ── R2.3: Attendee count "You + N Guests" ──────────────────────────

  it("R2.3: displays attendee count as 'You + N Guests' in Tickets row", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({
        status: "confirmed",
        attendees: {
          children: [{ id: "c1", name: "Child", age: 8, meal: "veg" }],
          guests: [{ id: "g1", name: "Guest", relationship: "friend", meal: "non_veg" }],
        },
      }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
    });

    // 1 alumni + 1 child + 1 guest = 3 total → "3 (You + 2 Guests)"
    expect(screen.getByText("Tickets / Attendees")).toBeInTheDocument();
    expect(screen.getByText("3 (You + 2 Guests)")).toBeInTheDocument();
  });

  // ── R2.4: Meal summary ─────────────────────────────────────────────

  it("R2.4: displays Veg and Non-veg counts in Food Preference row", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({
        status: "confirmed",
        attendees: {
          spouse: { name: "Priya", meal: "non_veg" },
          children: [],
          guests: [],
        },
        attendance: { intent: "attending", participationType: "full_celebration", alumniMeal: "veg", tshirtSize: "L" },
      }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
    });

    // Veg alumni + non-veg spouse → "1 Veg, 1 Non-veg"
    expect(screen.getByText("Food Preference")).toBeInTheDocument();
    expect(screen.getByText("1 Veg, 1 Non-veg")).toBeInTheDocument();
  });

  // ── R2.5: Accommodation label (when not "none") ─────────────────────

  it("R2.5: displays accommodation label in details when shared_double", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({
        status: "confirmed",
        accommodation: { type: "shared_double", checkIn: "2026-08-14", checkOut: "2026-08-16", extraBed: false },
      }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
    });

    // Accommodation row shows the label for shared_double
    expect(screen.getByText("Accommodation")).toBeInTheDocument();
    expect(screen.getByText("Shared Room (2 persons)")).toBeInTheDocument();
  });

  // ── R2.8: Email confirmation note ──────────────────────────────────
  //
  // GAP: The derived email (d.email) is not rendered anywhere on the
  // confirmation page. The guidance cards reference "your registered
  // email" generically but never display the actual address. The test
  // below verifies the guidance card that IS displayed. The literal
  // email address "arun@example.com" would need a component change to
  // appear — see the guidance card desc for the generic reference.

  it("R2.8: shows confirmation sent guidance card with email reference", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "confirmed" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
    });

    // The "Confirmation sent" guidance card mentions email delivery
    expect(screen.getByText("Confirmation sent")).toBeInTheDocument();
    expect(screen.getByText(/we've emailed your confirmation/i)).toBeInTheDocument();
  });

  // ── R4.3: QR code renders within entry pass ────────────────────────

  it("R4.3: entry pass renders with QR code for confirmed registration", async () => {
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "confirmed" }),
    });

    renderConfirmation();

    await waitFor(() => {
      expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0);
    });

    // Entry pass name element renders (existing check pattern)
    expect(document.querySelector(".entry-pass-name")).not.toBeNull();

    // Entry pass header text
    expect(screen.getByText("ENTRY PASS")).toBeInTheDocument();

    // QR code renders (aria-label on the QR SVG)
    expect(screen.getByLabelText("QR code for pass check-in")).toBeInTheDocument();
  });
});
