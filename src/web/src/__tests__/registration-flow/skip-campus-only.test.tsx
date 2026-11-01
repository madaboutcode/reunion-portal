import "./mocks";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import {
  renderWizard,
  completeAlumniStep,
  completeAttendeesStep,
  backButton,
} from "./helpers";

afterEach(cleanup);

describe("campus_only skip logic", () => {
  it("skips Accommodation and lands on GivingBack after AttendeesMeals", async () => {
    const { user } = renderWizard();
    await completeAlumniStep(user, "campus");
    await completeAttendeesStep(user);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Giving Back/i })).toBeInTheDocument();
    });
    expect(screen.queryByText("My Stay")).not.toBeInTheDocument();
  });

  it("Back from GivingBack returns to AttendeesMeals", async () => {
    const { user } = renderWizard();
    await completeAlumniStep(user, "campus");
    await completeAttendeesStep(user);
    await user.click(backButton());

    await waitFor(() => {
      expect(screen.getByText(/Who.s coming along/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("My Stay")).not.toBeInTheDocument();
  });
});