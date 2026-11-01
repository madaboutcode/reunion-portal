import "./mocks";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import {
  renderWizard,
  goToAlumniStep,
  fillAlumniDetails,
  clickContinue,
  backButton,
  selectParticipation,
  DEFAULT_ALUMNI,
} from "./helpers";

afterEach(cleanup);

describe("Participation type switch", () => {
  it("changing path on step 1 skips accommodation for donation_only", async () => {
    const { user } = renderWizard();
    await goToAlumniStep(user, "full");
    await fillAlumniDetails(user, {
      ...DEFAULT_ALUMNI,
      fullName: "Switch User",
      email: "switch@example.com",
    });
    await clickContinue(user);
    await waitFor(() => {
      expect(screen.getByText(/Who.s coming along/i)).toBeInTheDocument();
    });

    await user.click(backButton());
    await waitFor(() => {
      expect(screen.getByText("Tell us about yourself")).toBeInTheDocument();
    });
    await user.click(backButton());
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Complete Reunion Experience/i }),
      ).toBeInTheDocument();
    });

    await selectParticipation(user, "donation");
    await clickContinue(user);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("What should we call you?")).toHaveValue(
        "Switch User",
      );
    });
    await clickContinue(user);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Donation/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/Who.s coming along/i)).not.toBeInTheDocument();
    expect(screen.queryByText("My Stay")).not.toBeInTheDocument();
  });
});