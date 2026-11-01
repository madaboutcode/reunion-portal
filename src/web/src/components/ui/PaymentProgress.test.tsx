import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PaymentProgress } from "./PaymentProgress";

afterEach(cleanup);

describe("PaymentProgress", () => {
  // ── R1: Four stages rendered ─────────────────────────────────────────────

  it("renders all four stage labels", () => {
    render(<PaymentProgress currentStatus="pending" />);

    expect(screen.getByText("Registered")).toBeInTheDocument();
    expect(screen.getByText("Payment")).toBeInTheDocument();
    expect(screen.getByText("We're Verifying")).toBeInTheDocument();
    expect(screen.getByText("You're In!")).toBeInTheDocument();
  });

  // ── R10: Accessibility list roles ────────────────────────────────────────

  it("has role=list with four listitem children", () => {
    render(<PaymentProgress currentStatus="pending" />);

    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  // ── R5 + R11: Active stage per status ───────────────────────────────────

  it('status "pending": Payment is active (aria-current=step)', () => {
    render(<PaymentProgress currentStatus="pending" />);

    const activeEl = screen.getByRole("listitem", { current: "step" });
    expect(activeEl).toHaveTextContent("Payment");
  });

  it('status "pending_verification": We\'re Verifying is active', () => {
    render(<PaymentProgress currentStatus="pending_verification" />);

    const activeEl = screen.getByRole("listitem", { current: "step" });
    expect(activeEl).toHaveTextContent("We're Verifying");
  });

  it('status "confirmed": You\'re In! is active', () => {
    render(<PaymentProgress currentStatus="confirmed" />);

    const activeEl = screen.getByRole("listitem", { current: "step" });
    expect(activeEl).toHaveTextContent("You're In!");
  });

  // ── R12: Completed stages have visually hidden "Complete" text ───────────

  it('status "pending": Registration shows sr-only "Complete" text', () => {
    render(<PaymentProgress currentStatus="pending" />);

    // "Complete" should appear once (Registration is complete)
    const completeLabels = screen.getAllByText("Complete");
    expect(completeLabels).toHaveLength(1);
    // Verify it's sr-only
    expect(completeLabels[0]).toHaveClass("sr-only");
  });

  it('status "pending_verification": two stages show "Complete" (Registration + Payment Proof)', () => {
    render(<PaymentProgress currentStatus="pending_verification" />);

    const completeLabels = screen.getAllByText("Complete");
    expect(completeLabels).toHaveLength(2);
  });

  it('status "confirmed": three stages show "Complete"', () => {
    render(<PaymentProgress currentStatus="confirmed" />);

    const completeLabels = screen.getAllByText("Complete");
    expect(completeLabels).toHaveLength(3);
  });

  // ── R5: Correct stages are complete (not just aria-current) ─────────────

  it('status "pending": only Registration is complete, others are not', () => {
    render(<PaymentProgress currentStatus="pending" />);

    const items = screen.getAllByRole("listitem");
    // items: Registration(0), Payment Proof(1), Verification(2), Passes(3)
    // Registration item should contain "Complete" sr-only text
    expect(items[0]).toHaveTextContent("Complete");
    // Payment Proof is active — no "Complete"
    expect(items[1]).not.toHaveTextContent("Complete");
    // Future stages — no "Complete"
    expect(items[2]).not.toHaveTextContent("Complete");
    expect(items[3]).not.toHaveTextContent("Complete");
  });

  // ── R6: No click handlers (stages are not interactive) ──────────────────

  it("stage elements are not buttons or links (not interactive)", () => {
    render(<PaymentProgress currentStatus="pending" />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
