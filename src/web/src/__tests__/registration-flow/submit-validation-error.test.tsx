import "./mocks";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import { submitRegistration } from "@/lib/api";
import { vi } from "vitest";
import {
  renderWizard,
  reachReviewFullCelebration,
  clickProceedToPayment,
} from "./helpers";

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(submitRegistration).mockClear();
});

describe("ReviewPay submit error handling", () => {
  it("shows API error message when submitRegistration rejects", async () => {
    vi.mocked(submitRegistration).mockRejectedValueOnce({
      error: "Registration could not be saved",
    });

    const { user } = renderWizard();
    await reachReviewFullCelebration(user);
    await clickProceedToPayment(user);

    await waitFor(() => {
      expect(
        screen.getByText("Registration could not be saved"),
      ).toBeInTheDocument();
    });

    const submitBtn = screen.getByTestId("step6-advance");
    expect(submitBtn).not.toBeDisabled();
    expect(submitBtn).toHaveTextContent("Proceed to Payment");
  });
});