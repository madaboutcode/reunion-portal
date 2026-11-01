# Specification: Input

## Purpose

A text input field with consistent styling, focus behavior, and error states. Supports text, email, tel, and number types with optional prefix (e.g., "+91" for phone).

## Scope

**MUST:** Text/email/tel/number types, focus ring, error state, prefix slot, disabled state, 44px minimum height
**WILL NOT:** Password masking (not needed), input masking (deferred), autocomplete management

## Requirements

### Types

R1 — Supports `type="text"` (default): standard text input

R2 — Supports `type="email"`: email-optimized keyboard on mobile, browser validation

R3 — Supports `type="tel"`: phone-optimized keyboard on mobile

R4 — Supports `type="number"`: numeric keyboard, no spinners (CSS hides them)

### Visual

R5 — Height: 44px (with 14px vertical padding, 1.5px border)

R6 — Default border: 1.5px solid `border` color (#E5E7EB)

R7 — Focus border: 1.5px solid `soft-aqua` (#B9DFE2), no outline glow

R8 — Error border: 1.5px solid `terracotta` (#D76B51)

R9 — Border radius: 10px (`rounded-input`)

R10 — Font: 14px, `font-body` (DM Sans), charcoal (#1F2A33)

R11 — Placeholder color: `subtle` (#9CA3AF)

### Prefix

R12 — When `prefix` prop is provided, renders a non-interactive text label inside the input (left side)

R13 — Input text padding adjusts to accommodate prefix width (left padding = ~38px when prefix present)

R14 — Prefix is positioned absolutely, does not affect input value

### States

R15 — **Default**: white background, gray border

R16 — **Focused**: white background, soft-aqua border

R17 — **Error**: white background, terracotta border (error message displayed by parent FormField)

R18 — **Disabled / Read-only**: light gray background (#F8F9FB), muted text, no focus interaction

### Behavior

R19 — Passes through all native `<input>` HTML attributes via rest props

R20 — `onChange` fires on every keystroke with the event (caller extracts `e.target.value`)

### Accessibility

R21 — `aria-invalid="true"` when in error state

R22 — `aria-describedby` links to hint/error text when provided

## States

| State | Visual |
|-------|--------|
| Default | White bg, gray border, placeholder text |
| Focused | White bg, aqua border |
| Error | White bg, terracotta border |
| Disabled | Gray bg (#F8F9FB), muted text |
| Read-only | Gray bg, normal text |
| With prefix | "+91" label on left, indented text |

## Edge Cases

- **Very long input value**: Scrolls horizontally within the input
- **Number type**: Spinners hidden via `appearance: none` CSS
- **Prefix + placeholder**: Prefix visible, placeholder indented to the right of prefix
- **Empty value**: Shows placeholder if provided, otherwise empty
- **Controlled component**: Value is fully controlled by parent (no internal state)

## Data Flow

```
Props:
  value: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  type?: 'text' | 'email' | 'tel' | 'number'
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  prefix?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  ...rest: InputHTMLAttributes

Emits:
  onChange on every keystroke
```

## Dependencies

- `theme.spec.md` for color tokens, border radius, typography
