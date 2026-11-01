import "./mocks";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { submitRegistration } from "@/lib/api";
import { vi } from "vitest";
import {
  renderWizard,
  goToAlumniStep,
  fillAlumniDetails,
  clickContinue,
  completeAttendeesStep,
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

describe("Registration flow — full celebration with spouse", () => {
  it("submit payload includes spouse when added on AttendeesMeals", async () => {
    const { user } = renderWizard();
    await goToAlumniStep(user, "full");
    await fillAlumniDetails(user, {
      ...DEFAULT_ALUMNI,
      fullName: "Mangalasseri Neelakantan",
      email: "neelakantan@example.com",
    });
    await clickContinue(user);
    await completeAttendeesStep(user, { spouseName: "Karuthamma" });
    await completeAccommodationStep(user);
    await clickContinue(user);
    await completePhotoStep(user);
    await clickProceedToPayment(user);

    const payload = await expectSubmitAndRedirect();
    expectValidSubmitPayload(payload);
    expect(payload.attendees.spouse).toEqual({
      name: "Karuthamma",
      meal: "veg",
    });
  });
});