# Specification: Stepper

## Purpose

Shows the user their progress through the 7-step registration wizard. Desktop: horizontal circles with connecting lines. Mobile: current step name + progress bar.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [Desktop (viewport ≥ 768px)](#desktop-viewport--768px)
  - [Mobile (viewport < 768px)](#mobile-viewport--768px)
  - [Step Definitions](#step-definitions)
  - [Behavior](#behavior)
- [States](#states)
- [Edge Cases](#edge-cases)
- [Data Flow](#data-flow)
- [Dependencies](#dependencies)

## Scope

**MUST:** Desktop horizontal stepper (7 steps), mobile progress bar, step completion state, current step highlight, skipped step visual state
**WILL NOT:** Click-to-navigate steps (wizard is linear), animated step transitions (handled by wizard shell)

## Requirements

### Desktop (viewport ≥ 768px)

R1 — Renders 7 step circles in a horizontal row with connecting lines between them

R2 — Each circle: 38px diameter, contains either a checkmark (completed) or step icon (current/future)

R3 — Completed steps: soft-aqua filled circle, checkmark icon, aqua text label below

R4 — Current step: terracotta filled circle, white icon, terracotta bold text label, subtle shadow glow

R5 — Future steps: muted circle (transparent with gray border), gray icon, gray text label

R6 — Connecting lines: 2px, dashed when incomplete, solid soft-aqua when completed

R7 — Step labels below circles: 10px, centered, white-space pre-line for two-line labels

### Mobile (viewport < 768px)

R8 — Renders: current step icon + name (left), "Step N of 7" (right), progress bar below

R9 — Progress bar: 3px height, gray track, gradient fill (soft-aqua → terracotta)

R10 — Progress bar width: `(currentStep - 1) / 6 * 100 + 14.3`% (starts at ~14% on step 1, ends at 100% on step 7)

### Step Definitions

R11 — Steps: "Participation", "About You", "Your Group", "Your Stay", "Giving Back", "Photo & ID", "Review & Pay"

R12 — Step icons: ticket/option cards (1), person silhouette (2), group/family (3), building/accommodation (4), heart/hands (5), camera (6), document/receipt (7)

### Behavior

R13 — Transitions between steps animate smoothly (color, fill, line style transition 0.3s)

R14 — Stepper itself is display-only — does not navigate on click

## States

| State | Desktop | Mobile |
|-------|---------|--------|
| Step 1 | Circle 1 active (terracotta), rest future (gray) | "Participation" + ~14% bar |
| Step 3 | Circles 1-2 complete (aqua+check), 3 active, 4-7 future | "Your Group" + ~43% bar |
| Step 7 | Circles 1-6 complete, 7 active | "Review & Pay" + 100% bar |

## Edge Cases

- **Hidden when on confirmation**: Stepper not rendered (confirmation is full-screen takeover)

## Data Flow

**Receives:** Current step number (1 through 7), array of step definitions (each with a label and icon), set of skipped step numbers (varies by participation type).

**Produces:** No output — display only. Does not emit events or modify external state.

## Dependencies

- Parent: `registration-page.spec.md`
- Receives current step from the wizard shell (see `wizard-shell.spec.md`)
