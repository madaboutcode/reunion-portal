# src/web — React App (@smriti/portal)

React 19 SPA with Vite, Tailwind CSS v4, React Router v7.

## Commands

```bash
make dev           # Vite dev server with HMR (http://localhost:5173)
make build         # tsc -b && vite build → src/web/dist/
make check         # typecheck + lint
```

## Jumpstart

**Updated:** 2026-06-04

Single-page React app. User moves through a 7-step wizard → state managed by `WizardContext` → persisted to localStorage → submitted to `/api/registrations` → confirmation page displayed from reg code.

**Step 1 (Participation):** User chooses Full Celebration (₹8,500), Campus Only (₹5,500), or Donation Only. This drives skip rules for steps 3 (Your Group) and 4 (Your Stay). `participationType` is the new primary field; `attendanceIntent` is derived from it.

## Entry Points

| Task | File |
|------|------|
| App shell + routing | `src/App.tsx` |
| Wizard state management | `src/context/WizardContext.tsx` |
| Registration pages | `src/pages/RegisterPage.tsx`, `NewRegistrationPage.tsx` |
| Confirmation page | `src/pages/ConfirmationPage.tsx` |
| Shared logic bridge | `src/lib/validation.ts`, `src/lib/pricing.ts` |

## Routes

| Path | Component | Notes |
|------|-----------|-------|
| `/` | HomePage | Landing page — hero, schedule, CTA links to /register |
| `/connect` | ConnectPage | Alumni connect |
| `/magazine` | MagazinePage | Public 106-page souvenir magazine reader |
| `/new` | NewRegistrationPage | Start fresh (clears draft) |
| `/register` | RegisterPage | Registration wizard (7 steps) |
| `/pay/:regCode` | BankTransferPage | Bank transfer + UPI details, proof upload (no gateway) |
| `/payment/:regId` | BankTransferPage | Legacy alias for bank transfer page |
| `/confirmation/:id` | ConfirmationPage | Post-submit pass display |
| `/pass` | PassPage | Entry pass lookup |
| `/login` | LoginPage | Staff/admin login |
| `/auth/verify` | AuthVerifyPage | Magic link verification |
| `/staff/dashboard` | StaffDashboardPage | Staff dashboard (requires staff/admin role) |
| `/staff/registrations/:id` | RegistrationDetailPage | Registration detail (requires staff/admin role) |
| `/staff/resources` | ResourcesPage | Resources (requires staff/admin role) |
| `/staff/reports` | ReportsPage | Reports (requires staff/admin role) |
| `/staff/team` | TeamManagementPage | Team management (requires admin role) |
| `/debug` | DebugPage | Component isolation testing (dev; staging = admin + flag, see below) |
| `/debug/confirmations` | DonationCardDebugPage | Confirmation card debug (dev; staging = admin + flag) |
| `/debug/tools` | DebugToolsPage | Debug tools (dev; staging = admin + flag) |
| `/debug/staff` | StaffDebugPage | Staff debug (dev; staging = admin + flag) |
| `*` | NotFoundPage | 404 |

When building a new component, wire it into DebugPage first — add a tab in `src/pages/DebugPage.tsx`.

## Debug Routes — Build Exclusion (DO NOT WEAKEN)

Constraint mandated by `docs/specs/access-control.spec.md` G8 and a stakeholder
decision (RBAC cycle 2026-07-23, door R3 "security in layers"). Agents: do not
change this without a decision record.

Production builds must **physically exclude** all debug-route code from the
bundle. This works because the gate in `src/App.tsx` is **statically
eliminable**: Vite define-replaces `import.meta.env.DEV` and
`import.meta.env.VITE_ENABLE_DEBUG` at build time, the condition
constant-folds, and Rollup tree-shakes the entire debug block (routes AND the
imported page modules) out of a `VITE_ENABLE_DEBUG=false` build.

Rules:

1. The build-time debug condition in `App.tsx` must use `import.meta.env`
   **literals only** — never runtime config, fetched values, variables, or any
   expression Vite cannot constant-fold. If the condition stops being
   statically eliminable, debug code silently ships to production.
2. `scripts/assert-debug-excluded.sh` enforces this: it builds with
   `VITE_ENABLE_DEBUG=false` and fails on any `DebugPage|StaffDebugPage|/debug`
   marker in `dist/`. It runs on every deploy (`.github/workflows/deploy.yml`).
   If it fails, fix the gate — do not weaken or remove the assertion.
