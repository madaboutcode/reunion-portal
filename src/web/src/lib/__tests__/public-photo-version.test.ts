import { describe, expect, it } from "vitest";
import { publicPhotoUrl } from "@/lib/api";

describe("public photo cache versioning", () => {
  it("includes the global photo version and changes the URL when that version advances", () => {
    const before = publicPhotoUrl(42, "https://cdn.example/photos", 1_752_600_000_000);
    const after = publicPhotoUrl(42, "https://cdn.example/photos", 1_752_600_000_001);

    expect(before).toBe("https://cdn.example/photos/42.jpg?v=1752600000000");
    expect(after).toBe("https://cdn.example/photos/42.jpg?v=1752600000001");
    expect(after).not.toBe(before);
  });
});
