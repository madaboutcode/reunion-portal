import type { KeyboardEvent } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ToggleOption {
  value: string;
  label: string;
  icon?: string;
}

export interface ToggleProps {
  /** The two options to display. */
  options: ToggleOption[];
  /** Currently selected value (controlled). */
  value: string;
  /** Called when selection changes. */
  onChange: (value: string) => void;
  /** Optional function returning extra Tailwind classes for the active button.
   *  Classes are appended after the default active classes, so they override
   *  bg/border/text for variant-specific coloring (e.g. veg/non-veg). */
  activeClass?: (value: string) => string;
  /** Extra Tailwind classes appended to EVERY option button, after both the
   *  base and active/inactive classes, so they override (e.g. a taller 44px
   *  touch target for payment method controls). Same append-override pattern
   *  as `activeClass`. */
  optionClassName?: string;
  /** When true, all options are non-interactive. @default false */
  disabled?: boolean;
  /** Optional className for the radiogroup container. */
  className?: string;
  /** Accessible name for the radiogroup — id of the element that labels it
   *  (e.g. a visible "Payment mode" label). Prefer this over `ariaLabel`
   *  when a visible label already exists, so sighted and screen-reader users
   *  see the same text. */
  ariaLabelledBy?: string;
  /** Accessible name for the radiogroup when there's no visible label to
   *  reference via `ariaLabelledBy`. */
  ariaLabel?: string;
}

// ── Default active styles (overridable via activeClass) ────────────────────

const DEFAULT_ACTIVE = [
  "bg-soft-aqua-light",
  "border-soft-aqua",
  "text-charcoal",
].join(" ");

// ── Component ──────────────────────────────────────────────────────────────

export function Toggle({
  options,
  value,
  onChange,
  activeClass,
  optionClassName,
  disabled = false,
  className,
  ariaLabelledBy,
  ariaLabel,
}: ToggleProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (options.length === 0) return;

    const currentIndex = options.findIndex((o) => o.value === value);
    const isNext = e.key === "ArrowRight" || e.key === "ArrowDown";
    const isPrev = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!isNext && !isPrev) return;
    e.preventDefault();

    // ARIA radio-group pattern: when NO option is checked, arrow keys move to
    // and select the FIRST option (a controlled group that starts unselected,
    // e.g. the desk payment method, must still be keyboard-selectable).
    const nextIndex =
      currentIndex === -1
        ? 0
        : isNext
          ? (currentIndex + 1) % options.length
          : (currentIndex - 1 + options.length) % options.length;

    if (nextIndex !== currentIndex) {
      onChange(options[nextIndex].value);
    }
  };

  return (
    <div
      role="radiogroup"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
      onKeyDown={handleKeyDown}
      className={[
        "flex gap-2",
        "focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2",
        "outline-none rounded-[11px]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        const extraActive = activeClass?.(option.value) ?? "";

        const buttonClasses = [
          // ── base ──
          "flex-1 flex items-center justify-center gap-[5px]",
          "h-10",
          "border-[1.5px]",
          "rounded-[9px]",
          "text-xs font-bold",
          "font-body",
          "transition-all duration-150",
          "select-none",
          "outline-none",
          disabled && "opacity-60",

          // ── active / inactive ──
          isActive
            ? [DEFAULT_ACTIVE, extraActive].filter(Boolean).join(" ")
            : "bg-white border-border text-subtle",

          // ── cursor ──
          disabled ? "cursor-not-allowed" : "cursor-pointer",

          // ── per-instance overrides (appended last so they win the cascade,
          //    same pattern as activeClass) ──
          optionClassName,
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={-1}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onChange(option.value);
            }}
            className={buttonClasses}
          >
            {option.icon && (
              <span aria-hidden="true" className="leading-none">
                {option.icon}
              </span>
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
