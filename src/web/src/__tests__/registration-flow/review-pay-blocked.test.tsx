import "./mocks";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import { createInitialData } from "@/lib/pricing";
import { renderWizardWithState } from "./helpers";

afterEach(cleanup);

describe("ReviewPay blocked from injected invalid review state", () => {
  it("Proceed to Payment stays disabled when photo is missing on step 7", async () => {
    const base = createInitialData();
    renderWizardWithState({
      ...base,
      currentStep: 7,
      participationType: "full_celebration",
      attendanceIntent: "attending",
      fullName: "Review Blocked",
      email: "blocked@example.com",
      whatsapp: "+919876543210",
      city: "Kochi",
      tshirtSize: "M",
      photoFileKey: undefined,
      photoFileName: "",
      idFileKey: "key-id",
      idFileName: "id.jpg",
      collegeContribution: 500,
    });

    await waitFor(() => {
      expect(screen.getByText(/You.re almost there/i)).toBeInTheDocument();
    });

    const submitBtn = screen.getByTestId("step6-advance");
    expect(submitBtn).toBeDisabled();
    expect(
      screen.getByText(/complete the items marked above to continue/i),
    ).toBeInTheDocument();
  });
});