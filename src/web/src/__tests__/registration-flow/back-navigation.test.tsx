import "./mocks";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import {
  renderWizard,
  goToAlumniStep,
  fillAlumniDetails,
  clickContinue,
  backButton,
  DEFAULT_ALUMNI,
} from "./helpers";

afterEach(cleanup);

describe("Back navigation preserves state", () => {
  it("keeps AlumniDetails field values after round-trip to step 3", async () => {
    const { user } = renderWizard();
    await goToAlumniStep(user);
    await fillAlumniDetails(user, {
      fullName: "Meera Pillai",
      email: "meera@example.com",
      city: "Palakkad",
      whatsapp: "+919123456789",
      branch: DEFAULT_ALUMNI.branch,
      gender: "female",
    });
    await clickContinue(user);
    await waitFor(() => {
      expect(screen.getByText(/Who.s coming along/i)).toBeInTheDocument();
    });

    await user.click(backButton());
    await waitFor(() => {
      expect(screen.getByText("Tell us about yourself")).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText("What should we call you?")).toHaveValue(
      "Meera Pillai",
    );
    expect(screen.getByPlaceholderText("you@example.com")).toHaveValue(
      "meera@example.com",
    );
    expect(screen.getByPlaceholderText("Your current city")).toHaveValue("Palakkad");
    expect(screen.getAllByPlaceholderText("+91 98765 43210")[0]).toHaveValue(
      "+919123456789",
    );
  });
});