import type { ReactNode } from "react";
import { useId, cloneElement, isValidElement } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface FormFieldProps {
  /** Label text rendered above the input. */
  label?: string;
  /** When true, renders a terracotta asterisk (*) after the label. */
  required?: boolean;
  /** Error message displayed below the input in terracotta. Takes precedence over hint. */
  error?: string;
  /** Hint text displayed below the input when there is no error. */
  hint?: string;
  /** The input primitive (Input, Select, Textarea, etc.). */
  children: ReactNode;
}

// ── Component ──────────────────────────────────────────────────────────────

export function FormField({
  label,
  required = false,
  error,
  hint,
  children,
}: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;

  // Pass aria attributes to the child input when applicable
  let enhancedChildren = children;
  if (isValidElement(children) && (error || required)) {
    const extraProps: Record<string, unknown> = {};
    if (error) extraProps["aria-describedby"] = errorId;
    if (required) extraProps["aria-required"] = true;
    enhancedChildren = cloneElement(children, extraProps);
  }

  return (
    <div>
      {label && (
        <label className="block text-sm font-semibold text-[#374151] mb-[6px] tracking-[0.1px]">
          {label}
          {required && (
            <span className="text-terracotta ml-[2px]">*</span>
          )}
        </label>
      )}
      {enhancedChildren}
      {error ? (
        <p id={errorId} className="text-sm text-terracotta mt-1">
          ⚠ {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-subtle mt-1 leading-[1.4]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
