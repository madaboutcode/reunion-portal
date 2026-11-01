# Specification: PaymentProgress

## Purpose

A horizontal progress indicator showing the payment lifecycle stages. Tells the user where they are in the payment journey and what comes next.

## Scope

**MUST:** Four fixed stages, visual states (complete/active/future), responsive layout
**WILL NOT:** Clickable stages, dynamic stage list, animation between states

## Requirements

### Visual

R1 — Four stages displayed in order: "Registered" → "Payment" → "We're Verifying" → "You're In!"

R2 — Each stage shows a circle icon and a label below (desktop) or beside (mobile).

R3 — Stage visual states:
- **Complete**: filled circle with checkmark, muted text color
- **Active**: filled circle with dot/pulse, accent color (coral), bold label
- **Future**: outlined circle, muted/dimmed text

R4 — Stages are connected by a line. The line is solid up to the active stage, dashed after.

### Behavior

R5 — `currentStatus` prop determines which stage is active:
- `"pending"` → "Payment Proof" is active, "Registration" is complete
- `"pending_verification"` → "Verification" is active, first two are complete
- `"confirmed"` → "Passes" is active, all previous are complete

R5.1 — Known UX limitation: a registration that returns to `pending` after a partial committee verification (shortfall — see `payment-flow.spec.md` R7.20) renders identically to a registration that has never been paid — both show "Payment Proof" as active with "Registration" complete. The component has no way to distinguish "first-time payment" from "balance due after partial verify" from `currentStatus` alone. A future enhancement could pass additional props (e.g. prior verified amount) to differentiate these visually; not required this round.

R6 — Stages are not interactive (no click handlers).

### Layout

R7 — Desktop (≥ 640px): horizontal layout, stages evenly spaced, connecting lines between circles.

R8 — Mobile (< 640px): vertical layout, stages stacked with a connecting vertical line on the left.

R9 — Full-width container, max-width inherits from parent.

### Accessibility

R10 — Uses `role="list"` with `role="listitem"` for each stage.

R11 — Active stage has `aria-current="step"`.

R12 — Complete stages include visually hidden "Complete" text for screen readers.

## States

| State | Visual |
|-------|--------|
| Pending (upload needed) | Registered ✓, Payment ●, We're Verifying ○, You're In! ○ |
| Pending verification | Registered ✓, Payment ✓, We're Verifying ●, You're In! ○ |
| Confirmed | Registered ✓, Payment ✓, We're Verifying ✓, You're In! ● |

## Data Flow

```
Props:
  currentStatus: "pending" | "pending_verification" | "confirmed"
```

## Dependencies

- `theme.spec.md` for color tokens (coral accent, muted text)
- Used by: `step5-review-pay.spec.md` R4.11, `payment-flow.spec.md` R9
