import { Toggle } from "@/components/ui/Toggle";
import type { ToggleOption } from "@/components/ui/Toggle";
import { MEAL_LABELS } from "@/lib/constants";

// ── Types ──────────────────────────────────────────────────────────────────

export interface MealToggleProps {
  /** Currently selected meal preference (controlled). */
  value: "veg" | "non_veg";
  /** Called when the user clicks the other option. */
  onChange: (value: "veg" | "non_veg") => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MEAL_OPTIONS: ToggleOption[] = [
  { value: "veg", label: MEAL_LABELS.veg, icon: "🌿" },
  { value: "non_veg", label: MEAL_LABELS.non_veg, icon: "🍗" },
];

// ── Active-class mapping (theme tokens from index.css) ─────────────────────

const mealActiveClass = (value: string) =>
  value === "veg"
    ? "bg-veg-bg border-veg-border text-veg-text"
    : "bg-nonveg-bg border-nonveg-border text-nonveg-text";

// ── Component ──────────────────────────────────────────────────────────────

/** Two-option toggle for Veg / Non-veg meal preference.
 *  Thin wrapper around the Toggle primitive with pre-configured options
 *  and the correct green/terracotta active colors. */
export function MealToggle({ value, onChange }: MealToggleProps) {
  return (
    <Toggle
      options={MEAL_OPTIONS}
      value={value}
      onChange={(v) => onChange(v as "veg" | "non_veg")}
      activeClass={mealActiveClass}
    />
  );
}
