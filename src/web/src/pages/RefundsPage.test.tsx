import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui/Toast";
import { ApiError } from "@/lib/http";
import type { RefundRecord } from "@/lib/staff-types";

vi.mock("@/lib/staff-api");

import { completeRefund, fetchRefunds } from "@/lib/staff-api";
import RefundsPage from "./RefundsPage";

const activeRefund: RefundRecord = {
  id: 1,
  registrationId: 1001,
  sourcePaymentId: 55,
  amount: 700,
  reason: "overpayment",
  cancellationReason: null,
  status: "pending",
  bankReference: null,
  resolvedBy: null,
  resolvedAt: null,
  createdAt: 1_752_600_000_000,
  originalRegistrationId: 1001,
  originalPaymentId: 55,
  regCode: "SMRT0001001",
  fullName: "Active Alumni",
  email: "active@example.com",
  sourcePaymentAmount: 6200,
  sourcePaymentReference: "UTR-ACTIVE",
  ownerKind: "active",
};

const detachedRefund: RefundRecord = {
  id: 2,
  registrationId: null,
  sourcePaymentId: null,
  amount: 5500,
  reason: "cancellation",
  cancellationReason: "Alumni moved abroad",
  status: "pending",
  bankReference: null,
  resolvedBy: null,
  resolvedAt: null,
  createdAt: 1_752_700_000_000,
  originalRegistrationId: 42,
  originalPaymentId: 77,
  regCode: "SMRT0000042",
  fullName: "Cancelled Alumni",
  email: "cancelled@example.com",
  sourcePaymentAmount: 5500,
  sourcePaymentReference: "UTR-CANCELLED",
  ownerKind: "cancelled",
};

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <RefundsPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.mocked(fetchRefunds).mockResolvedValue({ refunds: [activeRefund, detachedRefund] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RefundsPage — active and detached refund rendering", () => {
  it("renders an active overpayment refund linked to its live registration", async () => {
    renderPage();
    const name = await screen.findByText("Active Alumni");
    expect(name).toBeVisible();
    // Active refund links to the live registration detail route.
    const link = name.closest("a");
    expect(link).toHaveAttribute("href", "/staff/registrations/1001");
  });

  it("renders a detached cancellation refund with stored identity, no dead link, reason shown", async () => {
    renderPage();

    const name = await screen.findByText("Cancelled Alumni");
    // Detached refund renders as plain text with a cancelled marker — no
    // link to /staff/registrations/null.
    expect(name.closest("a")).toBeNull();
    expect(screen.getByText("cancelled")).toBeVisible();
    expect(screen.getByText("SMRT0000042")).toBeVisible();
    expect(screen.getByText("cancellation")).toBeVisible();
    // Staff cancellation reason is rendered alongside the cancellation label.
    expect(screen.getByText("Alumni moved abroad")).toBeVisible();
    // Amount rendered from the stored refund.
    expect(screen.getByText("₹5,500")).toBeVisible();
  });

  it("completes a detached refund with a bank reference (no registration load)", async () => {
    vi.mocked(completeRefund).mockResolvedValue({ status: "completed" });
    renderPage();

    const markButton = (await screen.findAllByRole("button", { name: "Mark Completed" }))[1];
    // Simulate: open the expand row, enter reference, confirm.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(markButton);

    const referenceInput = screen.getByPlaceholderText("Enter the bank transfer reference used to send the refund…");
    fireEvent.change(referenceInput, { target: { value: "NEFT/DETACHED-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Completed" }));

    // Final confirmation dialog.
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(completeRefund).toHaveBeenCalledWith(2, "NEFT/DETACHED-1");
    });
  });

  it("shows the already-completed conflict message when completion returns 409", async () => {
    // A concurrent/stale completion: the server's guarded completion batch
    // already picked another operator as the winner, so this attempt is the
    // 409 loser. The page must surface the expected conflict specifically,
    // not the generic failure toast.
    vi.mocked(completeRefund).mockRejectedValue(
      new ApiError(409, "Refund is already completed", { error: "Refund is already completed" }),
    );
    renderPage();

    const markButton = (await screen.findAllByRole("button", { name: "Mark Completed" }))[0];
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(markButton);

    const referenceInput = screen.getByPlaceholderText("Enter the bank transfer reference used to send the refund…");
    fireEvent.change(referenceInput, { target: { value: "NEFT/STALE-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Completed" }));

    // Final confirmation dialog.
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByText("This refund was already completed by another operator."),
    ).toBeVisible();
  });
});
