import "./mocks";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import {
  renderWizard,
  goToAlumniStep,
  fillAlumniDetails,
  clickContinue,
  DEFAULT_ALUMNI,
} from "./helpers";

afterEach(cleanup);

describe("AlumniDetails validation", () => {
  it("shows required field errors and stays on step 2 when Continue is clicked empty", async () => {
    const { user } = renderWizard();
    await goToAlumniStep(user);
    await clickContinue(user);

    expect(screen.getByText("⚠ Full name is required")).toBeInTheDocument();
    expect(screen.getByText("⚠ Branch is required")).toBeInTheDocument();
    expect(screen.getByText("⚠ Email is required")).toBeInTheDocument();
    expect(screen.getByText("⚠ City is required")).toBeInTheDocument();
    // Country defaults to India; dial code auto-fills — expect phone format error, not empty required
    expect(
      screen.getByText("⚠ Enter a valid 10-digit Indian phone number"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Who.s coming along/i)).not.toBeInTheDocument();
  });

  it("clears each error when the user fills that field", async () => {
    const { user } = renderWizard();
    await goToAlumniStep(user);
    await clickContinue(user);

    await user.type(
      screen.getByPlaceholderText("What should we call you?"),
      "Dasan Vijayan",
    );
    expect(screen.queryByText("⚠ Full name is required")).not.toBeInTheDocument();

    const [branchSelect] = screen.getAllByRole("combobox");
    await user.selectOptions(branchSelect, DEFAULT_ALUMNI.branch);
    expect(screen.queryByText("⚠ Branch is required")).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("you@example.com"), "dasan@example.com");
    expect(screen.queryByText("⚠ Email is required")).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Your current city"), "Thrissur");
    expect(screen.queryByText("⚠ City is required")).not.toBeInTheDocument();

    const whatsapp = screen.getAllByPlaceholderText("+91 98765 43210")[0];
    await user.clear(whatsapp);
    await user.type(whatsapp, "+919876543210");
    expect(screen.queryByText("⚠ WhatsApp number is required")).not.toBeInTheDocument();
  });

  it("advances to AttendeesMeals when all required fields are valid", async () => {
    const { user } = renderWizard();
    await goToAlumniStep(user);
    await fillAlumniDetails(user);
    await clickContinue(user);

    await waitFor(() => {
      expect(screen.getByText(/Who.s coming along/i)).toBeInTheDocument();
    });
  });
});