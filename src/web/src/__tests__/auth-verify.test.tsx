import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/lib/auth");
vi.mock("@/lib/staff-api");

import { saveAuth, saveStaffAuth, saveVerifyResponse, resolveStaffLanding } from "@/lib/auth";
import { verifyMagicLink, fetchMyPermissions } from "@/lib/staff-api";
import { AuthVerifyPage } from "@/pages/AuthVerifyPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderVerify(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/auth/verify${search}`]}>
      <Routes>
        <Route path="/auth/verify" element={<AuthVerifyPage />} />
        <Route path="/login" element={<div data-testid="login-page" />} />
        <Route path="/" element={<div data-testid="home-page" />} />
        <Route path="/staff/dashboard" element={<div data-testid="staff-dashboard" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AuthVerifyPage — click-gate security", () => {
  it("token in URL: renders Continue button and does NOT call verifyMagicLink on mount", async () => {
    renderVerify("?token=magic-token-abc");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /continue to sign in/i }),
      ).toBeInTheDocument();
    });

    // Must not verify on mount
    expect(verifyMagicLink).not.toHaveBeenCalled();
  });

  it("token in URL: shows 'Sign in to Smriti' heading before click", async () => {
    renderVerify("?token=magic-token-abc");

    await waitFor(() => {
      expect(screen.getByText(/sign in to smriti/i)).toBeInTheDocument();
    });
  });

  it("click Continue → verifyMagicLink called with token", async () => {
    const user = userEvent.setup();

    vi.mocked(verifyMagicLink).mockResolvedValue({
      token: "jwt-token",
      role: "attendee",
      redirectTo: "/",
      sub: "user-1",
      email: "test@example.com",
    });

    renderVerify("?token=magic-token-abc");

    const btn = await screen.findByRole("button", {
      name: /continue to sign in/i,
    });
    await user.click(btn);

    await waitFor(() => {
      expect(verifyMagicLink).toHaveBeenCalledWith("magic-token-abc");
    });
  });

  it("click Continue → staff role → saveStaffAuth called", async () => {
    const user = userEvent.setup();

    vi.mocked(verifyMagicLink).mockResolvedValue({
      token: "staff-jwt",
      role: "staff",
      redirectTo: "/staff/dashboard",
      sub: "staff-user-1",
      email: "staff@example.com",
    });

    renderVerify("?token=staff-token");

    const btn = await screen.findByRole("button", {
      name: /continue to sign in/i,
    });
    await user.click(btn);

    await waitFor(() => {
      expect(saveStaffAuth).toHaveBeenCalledWith("staff-jwt");
    });

    expect(saveAuth).not.toHaveBeenCalled();
  });

  it("click Continue → attendee role → saveAuth called", async () => {
    const user = userEvent.setup();

    vi.mocked(verifyMagicLink).mockResolvedValue({
      token: "attendee-jwt",
      role: "attendee",
      redirectTo: "/",
      sub: "attendee-123",
      email: "user@example.com",
    });

    renderVerify("?token=attendee-token");

    const btn = await screen.findByRole("button", {
      name: /continue to sign in/i,
    });
    await user.click(btn);

    await waitFor(() => {
      expect(saveAuth).toHaveBeenCalledWith("attendee-jwt", "");
    });
  });

  it("click Continue → verify success → saveVerifyResponse called", async () => {
    const user = userEvent.setup();

    vi.mocked(verifyMagicLink).mockResolvedValue({
      token: "jwt",
      role: "attendee",
      redirectTo: "/",
      sub: "user-123",
      email: "test@example.com",
    });

    renderVerify("?token=token-abc");

    const btn = await screen.findByRole("button", {
      name: /continue to sign in/i,
    });
    await user.click(btn);

    await waitFor(() => {
      expect(saveVerifyResponse).toHaveBeenCalledWith({
        role: "attendee",
        email: "test@example.com",
        sub: "user-123",
      });
    });
  });

  it("click Continue → verify failure → shows expired link UI", async () => {
    const user = userEvent.setup();

    vi.mocked(verifyMagicLink).mockRejectedValue({ status: 401 });

    renderVerify("?token=expired-token");

    const btn = await screen.findByRole("button", {
      name: /continue to sign in/i,
    });
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/link expired/i)).toBeInTheDocument();
    });

    // Shows "Request a New Login Link" button
    expect(
      screen.getByRole("button", { name: /request a new login link/i }),
    ).toBeInTheDocument();
  });

  it("no token in URL: immediately shows expired link UI", async () => {
    renderVerify(""); // no token param

    await waitFor(() => {
      expect(screen.getByText(/link expired/i)).toBeInTheDocument();
    });

    expect(verifyMagicLink).not.toHaveBeenCalled();
  });

  it("no token in URL: 'Request a New Login Link' navigates to /login", async () => {
    const user = userEvent.setup();

    renderVerify("");

    const btn = await screen.findByRole("button", {
      name: /request a new login link/i,
    });
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
    });
  });

  it("does not show the idle card when no token provided", async () => {
    renderVerify("");

    await waitFor(() => {
      expect(screen.getByText(/link expired/i)).toBeInTheDocument();
    });

    // The idle "Continue to Sign In" button should NOT be shown
    expect(
      screen.queryByRole("button", { name: /continue to sign in/i }),
    ).not.toBeInTheDocument();
  });
});

