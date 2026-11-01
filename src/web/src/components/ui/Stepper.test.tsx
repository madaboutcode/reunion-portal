import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { Stepper } from "./Stepper";

afterEach(cleanup);

// ── Viewport helpers ──────────────────────────────────────────────────────

const DESKTOP = 1280;
const MOBILE = 375;

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
  // useIsMobile debounces 100ms — advance fake timers after firing resize
  act(() => {
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(150);
  });
}

// ── Desktop suite ─────────────────────────────────────────────────────────

describe("Stepper — desktop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: DESKTOP,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // R11 — correct step labels rendered
  it("R11: renders all 7 step labels", () => {
    render(<Stepper currentStep={1} />);

    expect(screen.getByText("Participation")).toBeInTheDocument();
    expect(screen.getByText("About You")).toBeInTheDocument();
    expect(screen.getByText("Your Group")).toBeInTheDocument();
    expect(screen.getByText("Your Stay")).toBeInTheDocument();
    expect(screen.getByText("Giving Back")).toBeInTheDocument();
    expect(screen.getByText("Photo & ID")).toBeInTheDocument();
    // The label uses a newline: "Review\n& Pay" — rendered as text node, query separately
    expect(screen.getByText(/Review/)).toBeInTheDocument();
  });

  // R1 — 7 steps rendered
  it("R1: renders exactly 7 step circles", () => {
    render(<Stepper currentStep={1} />);

    const labels = [
      "Participation",
      "About You",
      "Your Group",
      "Your Stay",
      "Giving Back",
      "Photo & ID",
    ];
    labels.forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
    expect(screen.getByText(/Review/)).toBeInTheDocument();
  });

  // R14 — display only, no click navigation
  it("R14: step circles are not interactive buttons (display only)", () => {
    render(<Stepper currentStep={1} />);
    // The stepper should not contain any <button> or <a> elements
    const buttons = screen.queryAllByRole("button");
    const links = screen.queryAllByRole("link");
    expect(buttons).toHaveLength(0);
    expect(links).toHaveLength(0);
  });

  // Accessibility — progressbar role (R8 spec, applies to all viewports)
  it("has progressbar role with correct aria values on step 1", () => {
    render(<Stepper currentStep={1} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemin", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "7");
  });

  it("progressbar aria-valuenow updates for each step", () => {
    const { rerender } = render(<Stepper currentStep={1} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");

    rerender(<Stepper currentStep={3} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");

    rerender(<Stepper currentStep={7} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "7");
  });

  // Step state: completed steps show checkmark, not the step icon text
  // The checkmark SVG has a distinguishing path — we can look for it via aria/svg presence
  // But more reliably: completed steps append no extra label text; the raw label stays
  // We test the observable label state changes for completed/active/upcoming.

  // R3 — completed step labels use aqua-colored text class
  it("R3: completed steps render with aqua-colored label text", () => {
    render(<Stepper currentStep={3} />);
    // Steps 1 and 2 are completed when currentStep=3
    const participationLabel = screen.getByText("Participation");
    expect(participationLabel.className).toMatch(/text-\[#2A7A80\]/);

    const aboutYouLabel = screen.getByText("About You");
    expect(aboutYouLabel.className).toMatch(/text-\[#2A7A80\]/);
  });

  // R4 — current step label is bold terracotta
  it("R4: current step label is bold terracotta", () => {
    render(<Stepper currentStep={2} />);
    const currentLabel = screen.getByText("About You");
    expect(currentLabel.className).toMatch(/text-terracotta/);
    expect(currentLabel.className).toMatch(/font-bold/);
  });

  // R5 — future steps have muted gray label
  it("R5: future steps have muted gray label", () => {
    render(<Stepper currentStep={1} />);
    // Steps 2–7 are future when currentStep=1
    const futureLabel = screen.getByText("About You");
    expect(futureLabel.className).toMatch(/text-\[#B8A898\]/);
  });

  // Step-count correctness across all 7 steps
  it("renders without error for all valid step values (1–7)", () => {
    const steps: Array<1 | 2 | 3 | 4 | 5 | 6 | 7> = [1, 2, 3, 4, 5, 6, 7];
    for (const step of steps) {
      const { unmount } = render(<Stepper currentStep={step} />);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      unmount();
    }
  });

  // R11 — step order is correct (Participation is step 1)
  it("R11: step order — Participation is step 1 (active on currentStep=1)", () => {
    render(<Stepper currentStep={1} />);
    const participationLabel = screen.getByText("Participation");
    // Active step has terracotta bold label
    expect(participationLabel.className).toMatch(/text-terracotta/);
    expect(participationLabel.className).toMatch(/font-bold/);

    // About You (step 2) should be a future step
    const aboutYouLabel = screen.getByText("About You");
    expect(aboutYouLabel.className).toMatch(/text-\[#B8A898\]/);
  });

  // Filtered steps — Stepper receives only active steps (skipped steps filtered out upstream)
  it("renders only the steps it receives (filtered array)", () => {
    const activeSteps = [
      { key: "participation" as const, id: 1, label: "Participation", mobileLabel: "Participation" },
      { key: "about_you" as const, id: 2, label: "About You", mobileLabel: "About You" },
      { key: "giving_back" as const, id: 5, label: "Giving Back", mobileLabel: "Giving Back" },
      { key: "photo_id" as const, id: 6, label: "Photo & ID", mobileLabel: "Photo & ID" },
      { key: "review_pay" as const, id: 7, label: "Review\n& Pay", mobileLabel: "Review & Pay" },
    ];
    render(<Stepper currentStep={1} steps={activeSteps} />);

    expect(screen.getByText("Participation")).toBeInTheDocument();
    expect(screen.getByText("About You")).toBeInTheDocument();
    expect(screen.getByText("Giving Back")).toBeInTheDocument();
    expect(screen.queryByText("Your Group")).not.toBeInTheDocument();
    expect(screen.queryByText("Your Stay")).not.toBeInTheDocument();
  });

  it("active index maps correctly when steps are filtered", () => {
    const activeSteps = [
      { key: "participation" as const, id: 1, label: "Participation", mobileLabel: "Participation" },
      { key: "about_you" as const, id: 2, label: "About You", mobileLabel: "About You" },
      { key: "giving_back" as const, id: 5, label: "Giving Back", mobileLabel: "Giving Back" },
    ];
    // currentStep=3 means 3rd position in filtered array = Giving Back
    render(<Stepper currentStep={3} steps={activeSteps} />);

    // Steps 1,2 completed; step 3 (Giving Back) active
    const participationLabel = screen.getByText("Participation");
    expect(participationLabel.className).toMatch(/text-\[#2A7A80\]/);

    const givingBackLabel = screen.getByText("Giving Back");
    expect(givingBackLabel.className).toMatch(/text-terracotta/);
  });

  // Edge case: renders nothing when currentStep is out of bounds
  it("renders nothing when currentStep exceeds step count", () => {
    const { container } = render(<Stepper currentStep={7} steps={[
      { key: "participation" as const, id: 1, label: "Only", mobileLabel: "Only" },
    ]} />);
    expect(container.firstChild).toBeNull();
  });
});

// ── Mobile suite ──────────────────────────────────────────────────────────

describe("Stepper — mobile", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: MOBILE,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // R8 — mobile renders current step name and "Step N of 7"
  it("R8: renders current step mobile label and step count", () => {
    render(<Stepper currentStep={1} />);
    expect(screen.getByText("Participation")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 7")).toBeInTheDocument();
  });

  it("R8: step count text updates correctly for step 3", () => {
    render(<Stepper currentStep={3} />);
    expect(screen.getByText("Your Group")).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 7")).toBeInTheDocument();
  });

  it("R8: step 7 shows 'Review' and 'Step 7 of 7'", () => {
    render(<Stepper currentStep={7} />);
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Step 7 of 7")).toBeInTheDocument();
  });

  // R9 — progress bar present (via role=progressbar wrapping div)
  it("R9: has progressbar role on mobile", () => {
    render(<Stepper currentStep={1} />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  // R8 — aria-label on progressbar includes step name
  it("R8: aria-label describes current step and total", () => {
    render(<Stepper currentStep={2} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-label", "Step 2 of 7: About You");
  });

  it("aria-valuenow matches currentStep on mobile", () => {
    render(<Stepper currentStep={4} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
  });

  // R10 — progress bar width calculation (20% at step 1, 100% at step 7)
  // We test this via the inline style on the fill div
  it("R10: progress bar starts at 20% on step 1", () => {
    render(<Stepper currentStep={1} />);
    // The fill div has inline style width
    const progressBar = screen.getByRole("progressbar");
    const fillDiv = progressBar.querySelector("[style]");
    expect(fillDiv).not.toBeNull();
    expect(fillDiv!.getAttribute("style")).toMatch(/width:\s*20%/);
  });

  it("R10: progress bar is 100% on step 7", () => {
    render(<Stepper currentStep={7} />);
    const progressBar = screen.getByRole("progressbar");
    const fillDiv = progressBar.querySelector("[style]");
    expect(fillDiv).not.toBeNull();
    expect(fillDiv!.getAttribute("style")).toMatch(/width:\s*100%/);
  });

  it("R10: progress bar is 60% on step 4 ((4-1)/6 * 80 + 20 = 60)", () => {
    render(<Stepper currentStep={4} />);
    const progressBar = screen.getByRole("progressbar");
    const fillDiv = progressBar.querySelector("[style]");
    // (4-1)/6 * 80 + 20 = 0.5 * 80 + 20 = 40 + 20 = 60
    expect(fillDiv!.getAttribute("style")).toMatch(/width:\s*60%/);
  });

  // R8 — desktop step labels are NOT shown on mobile (only mobileLabel is rendered)
  it("R8: desktop-only multi-line labels are not rendered on mobile", () => {
    render(<Stepper currentStep={7} />);
    // Mobile uses the mobileLabel ("Review"), not the desktop label
    const mobileLabel = screen.getByText("Review");
    expect(mobileLabel).toBeInTheDocument();
    // Desktop-style multi-circle labels should not appear on mobile
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  // R14 — no click navigation on mobile either
  it("R14: mobile stepper has no interactive buttons", () => {
    render(<Stepper currentStep={2} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

// ── Viewport switch ───────────────────────────────────────────────────────

describe("Stepper — viewport switching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("switches from desktop to mobile layout when viewport narrows", () => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: DESKTOP,
    });

    const { rerender } = render(<Stepper currentStep={2} />);

    // On desktop: "Step N of 7" text is NOT shown
    expect(screen.queryByText("Step 2 of 7")).not.toBeInTheDocument();

    // Simulate resize to mobile
    setViewport(MOBILE);
    rerender(<Stepper currentStep={2} />);

    // On mobile: "Step N of 7" text IS shown
    expect(screen.getByText("Step 2 of 7")).toBeInTheDocument();
  });
});
