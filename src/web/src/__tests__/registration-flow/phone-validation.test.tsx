import "./mocks";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import {
  renderWizard,
  goToAlumniStep,
  fillAlumniDetails,
  clickContinue,
} from "./helpers";

afterEach(cleanup);

describe("AlumniDetails phone validation", () => {
  it("shows error for invalid Indian mobile after +91", async () => {
    const { user } = renderWizard();
    await goToAlumniStep(user);
    await fillAlumniDetails(user, { whatsapp: "+911234567890" });
    await clickContinue(user);

    expect(
      screen.getByText("⚠ Enter a valid 10-digit Indian phone number"),
    ).toBeInTheDocument();
  });

  it("requires country code prefix for India", async () => {
    const { user } = renderWizard();
    await goToAlumniStep(user);
    await fillAlumniDetails(user);
    const whatsapp = screen.getAllByPlaceholderText("+91 98765 43210")[0];
    await user.clear(whatsapp);
    await user.type(whatsapp, "9876543210");
    await clickContinue(user);

    expect(
      screen.getByText("⚠ Include your country code (e.g. +91)"),
    ).toBeInTheDocument();
  });

  it("clears phone error when a valid +91 number is entered", async () => {
    const { user } = renderWizard();
    await goToAlumniStep(user);
    await fillAlumniDetails(user, { whatsapp: "+911234567890" });
    await clickContinue(user);
    expect(
      screen.getByText("⚠ Enter a valid 10-digit Indian phone number"),
    ).toBeInTheDocument();

    const whatsapp = screen.getAllByPlaceholderText("+91 98765 43210")[0];
    await user.clear(whatsapp);
    await user.type(whatsapp, "+919876543210");
    expect(
      screen.queryByText("⚠ Enter a valid 10-digit Indian phone number"),
    ).not.toBeInTheDocument();
  });
});