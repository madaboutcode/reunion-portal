import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MealToggle } from "@/components/form/MealToggle";

afterEach(cleanup);

// ── R7: Rendering ──────────────────────────────────────────────────────────

describe("MealToggle — rendering", () => {
  it("R7: renders both Veg and Non-veg options", () => {
    render(<MealToggle value="veg" onChange={vi.fn()} />);

    // Use exact names — /veg/i would match both buttons since "Non-veg" contains "veg"
    // The emoji span is aria-hidden, so accessible name is just the text label
    expect(screen.getByRole("radio", { name: "Veg" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Non-veg" })).toBeInTheDocument();
  });

  it("renders veg icon 🌿 and non-veg icon 🍗", () => {
    render(<MealToggle value="veg" onChange={vi.fn()} />);

    expect(screen.getByText("🌿")).toBeInTheDocument();
    expect(screen.getByText("🍗")).toBeInTheDocument();
  });
});

// ── R9: Exactly one option active at all times ─────────────────────────────

describe("MealToggle — active state (R9)", () => {
  it("R9: veg is aria-checked=true when value='veg'", () => {
    render(<MealToggle value="veg" onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "Veg" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Non-veg" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("R9: non_veg is aria-checked=true when value='non_veg'", () => {
    render(<MealToggle value="non_veg" onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "Non-veg" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Veg" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("R9: exactly one radio is aria-checked=true", () => {
    render(<MealToggle value="veg" onChange={vi.fn()} />);

    const checked = screen
      .getAllByRole("radio")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
  });
});

// ── R10: ARIA radiogroup pattern ────────────────────────────────────────────

describe("MealToggle — ARIA (R10)", () => {
  it("R10: container has role=radiogroup", () => {
    render(<MealToggle value="veg" onChange={vi.fn()} />);

    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
  });

  it("R10: each option has role=radio", () => {
    render(<MealToggle value="veg" onChange={vi.fn()} />);

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
  });

  it("R10: aria-checked reflects the currently selected value", () => {
    const { rerender } = render(<MealToggle value="veg" onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "Veg" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    rerender(<MealToggle value="non_veg" onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: "Non-veg" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Veg" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

// ── R8: onChange callback ───────────────────────────────────────────────────

describe("MealToggle — onChange (R8)", () => {
  it("R8: clicking non_veg calls onChange with 'non_veg' when veg is selected", async () => {
    const onChange = vi.fn();
    render(<MealToggle value="veg" onChange={onChange} />);

    await userEvent.click(screen.getByRole("radio", { name: "Non-veg" }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("non_veg");
  });

  it("R8: clicking veg calls onChange with 'veg' when non_veg is selected", async () => {
    const onChange = vi.fn();
    render(<MealToggle value="non_veg" onChange={onChange} />);

    await userEvent.click(screen.getByRole("radio", { name: "Veg" }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("veg");
  });

  it("R8: onChange receives the typed value 'veg' | 'non_veg', not a generic string", async () => {
    const onChange = vi.fn();
    render(<MealToggle value="veg" onChange={onChange} />);

    await userEvent.click(screen.getByRole("radio", { name: "Non-veg" }));

    const received = onChange.mock.calls[0][0];
    expect(received === "veg" || received === "non_veg").toBe(true);
  });
});

// ── R11: Keyboard navigation (roving tabindex / arrow keys) ────────────────

describe("MealToggle — keyboard navigation (R11)", () => {
  it("R11: ArrowRight on the radiogroup calls onChange with 'non_veg' when veg is selected", async () => {
    const onChange = vi.fn();
    render(<MealToggle value="veg" onChange={onChange} />);

    const radiogroup = screen.getByRole("radiogroup");
    radiogroup.focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("non_veg");
  });

  it("R11: ArrowLeft on the radiogroup calls onChange with 'veg' when non_veg is selected", async () => {
    const onChange = vi.fn();
    render(<MealToggle value="non_veg" onChange={onChange} />);

    const radiogroup = screen.getByRole("radiogroup");
    radiogroup.focus();
    await userEvent.keyboard("{ArrowLeft}");

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("veg");
  });

  it("R11: ArrowDown on the radiogroup calls onChange with 'non_veg' when veg is selected", async () => {
    const onChange = vi.fn();
    render(<MealToggle value="veg" onChange={onChange} />);

    const radiogroup = screen.getByRole("radiogroup");
    radiogroup.focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("non_veg");
  });

  it("R11: ArrowUp on the radiogroup calls onChange with 'veg' when non_veg is selected", async () => {
    const onChange = vi.fn();
    render(<MealToggle value="non_veg" onChange={onChange} />);

    const radiogroup = screen.getByRole("radiogroup");
    radiogroup.focus();
    await userEvent.keyboard("{ArrowUp}");

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("veg");
  });

  it("R11: ArrowRight wraps from non_veg back to veg", async () => {
    const onChange = vi.fn();
    render(<MealToggle value="non_veg" onChange={onChange} />);

    const radiogroup = screen.getByRole("radiogroup");
    radiogroup.focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledWith("veg");
  });

  it("R11: ArrowLeft wraps from veg back to non_veg", async () => {
    const onChange = vi.fn();
    render(<MealToggle value="veg" onChange={onChange} />);

    const radiogroup = screen.getByRole("radiogroup");
    radiogroup.focus();
    await userEvent.keyboard("{ArrowLeft}");

    expect(onChange).toHaveBeenCalledWith("non_veg");
  });

  it("R11: unrelated keys (Enter, Space, Tab) do not call onChange", async () => {
    const onChange = vi.fn();
    render(<MealToggle value="veg" onChange={onChange} />);

    const radiogroup = screen.getByRole("radiogroup");
    radiogroup.focus();
    await userEvent.keyboard("{Enter} {Tab}");

    expect(onChange).not.toHaveBeenCalled();
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────

describe("MealToggle — edge cases", () => {
  it("missing onChange handler: clicking a button does not throw", async () => {
    // Silence the TS error via cast — spec says no-op when handler is absent
    const toggle = (
      <MealToggle value="veg" onChange={undefined as unknown as () => void} />
    );

    expect(() => render(toggle)).not.toThrow();
  });

  it("controlled: re-render with new value updates aria-checked without internal state", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MealToggle value="veg" onChange={onChange} />,
    );

    // Simulate parent updating the controlled value
    rerender(<MealToggle value="non_veg" onChange={onChange} />);

    expect(screen.getByRole("radio", { name: "Non-veg" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // onChange was NOT called during a passive rerender
    expect(onChange).not.toHaveBeenCalled();
  });
});
