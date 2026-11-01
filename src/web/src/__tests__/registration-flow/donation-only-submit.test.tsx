import "./mocks";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { submitRegistration } from "@/lib/api";
import { vi } from "vitest";
import {
  renderWizard,
  reachReviewDonationOnly,
  clickProceedToPayment,
  expectSubmitAndRedirect,
} from "./helpers";
import { expectAttendance, expectValidSubmitPayload } from "./assert-payload";

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(submitRegistration).mockClear();
});

describe("Registration flow — donation only submit (spec R9, R20)", () => {
  it("skips group and stay and submits donation_only payload with donation amount", async () => {
    const { user } = renderWizard();
    await reachReviewDonationOnly(user);
    await clickProceedToPayment(user);

    const payload = await expectSubmitAndRedirect();
    expectValidSubmitPayload(payload);
    expectAttendance(payload, "donation_only", "donation_only");
    expect(payload.donation?.amount).toBe(5000);
    expect(payload.attendees.children).toEqual([]);
  });
});