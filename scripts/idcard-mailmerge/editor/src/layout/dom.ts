/**
 * Tiny DOM helpers shared by the canvases and the per-ID editor. Kept out of
 * core/ because it touches the DOM (HTMLElement); core/ is pure data logic.
 */

/** True when a keyboard event targets a text-entry field, so global keyboard
 * shortcuts (canvas nudges, per-ID record navigation) defer to normal typing
 * and caret movement instead of hijacking the key. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}
