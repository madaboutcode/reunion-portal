import type { ButtonHTMLAttributes, ReactNode } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style variant. @default "primary" */
  variant?: ButtonVariant;
  /** Height preset. @default "md" (44px) */
  size?: ButtonSize;
  /** Show a spinner and disable interaction without graying out. */
  loading?: boolean;
  /** Button label or content. */
  children: ReactNode;
}

// ── Style maps ─────────────────────────────────────────────────────────────

const variantClasses: Record<ButtonVariant, string> = {
  primary: [
    "bg-linear-to-br from-terracotta to-[#C45A40]",
    "text-white",
    "shadow-md",
    "hover:brightness-90",
    "active:brightness-85",
  ].join(" "),

  secondary: [
    "bg-white",
    "border-[1.5px] border-border",
    "text-charcoal",
    "hover:border-terracotta hover:text-terracotta",
    "active:bg-terracotta-light",
  ].join(" "),

  ghost: [
    "bg-transparent",
    "text-charcoal",
    "hover:bg-terracotta-light hover:text-terracotta",
    "active:bg-terracotta-light/70",
  ].join(" "),
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm rounded-lg",
  md: "h-11 px-5 text-base",
  lg: "h-[54px] px-7 text-base",
};

const spinnerSize: Record<ButtonSize, string> = {
  sm: "h-3.5 w-3.5 border-[1.5px]",
  md: "h-5 w-5 border-2",
  lg: "h-6 w-6 border-2",
};

const disabledClasses =
  "bg-[#D1D5DB] bg-none text-muted cursor-not-allowed shadow-none border-transparent";

// ── Component ──────────────────────────────────────────────────────────────

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  className,
  children,
  onClick,
  "aria-label": ariaLabelProp,
  ...rest
}: ButtonProps) {
  const isActionDisabled = disabled || loading;
  const isVisuallyDisabled = disabled && !loading;
  const finalAriaLabel = loading ? "Loading" : ariaLabelProp;

  const classes = [
    // ── base ──
    "relative inline-flex items-center justify-center",
    "font-semibold",
    "rounded-xl",
    "focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2",
    "transition duration-150",
    "select-none",
    "cursor-pointer",
    "whitespace-nowrap",

    // ── variant ──
    variantClasses[variant],

    // ── size ──
    sizeClasses[size],

    // ── disabled visual (not loading) ──
    isVisuallyDisabled && disabledClasses,

    // ── consumer overrides ──
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      disabled={isActionDisabled}
      aria-disabled={disabled || undefined}
      aria-busy={loading || undefined}
      aria-label={finalAriaLabel}
      onClick={isActionDisabled ? undefined : onClick}
      {...rest}
    >
      {/* Spinner — only when loading and not explicitly disabled */}
      {loading && !disabled && (
        <span
          className="absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
        >
          <span
            className={[
              "animate-spin rounded-full border-current border-t-transparent",
              spinnerSize[size],
            ].join(" ")}
          />
        </span>
      )}

      {/* Children hidden during loading to preserve width. inline-flex keeps an
          svg icon + label on one line — Tailwind v4 preflight forces svg to
          display:block, so a plain inline/block span would stack them. */}
      <span className={`inline-flex items-center justify-center gap-1.5 ${loading && !disabled ? "invisible" : undefined}`}>
        {children}
      </span>
    </button>
  );
}
