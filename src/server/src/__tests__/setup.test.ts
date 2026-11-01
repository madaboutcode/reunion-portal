import { describe, it, expect } from "vitest";

describe("test infrastructure", () => {
  it("vitest runs in server package", () => {
    expect(1 + 1).toBe(2);
  });
});
