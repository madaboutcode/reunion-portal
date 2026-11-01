import "./mocks";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import {
  renderWizard,
  renderWizardWithState,
  advanceToGivingBack,
  clickContinue,
  collegeContributionMin,
} from "./helpers";

afterEach(cleanup);

describe("GivingBack validation", () => {
  // ── donation_only ──────────────────────────────────────────────────────

  it("donation_only: blocks Continue when both donation and contribution are zero", async () => {
    const { user } = renderWizard();
    await advanceToGivingBack(user, "donation");
    await clickContinue(user);

    expect(
      screen.getByText("⚠ Add a donation or a college contribution to continue."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Photo & ID/i)).not.toBeInTheDocument();
  });

  it("donation_only: donation amount clears error and advances to PhotoId", async () => {
    const { user } = renderWizard();
    await advanceToGivingBack(user, "donation");
    await clickContinue(user);
    expect(
      screen.getByText("⚠ Add a donation or a college contribution to continue."),
    ).toBeInTheDocument();

    // Type into the donation amount field (Section B)
    const inputs = screen.getAllByPlaceholderText("0");
    await user.type(inputs[inputs.length - 1], "5000");
    await clickContinue(user);

    await waitFor(() => {
      expect(screen.getByText(/Photo & ID/i)).toBeInTheDocument();
    });
  });

  it("donation_only: renders Section A (college contribution + cause picker)", async () => {
    const { user } = renderWizard();
    await advanceToGivingBack(user, "donation");

    // Section A title should be present for donation_only
    expect(screen.getByText("Batch Contribution to College")).toBeInTheDocument();
    // Cause cards should be rendered
    expect(screen.getByText("Green Energy Project")).toBeInTheDocument();
    expect(screen.getByText("Scholarship Fund")).toBeInTheDocument();
  });

  it("donation_only: contribution-only (no reunion donation) passes validation", async () => {
    const { user } = renderWizardWithState({
      participationType: "donation_only",
      attendanceIntent: "donation_only",
      collegeContribution: 5000,
      collegeContributionCause: "green_energy",
    });
    await advanceToGivingBack(user, "donation");
    await clickContinue(user);

    await waitFor(() => {
      expect(screen.getByText(/Photo & ID/i)).toBeInTheDocument();
    });
  });

  // ── cause picker ───────────────────────────────────────────────────────

  it("cause picker: blocks Continue when contribution > 0 and no cause selected", async () => {
    const { user } = renderWizardWithState({
      collegeContribution: 2000,
      collegeContributionCause: "",
    });
    await advanceToGivingBack(user, "full");
    await clickContinue(user);

    expect(
      screen.getByText("⚠ Select a cause for your contribution."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Photo & ID/i)).not.toBeInTheDocument();
  });

  it("cause picker: selecting a cause allows Continue to proceed", async () => {
    const { user } = renderWizardWithState({
      collegeContribution: 2000,
      collegeContributionCause: "",
    });
    await advanceToGivingBack(user, "full");
    await clickContinue(user);
    expect(
      screen.getByText("⚠ Select a cause for your contribution."),
    ).toBeInTheDocument();

    // Click the Green Energy Project card to select the cause
    await user.click(screen.getByText("Green Energy Project"));
    await clickContinue(user);

    await waitFor(() => {
      expect(screen.getByText(/Photo & ID/i)).toBeInTheDocument();
    });
  });

  it("cause picker: cause not required when contribution is 0", async () => {
    // No contribution, no cause — attending should still pass (attending with 0 contribution is fine since min is 0)
    const { user } = renderWizardWithState({
      collegeContribution: 0,
      collegeContributionCause: "",
    });
    await advanceToGivingBack(user, "full");
    await clickContinue(user);

    // Should not show the cause error
    expect(
      screen.queryByText("⚠ Select a cause for your contribution."),
    ).not.toBeInTheDocument();
    // Should advance to Photo & ID
    await waitFor(() => {
      expect(screen.getByText(/Photo & ID/i)).toBeInTheDocument();
    });
  });

  // ── attending ─────────────────────────────────────────────────────────

  // UI snaps custom contribution to minimum (₹0); inject invalid state to exercise real schema + GivingBack.validate
  it("attending: shows minimum college contribution error", async () => {
    const { user } = renderWizardWithState({ collegeContribution: -1 });
    await advanceToGivingBack(user, "full");
    await clickContinue(user);

    expect(
      screen.getByText(`⚠ Minimum contribution is ₹${collegeContributionMin}`),
    ).toBeInTheDocument();
  });
});
