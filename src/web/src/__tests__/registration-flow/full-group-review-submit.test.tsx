import "./mocks";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import { submitRegistration } from "@/lib/api";
import { vi } from "vitest";
import {
  renderWizard,
  goToAlumniStep,
  fillAlumniDetails,
  clickContinue,
  completeAttendeesGroupStep,
  completeAccommodationStep,
  completePhotoStep,
  clickProceedToPayment,
  expectSubmitAndRedirect,
  DEFAULT_ALUMNI,
} from "./helpers";
import { expectValidSubmitPayload } from "./assert-payload";

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(submitRegistration).mockClear();
});

describe("Registration flow — full group on review and submit", () => {
  it("review shows attendee meal badge and payload includes family", async () => {
    const { user } = renderWizard();
    await goToAlumniStep(user, "full");
    await fillAlumniDetails(user, {
      ...DEFAULT_ALUMNI,
      fullName: "Mangalasseri Neelakantan",
      email: "neelakantan@example.com",
    });
    await clickContinue(user);
    await completeAttendeesGroupStep(user);
    await completeAccommodationStep(user);
    await clickContinue(user);
    await completePhotoStep(user);

    await waitFor(() => {
      expect(screen.getByText(/You.re almost there/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Attendees & Meals · 5 people/i)).toBeInTheDocument();
    expect(screen.getByText("Karuthamma")).toBeInTheDocument();

    await clickProceedToPayment(user);

    const payload = await expectSubmitAndRedirect();
    expectValidSubmitPayload(payload);
    expect(payload.attendees.spouse?.name).toBe("Karuthamma");
    expect(payload.attendees.children).toHaveLength(2);
    expect(payload.attendees.guests).toHaveLength(1);
  });
});