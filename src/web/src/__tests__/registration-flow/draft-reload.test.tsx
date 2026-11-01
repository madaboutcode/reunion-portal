import "./mocks";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import { createInitialData } from "@/lib/pricing";
import { createMemoryDraftStorage } from "@/lib/draft-storage.memory";
import { renderWizard } from "./helpers";

afterEach(cleanup);

describe("Wizard draft persistence", () => {
  it("restores saved alumni fields when resuming at step 2", async () => {
    const base = createInitialData();
    const storage = createMemoryDraftStorage({
      ...base,
      participationType: "full_celebration",
      fullName: "Saved User",
      email: "saved@example.com",
      city: "Kozhikode",
      currentStep: 2,
    });

    renderWizard(undefined, storage);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("What should we call you?")).toHaveValue(
        "Saved User",
      );
    });
    expect(screen.getByPlaceholderText("you@example.com")).toHaveValue(
      "saved@example.com",
    );
    expect(screen.getByPlaceholderText("Your current city")).toHaveValue("Kozhikode");
  });
});