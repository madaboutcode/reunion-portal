import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "../App";

vi.mock("../pages/AutographPage", () => ({
  default: () => <div>AUTOGRAPH PAGE MARKER</div>,
}));

function LocationMarker() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
      {location.hash}
    </div>
  );
}

describe("autograph short URL", () => {
  it("redirects /autograph to the canonical stories route without query or hash", () => {
    render(
      <MemoryRouter initialEntries={["/autograph?source=poster#page"]}>
        <App />
        <LocationMarker />
      </MemoryRouter>,
    );

    expect(screen.getByText("AUTOGRAPH PAGE MARKER")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/memories\/stories$/);
  });
});
