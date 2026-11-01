import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { PhotoId } from "@/components/registration/PhotoId";
import type { WizardDraft } from "@smriti/shared";

afterEach(cleanup);

function baseDraft(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return {
    fullName: "Test Alumna",
    branch: "Computer Science & Engineering",
    gender: "female",
    email: "test@test.com",
    whatsapp: "+919876543210",
    city: "Kochi",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    alumniMeal: "veg",
    tshirtSize: "M",
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
    idFileName: "",
    idNote: "",
    collegeContribution: 500,
    collegeContributionCause: "",
    photoFileName: "",
    ...overrides,
  };
}

function continueBtn() {
  return screen.getByRole("button", { name: /Continue to Review/i });
}

describe("PhotoId — advance gates", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1280,
    });
    window.dispatchEvent(new Event("resize"));
  });

  it("attending: onNext not called without uploads", () => {
    const onNext = vi.fn();
    render(
      <PhotoId
        data={baseDraft()}
        update={vi.fn()}
        onNext={onNext}
        onBack={vi.fn()}
      />,
    );

    continueBtn().click();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("attending: onNext called when photo and ID keys are set", async () => {
    const onNext = vi.fn();
    render(
      <PhotoId
        data={baseDraft({
          photoFileKey: "photo-key",
          photoFileName: "photo.jpg",
          idFileKey: "id-key",
          idFileName: "id.pdf",
        })}
        update={vi.fn()}
        onNext={onNext}
        onBack={vi.fn()}
      />,
    );

    continueBtn().click();
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledTimes(1);
    });
  });

  it("donation_only: ID section hidden", () => {
    render(
      <PhotoId
        data={baseDraft({
          attendanceIntent: "donation_only",
          participationType: "donation_only",
        })}
        update={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.queryByText("Verify Your Identity")).not.toBeInTheDocument();
  });

  it("donation_only: onNext not called without photo key", () => {
    const onNext = vi.fn();
    render(
      <PhotoId
        data={baseDraft({
          attendanceIntent: "donation_only",
          participationType: "donation_only",
        })}
        update={vi.fn()}
        onNext={onNext}
        onBack={vi.fn()}
      />,
    );

    continueBtn().click();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("donation_only: onNext called when photo key is set", async () => {
    const onNext = vi.fn();
    render(
      <PhotoId
        data={baseDraft({
          attendanceIntent: "donation_only",
          participationType: "donation_only",
          photoFileKey: "photo-key",
          photoFileName: "photo.jpg",
        })}
        update={vi.fn()}
        onNext={onNext}
        onBack={vi.fn()}
      />,
    );

    continueBtn().click();
    await waitFor(() => {
      expect(onNext).toHaveBeenCalled();
    });
  });
});