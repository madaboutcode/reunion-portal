import { describe, expect, it } from "vitest";
import { mapEditAttendees } from "./registration-detail.helpers";

describe("staff attendee edit mapping", () => {
  it("preserves newborn age 0 and derives the free-child chargeability", () => {
    const [newborn] = mapEditAttendees([{
      _tempId: "child-0",
      type: "child",
      name: "Baby",
      age: "0",
      relationship: "",
      meal: "veg",
    }]);

    expect(newborn.age).toBe(0);
    expect(newborn.isChargeable).toBe(false);
  });

  it("marks a child at the pricing threshold as chargeable", () => {
    const [child] = mapEditAttendees([{
      _tempId: "child-6",
      type: "child",
      name: "Six",
      age: "6",
      relationship: "",
      meal: "non_veg",
    }]);

    expect(child.age).toBe(6);
    expect(child.isChargeable).toBe(true);
  });
});
