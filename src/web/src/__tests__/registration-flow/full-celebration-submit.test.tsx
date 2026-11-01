import "./mocks";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import { submitRegistration } from "@/lib/api";
import { WIZARD_DRAFT_STORAGE_KEY } from "@/lib/draft-storage";
import { vi } from "vitest";
import {
  renderWizard,
  reachReviewFullCelebration,
  clickProceedToPayment,
  expectSubmitAndRedirect,
} from "./helpers";
import { expectAttendance, expectValidSubmitPayload } from "./assert-payload";

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(submitRegistration).mockClear();
  localStorage.clear();
});

describe("Registration flow — full celebration submit (spec R10.1, R20)", () => {
  it("wizard → Proceed to Payment sends schema-valid Registration with attending intent", async () => {
    const { user } = renderWizard();
    await reachReviewFullCelebration(user);
    await clickProceedToPayment(user);

    const payload = await expectSubmitAndRedirect();
    expectValidSubmitPayload(payload);
    expectAttendance(payload, "full_celebration", "attending");
    expect(payload.contact.fullName).toBe("Mangalasseri Neelakantan");
    expect(payload.contact.email).toBe("neelakantan@example.com");
    expect(payload.attendance.tshirtSize).toBe("M");
    expect(payload.idDocument?.fileKey).toBe("key-id");

    await waitFor(() => {
      expect(localStorage.getItem(WIZARD_DRAFT_STORAGE_KEY)).toBeNull();
    });
  });
});