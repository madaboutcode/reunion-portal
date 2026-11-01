import "./mocks";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import {
  renderWizard,
  advanceToGivingBack,
  clickContinue,
  photoContinueButton,
} from "./helpers";

afterEach(cleanup);

describe("PhotoId wizard gates", () => {
  it("full celebration: cannot reach review without photo and ID uploads", async () => {
    const { user } = renderWizard();
    await advanceToGivingBack(user, "full");
    await clickContinue(user);

    await waitFor(() => {
      expect(screen.getByText(/Photo & ID/i)).toBeInTheDocument();
    });

    await user.click(photoContinueButton());
    expect(screen.getByText(/Photo & ID/i)).toBeInTheDocument();
    expect(screen.queryByText(/You.re almost there/i)).not.toBeInTheDocument();

    const file = new File(["pixels"], "photo.jpg", { type: "image/jpeg" });
    const photoInput = screen.getByTestId("upload-photo-input");
    await user.upload(photoInput, file);
    await user.click(photoContinueButton());
    expect(screen.queryByText(/You.re almost there/i)).not.toBeInTheDocument();

    const idFile = new File(["id"], "id.jpg", { type: "image/jpeg" });
    const idInput = screen.getByTestId("upload-id-input");
    await user.upload(idInput, idFile);
    await user.click(photoContinueButton());

    await waitFor(() => {
      expect(screen.getByText(/You.re almost there/i)).toBeInTheDocument();
    });
  });

  it("donation_only: photo alone reaches review (no ID section)", async () => {
    const { user } = renderWizard();
    await advanceToGivingBack(user, "donation");
    // Section A (college contribution) and Section B (donation) both have placeholder "0".
    // Target the last one — Section B, the reunion donation amount.
    const amountInputs = screen.getAllByPlaceholderText("0");
    await user.type(amountInputs[amountInputs.length - 1], "5000");
    await clickContinue(user);

    await waitFor(() => {
      expect(screen.getByText(/Photo & ID/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("Verify Your Identity")).not.toBeInTheDocument();

    await user.click(photoContinueButton());
    expect(screen.queryByText(/You.re almost there/i)).not.toBeInTheDocument();

    const file = new File(["pixels"], "photo.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByTestId("upload-photo-input"), file);
    await user.click(photoContinueButton());

    await waitFor(() => {
      expect(screen.getByText(/You.re almost there/i)).toBeInTheDocument();
    });
  });
});