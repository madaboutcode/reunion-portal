import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { RegistrationResponseData } from "@smriti/shared";

vi.mock("@/lib/api");
vi.mock("@/lib/auth");

import {
  FeatureFlagsContext,
  initialFeatureFlagValues,
} from "@/context/feature-flags-context";
import { getMyRegistration } from "@/lib/api";
import { getToken, clearAuth } from "@/lib/auth";
import RegisterPage from "@/pages/RegisterPage";

afterEach(cleanup);

const OPEN_REGISTRATION_FLAGS = {
  ...initialFeatureFlagValues,
  registration_show_page: true,
  registration_accept_new: true,
};
const PAGE_VISIBLE_REGISTRATION_CLOSED_FLAGS = {
  ...OPEN_REGISTRATION_FLAGS,
  registration_accept_new: false,
};

// ── Mock data factory ──────────────────────────────────────────────────────

function mockRegistration(
  overrides: Partial<RegistrationResponseData> = {},
): RegistrationResponseData {
  return {
    regId: "SMRT79WW4A25NWG1",
    regCode: "SMRT79WW4A25NWG1",
        status: "pending",
        createdAt: Date.now(),
        pricingBreakup: { base: 7500, collegeContribution: 500, lines: [], donation: 0, total: 8000 },
        contact: {
          fullName: "Mangalasseri Neelakantan",
          branch: "Civil Engineering",
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

function renderRegisterPage(values: typeof OPEN_REGISTRATION_FLAGS) {
  return render(
    <FeatureFlagsContext.Provider
      value={{ values, ready: true, refresh: () => Promise.resolve() }}
    >
      <MemoryRouter initialEntries={["/register"]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/pay/:regCode"
            element={<div data-testid="payment-page" />}
          />
          <Route
            path="/confirmation/:id"
            element={<div data-testid="confirmation-page" />}
          />
          <Route
            path="/new"
            element={<div data-testid="new-registration-page" />}
          />
        </Routes>
      </MemoryRouter>
    </FeatureFlagsContext.Provider>,
  );
}

// ── No token: shows wizard ─────────────────────────────────────────────────

describe("RegisterPage — no token", () => {
  it("shows wizard when no token is present", () => {
    vi.mocked(getToken).mockReturnValue(null);

    renderRegisterPage(OPEN_REGISTRATION_FLAGS);

    // WizardShell renders — at minimum the wizard step content appears
    // (no interstitial, no redirect)
    expect(screen.queryByTestId("payment-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("confirmation-page")).not.toBeInTheDocument();
  });
});

describe("RegisterPage — registration flags", () => {
  it("shows the closed state when the registration page flag is disabled", () => {
    vi.mocked(getToken).mockReturnValue(null);

    renderRegisterPage({
      ...OPEN_REGISTRATION_FLAGS,
      registration_show_page: false,
    });

    expect(screen.getByText("Registration closed")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Complete Reunion Experience/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the closed new-registration state when the page is visible but accepting new registrations is disabled", () => {
    vi.mocked(getToken).mockReturnValue(null);

    renderRegisterPage(PAGE_VISIBLE_REGISTRATION_CLOSED_FLAGS);

    expect(screen.getByText("Registration closed")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Complete Reunion Experience/i }),
    ).not.toBeInTheDocument();
  });
});

// ── Confirmed: shows interstitial ─────────────────────────────────────────

describe("RegisterPage — confirmed registration", () => {
  it("shows existing registration interstitial with See pass and New registration buttons", async () => {
    vi.mocked(getToken).mockReturnValue("fake-jwt");
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "confirmed" }),
    });

    renderRegisterPage(OPEN_REGISTRATION_FLAGS);

    await waitFor(() => {
      expect(screen.getByText(/you're already registered/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /see pass/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new registration/i }),
    ).toBeInTheDocument();
  });

  it("confirmed: does NOT redirect to payment page", async () => {
    vi.mocked(getToken).mockReturnValue("fake-jwt");
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "confirmed" }),
    });

    renderRegisterPage(PAGE_VISIBLE_REGISTRATION_CLOSED_FLAGS);

    await waitFor(() => {
      expect(screen.getByText(/you're already registered/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /see pass/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /new registration/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-page")).not.toBeInTheDocument();
  });
});

// ── Pending: redirect to payment ──────────────────────────────────────────

describe("RegisterPage — pending registration", () => {
  it("status pending: redirects to /pay/:regCode", async () => {
    vi.mocked(getToken).mockReturnValue("fake-jwt");
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({
        status: "pending",
        regCode: "SMRT79WW4A25NWG1",
      }),
    });

    renderRegisterPage(PAGE_VISIBLE_REGISTRATION_CLOSED_FLAGS);

    await waitFor(() => {
      expect(screen.getByTestId("payment-page")).toBeInTheDocument();
    });
  });

  it("status pending_verification: redirects to /pay/:regCode", async () => {
    vi.mocked(getToken).mockReturnValue("fake-jwt");
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({
        status: "pending_verification",
        regCode: "SMRT79WW4A25NWG1",
      }),
    });

    renderRegisterPage(PAGE_VISIBLE_REGISTRATION_CLOSED_FLAGS);

    await waitFor(() => {
      expect(screen.getByTestId("payment-page")).toBeInTheDocument();
    });
  });

  it("pending: does NOT show wizard or confirmed interstitial", async () => {
    vi.mocked(getToken).mockReturnValue("fake-jwt");
    vi.mocked(getMyRegistration).mockResolvedValue({
      registration: mockRegistration({ status: "pending" }),
    });

    renderRegisterPage(PAGE_VISIBLE_REGISTRATION_CLOSED_FLAGS);

    await waitFor(() => {
      expect(screen.getByTestId("payment-page")).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/you're already registered/i),
    ).not.toBeInTheDocument();
  });
});

// ── 401: clears auth and shows wizard ────────────────────────────────────

describe("RegisterPage — 401 error", () => {
  it("401 response: calls clearAuth and falls through to wizard", async () => {
    vi.mocked(getToken).mockReturnValue("fake-jwt");
    vi.mocked(getMyRegistration).mockRejectedValue({ status: 401 });

    renderRegisterPage(OPEN_REGISTRATION_FLAGS);

    await waitFor(() => {
      expect(vi.mocked(clearAuth)).toHaveBeenCalled();
    });

    expect(screen.queryByTestId("payment-page")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/you're already registered/i),
    ).not.toBeInTheDocument();
  });
});
