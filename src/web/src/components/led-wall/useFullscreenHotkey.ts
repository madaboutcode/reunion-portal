import { useEffect } from "react";

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Toggles browser fullscreen on the document root when the user presses unmodified
 * `f`/`F`, so the wall fills a venue screen with no on-screen control and any strip
 * mounted above the wall (the debug strip on the debug route) stays visible.
 *
 * Failures are non-fatal by design (see led-wall.spec.md R19.3): a missing or denied
 * Fullscreen API leaves the wall windowed with no error UI and no unhandled rejection.
 */
export function useFullscreenHotkey() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "f" && event.key !== "F") return;
      if (event.repeat) return;
      // Shift is intentionally allowed: `F` (uppercase) is shift+f and must toggle too.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      if (document.fullscreenElement) {
        void exitFullscreen();
      } else {
        void enterFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

async function enterFullscreen() {
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    // requestFullscreen can be absent (no Fullscreen API) or reject (gesture/permission
    // policy). Either way the wall stays windowed and keeps running — nothing to recover.
  }
}

async function exitFullscreen() {
  try {
    await document.exitFullscreen();
  } catch {
    // exitFullscreen can be absent or reject; the wall just stays windowed.
  }
}
