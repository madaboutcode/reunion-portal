# Specification: MealToggle

## Purpose

A two-option segmented control for selecting Veg or Non-veg meal preference per attendee. Used in the AttendeesMeals step (wizard step 3) for every attendee row.

## Scope

**MUST:** Veg / Non-veg toggle with emoji icons, color-coded active states, keyboard accessible
**WILL NOT:** Custom meal types (only Veg/Non-veg per spec), multi-select

## Requirements

### Visual

R1 — Two equal-width buttons side by side (flex row, gap 8px)

R2 — Each button: 40px height, border radius 9px, 12px font, font-weight 700

R3 — Veg active: green-tinted background (#EBF7F0), green border (#2D9B67), green text (#1E7A4A), 🌿 icon

R4 — Non-veg active: terracotta-tinted background (#FDF3EF), terracotta border (#D76B51), terracotta text (#C4512F), 🍗 icon

R5 — Inactive button: white background, gray border (#E5E7EB), muted text (#9CA3AF)

R6 — Transition: all 0.15s on background, border, color

### Behavior

R7 — `value` is `'veg' | 'non_veg'` (controlled by parent)

R8 — `onChange(value)` called when either button is clicked with the new value

R9 — Exactly one option is active at all times (no unselected state)

### Accessibility

R10 — Behaves as a radiogroup: `role="radiogroup"`, each button has `role="radio"` with `aria-checked`

R11 — Keyboard: Left/Right arrow switches between options (roving tabindex pattern)

## States

| State | Visual |
|-------|--------|
| Veg selected | Veg button green-tinted, Non-veg gray |
| Non-veg selected | Non-veg terracotta-tinted, Veg gray |

## Edge Cases

- **Rapid toggle**: Each click fires onChange with the selected value; no debounce needed (instant visual feedback)
- **Same value clicked**: No-op (already active button)
- **Missing onChange handler**: No-op (button does nothing)

## Data Flow

```
Props:
  value: 'veg' | 'non_veg'
  onChange: (value: 'veg' | 'non_veg') => void

Emits:
  onChange with new value on button click
```

## Dependencies

- `theme.spec.md` for veg/non-veg status colors
