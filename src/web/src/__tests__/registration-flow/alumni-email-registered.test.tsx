import "./mocks";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { vi } from "vitest";
import { checkEmail } from "@/lib/api";
import {
  renderWizard,
  goToAlumniStep,
  fillAlumniDetails,
  clickContinue,
  DEFAULT_ALUMNI,
} from "./helpers";

afterEach(cleanup);

describe("AlumniDetails email gate", () => {
  it("blocks Continue when checkEmail reports the address is already registered", async () => {
    vi.mocked(checkEmail).mockResolvedValueOnce(true);

    const { user } = renderWizard();
    await goToAlumniStep(user);
    await fillAlumniDetails(user, {
      ...DEFAULT_ALUMNI,
      email: "existing@example.com",
    });
    await clickContinue(user);

    expect(
      screen.getByText(/This email is already registered/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Who.s coming along/i)).not.toBeInTheDocument();
  });
});