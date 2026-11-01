import "./mocks";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { submitRegistration } from "@/lib/api";
import { vi } from "vitest";
import {
  renderWizard,
  reachReviewCampusOnly,
  clickProceedToPayment,
  expectSubmitAndRedirect,
} from "./helpers";
import { expectAttendance, expectValidSubmitPayload } from "./assert-payload";

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(submitRegistration).mockClear();
});

describe("Registration flow — campus only submit (spec R10, R20)", () => {
  it("skips stay step and submits valid campus_only payload", async () => {
    const { user } = renderWizard();
    await reachReviewCampusOnly(user);
    await clickProceedToPayment(user);

    const payload = await expectSubmitAndRedirect();
    expectValidSubmitPayload(payload);
    expectAttendance(payload, "campus_only", "attending");
    expect(payload.accommodation).toBeUndefined();
  });
});