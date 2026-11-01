import { describe, expect, it } from "vitest";
import { peopleCount, planRooms, roomCount } from "../accommodation-room-plan";

describe("accommodation room planning", () => {
  it("rounds shared rooms separately by gender", () => {
    const double = planRooms("shared_double", { male: 20, female: 5, other: 0 });
    const triple = planRooms("shared_triple", { male: 25, female: 22, other: 0 });

    expect(roomCount(double.rooms)).toBe(13);
    expect(roomCount(triple.rooms)).toBe(17);
    expect(roomCount(double.rooms) + roomCount(triple.rooms) + 13).toBe(43);
  });

  it("reports vacant capacity inside each gender's rooms", () => {
    expect(planRooms("shared_triple", { male: 25, female: 22, other: 0 }).vacantBeds).toEqual({
      male: 2,
      female: 2,
      other: 0,
    });
  });

  it("treats private rooms as one-person rooms", () => {
    const occupants = { male: 10, female: 3, other: 0 };
    const plan = planRooms("private", occupants);

    expect(peopleCount(occupants)).toBe(13);
    expect(roomCount(plan.rooms)).toBe(13);
    expect(plan.vacantBeds).toEqual({ male: 0, female: 0, other: 0 });
  });
});
