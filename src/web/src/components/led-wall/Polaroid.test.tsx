import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Polaroid } from "./Polaroid";
import type { PolaroidCard } from "./layout";
import type { PresentAttendee } from "./types";

afterEach(() => cleanup());

function makeAttendee(
  id: number,
  portraitUrl: string | null,
  thumbnailUrl: string | null = null,
  fullName = `Person ${id}`,
): PresentAttendee {
  return {
    id,
    fullName,
    branch: "Computer Science & Engineering",
    portraitUrl,
    thumbnailUrl,
    checkedInAt: 1_780_000_000_000 + id,
  };
}

function makeGeometry(attendeeId: number): PolaroidCard {
  return {
    attendeeId,
    name: `Person ${attendeeId}`,
    ini: "P" + attendeeId,
    width: 200,
    mat: 12,
    matBottom: 40,
    capPad: 6,
    photoHeight: 180,
    rotation: 1.2,
    marginTop: 0,
    paper: "linear-gradient(155deg,#f2e7cf,#d9c9a6)",
    bg: "linear-gradient(150deg,#40525e,#202b33)",
    veil: 0.1,
    tapeX: 10,
    tapeW: 40,
    tapeR: -3,
    tapeOp: 0.8,
    initialsSize: 40,
    nameSize: 14,
    subSize: 10,
    branchShort: "CSE",
    floatDur: 6,
    floatDelay: 0,
  };
}

describe("Polaroid — FIX C: imageFailed must not leak across attendees", () => {
  it("shows the portrait image when a portraitUrl is present and hasn't failed", () => {
    const attendee = makeAttendee(1, "https://cdn.example.com/1.webp");
    const { container } = render(<Polaroid attendee={attendee} geometry={makeGeometry(1)} />);

    expect(container.querySelector(".led-wall-polaroid__portrait")).toBeInTheDocument();
    expect(container.querySelector(".led-wall-initials")).not.toBeInTheDocument();
  });

  it("falls back to initials after the image errors", () => {
    const attendee = makeAttendee(1, "https://cdn.example.com/1.webp");
    const { container } = render(<Polaroid attendee={attendee} geometry={makeGeometry(1)} />);

    const img = container.querySelector(".led-wall-polaroid__portrait");
    expect(img).toBeInTheDocument();
    fireEvent.error(img as HTMLImageElement);

    expect(container.querySelector(".led-wall-polaroid__portrait")).not.toBeInTheDocument();
    expect(container.querySelector(".led-wall-initials")).toBeInTheDocument();
  });

  it("a new attendee (same component instance, no remount) does not inherit the previous attendee's failed-image state", () => {
    const first = makeAttendee(1, "https://cdn.example.com/1.webp");
    const second = makeAttendee(2, "https://cdn.example.com/2.webp");
    const { container, rerender } = render(<Polaroid attendee={first} geometry={makeGeometry(1)} />);

    const img = container.querySelector(".led-wall-polaroid__portrait");
    fireEvent.error(img as HTMLImageElement);
    expect(container.querySelector(".led-wall-initials")).toBeInTheDocument(); // failed for attendee 1

    // Same Polaroid instance, same JSX position — a spotlight/rotation slot getting reused
    // for a different attendee, exactly like the real wall does mid-rotation.
    rerender(<Polaroid attendee={second} geometry={makeGeometry(2)} />);

    expect(container.querySelector(".led-wall-polaroid__portrait")).toBeInTheDocument(); // attendee 2's image gets a fresh chance
    expect(container.querySelector(".led-wall-initials")).not.toBeInTheDocument();
  });
});

describe("Polaroid — three-tier photo fallback (cutout -> thumbnail -> initials)", () => {
  it("case 17: cutout wins when both portraitUrl and thumbnailUrl are present", () => {
    const attendee = makeAttendee(1, "https://cdn/p/1.webp", "https://cdn/1.jpg");
    const { container } = render(<Polaroid attendee={attendee} geometry={makeGeometry(1)} />);

    const img = container.querySelector(".led-wall-polaroid__portrait") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe("https://cdn/p/1.webp");
  });

  it("case 18: no cutout, thumbnail present -> renders thumbnail, no error event needed", () => {
    const attendee = makeAttendee(1, null, "https://cdn/1.jpg");
    const { container } = render(<Polaroid attendee={attendee} geometry={makeGeometry(1)} />);

    const img = container.querySelector(".led-wall-polaroid__portrait") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe("https://cdn/1.jpg");
    expect(container.querySelector(".led-wall-initials")).not.toBeInTheDocument();
  });

  it("case 19: cutout 404s -> falls to thumbnail", () => {
    const attendee = makeAttendee(1, "https://cdn/p/1.webp", "https://cdn/1.jpg");
    const { container } = render(<Polaroid attendee={attendee} geometry={makeGeometry(1)} />);

    const cutoutImg = container.querySelector(".led-wall-polaroid__portrait") as HTMLImageElement;
    fireEvent.error(cutoutImg);

    const img = container.querySelector(".led-wall-polaroid__portrait") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe("https://cdn/1.jpg");
  });

  it("case 20: both cutout and thumbnail fail -> initials", () => {
    const attendee = makeAttendee(1, "https://cdn/p/1.webp", "https://cdn/1.jpg", "Asha Nair");
    const { container } = render(<Polaroid attendee={attendee} geometry={makeGeometry(1)} />);

    fireEvent.error(container.querySelector(".led-wall-polaroid__portrait") as HTMLImageElement);
    fireEvent.error(container.querySelector(".led-wall-polaroid__portrait") as HTMLImageElement);

    expect(container.querySelector(".led-wall-polaroid__portrait")).not.toBeInTheDocument();
    const initials = container.querySelector(".led-wall-initials");
    expect(initials).toBeInTheDocument();
    expect(initials?.textContent).toBe("AN");
  });

  it("case 21: both portraitUrl and thumbnailUrl null -> initials immediately, no img requested", () => {
    const attendee = makeAttendee(1, null, null);
    const { container } = render(<Polaroid attendee={attendee} geometry={makeGeometry(1)} />);

    expect(container.querySelector(".led-wall-polaroid__portrait")).not.toBeInTheDocument();
    expect(container.querySelector(".led-wall-initials")).toBeInTheDocument();
  });

  it("case 22: tier resets when the slot's attendee changes (identity key carries both urls)", () => {
    const asha = makeAttendee(1, "https://cdn/p/1.webp", "https://cdn/1.jpg", "Asha Nair");
    const { container, rerender } = render(<Polaroid attendee={asha} geometry={makeGeometry(1)} />);

    fireEvent.error(container.querySelector(".led-wall-polaroid__portrait") as HTMLImageElement);
    fireEvent.error(container.querySelector(".led-wall-polaroid__portrait") as HTMLImageElement);
    expect(container.querySelector(".led-wall-initials")).toBeInTheDocument(); // exhausted for attendee 1

    const devika = makeAttendee(2, "https://cdn/p/2.webp", "https://cdn/2.jpg", "Devika Kurian");
    rerender(<Polaroid attendee={devika} geometry={makeGeometry(2)} />);

    const img = container.querySelector(".led-wall-polaroid__portrait") as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe("https://cdn/p/2.webp");
    expect(container.querySelector(".led-wall-initials")).not.toBeInTheDocument();
  });
});
