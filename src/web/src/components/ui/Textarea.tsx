import type { TextareaHTMLAttributes } from "react";
import { useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** When true, renders terracotta border and sets aria-invalid. */
  error?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

export function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled = false,
  error = false,
  className,
  id,
  "aria-describedby": ariaDescribedby,
  onFocus,
  onBlur,
  ...rest
}: TextareaProps) {
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? "border-terracotta"
    : focused
      ? "border-soft-aqua"
      : "border-border";

  const bgClass = disabled ? "bg-[#F8F9FB]" : "bg-white";

  const classes = [
    // ── base ──
    "w-full",
    "py-[12px] px-[14px]",
    "text-[13px] font-body text-charcoal",
    "leading-[1.5]",
    "placeholder:text-subtle",
    bgClass,
    `border-[1.5px] ${borderColor}`,
    "rounded-[10px]",
    "outline-none",
    "box-border",
    "resize-y",
    "transition-[border-color] duration-150",
    // ── consumer overrides ──
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <textarea
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
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
      {...rest}
    />
  );
}
