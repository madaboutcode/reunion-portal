import type { SelectHTMLAttributes } from "react";
import { useState } from "react";
import { focusNextFieldOnEnter } from "@/lib/focus-navigation";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  /** Options as plain strings or {value, label} pairs. */
  options: readonly string[] | ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
  /** Placeholder rendered as a disabled <option> at the top. */
  placeholder?: string;
  /** When true, renders terracotta border and sets aria-invalid. */
  error?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isStringArray(
  opts: SelectProps["options"],
): opts is readonly string[] {
  return typeof opts[0] === "string";
}

// ── Component ──────────────────────────────────────────────────────────────

export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  error = false,
  className,
  id,
  "aria-describedby": ariaDescribedby,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: SelectProps) {
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? "border-terracotta"
    : focused
      ? "border-soft-aqua"
      : "border-border";

  const baseColor = value ? "text-charcoal" : "text-subtle";

  const selectClasses = [
    "appearance-none",
    "w-full h-[44px]",
    "px-[14px] pr-[32px]",
    "text-[14px] font-body",
    baseColor,
    "bg-white",
    `border-[1.5px] ${borderColor}`,
    "rounded-[10px]",
    "outline-none",
    "box-border",
    "cursor-pointer",
    "transition-[border-color] duration-150",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={onChange}
        disabled={disabled}
        aria-invalid={error || undefined}
        aria-describedby={ariaDescribedby}
        className={selectClasses}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (!e.defaultPrevented) {
            focusNextFieldOnEnter(e);
          }
        }}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {isStringArray(options)
          ? options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))
          : options.map((o, i) => (
              <option key={o.value || `sep-${i}`} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
      </select>
      <span
        className="absolute right-[12px] top-1/2 -translate-y-1/2 pointer-events-none text-subtle text-[10px] select-none"
        aria-hidden="true"
      >
        ▼
      </span>
    </div>
  );
}
