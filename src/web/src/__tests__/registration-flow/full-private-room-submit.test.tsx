import "./mocks";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { submitRegistration } from "@/lib/api";
import { calculateTotal } from "@smriti/shared";
import { vi } from "vitest";
import {
  renderWizard,
  goToAlumniStep,
  fillAlumniDetails,
  clickContinue,
  completeAttendeesStep,
  completeAccommodationPrivateRoom,
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

describe("Registration flow — private room accommodation", () => {
  it("submit payload includes private accommodation and priced total", async () => {
    const { user } = renderWizard();
    await goToAlumniStep(user, "full");
    await fillAlumniDetails(user, {
      ...DEFAULT_ALUMNI,
      fullName: "Mangalasseri Neelakantan",
      email: "neelakantan@example.com",
    });
    await clickContinue(user);
    await completeAttendeesStep(user);
    await completeAccommodationPrivateRoom(user);
    await clickContinue(user);
    await completePhotoStep(user);
    await clickProceedToPayment(user);

    const payload = await expectSubmitAndRedirect();
    expectValidSubmitPayload(payload);
    expect(payload.accommodation?.type).toBe("private");
    expect(payload.accommodation?.checkIn).toBeTruthy();
    expect(calculateTotal(payload).total).toBeGreaterThan(8000);
  });
});