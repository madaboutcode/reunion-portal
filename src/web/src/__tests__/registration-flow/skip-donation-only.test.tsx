import "./mocks";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import {
  renderWizard,
  advanceToGivingBack,
  backButton,
} from "./helpers";

afterEach(cleanup);

describe("donation_only skip logic", () => {
  it("jumps from AlumniDetails to GivingBack without steps 3–4", async () => {
    const { user } = renderWizard();
    await advanceToGivingBack(user, "donation");

    expect(screen.getByRole("heading", { name: /Donation/i })).toBeInTheDocument();
    expect(screen.queryByText(/Who.s coming along/i)).not.toBeInTheDocument();
    expect(screen.queryByText("My Stay")).not.toBeInTheDocument();
  });

  it("Back from GivingBack returns to AlumniDetails", async () => {
    const { user } = renderWizard();
    await advanceToGivingBack(user, "donation");
    await user.click(backButton());

    await waitFor(() => {
      expect(screen.getByText("Tell us about yourself")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Who.s coming along/i)).not.toBeInTheDocument();
    expect(screen.queryByText("My Stay")).not.toBeInTheDocument();
  });
});