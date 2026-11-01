# Specification: Theme / Design Tokens

## Purpose

Define the visual design tokens — colors, typography, spacing, radii, shadows — that every component in the Smriti portal references. These are the single source of truth for all visual decisions.

## Scope

**MUST:** Color palette, font families, spacing scale, border radii, shadow levels
**WILL NOT:** Component-level styles, layout decisions

## Requirements

### Colors

R1 — The system provides semantic color tokens with light variants for hover/active states.

R1.1 — Background colors: `page` (#F5F0E8), `surface` (#FDFBF7 / warm white), `surface-elevated` (#FFFFFF)

R1.2 — Brand primary: `soft-aqua` (#B9DFE2) with `soft-aqua-light` for tints/backgrounds

R1.3 — Brand accent: `terracotta` (#D76B51) with `terracotta-light` for tints

R1.4 — Text colors: `charcoal` (#1F2A33) primary text, `muted` (#6B7280) secondary, `subtle` (#9CA3AF) tertiary

R1.5 — Status colors: `success` (#2D9B67), `warning` (#F59E0B)

R1.6 — Border colors: `border` (#E5E7EB) default, `border-warm` (rgba(200,180,150,0.22)) for card edges

R1.7 — Veg toggle: `veg-bg` (#EBF7F0), `veg-border` (#2D9B67), `veg-text` (#1E7A4A). Non-veg toggle: `nonveg-bg` (#FDF3EF), `nonveg-border` (#D76B51), `nonveg-text` (#C4512F)

### Typography

R2 — Three font families are available as Tailwind utility classes.

R2.1 — `font-heading`: Playfair Display (serif, for page titles, section headings, hero)

R2.2 — `font-body`: DM Sans (sans-serif, for form fields, labels, body text, buttons)

R2.3 — `font-accent`: Caveat (cursive/handwritten, for decorative text, taglines, captions)

R2.4 — When web fonts fail to load, fall back to system fonts: Georgia for headings, system-ui sans-serif for body, cursive for accent

### Spacing & Sizing

R3 — Minimum touch target is 44px on all interactive elements.

R3.1 — Input height is 44px (with padding, not including border)

R3.2 — Button heights: `sm` = 36px, `md` = 44px, `lg` = 54px

R3.3 — Form field gaps are 12–16px between fields, 24px between sections

### Border Radius

R4 — All inputs, buttons, and cards use rounded corners.

R4.1 — `rounded-input`: 10px (inputs, selects, textareas)

R4.2 — `rounded-button`: 12–14px (buttons)

R4.3 — `rounded-card`: 16–20px (cards, panels, summary sections)

### Shadows

R5 — Shadow tokens provide depth hierarchy.

R5.1 — `shadow-card`: subtle (rgba(80,60,40,0.06-0.08)) for cards

R5.2 — `shadow-elevated`: moderate (rgba(80,60,40,0.1-0.12)) for sticky sidebars

R5.3 — `shadow-button`: terracotta-tinted (rgba(215,107,81,0.35)) for primary CTA buttons

R5.4 — `shadow-bottom-bar`: upward shadow (rgba(31,42,51,0.1)) for mobile sticky bottom bar

### Gradients

R6 — Brand gradients are available as Tailwind utilities.

R6.1 — `gradient-primary`: terracotta gradient (135deg, #D76B51 → #C45A40) for primary buttons

R6.2 — `gradient-page`: warm radial background (soft-aqua top-left, terracotta bottom-right)

R6.3 — `gradient-confirmation`: 160deg warm gradient (#F0E8E0 → #F5F0E8 → #E8F0F2) for confirmation screen

### Animations

R7 — Consistent transition tokens.

R7.1 — `transition-input`: border-color 0.15s ease (inputs on focus/blur)

R7.2 — `transition-button`: opacity/background 0.15s ease (button hover/active)

R7.3 — `transition-step`: opacity + translateY 0.32s ease (step enter animation)

## Dependencies

- Google Fonts: Playfair Display, DM Sans, Caveat (loaded via `<link>` or `@import`)
- Fonts must load before first paint to avoid layout shift

## Verification

- [ ] Color contrast: all text meets WCAG AA (4.5:1 for body, 3:1 for large text)
- [ ] Touch targets: all interactive elements ≥44px at viewport widths ≤ 768px
- [ ] No hardcoded hex values in component files (all via Tailwind config tokens)
- [ ] Font fallback works: disable Google Fonts → system fonts render without layout shift
