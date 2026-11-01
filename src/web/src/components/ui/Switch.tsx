// ── Types ──────────────────────────────────────────────────────────────────

export interface SwitchProps {
  /** Whether the switch is in the "on" position. */
  checked: boolean;
  /** Called with the new checked state when toggled. */
  onChange: (checked: boolean) => void;
  /** Optional label displayed to the right of the switch. */
  label?: string;
  /** When true, interaction is blocked. @default false */
  disabled?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

/** A simple toggle switch for boolean settings (spouse on/off, etc.).
 *  Uses the terracotta brand color for the active state. */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: SwitchProps) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      className={[
        "flex items-center gap-3 select-none py-1",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
      ].join(" ")}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    >
      {/* ── Track ── */}
      <div
        className={[
          "relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-200",
          "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]",
          checked ? "bg-terracotta" : "bg-[#E5E7EB]",
        ].join(" ")}
      >
        {/* ── Knob ── */}
        <div
          className={[
            "absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white",
            "shadow-[0_1px_4px_rgba(0,0,0,0.2)]",
            "transition-all duration-200",
            checked ? "left-[23px]" : "left-[3px]",
          ].join(" ")}
        />
      </div>

      {label && (
        <span className="text-[13px] text-charcoal font-medium leading-tight">
          {label}
        </span>
      )}
    </div>
  );
}
