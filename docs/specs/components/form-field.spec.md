# Specification: FormField

## Purpose

Wraps an input primitive with label, required indicator, hint text, and inline error display. The standard way to render any form field in the Smriti wizard.

## Scope

**MUST:** Label, required asterisk, hint text, error message, children slot for input
**WILL NOT:** Input-specific validation logic (that's Zod), multi-field layouts (use CSS grid in step component)

## Requirements

### Layout

R1 — Renders in vertical stack: label (optional) → children (input) → hint (optional) → error (optional)

R2 — Label: 12px, font-weight 600, charcoal (#374151), letter-spacing 0.1px, 6px bottom margin

R3 — Required indicator: terracotta asterisk (*) immediately after label text, no space

R4 — Hint: 11px, subtle (#9CA3AF), 4px top margin

R5 — Error: 11px, terracotta (#D76B51), bold, 4px top margin, prefixed with ⚠ icon

### Behavior

R6 — `children` slot accepts any input primitive (Input, Select, Textarea, Toggle, custom)

R7 — When `error` prop is truthy, renders error message below children

R8 — When `error` is falsy but `hint` is provided, renders hint below children

R9 — When neither `error` nor `hint` is provided, renders nothing below children

### Accessibility

R10 — When error is shown: `aria-describedby` on child input links to error element

R11 — Required fields marked with `aria-required="true"`

## States

| State | Visual |
|-------|--------|
| Default | Label + input + hint (if provided) |
| Required | Label with red asterisk + input |
| Error | Label + input with error border + terracotta error message |
| No label | Input + hint/error only |
| No children | Empty div (graceful) |

## Edge Cases

- **Label without children**: Renders label only (no-op for layout)
- **Both hint and error**: Error takes precedence, hint hidden
- **Long error message**: Wraps to multiple lines, does not overflow

## Data Flow

```
Props:
  label?: string
  required?: boolean
  error?: string
  hint?: string
  children: ReactNode

No emits — purely presentational. Error/hint are derived by parent from React Hook Form.
```

## Dependencies

- `input.spec.md`, `select.spec.md` — child components wrapped by FormField
- `theme.spec.md` for typography, color tokens
