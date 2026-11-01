import { describe, it, expect } from "vitest";
import { selectIntro, type MagazineIntro } from "../magazine";

const CDN = "https://cdn.example.test";

function makeFrame(n: number, mobile = false) {
  const id = `frame-${String(n).padStart(3, "0")}`;
  const prefix = mobile ? "intro-frames-mobile" : "intro-frames";
  return {
    id,
    number: n,
    src: `${CDN}/magazines/magazine-2026/${prefix}/${id}.webp`,
    width: mobile ? 720 : 960,
    height: mobile ? 1280 : 540,
    alt: `frame ${n}`,
  };
}

function makeIntro(): MagazineIntro {
  return {
    frameRate: 15,
    duration: 5.45,
    frameCount: 2,
    width: 960,
    height: 540,
    eyebrow: "From the editor's desk",
    quote: "Full desktop quote with two sentences.",
    credit: "Gita Specimen · EEE 2006",
    frames: [makeFrame(1), makeFrame(2)],
    mobile: {
      frameRate: 15,
      duration: 5.45,
      frameCount: 2,
      width: 720,
      height: 1280,
      quote: "Short mobile quote.",
      frames: [makeFrame(1, true), makeFrame(2, true)],
    },
  };
}

describe("selectIntro", () => {
  it("returns null when intro is undefined", () => {
    expect(selectIntro(undefined, true)).toBeNull();
    expect(selectIntro(undefined, false)).toBeNull();
  });

  it("selects desktop frames when isMobile is false", () => {
    const result = selectIntro(makeIntro(), false);
    expect(result).not.toBeNull();
    expect(result!.isMobile).toBe(false);
    expect(result!.width).toBe(960);
    expect(result!.height).toBe(540);
    expect(result!.frames[0].src).toContain("/intro-frames/");
    expect(result!.frames[0].src).not.toContain("/intro-frames-mobile/");
  });

  it("selects mobile frames when isMobile is true and mobile exists", () => {
    const result = selectIntro(makeIntro(), true);
    expect(result).not.toBeNull();
    expect(result!.isMobile).toBe(true);
    expect(result!.width).toBe(720);
    expect(result!.height).toBe(1280);
    expect(result!.frames[0].src).toContain("/intro-frames-mobile/");
  });

  it("FEATURE: mobile quote overrides desktop quote", () => {
    const result = selectIntro(makeIntro(), true);
    expect(result!.quote).toBe("Short mobile quote.");
  });

  it("desktop uses the full parent quote", () => {
    const result = selectIntro(makeIntro(), false);
    expect(result!.quote).toBe("Full desktop quote with two sentences.");
  });

  it("falls back to parent quote when mobile has no quote", () => {
    const intro = makeIntro();
    intro.mobile!.quote = undefined;
    const result = selectIntro(intro, true);
    expect(result!.quote).toBe("Full desktop quote with two sentences.");
  });

  it("editorial copy always comes from the parent intro", () => {
    const result = selectIntro(makeIntro(), true);
    expect(result!.eyebrow).toBe("From the editor's desk");
    expect(result!.credit).toBe("Gita Specimen · EEE 2006");
  });

  it("selects desktop frames when isMobile is true but no mobile variant exists", () => {
    const intro = makeIntro();
    delete (intro as unknown as Record<string, unknown>).mobile;
    const result = selectIntro(intro, true);
    expect(result!.isMobile).toBe(false);
    expect(result!.width).toBe(960);
  });
});
