import type { ReactNode } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AttendeeRowProps {
  /** Label text for this row (e.g. "Child", "Guest"). */
  label: string;
  /** Called when the remove button is clicked. */
  onRemove: () => void;
  /** The form fields to render inside the row (inputs, meal toggle, etc.). */
  children: ReactNode;
  /** When true, renders a card-style layout (mobile). @default false */
  isMobile?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

/** A row wrapper for child / guest attendees.
 *
 *  Desktop: compact flex row — label badge on left, fields in middle,
 *           terracotta-ghost remove button on right.
 *
 *  Mobile: card-style block — header row with label + remove, then the
 *          fields stacked below. */

export function AttendeeRow({
  label,
  onRemove,
  children,
  isMobile = false,
}: AttendeeRowProps) {
  const removeBtn = (
    <button
      type="button"
      onClick={onRemove}
      className={[
        "flex items-center justify-center",
        "w-9 h-9 rounded-lg flex-shrink-0",
        "bg-[#FFF0F0] hover:bg-[#FDE2E2]",
        "text-terracotta hover:text-[#C4512F]",
        "transition-colors duration-150",
        "cursor-pointer border-0",
      ].join(" ")}
      aria-label={`Remove ${label.toLowerCase()}`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  );

  // ── Mobile card layout ──
  if (isMobile) {
    return (
      <div
        className={[
          "bg-[#FAFAFA] rounded-xl p-3 mb-2.5",
          "border border-[#F0F0F0]",
        ].join(" ")}
      >
        {/* Header row */}
        <div className="flex justify-between items-center mb-2.5">
          <span className="text-sm font-bold text-subtle uppercase tracking-[0.5px]">
            {label}
          </span>
          {removeBtn}
        </div>

        {/* Form fields (stacked) */}
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    );
  }

  // ── Desktop flex row ──
  return (
    <div className="flex items-start gap-2.5 mb-2.5">
      {/* Label badge (subtle indicator) */}
      <span className="text-sm font-bold text-subtle uppercase tracking-[0.5px] pt-2.5 w-14 flex-shrink-0 text-right">
        {label}
      </span>

      {/* Form fields */}
      <div className="flex-1 flex items-center gap-2.5">{children}</div>

      {/* Remove button */}
      {removeBtn}
    </div>
  );
}
