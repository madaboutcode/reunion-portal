import type { InputHTMLAttributes } from "react";
import { useState } from "react";
import { focusNextFieldOnEnter } from "@/lib/focus-navigation";

// ── Types ──────────────────────────────────────────────────────────────────

export interface InputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "prefix"
  > {
  /** Input type. @default "text" */
  type?: "text" | "email" | "tel" | "number";
  /** Non-interactive label rendered inside the input on the left (e.g. "+91"). */
  prefix?: string;
  /** When true, renders terracotta border and sets aria-invalid. */
  error?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

export function Input({
  value,
  onChange,
  type = "text",
  placeholder,
  disabled = false,
  readOnly = false,
  prefix,
  error = false,
  className,
  id,
  "aria-describedby": ariaDescribedby,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? "border-terracotta"
    : focused
      ? "border-soft-aqua"
      : "border-border";

  const bgClass = disabled || readOnly ? "bg-[#F8F9FB]" : "bg-white";

  const classes = [
    // ── base ──
    "w-full h-[44px]",
    "text-[14px] font-body text-charcoal",
    "placeholder:text-subtle",
    bgClass,
    `border-[1.5px] ${borderColor}`,
    "rounded-[10px]",
    "outline-none",
    "box-border",
    "transition-[border-color] duration-150",
    // ── prefix-aware padding ──
    prefix ? "pl-[38px] pr-[14px]" : "px-[14px]",
    // ── consumer overrides ──
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="relative flex items-center">
      {prefix && (
        <span
          className="absolute left-[13px] text-[13px] text-muted pointer-events-none select-none"
          aria-hidden="true"
        >
          {prefix}
        </span>
      )}
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={error || undefined}
        aria-describedby={ariaDescribedby}
        className={classes}
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
      />
    </div>
  );
}
