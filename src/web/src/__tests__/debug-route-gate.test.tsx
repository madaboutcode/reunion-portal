/**
 * DebugRouteGate — contract tests (layer 2 of the debug-exposure defense,
 * docs/specs/access-control.spec.md G8).
 *
 * Guarantees under test:
 *  - Dev builds (import.meta.env.DEV): debug children render with no auth
 *    and no flag.
 *  - Non-dev: unauthenticated / non-admin sessions are redirected to /login —
 *    StaffDebugPage and friends are unreachable without auth.
 *  - Non-dev: an admin session still needs the `debug_tools` feature flag;
 *    flag disabled renders the 404 page, flag enabled renders the child.
 *
 * The gate is rendered with lightweight stand-in children so this tests the
 * real exported gate from App.tsx without mounting the heavy debug pages.
 * `useFeatureFlag` is mocked to isolate the gate's branching (the hook and
 * the server endpoint have their own tests).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { DebugRouteGate } from "../App";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";

vi.mock("@/hooks/useFeatureFlag", () => ({
  useFeatureFlag: vi.fn(),
}));

const mockUseFeatureFlag = vi.mocked(useFeatureFlag);

function setFlag(enabled: boolean, loading = false) {
  mockUseFeatureFlag.mockReturnValue({ enabled, loading });
}

function renderGated(initialPath = "/debug/x") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<DebugRouteGate />}>
          <Route path="/debug/x" element={<div>DEBUG CHILD CONTENT</div>} />
        </Route>
        <Route path="/login" element={<div>LOGIN PAGE STUB</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  setFlag(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("DebugRouteGate — dev builds", () => {
  it("renders debug children with no auth and no flag when DEV", () => {
    vi.stubEnv("DEV", true);
    setFlag(false); // flag off and no session — must not matter in dev
    renderGated();
    expect(screen.getByText("DEBUG CHILD CONTENT")).toBeInTheDocument();
  });
});

describe("DebugRouteGate — non-dev builds (staging)", () => {
  beforeEach(() => {
    vi.stubEnv("DEV", false);
  });

  it("redirects unauthenticated visitors to /login", () => {
    renderGated();
    expect(screen.queryByText("DEBUG CHILD CONTENT")).not.toBeInTheDocument();
    expect(screen.getByText("LOGIN PAGE STUB")).toBeInTheDocument();
  });

  it("redirects staff (non-admin) sessions to /login", () => {
    localStorage.setItem("smriti_role", "staff");
    setFlag(true); // even with the flag on, staff must not pass
    renderGated();
    expect(screen.queryByText("DEBUG CHILD CONTENT")).not.toBeInTheDocument();
    expect(screen.getByText("LOGIN PAGE STUB")).toBeInTheDocument();
  });

  it("renders 404 for an admin when the debug_tools flag is disabled", () => {
    localStorage.setItem("smriti_role", "admin");
    setFlag(false);
    renderGated();
    expect(screen.queryByText("DEBUG CHILD CONTENT")).not.toBeInTheDocument();
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("renders nothing while the flag is loading (no premature exposure)", () => {
    localStorage.setItem("smriti_role", "admin");
    setFlag(false, true);
    renderGated();
    expect(screen.queryByText("DEBUG CHILD CONTENT")).not.toBeInTheDocument();
    expect(screen.queryByText("Page not found")).not.toBeInTheDocument();
  });

  it("renders debug children for an admin when the flag is enabled", () => {
    localStorage.setItem("smriti_role", "admin");
    setFlag(true);
    renderGated();
    expect(screen.getByText("DEBUG CHILD CONTENT")).toBeInTheDocument();
  });

  it("skips the flag fetch for non-admin sessions (no unauthenticated request)", () => {
    localStorage.setItem("smriti_role", "staff");
    renderGated();
    expect(mockUseFeatureFlag).toHaveBeenCalledWith(
      "debug_tools",
      expect.objectContaining({ skip: true }),
    );
  });
});
