import type { ReactNode } from "react";

// ── CardHeader ────────────────────────────────────────────────────────────

export interface CardHeaderProps {
  /** Icon displayed to the left of the title. */
  icon?: ReactNode;
  /** Header title text. */
  title: string;
  /** Action element rendered on the right (e.g. an "Edit" button). */
  action?: ReactNode;
  /** Optional accent strip below the header (CSS color value). */
  accent?: string;
}

export function CardHeader({
  icon,
  title,
  action,
  accent,
}: CardHeaderProps) {
  return (
    <div
      className="flex items-center gap-3 px-5 py-3"
      style={
        accent
          ? {
              borderBottom: `2px solid ${accent}`,
              paddingBottom: "calc(0.75rem - 2px)",
            }
          : undefined
      }
    >
      {icon && (
        <span className="flex-shrink-0 text-charcoal/70">{icon}</span>
      )}
      <h3 className="font-heading text-base font-bold text-charcoal flex-1">
        {title}
      </h3>
      {action && (
        <span className="flex-shrink-0">{action}</span>
      )}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Add default inner padding. @default true */
  padding?: boolean;
}

export function Card({
  children,
  className,
  padding = true,
}: CardProps) {
  return (
    <div
      className={[
        "bg-surface",
        "border border-border-warm",
        "rounded-2xl",
        "overflow-hidden",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        boxShadow: "0 2px 10px rgba(80, 60, 40, 0.06)",
      }}
    >
      {padding ? (
        <div className="p-5">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
