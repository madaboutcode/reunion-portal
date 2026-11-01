import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CostBreakdownPopup } from "./CostBreakdownPopup";

afterEach(cleanup);

describe("CostBreakdownPopup", () => {
  it("renders dialog with categories and total when open", () => {
    const onClose = vi.fn();
    render(<CostBreakdownPopup base={10000} isOpen={true} onClose={onClose} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("How your registration fee is used")).toBeInTheDocument();

    // Verify at least one category label is rendered
    expect(screen.getByText("Welcome Kit & Teachers Recognition")).toBeInTheDocument();
    expect(screen.getByText("Food Arrangements (Buffet Lunch @ TKMCE & Dinner @ Raviz)")).toBeInTheDocument();

    expect(screen.getByText("₹10,000")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    const onClose = vi.fn();
    render(<CostBreakdownPopup base={10000} isOpen={false} onClose={onClose} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CostBreakdownPopup base={10000} isOpen={true} onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on backdrop click, not on card click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CostBreakdownPopup base={10000} isOpen={true} onClose={onClose} />);

    // Clicking inside the dialog card should NOT close
    await user.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    // Clicking the backdrop overlay (the fixed overlay behind the dialog) should close
    // The backdrop is the parent of the dialog — the fixed overlay div
    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on X button click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CostBreakdownPopup base={10000} isOpen={true} onClose={onClose} />);

    await user.click(screen.getByLabelText("Close cost breakdown"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
