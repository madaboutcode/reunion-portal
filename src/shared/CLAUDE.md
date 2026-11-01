# @smriti/shared

Pure TypeScript package — types, pricing logic, Zod validation schemas, and constants. No UI dependencies, no Node dependencies. Consumed by both web (Vite) and server (wrangler) via direct TS transpilation (no build step).

## Jumpstart

### The Data Pipeline

Alumni fills 7-step wizard → form fields stored as `WizardDraft` in localStorage (flat, form-friendly) → on submit, `toRegistration()` maps draft to nested `Registration` shape → server validates `Registration` via `registrationSchema` → persists to D1 → returns entry pass.

**New in 7-step flow:** `WizardDraft` now includes `participationType: "full_celebration" | "campus_only" | "donation_only"`. `attendanceIntent` is derived from `participationType` in `toRegistration()`. `not_sure` is no longer a valid value. Base fees: Full Celebration ₹8,500, Campus Only ₹5,500 (both include ₹1,000 college contribution). College contribution minimum is ₹0 (optional additional only).

**Key shapes:**
- `WizardDraft`: Flat, optional fields, matches form UI (localStorage-friendly)
- `Registration`: Nested, required fields (presence semantics), API boundary

**Key derivation function:**
- `toRegistration(draft: WizardDraft): Registration` — sole mapping point; handles nested structures, trimming, falsy omission, type casting

**Pricing & headcount:**
- `calculateTotal(registration, pricingConfig?)` — returns `PricingBreakup` with base, line items, donation, total
- `getAttendeeCounts(registration)` — returns veg/nonveg meal counts
- Both take `Registration` (not draft) because they need the nested `attendees` structure

**Validation:**
- Per-step schemas in `validation.ts` (`step1Schema` through `step6Schema`) — form-level UX validation only. Step numbers match the 7-step wizard (step1=Participation, step2=About You, step3=Your Group, step4=Accommodation, step5=Giving Back, step6=Photo & ID)
- `registrationSchema` in `registration-schema.ts` — canonical API-boundary validation; enforces nested structure and cross-field rules
- `validateForPayment(draft: WizardDraft)` in `review-validation.ts` — pre-payment checklist (takes draft for localStorage convenience)

### Gotchas

1. **Two validation regimes.** Per-step schemas validate form fields as the user fills them. `registrationSchema` validates the fully-mapped `Registration` shape at the API boundary. They're not the same — per-step schemas are lenient (optional spouse name), `registrationSchema` is strict (spouse name must be non-empty if present). Both are correct — different surfaces, different rules.

2. **`toRegistration()` is the sole derivation point.** All nested structure, trimming, type casting happens there. Never manually construct `Registration` — call `toRegistration()`.

3. **Pricing consumes `Registration`, not `WizardDraft`.** The nested `attendees` structure is required for accurate line-item calculation.

4. **Import extensions are required** (`.ts` not `.js`). Vite and wrangler both transpile source TS directly — relative imports must include the extension.

5. **Accommodation is a 3-room model, fully data-driven.** `AccommodationType` is `"none" | "private" | "shared_double" | "shared_triple"`. Every rate, label, description, and UI string comes from `constants.ts` — `getAccommodationCatalog(config)` resolves prices/breakfast/basis from `PricingConfig`, `ACCOMMODATION_LABELS` maps enum→label, `ACCOMMODATION_COPY` holds all helper strings. Never hardcode a room price, label, or option literal outside this module.
   - **Shared rooms (`shared_double`/`shared_triple`) are solo-only.** `registrationSchema` rejects them with a spouse/children/guests; families take `private`. (Per-step `accommodationSchema` is lenient; the canonical schema enforces it.)
   - **Extra bed is private-only, max 1.** `WizardDraft`/`Registration` carry `extraBed: boolean`. `toRegistration()` forces it `false` for shared types and auto-sets it `true` when a child older than `accommodationChildBedAge` (12) is in a private booking — the over-12 child *is* the extra bed (one charge, no double-count).
   - **Pricing** (`calculateTotal`): per-night room + 6–12 child charges + extra-bed line, plus ONE GST line over the accommodation subtotal (`accommodationTaxPercent`, default 18). Under-6 children are free; food/base fee stays tax-inclusive and untouched. Zero-fee lines are suppressed.

## Entry Points

