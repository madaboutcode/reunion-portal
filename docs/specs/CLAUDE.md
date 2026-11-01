# Specs

Specs are the source of truth for behavior. Keep them in sync with code; describe observable behavior (what the system should do), not implementation.

## Spec Format

Every spec file follows this structure:

```markdown
# Specification: <Component Name>

## Purpose
What this component does from the consumer's perspective. One sentence.

## Scope
What's in scope (MUST) and out of scope (WILL NOT) for this component.

## Requirements
R1 — First requirement (testable assertion)
R1.1 — Sub-requirement
R2 — Second requirement

## States
List every visual/interaction state the component can be in:
- Default / Empty
- Populated / Active
- Error
- Disabled
- Loading
- etc.

## Data Flow
What data enters this component, what data leaves it.
Props, callbacks, context consumption.

## Edge Cases
- What happens when...
- Error conditions and their handling

## Dependencies
- References to other component specs this one depends on
- Links to data model specs or validation specs
```

## File Organization

```
specs/
├── CLAUDE.md                              # This file
├── README.md                              # Spec index
├── registration-page.spec.md              # Page-level spec (existing)
├── theme.spec.md                          # Design tokens
├── estimate-sidebar.spec.md               # Feature
├── alumni-details.spec.md                 # Feature (wizard step 2)
├── attendees-meals.spec.md                # Feature (wizard step 3)
├── accommodation.spec.md                  # Feature (wizard step 4)
├── giving-back.spec.md                    # Feature (wizard step 5)
├── photo-id.spec.md                       # Feature (wizard step 6)
├── review-pay.spec.md                     # Feature (wizard step 7)
├── confirmation.spec.md
└── components/
    ├── button.spec.md                     # Primitives
    ├── input.spec.md
    ├── select.spec.md
    ├── form-field.spec.md                 # Composed
    ├── meal-toggle.spec.md
    ├── stepper.spec.md
    └── file-upload.spec.md
```

## Naming

- File names: `kebab-case`, describe what the component IS (`button.spec.md` not `Button.tsx.spec.md`)
- Requirements: `R1`, `R2`, `R1.1`, etc. for precise cross-references
- Cross-references: `(see components/button.spec.md R3)` format
