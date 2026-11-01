import type { ReactNode } from "react";

// ── Types ─────────────────────────────────────────────────────────────────

export type BadgeVariant = "success" | "warning" | "error" | "info" | "default";

export interface BadgeProps {
  /** Semantic variant controlling background and text color. */
  variant?: BadgeVariant;
  /** Badge content (usually a short label). */
  children: ReactNode;
}

// ── Variant style maps ────────────────────────────────────────────────────

const variantClasses: Record<BadgeVariant, string> = {
  success: "bg-veg-bg text-veg-text",
  warning: "bg-amber-100 text-amber-800",
  error: "bg-terracotta-light text-terracotta",
  info: "bg-soft-aqua-light text-[#2A7A80]",
  default: "bg-gray-100 text-gray-600",
};

// ── Component ─────────────────────────────────────────────────────────────

export function Badge({ variant = "default", children }: BadgeProps) {
  return (
    <span
      className={[
        "inline-block",
        "px-2",
        "py-px",
        "rounded-[10px]",
        "text-xs",
        "font-medium",
        "leading-normal",
        "select-none",
        variantClasses[variant],
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}