| Function / Type | File | Purpose |
|---|---|---|
| `WizardDraft`, `Registration` | `types.ts` | Canonical data shapes |
| `toRegistration(draft)` | `mapping.ts` | Map WizardDraft → Registration (sole derivation point) |
| `calculateTotal(registration)` | `pricing.ts` | Compute pricing breakup with line items |
| `getAttendeeCounts(registration)` | `pricing.ts` | Extract veg/nonveg meal counts |
| `createInitialData()` | `pricing.ts` | Factory for empty WizardDraft |
| `step1Schema`, `step2Schema`, `step3Schema`, `step4Schema`, `step5Schema`, `step6Schema` | `validation.ts` | Per-step form validation (UX-level) |
| `registrationSchema` | `registration-schema.ts` | Canonical API-boundary validation |
| `validateForPayment(draft)` | `review-validation.ts` | Pre-payment checklist |
| `BRANCHES`, `PRICING_DEFAULTS`, `ACCOMMODATION_OPTIONS`, etc. | `constants.ts` | Config constants, enums, utilities |
| `SubmitRegistrationRequest`, `SubmitRegistrationResponse`, etc. | `api-types.ts` | API boundary types (for web and server) |

## Finding Things

| Concept | Search |
|---|---|
| Type definitions | `src/shared/src/types.ts` |
| Mapping logic | `src/shared/src/mapping.ts` (cases in `__tests__/mapping.test.ts`) |
| Pricing calculation | `src/shared/src/pricing.ts` (search for `calculateTotal`) |
| Form validation (per-step) | `src/shared/src/validation.ts` (search for `stepNSchema`) |
| API validation (canonical) | `src/shared/src/registration-schema.ts` (search for `registrationSchema`) |
| Pre-payment checks | `src/shared/src/review-validation.ts` (search for `validateForPayment`) |
| API request/response types | `src/shared/src/api-types.ts` |
| Test files | `src/shared/src/__tests__/` |

## Conventions

**TypeScript:**
- Strict mode (no `any` — use `unknown` and narrow)
- Prefer `interface` over `type` for object shapes
- Export types alongside implementations
- All imports use `.ts` extensions (required for Vite/wrangler)

**Validation:**
- Per-step schemas validate individual form steps (lenient, optional spouse name)
- `registrationSchema` validates the full `Registration` at the API boundary (strict, enforces presence)
- `validateForPayment()` runs against `WizardDraft` for localStorage convenience; does not validate schema, only business logic

**Pricing:**
- All pricing functions consume `Registration` (nested structure)
- `PricingConfig` is always optional with `PRICING_DEFAULTS` as fallback
- Donations are optional fields in `Registration` — `calculateTotal()` handles absence gracefully

**Constants:**
- Branch list, meal options, accommodation options live in `constants.ts`
- Check-in/check-out dates are hardcoded as ISO strings (`"2026-08-14"`)
- Prices in INR (no currency type, just numbers)

## Constraints

- **No UI dependencies** — this package is consumed by both web and server. Don't import React, UI frameworks, or browser-only APIs.
- **No Node dependencies** — code must run in Cloudflare Workers. Don't import Node stdlib.
- **No build step** — source TS transpiled directly by Vite/wrangler. Don't rely on build-time transformations.
- **Don't hardcode pricing** — use `PricingConfig` and `PRICING_DEFAULTS`. Prices are configurable.
- **Don't add new types without updating both `types.ts` and test coverage** — especially mappings in `toRegistration()`.

## Design & Documentation

- Maintain CONTRACT blocks at the top of source files — document what each module guarantees and expects (see `api-types.ts` for example)
- When adding new types or validation rules, update CONTRACT blocks and sync tests in `src/shared/src/__tests__/`
- Changes to validation rules (e.g., new constraint on shared rooms) require updates to both per-step schemas and `registrationSchema`, plus tests

## Testing

- Test files: `__tests__/mapping.test.ts` (`toRegistration()` derivation), `__tests__/pricing-accommodation.test.ts` (§7 rupee oracle + GST + extra-bed no-double-count), `__tests__/accommodation-catalog.test.ts` (catalog is config-driven)
- Every validation rule (per-step and canonical) must have test cases covering: happy path, missing required field, invalid format, cross-field constraint violation
- Test contracts: every GUARANTEE in CONTRACT blocks, every EXPECTS dependency, and every validation rule gets a test
- Don't stats-pad — new validation rules need new tests that exercise the new rule (not just "tests pass")
