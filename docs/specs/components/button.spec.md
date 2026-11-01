# Specification: Button

## Purpose

A clickable action element with consistent styling, sizing, and states across the Smriti portal.

## Scope

**MUST:** Primary (terracotta), secondary (outlined), ghost (text-only) variants; small/medium/large sizes; disabled and loading states
**WILL NOT:** Icon-only buttons (use ghost variant with icon child), link-styled buttons (component exists but deferred)

## Requirements

### Variants

R1 — `primary`: solid terracotta gradient background, white text, shadow. Used for CTAs (Continue, Pay, Submit).

R2 — `secondary`: white background, 1.5px border (default: gray, hover: terracotta), charcoal text. Used for Back, Cancel, secondary actions.

R3 — `ghost`: transparent background, no border, charcoal text with terracotta hover tint. Used for Edit links, remove actions, accessory buttons.

### Sizes

R4 — `sm` (36px height, 12px font): compact actions, inline buttons

R5 — `md` (44px height, 14px font): default size, standard form actions

R6 — `lg` (54px height, 15-17px font): primary CTAs, payment button

### States

R7 — **Default**: variant-specific background/text/border

R8 — **Hover**: primary darkens, secondary shows terracotta border highlight, ghost shows terracotta background tint

R9 — **Disabled**: gray background (#D1D5DB), muted text, `cursor-not-allowed`, no shadow

R10 — **Loading**: replaces children with a spinner, disables interaction, preserves width to prevent layout shift

### Behavior

R11 — `type="button"` by default (prevents accidental form submission)

R12 — Accepts all native `<button>` HTML attributes via rest props

R13 — `onClick` fires on click and Enter/Space keypress

R14 — Renders its `children` as the button label (text, icon+text, etc.)

### Accessibility

R15 — Focus ring: visible on keyboard focus (Tab), not on mouse click

R16 — `aria-disabled="true"` when disabled

R17 — `aria-busy="true"` + `aria-label="Loading"` when in loading state

## States

| State | Visual |
|-------|--------|
| Default | Variant-specific styling |
| Hover | Darker / highlighted |
| Active/Pressed | Slightly darker still |
| Focus-visible | Outline ring (keyboard only) |
| Disabled | Grayed out, no pointer events |
| Loading | Spinner, no interaction |

## Edge Cases

- **Very long label**: Text truncates with ellipsis, button has max-width
- **Empty children**: Renders nothing (graceful no-op) or minimal empty button
- **Rapid clicks**: Loading state prevents double-submission; debounce is caller's responsibility
- **Nested interactive children**: Warn in dev (buttons shouldn't contain other buttons/links)

## Data Flow

```
Props:
  variant: 'primary' | 'secondary' | 'ghost'
  size: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
  children: ReactNode
  ...rest: ButtonHTMLAttributes

Emits:
  onClick when clicked
```

## Dependencies

- `theme.spec.md` for color tokens, border radii, shadow levels, transition tokens
