import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Input } from "./Input";
import { Select } from "./Select";

describe("enter-key field navigation", () => {
  it("moves focus to the next input when Enter is pressed", () => {
    render(
      <div data-enter-nav-scope>
        <Input aria-label="First name" value="" onChange={() => {}} />
        <Input aria-label="Last name" value="" onChange={() => {}} />
      </div>,
    );

    const first = screen.getByLabelText("First name");
    const second = screen.getByLabelText("Last name");

    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });

    expect(document.activeElement).toBe(second);
  });

  it("moves focus from a select to the next field when Enter is pressed", () => {
    render(
      <div data-enter-nav-scope>
        <Select
          aria-label="Branch"
          value="CSE"
          onChange={() => {}}
          options={[{ value: "CSE", label: "CSE" }]}
        />
        <Input aria-label="City" value="" onChange={() => {}} />
      </div>,
    );

    const branch = screen.getByLabelText("Branch");
    const city = screen.getByLabelText("City");

    branch.focus();
    fireEvent.keyDown(branch, { key: "Enter" });

    expect(document.activeElement).toBe(city);
  });
});
