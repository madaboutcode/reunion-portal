import "./mocks";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import { submitRegistration } from "@/lib/api";
import { vi } from "vitest";
import { WIZARD_DRAFT_STORAGE_KEY } from "@/lib/draft-storage";
import {
  renderWizard,
  advanceToGivingBack,
  clickContinue,
  reachReviewFullCelebration,
  clickProceedToPayment,
  photoContinueButton,
} from "./helpers";

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(submitRegistration).mockClear();
  localStorage.clear();
});

describe("Submit safety net", () => {
  it("does not call submitRegistration when photo step is incomplete", async () => {
    const { user } = renderWizard();
    await advanceToGivingBack(user, "full");
    await clickContinue(user);

    await waitFor(() => {
      expect(screen.getByText(/Photo & ID/i)).toBeInTheDocument();
    });
    await user.click(photoContinueButton());
    expect(screen.queryByText(/You.re almost there/i)).not.toBeInTheDocument();
    expect(submitRegistration).not.toHaveBeenCalled();
  });

  it("clears smriti_reg_v5 from localStorage after successful submit", async () => {
    localStorage.setItem(WIZARD_DRAFT_STORAGE_KEY, JSON.stringify({ fullName: "Stale" }));

    const { user } = renderWizard();
    await reachReviewFullCelebration(user);
    await clickProceedToPayment(user);

    await waitFor(() => {
      expect(submitRegistration).toHaveBeenCalledTimes(1);
    });
    expect(localStorage.getItem(WIZARD_DRAFT_STORAGE_KEY)).toBeNull();
  });
});