describe("AuthVerifyPage — returnTo param", () => {
  it("redirects to returnTo path after successful verify", async () => {
    const user = userEvent.setup();

    vi.mocked(verifyMagicLink).mockResolvedValue({
      token: "jwt",
      role: "attendee",
      redirectTo: "/",
      sub: "u1",
      email: "x@y.com",
    });

    // Override render to include the returnTo stub
    render(
      <MemoryRouter
        initialEntries={["/auth/verify?token=t123&returnTo=%2Fstaff%2Fdashboard"]}
      >
        <Routes>
          <Route path="/auth/verify" element={<AuthVerifyPage />} />
          <Route path="/staff/dashboard" element={<div data-testid="staff-dashboard" />} />
        </Routes>
      </MemoryRouter>,
    );

    const btn = await screen.findByRole("button", {
      name: /continue to sign in/i,
    });
    await user.click(btn);

    await waitFor(() => {
      expect(screen.getByTestId("staff-dashboard")).toBeInTheDocument();
    });
  });
});

beforeEach(() => {
  // Reset history state between tests (replaceState side effects)
  window.history.replaceState(null, "", "/auth/verify");
});

// ── Permission-aware staff landing (design.md "Post-Login Destination
//    Design") — the page resolves current scopes BEFORE navigating, never
//    falls back to /staff/dashboard on a permissions failure, and ignores a
//    returnTo whose required scope is missing. ────────────────────────────────

function renderVerifyWithLandingRoutes(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/auth/verify${search}`]}>
      <Routes>
        <Route path="/auth/verify" element={<AuthVerifyPage />} />
        <Route path="/staff/check-in" element={<div data-testid="check-in-page" />} />
        <Route path="/staff/dashboard" element={<div data-testid="staff-dashboard" />} />
        <Route path="/staff/access-denied" element={<div data-testid="access-denied-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function staffVerifyResponse(overrides: Partial<{ redirectTo: string; returnTo: string }> = {}) {
  return {
    token: "staff-jwt",
    role: "staff" as const,
    redirectTo: overrides.redirectTo ?? "/staff/dashboard",
    sub: "staff-user-1",
    email: "staff@example.com",
  };
}

describe("AuthVerifyPage — permission-aware staff landing", () => {
  it("desk-only staff lands on /staff/check-in (design scenario 9)", async () => {
    const user = userEvent.setup();
    vi.mocked(verifyMagicLink).mockResolvedValue(staffVerifyResponse());
    vi.mocked(fetchMyPermissions).mockResolvedValue({
      permissions: { scopes: ["registration_desk"] },
      role: "staff",
    });
    vi.mocked(resolveStaffLanding).mockReturnValue("/staff/check-in");
    renderVerifyWithLandingRoutes("?token=magic-token-abc");

    await user.click(await screen.findByRole("button", { name: /continue to sign in/i }));

    await waitFor(() => {
      expect(fetchMyPermissions).toHaveBeenCalledTimes(1);
      expect(resolveStaffLanding).toHaveBeenCalledWith(
        ["registration_desk"],
        null,
        "staff",
      );
    });
    expect(await screen.findByTestId("check-in-page")).toBeInTheDocument();
    expect(screen.queryByTestId("staff-dashboard")).not.toBeInTheDocument();
  });

  it("a dashboard returnTo is discarded for a desk-only user (no dashboard 403)", async () => {
    const user = userEvent.setup();
    vi.mocked(verifyMagicLink).mockResolvedValue(staffVerifyResponse());
    vi.mocked(fetchMyPermissions).mockResolvedValue({
      permissions: { scopes: ["registration_desk"] },
      role: "staff",
    });
    vi.mocked(resolveStaffLanding).mockReturnValue("/staff/check-in");
    renderVerifyWithLandingRoutes(
      "?token=magic-token-abc&returnTo=%2Fstaff%2Fdashboard",
    );

    await user.click(await screen.findByRole("button", { name: /continue to sign in/i }));

    await waitFor(() => {
      // The resolver receives the returnTo and decides it is denied; the page
      // navigates to whatever the resolver returns (unit-tested in
      // staff-landing.test.ts).
      expect(resolveStaffLanding).toHaveBeenCalledWith(
        ["registration_desk"],
        "/staff/dashboard",
        "staff",
      );
    });
    expect(await screen.findByTestId("check-in-page")).toBeInTheDocument();
  });

  it("permission-fetch failure NEVER falls back to /staff/dashboard — access-denied?reason=fetch", async () => {
    const user = userEvent.setup();
    vi.mocked(verifyMagicLink).mockResolvedValue(staffVerifyResponse());
    vi.mocked(fetchMyPermissions).mockRejectedValue(new Error("network down"));
    renderVerifyWithLandingRoutes("?token=magic-token-abc");

    await user.click(await screen.findByRole("button", { name: /continue to sign in/i }));

    expect(await screen.findByTestId("access-denied-page")).toBeInTheDocument();
    expect(screen.queryByTestId("staff-dashboard")).not.toBeInTheDocument();
    // The server's redirectTo hint is not used to bypass missing scope data.
    expect(resolveStaffLanding).not.toHaveBeenCalled();
  });

  it("scoped staff with a permitted returnTo keeps it", async () => {
    const user = userEvent.setup();
    vi.mocked(verifyMagicLink).mockResolvedValue(staffVerifyResponse());
    vi.mocked(fetchMyPermissions).mockResolvedValue({
      permissions: { scopes: ["dashboard"] },
      role: "staff",
    });
    vi.mocked(resolveStaffLanding).mockReturnValue("/staff/dashboard");
    renderVerifyWithLandingRoutes(
      "?token=magic-token-abc&returnTo=%2Fstaff%2Fregistrations%2F42",
    );

    await user.click(await screen.findByRole("button", { name: /continue to sign in/i }));

    await waitFor(() => {
      expect(resolveStaffLanding).toHaveBeenCalledWith(
        ["dashboard"],
        "/staff/registrations/42",
        "staff",
      );
    });
    expect(await screen.findByTestId("staff-dashboard")).toBeInTheDocument();
  });
});
