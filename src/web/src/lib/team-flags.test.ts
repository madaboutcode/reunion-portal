import { describe, expect, it } from "vitest";
import { getTeamFlagCode, getTeamFlagEmoji } from "./team-flags";

describe("getTeamFlagCode", () => {
  it("maps standard country names", () => {
    expect(getTeamFlagCode("Mexico")).toBe("MX");
    expect(getTeamFlagCode("Japan")).toBe("JP");
  });

  it("maps world-cup aliases and punctuation variants", () => {
    expect(getTeamFlagCode("USA")).toBe("US");
    expect(getTeamFlagCode("South Korea")).toBe("KR");
    expect(getTeamFlagCode("Bosnia & Herzegovina")).toBe("BA");
    expect(getTeamFlagCode("Curaçao")).toBe("CW");
    expect(getTeamFlagCode("Ivory Coast")).toBe("CI");
    expect(getTeamFlagCode("Turkey")).toBe("TR");
  });

  it("returns null for knockout placeholders", () => {
    expect(getTeamFlagCode("W101")).toBeNull();
    expect(getTeamFlagCode("1A")).toBeNull();
  });
});

describe("getTeamFlagEmoji", () => {
  it("builds an emoji flag from the team code", () => {
    expect(getTeamFlagEmoji("Mexico")).toBe("🇲🇽");
  });

  it("returns emoji for subdivision countries (Scotland, England, Wales)", () => {
    expect(getTeamFlagEmoji("Scotland")).toBe(
      String.fromCodePoint(
        0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f,
      ),
    );
    expect(getTeamFlagEmoji("England")).toBe(
      String.fromCodePoint(
        0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f,
      ),
    );
    expect(getTeamFlagEmoji("Wales")).toBe(
      String.fromCodePoint(
        0x1f3f4, 0xe0067, 0xe0062, 0xe0077, 0xe006c, 0xe0073, 0xe007f,
      ),
    );
  });

  it("returns emoji for Turkey alias", () => {
    expect(getTeamFlagEmoji("Turkey")).toBe("🇹🇷");
  });

  it("returns null for knockout placeholders", () => {
    expect(getTeamFlagEmoji("W101")).toBeNull();
  });
});
