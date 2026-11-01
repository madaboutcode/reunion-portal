import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { ReviewPay } from "@/components/registration/ReviewPay";
import type { WizardDraft } from "@smriti/shared";
vi.mock("@/lib/api");
vi.mock("@/lib/auth");

import { submitRegistration } from "@/lib/api";

afterEach(cleanup);

function validAttendingData(): WizardDraft {
  return {
    fullName: "Test User",
    branch: "Electronics & Communication Engineering",
    gender: "male",
    email: "test@test.com",
    whatsapp: "9876543210",
    city: "Kochi",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    alumniMeal: "veg",
    tshirtSize: "L",
    spouseName: "",
    spouseMeal: "veg",
    children: [],
    guests: [],
    accommodation: "none",
    extraBed: false,
    checkIn: "2026-08-14",
    checkOut: "2026-08-16",
    donationAmount: "0",
    publicAcknowledgement: false,
    acknowledgementDisplayName: "",
    felicitationConsent: false,
    idFileName: "test.pdf",
    idNote: "",
    idFileKey: "doc-key-123",
    idFileType: "application/pdf",
    idFileSizeBytes: 1000,
    collegeContribution: 500,
    collegeContributionCause: "green_energy",
    photoFileName: "photo.jpg",
    photoFileKey: "photo-key-123",
  };
}

function validDonationOnlyData(): WizardDraft {
  return {
    ...validAttendingData(),
    attendanceIntent: "donation_only",
    participationType: "donation_only",
    donationAmount: "5000",
    idFileName: "",
    idFileKey: undefined,
  };
}

function invalidData(): WizardDraft {
  return {
    ...validAttendingData(),
    fullName: "",
    email: "",
    tshirtSize: undefined,
    photoFileName: "",
    photoFileKey: undefined,
    idFileKey: undefined,
  };
}

describe("ReviewPay — payment gate", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1280,
    });
    window.dispatchEvent(new Event("resize"));
  });

  it("blocks Proceed to Payment when validateForPayment fails", async () => {
    render(
      <ReviewPay
        data={invalidData()}
        update={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
        goToStep={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/complete the items marked above to continue/i),
      ).toBeInTheDocument();
    });

    const submitBtn = screen.getByTestId("step6-advance");
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveTextContent("Proceed to Payment");
  });

  it("enables Proceed to Payment when draft passes validateForPayment", async () => {
    render(
      <ReviewPay
        data={validAttendingData()}
        update={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
        goToStep={vi.fn()}
      />,
    );

    const submitBtn = screen.getByTestId("step6-advance");
    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
    });
  });

  it("donation_only hides attendees section but shows college contribution for all types", async () => {
    render(
      <ReviewPay
        data={validDonationOnlyData()}
        update={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
        goToStep={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("step6-advance")).toBeInTheDocument();
    });

    expect(screen.queryByText(/attendees & meals/i)).not.toBeInTheDocument();
    // College Contribution is now shown for all participation types (including donation_only)
    expect(screen.getByText(/college contribution/i)).toBeInTheDocument();
    expect(screen.getByText(/alumni details/i)).toBeInTheDocument();
  });

  it("shows Processing... while submitRegistration is in flight", async () => {
    vi.mocked(submitRegistration).mockImplementation(() => new Promise(() => {}));

    render(
      <ReviewPay
        data={validAttendingData()}
        update={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
        goToStep={vi.fn()}
      />,
    );

    const submitBtn = screen.getByTestId("step6-advance");
    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
    });

    submitBtn.click();

    await waitFor(() => {
      expect(submitBtn).toHaveTextContent("Processing...");
      expect(submitBtn).toBeDisabled();
    });
  });
});