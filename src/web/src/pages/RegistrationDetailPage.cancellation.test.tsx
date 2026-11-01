import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToastProvider } from "@/components/ui/Toast";
import type { StaffRegistrationDetailResponse } from "@/lib/staff-types";

vi.mock("@/lib/staff-api");

import {
  cancelRegistration,
  fetchRefunds,
  fetchRegistrationDetail,
  archiveRegistration,
} from "@/lib/staff-api";
import RegistrationDetailPage from "./RegistrationDetailPage";

function makeDetail(overrides: {
  payments?: StaffRegistrationDetailResponse["payments"];
  status?: string;
} = {}): StaffRegistrationDetailResponse {
  return {
    registration: {
      id: 42,
      regCode: "SMRT00042",
      status: overrides.status ?? "confirmed",
      fullName: "Omar M",
      email: "omar@example.com",
      whatsapp: "9876543210",
      branch: "Computer Science & Engineering",
      city: "Kochi",
      country: "India",
      gender: "female",
      mobileAlternate: null,
      attendance: {
        intent: "attending",
        participationType: "full_celebration",
        mealPreference: "veg",
        tshirtSize: "M",
      },
      accommodation: {
        type: "none",
        checkIn: "",
        checkOut: "",
        extraBed: false,
        breakfastAdult: 0,
        breakfastChild: 0,
      },
      donation: 0,
      publicAck: false,
      ackDisplayName: null,
      felicitation: false,
      pricingBreakup: {
        base: 0,
        collegeContribution: 0,
        lines: [],
        donation: 0,
        total: 0,
      },
      totalAmount: 5500,
      idNote: null,
      photoFileKey: null,
      photoThumbKey: null,
      createdAt: 1_752_600_000_000,
      updatedAt: 1_752_600_000_000,
    },
    attendees: [],
    payments: overrides.payments ?? [],
    documents: [],
    audit: [],
    tshirts: [],
    additionalCharges: [],
  };
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/staff/registrations/42"]}>
        <Routes>
          <Route path="/staff/registrations/:id" element={<RegistrationDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchRegistrationDetail).mockResolvedValue(makeDetail());
  vi.mocked(fetchRefunds).mockResolvedValue({ refunds: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("staff cancellation UI (paid registrations)", () => {
  it("shows 'Cancel and create refund' instead of ordinary archive for a verified payment", async () => {
    vi.mocked(fetchRegistrationDetail).mockResolvedValue(
      makeDetail({
        payments: [{
          id: 7,
          amount: 5500,
          status: "verified",
          proofFileKey: null,
          gatewayRef: "UTR-123",
          verifiedBy: "staff@example.com",
          verifiedAt: 1_752_600_000_000,
          createdAt: 1_752_000_000_000,
        }],
      }),
    );
    renderPage();

    expect(await screen.findByRole("button", { name: "Cancel and create refund" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Archive Registration" })).not.toBeInTheDocument();
  });

  it("confirmation dialog displays the verified refund amount and requires a reason before confirming", async () => {
    vi.mocked(fetchRegistrationDetail).mockResolvedValue(
      makeDetail({
        payments: [{
          id: 7,
          amount: 5500,
          status: "verified",
          proofFileKey: null,
          gatewayRef: "UTR-123",
          verifiedBy: "staff@example.com",
          verifiedAt: 1_752_600_000_000,
          createdAt: 1_752_000_000_000,
        }],
      }),
    );
    vi.mocked(cancelRegistration).mockResolvedValue({
      archivedId: 99,
      originalRegistrationId: 42,
      regCode: "SMRT00042",
      fullName: "Omar M",
      totalRefundAmount: 5500,
      refunds: [],
    });
    renderPage();

    const cancelButton = await screen.findByRole("button", { name: "Cancel and create refund" });
    fireEvent.click(cancelButton);

    // Dialog explains the amount and carries the required reason field.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Cancel and create refund?");
    expect(dialog).toHaveTextContent("₹5,500");
    expect(screen.getByLabelText("Reason (required)")).toBeInTheDocument();

    // Confirm is disabled until a non-blank reason is entered.
    expect(screen.getByRole("button", { name: "Cancel & Create Refund" })).toBeDisabled();
    const reasonInput = screen.getByLabelText("Reason (required)");
    fireEvent.change(reasonInput, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Cancel & Create Refund" })).toBeDisabled();
    fireEvent.change(reasonInput, { target: { value: "Alumni moved abroad" } });
    const confirmButton = screen.getByRole("button", { name: "Cancel & Create Refund" });
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(cancelRegistration).toHaveBeenCalledWith(42, "Alumni moved abroad");
    });
  });

  it("shows the specific 409 message when cancellation is rejected for pending verification / already cancelled", async () => {
    vi.mocked(fetchRegistrationDetail).mockResolvedValue(
      makeDetail({
        payments: [{
          id: 7,
          amount: 5500,
          status: "verified",
          proofFileKey: null,
          gatewayRef: "UTR-123",
          verifiedBy: "staff@example.com",
          verifiedAt: 1_752_600_000_000,
          createdAt: 1_752_000_000_000,
        }],
      }),
    );
    // The API contract's 409 business state: a payment is awaiting
    // verification or the registration was already cancelled (staff-api.ts
    // cancelRegistration). The toast must name that state, not the generic
    // network/server fallback.
    vi.mocked(cancelRegistration).mockRejectedValue({ status: 409, code: "Conflict" });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Cancel and create refund" }));
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Alumni moved abroad" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel & Create Refund" }));

    expect(
      await screen.findByText("Cannot cancel: a payment may be awaiting verification, or the registration was already cancelled."),
    ).toBeVisible();
  });

  it("keeps ordinary archive for registrations with no real payment activity", async () => {
    vi.mocked(fetchRegistrationDetail).mockResolvedValue(
      makeDetail({
        payments: [{
          id: 7,
          amount: 5500,
          status: "payment_pending",
          proofFileKey: null,
          gatewayRef: null,
          verifiedBy: null,
          verifiedAt: null,
          createdAt: 1_752_000_000_000,
        }],
      }),
    );
    vi.mocked(archiveRegistration).mockResolvedValue({ ok: true, archivedId: 9 });
    renderPage();

    expect(await screen.findByRole("button", { name: "Archive Registration" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Cancel and create refund" })).not.toBeInTheDocument();
  });

  it("offers neither cancel nor archive when a verified payment coexists with a pending_verification payment", async () => {
    // The server rejects both archive and cancellation with 409 while a proof
    // is unreviewed — the UI must not offer an action that cannot succeed.
    vi.mocked(fetchRegistrationDetail).mockResolvedValue(
      makeDetail({
        payments: [
          {
            id: 7,
            amount: 5500,
            status: "verified",
            proofFileKey: null,
            gatewayRef: "UTR-123",
            verifiedBy: "staff@example.com",
            verifiedAt: 1_752_600_000_000,
            createdAt: 1_752_000_000_000,
          },
          {
            id: 8,
            amount: 2000,
            status: "pending_verification",
            proofFileKey: null,
            gatewayRef: null,
            verifiedBy: null,
            verifiedAt: null,
            createdAt: 1_752_100_000_000,
          },
        ],
      }),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Cancel and create refund" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Archive Registration" })).not.toBeInTheDocument();
    });
    // The Verify/Reject bar is the action while the proof is unreviewed.
    expect(await screen.findByText("Payment proof uploaded — review and verify")).toBeVisible();
  });
});
