import "./mocks";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi } from "vitest";
import {
  FeatureFlagsContext,
  initialFeatureFlagValues,
} from "@/context/feature-flags-context";
import { submitRegistration } from "@/lib/api";
import { getToken, saveAuth } from "@/lib/auth";
import { setViewport, DESKTOP } from "@/__tests__/test-utils";
import RegisterPage from "@/pages/RegisterPage";
import {
  selectParticipation,
  clickContinue,
  fillAlumniDetails,
  completeAttendeesStep,
  completeAccommodationStep,
  completePhotoStep,
  clickProceedToPayment,
  DEFAULT_ALUMNI,
} from "./helpers";

const OPEN_REGISTRATION_FLAGS = {
  ...initialFeatureFlagValues,
  registration_show_page: true,
  registration_accept_new: true,
};

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(getToken).mockReturnValue(null);
  vi.mocked(submitRegistration).mockClear();
  localStorage.clear();
});

function renderRegisterChain() {
  setViewport(DESKTOP);
  const user = userEvent.setup();
  render(
    <FeatureFlagsContext.Provider
      value={{ values: OPEN_REGISTRATION_FLAGS, ready: true, refresh: () => Promise.resolve() }}
    >
      <MemoryRouter initialEntries={["/register"]}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/pay/:regCode"
            element={<div data-testid="payment-landing" />}
          />
        </Routes>
      </MemoryRouter>
    </FeatureFlagsContext.Provider>,
  );
  return { user };
}

describe("RegisterPage → wizard → submit → redirect", () => {
  it("no JWT: full celebration completes and lands on payment", async () => {
    const { user } = renderRegisterChain();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Complete Reunion Experience/i }),
      ).toBeInTheDocument();
    });

    await selectParticipation(user, "full");
    await clickContinue(user);
    await fillAlumniDetails(user, {
      ...DEFAULT_ALUMNI,
      fullName: "Chain User",
      email: "chain@example.com",
    });
    await clickContinue(user);
    await completeAttendeesStep(user);
    await completeAccommodationStep(user);
    await clickContinue(user);
    await completePhotoStep(user);
    await clickProceedToPayment(user);

    await waitFor(() => {
      expect(submitRegistration).toHaveBeenCalledTimes(1);
    });
    expect(saveAuth).toHaveBeenCalledWith("test-jwt", "1001");
    expect(window.location.href).toBe("/pay/SMRTTESTREG00001?new=1");
  });
});
