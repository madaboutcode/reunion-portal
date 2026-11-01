import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttendeesMeals } from "@/components/registration/AttendeesMeals";
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

describe("AttendeesMeals — t-shirt size", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1280,
    });
    window.dispatchEvent(new Event("resize"));
  });

  it("shows a prominent warning that the t-shirt order is already with the vendor", () => {
    render(
      <AttendeesMeals
        data={baseDraft()}
        update={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText(/t-shirt order already placed/i)).toBeInTheDocument();
    expect(
      screen.getByText(/can.t guarantee the exact size/i),
    ).toBeInTheDocument();
  });

  it("allows selecting a t-shirt size despite the order warning", async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    render(
      <AttendeesMeals
        data={baseDraft()}
        update={update}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText("T-Shirt Size"), "M");
    expect(update).toHaveBeenCalledWith({ tshirtSize: "M" });
  });
});
