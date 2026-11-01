# Specification: Select

## Purpose

A dropdown select field with consistent styling matching Input — used for branch selection, room preference, and other enumerated choices.

## Scope

**MUST:** Single-select dropdown, custom chevron, placeholder option, options as strings or {value, label} pairs, 44px height
**WILL NOT:** Multi-select, search/filter within dropdown, grouped options (not needed for current use cases)

## Requirements

### Visual

R1 — Height: 44px, consistent with Input

R2 — Border: 1.5px solid, same default/focus/error colors as Input

R3 — Border radius: 10px, consistent with Input

R4 — Custom chevron icon (▼) positioned absolute right, replaces native select arrow

R5 — Font: 14px, `font-body`, charcoal when value selected, subtle (#9CA3AF) when showing placeholder

R6 — Background: white

### Options

R7 — Accepts `options` as `string[]` or `Array<{value: string, label: string}>`

R8 — When `placeholder` is provided, renders a disabled `<option>` at top with empty value

R9 — Selected option shows its label text (not value) in the closed select

### Behavior

R10 — `onChange` fires with the native change event (caller extracts `e.target.value`)

R11 — `value` is fully controlled by parent

### Accessibility

R12 — Keyboard navigable: focus with Tab, open with Space/Enter, navigate with arrows, select with Enter

R13 — `aria-invalid="true"` when in error state

## States

| State | Visual |
|-------|--------|
| Default (no selection) | Gray placeholder text, gray border |
| Focused | Aqua border |
| Selected | Charcoal text showing selected label |
| Error | Terracotta border |
| Disabled | Gray background, muted text |

## Edge Cases

- **No options**: Renders empty select with placeholder only
- **Value not in options**: Shows the raw value string (shouldn't happen in controlled usage)
- **Long option labels**: Text truncates within select width

## Data Flow

```
Props:
  value: string
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void
  options: string[] | Array<{value: string, label: string}>
  placeholder?: string
  disabled?: boolean
  ...rest: SelectHTMLAttributes

Emits:
  onChange when selection changes
```

## Dependencies

- `theme.spec.md` for color tokens, border radius, typography
- `input.spec.md` for visual consistency requirements
