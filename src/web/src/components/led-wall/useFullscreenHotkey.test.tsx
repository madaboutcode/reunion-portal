/**
 * LED wall — fullscreen hotkey (led-wall.spec.md R19–R19.3).
 *
 * jsdom provides none of the Fullscreen API (`fullscreenElement`,
 * `requestFullscreen`, `exitFullscreen` are all absent), so the tests install
 * an observable stub: `requestFullscreen` records that it was called on the
 * document root and flips the fake `fullscreenElement` getter; `exitFullscreen`
 * flips it back. "Browser lacks the API" (R19.3) is simply the default jsdom
 * state, and the test asserts no unhandled rejection surfaces.
 *
 * Real fullscreen geometry and rendering are not exercised here — those need a
 * real browser and are verified manually on a venue screen.
 */
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFullscreenHotkey } from "./useFullscreenHotkey";
import { LedWall } from "./LedWall";
import type { LedWallDataSource } from "./types";

// ---------------------------------------------------------------------------
// Fullscreen API stub — an observable fake, not a silent stub. The mocks flip
// a `fakeFullscreenElement` that the `fullscreenElement` getter reads back, so
// a rejected request (which never sets it) honestly leaves the page windowed.
// ---------------------------------------------------------------------------

let fakeFullscreenElement: Element | null;

function installFullscreenApi() {
  fakeFullscreenElement = null;
  const requestFullscreen = vi.fn(async () => {
    fakeFullscreenElement = document.documentElement;
  });
  const exitFullscreen = vi.fn(async () => {
    fakeFullscreenElement = null;
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fakeFullscreenElement,
  });
  document.documentElement.requestFullscreen = requestFullscreen;
  document.exitFullscreen = exitFullscreen;
}

function removeFullscreenApi() {
  delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
  delete (document as { exitFullscreen?: unknown }).exitFullscreen;
  fakeFullscreenElement = null;
}

const requestFullscreenMock = () => vi.mocked(document.documentElement.requestFullscreen);
const exitFullscreenMock = () => vi.mocked(document.exitFullscreen);

/** `f` typed into a focused element — bubbles to the window listener. */
function keydownOn(element: Element | Window, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(element, { key: "f", ...init });
}

beforeEach(() => {
  installFullscreenApi();
});

afterEach(() => {
  cleanup();
  removeFullscreenApi();
});

// ---------------------------------------------------------------------------
// R19 — toggle on unmodified f/F
// ---------------------------------------------------------------------------

describe("useFullscreenHotkey — R19 toggle", () => {
  it("requests fullscreen on the document root when the page is windowed", async () => {
    renderHook(() => useFullscreenHotkey());

    keydownOn(window);

    expect(requestFullscreenMock()).toHaveBeenCalledTimes(1);
    // The receiver must be the document root — a strip above the wall stays visible.
    expect(requestFullscreenMock().mock.contexts[0]).toBe(document.documentElement);
  });

  it("exits fullscreen when the page is already fullscreen", async () => {
    renderHook(() => useFullscreenHotkey());

    keydownOn(window); // enter
    expect(document.fullscreenElement).toBe(document.documentElement);

    keydownOn(window); // exit
    expect(exitFullscreenMock()).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
  });

  it("accepts uppercase F (shift+f) as the same toggle", async () => {
    renderHook(() => useFullscreenHotkey());

    fireEvent.keyDown(window, { key: "F" });
    expect(requestFullscreenMock()).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "F" });
    expect(exitFullscreenMock()).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys entirely", async () => {
    renderHook(() => useFullscreenHotkey());

    for (const key of [" ", "e", "Enter"] as const) {
      fireEvent.keyDown(window, { key });
    }
    expect(requestFullscreenMock()).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R19.1 — editable targets are exempt
// ---------------------------------------------------------------------------

describe("useFullscreenHotkey — R19.1 editable targets", () => {
  it("does not toggle when the event target is an input", async () => {
    renderHook(() => useFullscreenHotkey());
    const { container } = render(<input aria-label="field" />);
    const input = container.querySelector("input")!;

    keydownOn(input);

    expect(requestFullscreenMock()).not.toHaveBeenCalled();
  });

  it("does not toggle when the event target is a textarea", async () => {
    renderHook(() => useFullscreenHotkey());
    const { container } = render(<textarea aria-label="field" />);
    const textarea = container.querySelector("textarea")!;

    keydownOn(textarea);

    expect(requestFullscreenMock()).not.toHaveBeenCalled();
  });

  it("does not toggle when the event target is a select", async () => {
    renderHook(() => useFullscreenHotkey());
    const { container } = render(<select aria-label="field" />);
    const select = container.querySelector("select")!;

    keydownOn(select);

    expect(requestFullscreenMock()).not.toHaveBeenCalled();
  });

  it("does not toggle when the event target is contenteditable", async () => {
    renderHook(() => useFullscreenHotkey());
    const { container } = render(<div aria-label="field" contentEditable />);
    const editable = container.querySelector("div")!;
    // jsdom doesn't implement `isContentEditable` — give the element the property.
    Object.defineProperty(editable, "isContentEditable", { configurable: true, get: () => true });

    keydownOn(editable);

    expect(requestFullscreenMock()).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R19.2 — no auto-repeat, no Ctrl/Alt/Meta
// ---------------------------------------------------------------------------

describe("useFullscreenHotkey — R19.2 repeat and modifiers", () => {
  it("ignores auto-repeated keydown events", async () => {
    renderHook(() => useFullscreenHotkey());

    keydownOn(window, { repeat: true });

    expect(requestFullscreenMock()).not.toHaveBeenCalled();
  });

  it("ignores Ctrl+F, Alt+F, and Meta+F", async () => {
    renderHook(() => useFullscreenHotkey());

    for (const init of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      keydownOn(window, init);
    }

    expect(requestFullscreenMock()).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R19.3 — no API or denied request: wall keeps running, nothing surfaces
// ---------------------------------------------------------------------------

describe("useFullscreenHotkey — R19.3 graceful absence", () => {
  it("stays windowed with no unhandled rejection when the Fullscreen API is absent", async () => {
    removeFullscreenApi(); // jsdom's default state — the R19.3 scenario
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      renderHook(() => useFullscreenHotkey());

      keydownOn(window);
      await act(async () => { await Promise.resolve(); });

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("keeps running when a fullscreen request is denied", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      document.documentElement.requestFullscreen = vi.fn(async () => {
        throw new DOMException("denied", "NotAllowedError");
      });
      renderHook(() => useFullscreenHotkey());

      keydownOn(window);
      await act(async () => { await Promise.resolve(); });

      expect(unhandled).toEqual([]);
      // Denied → still windowed, and a later press retries rather than wedging.
      expect(fakeFullscreenElement).toBeNull();
      keydownOn(window);
      await act(async () => { await Promise.resolve(); });
      expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(2);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

// ---------------------------------------------------------------------------
// LedWall wiring — the feature works through the component (both wall routes
// mount LedWall, so one wiring proves both).
// ---------------------------------------------------------------------------

describe("LedWall fullscreen wiring", () => {
  it("presses f on the mounted wall and enters fullscreen on the document root", async () => {
    const source: LedWallDataSource = {
      getSnapshot: async () => [],
      subscribe: () => () => {},
    };
    render(<LedWall source={source} controls={false} />);
    await act(async () => { await Promise.resolve(); });

    keydownOn(window);

    expect(requestFullscreenMock()).toHaveBeenCalledTimes(1);
    expect(requestFullscreenMock().mock.contexts[0]).toBe(document.documentElement);
    expect(document.fullscreenElement).toBe(document.documentElement);
  });
});
