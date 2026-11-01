import { describe, expect, it } from "vitest";
import { layerForKind } from "./layers";

describe("layerForKind — R8's three fixed layers", () => {
  it.each([
    ["sprite_alpha", "doodles"],
    ["nostalgia_opaque", "doodles"],
    ["photo_box", "photo_logo"],
    ["logo_alpha", "photo_logo"],
    ["text_static", "text"],
    ["line", "text"],
    ["name", "text"],
    ["branch", "text"],
    ["id_badge", "text"],
  ] as const)("%s -> %s", (kind, expected) => {
    expect(layerForKind(kind)).toBe(expected);
  });
});
