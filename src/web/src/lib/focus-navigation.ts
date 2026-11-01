import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const FIELD_SELECTOR = [
  "input:not([type='hidden']):not([disabled]):not([readonly])",
  "select:not([disabled])",
  "textarea:not([disabled]):not([readonly])",
].join(", ");

export function focusNextFieldOnEnter(
  event: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>,
) {
  if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  const current = event.currentTarget;
  const scope =
    current.closest("[data-enter-nav-scope]") ??
    current.form ??
    document.body;

  const fields = Array.from(scope.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(
    (field) => field.tabIndex !== -1,
  );
  const currentIndex = fields.indexOf(current);
  const nextField = currentIndex >= 0 ? fields[currentIndex + 1] : null;

  if (!nextField) return;

  event.preventDefault();
  nextField.focus();
  if (
    nextField instanceof HTMLInputElement &&
    nextField.type !== "checkbox" &&
    nextField.type !== "radio"
  ) {
    nextField.select();
  }
}
