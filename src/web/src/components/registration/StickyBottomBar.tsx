// ── Types ──────────────────────────────────────────────────────────────────

export interface StickyBottomBarProps {
  /** Called when the Back button is clicked. */
  onBack?: () => void;
  /** Called when the Next / Continue button is clicked. */
  onNext: () => void;
  /** Label for the primary action button. @default "Continue" */
  nextLabel?: string;
  /** When true, the primary button is visually disabled. @default false */
  nextDisabled?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

/** Fixed bottom bar for mobile step navigation.
 *  Renders Back (secondary) + Continue (primary gradient) buttons. */
export function StickyBottomBar({
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled = false,
}: StickyBottomBarProps) {
  return (
    <div
      className={[
        "fixed fixed-bottom-safe left-0 right-0",
        "bg-white border-t border-border",
        "px-4 py-2.5",
        "flex gap-2.5",
        "z-[300]",
        "shadow-[0_-4px_24px_rgba(31,42,51,0.1)]",
      ].join(" ")}
    >
      {/* ── Back ── */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          data-testid="wizard-back-mobile"
          className={[
            "h-12 px-[18px]",
            "border-[1.5px] border-border rounded-xl",
            "bg-white text-[#374151]",
            "text-base font-semibold font-body",
            "cursor-pointer whitespace-nowrap flex-shrink-0",
            "hover:border-muted active:bg-[#F9FAFB]",
            "transition-colors duration-150",
          ].join(" ")}
        >
          ← Back
        </button>
      )}

      {/* ── Continue ── */}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        data-testid="wizard-continue-mobile"
        className={[
          "flex-1 h-12",
          "border-0 rounded-xl",
          "text-white text-[15px] font-bold font-body",
          "transition-opacity duration-150",
          nextDisabled
            ? "bg-[#D1D5DB] cursor-not-allowed"
            : [
                "bg-linear-to-br from-terracotta to-[#C45A40]",
                "cursor-pointer",
                "shadow-[0_2px_10px_rgba(215,107,81,0.3)]",
                "hover:brightness-95 active:brightness-90",
              ].join(" "),
        ].join(" ")}
      >
        {nextLabel}
      </button>
    </div>
  );
}