3. Layered defense on top of exclusion: where debug code does ship (staging,
   `VITE_ENABLE_DEBUG=true`), `DebugRouteGate` in `App.tsx` requires an admin
   session AND the `debug_tools` D1 feature flag (`useFeatureFlag` hook →
   `GET /api/feature-flags/debug_tools`, admin-only endpoint). Server
   `/api/debug/*` stays dev-only (`src/server/src/index.dev.ts`).
4. Local dev (`import.meta.env.DEV`) keeps debug routes open with no flag and
   no auth.
5. Do not remove or weaken the gate, the assertion, or this note without a
   decision record in `docs/decisions/`.

## Components

- One component per file, named export
- **Primitives** in `src/components/ui/` — Button, Input, Select, Toggle, etc.
- **Form components** in `src/components/form/` — FormField, MealToggle, AttendeeRow
- **Feature components** in `src/components/registration/` — Step1–7, Confirmation, Hero
- Props interface exported alongside the component

## Styling

- Tailwind utility classes only — no inline styles, no CSS modules
- Theme tokens defined in `src/index.css` via `@theme` block
- Brand colors: `soft-aqua` (#B9DFE2), `terracotta` (#D76B51), `charcoal` (#1F2A33)
- Fonts: Playfair Display (headings), DM Sans (body), Caveat (accent/handwritten)
- 44px minimum touch targets on mobile
- See `docs/STYLE_GUIDE.md` for full brand reference

## Forms

- React Hook Form + Zod for all forms
- Schemas live in `@smriti/shared` (re-exported via `src/lib/validation.ts`)
- Inline error display on all required fields

## State

- Wizard state persists to `localStorage` under key `smriti_reg_v5` as `WizardDraft` (flat object via `usePersistence` hook)
- Pricing is derived, not stored — `calculateTotal()` from `@smriti/shared` takes draft + config
- Two registration shapes: `WizardDraft` (flat, localStorage draft) and `Registration` (canonical, API boundary)
- Derivation point: `toRegistration(draft)` in `@smriti/shared/src/mapping.ts` maps `WizardDraft` → `Registration` before POST
- `WizardState` extends `WizardDraft` with `currentStep` — used only in wizard context
- Confirmation page receives canonical `Registration` from API, derives display via `deriveDisplay(registration)`

## Page Titles

Pattern: `<Page> - Smriti, The Batch of 2006, TKMCE`

Every page component calls `useDocumentTitle("Page Name")` from `src/hooks/useDocumentTitle.ts`.

## Imports

- `@/` path alias resolves to `src/web/src/`
- Shared code: `src/lib/` re-exports from `@smriti/shared` — import from `@/lib/` in components
- Types: `@/types/registration` re-exports shared types + adds `WizardStep`, `WizardState`

## Design & Documentation

- Maintain component contracts in source files — keep them in sync with actual behavior
- When state shapes or data flow change (like the `WizardDraft` → `Registration` refactor), update this CLAUDE.md immediately

## Testing

- Test contracts: every GUARANTEE, EXPECTS violation, and FAILURE BEHAVIOR gets a test
- Don't stats-pad — new features need new tests that exercise the new code path
- Current test coverage: step validation schemas, registration derivation (`toRegistration`), confirmation page display logic

## Finding Things

| To find... | Look in / Grep for |
|------------|--------------------|
| A step component (1-7) | `src/components/registration/Step[1-7].tsx` |
| A UI primitive | `src/components/ui/` |
| All route components | `src/pages/` |
| Form validation wiring | `src/lib/validation.ts` |
| Wizard data flow | `WizardContext`, `usePersistence` |

## Tests

| What's tested | File |
|--------------|------|
| Step config contracts | `src/lib/__tests__/step-config.verify.ts` |
| Reg code display logic | `src/lib/__tests__/reg-code.verify.ts` |
| QA contracts (smoke) | `src/__tests__/qa-contracts.test.ts` |

## Gotchas

- Don't import from `@smriti/shared` directly in components — always go through `src/lib/` re-exports
- Confirmation page uses `deriveDisplay` not `calculateTotal` — it reads stored data, not form state
- `/new` clears wizard draft — don't navigate there unless intentional
