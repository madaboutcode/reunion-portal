import "./mocks";
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import { createInitialData } from "@/lib/pricing";
import { createMemoryDraftStorage } from "@/lib/draft-storage.memory";
import { renderWizard } from "./helpers";

afterEach(cleanup);

describe("Wizard resume at last step (R19, mock storage)", () => {
  it("opens Photo & ID when storage has currentStep 5", async () => {
    const base = createInitialData();
    const storage = createMemoryDraftStorage({
      ...base,
      participationType: "full_celebration",
      fullName: "Resume User",
      email: "resume@example.com",
      whatsapp: "+919876543210",
      branch: base.branch || "Computer Science & Engineering",
      city: "Kochi",
      currentStep: 6,
    });

    renderWizard(undefined, storage);

    await waitFor(() => {
      expect(screen.getByText(/Photo & ID/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("Tell us about yourself")).not.toBeInTheDocument();
  });

  it("clamps donation_only step 4 in storage to Alumni step", async () => {
    const base = createInitialData();
    const storage = createMemoryDraftStorage({
      ...base,
      participationType: "donation_only",
      fullName: "Donor",
      email: "donor@example.com",
      whatsapp: "+919876543210",
      branch: "Mechanical Engineering",
      city: "Mumbai",
      currentStep: 4,
    });

    renderWizard(undefined, storage);

    await waitFor(() => {
      expect(screen.getByText("Tell us about yourself")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Who.s coming along/i)).not.toBeInTheDocument();
  });
});