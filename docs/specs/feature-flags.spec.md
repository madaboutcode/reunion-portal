# Specification: Runtime Feature Flags

## Purpose

Allow administrators to change defined application capabilities at runtime while keeping every flag's meaning, default, exposure, and enforcement contract in code.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)
- [Runtime flag API](./interfaces/runtime-feature-flags.ispec.md)
- [Memory stories](./memory-stories.spec.md)

## Scope

**Covers:** The code-owned flag catalog, persisted overrides, public and administrative flag snapshots, React consumers, server consumers, the admin configuration page, audit history, and failure behavior.

**Does not cover:** Arbitrary administrator-created flags, non-boolean application settings, simultaneous events, automatic date/phase transitions, percentage rollouts, user cohorts, or third-party flag services.

## Requirements

R1 — Every supported flag is declared in a code-owned catalog before it can be read or changed.

  Scenario: Given a key has no catalog entry, when a caller requests it, then no effective flag is returned for that key.

R1.1 — Each catalog entry defines a stable key, administrator label, description, group, default value, storage-failure value, exposure (`public` or `admin_only`), and enforcement (`ui`, `server`, or `both`).

  Scenario: Given an administrator views a catalogued flag, when its definition is displayed, then all eight metadata fields are present.

R1.2 — Flag keys use lowercase snake case in the form `<namespace>_<action>_<feature>` and match `^[a-z][a-z0-9_]{0,63}$`.

  Scenario: Given the proposed key `Homepage-Show-Stories`, when catalog validation runs, then the key is rejected.

R1.3 — Unknown persisted keys are ignored. They are not returned by public or admin APIs and cannot be changed through the admin page.

  Scenario: Given the database contains an undeclared key, when an administrator loads configuration, then the undeclared key is absent and every catalogued flag remains available.

R2 — The database stores runtime overrides and update metadata, not flag definitions.

  Scenario: Given a catalog label changes in code without a value change, when configuration is loaded, then the new label appears with the existing effective value.

R2.1 — When no override exists for a catalogued flag, consumers receive its code-defined default.

  Scenario: Given `navigation_show_stories` has no override, when it is resolved, then its catalog default `false` is returned.

R2.2 — Updating a flag records the actor, previous effective value, new value, and update time in the system audit history.

  Scenario: Given a catalogued flag has no database row, when it is read, then its catalog default is returned; when an administrator changes it, the new value and audit record are persisted together.

R3 — Public clients receive one bulk snapshot containing only flags whose exposure is `public`.

  Scenario: Given four public flags exist, when the public snapshot is requested, then all four values arrive in one response.

R3.1 — `admin_only` keys, definitions, update actors, and audit details are never included in the public snapshot.

  Scenario: Given `debug_tools` is enabled, when the public snapshot is requested, then `debug_tools` and its update metadata are absent.

R3.2 — A public snapshot resolves every public catalog key to a boolean; callers do not need to handle missing keys.

  Scenario: Given the catalog contains public and admin-only flags, when an anonymous client requests the public snapshot, then every public key has a boolean value and no admin-only key is present.

R4 — All public-page features in one browser session consume one consistent public flag snapshot.

  Scenario: Given two visible features read configuration during one page load, when both render, then they use values from the same resolved snapshot.

R4.1 — Loading a page obtains public flags in one bulk request rather than issuing one request per displayed feature.

  Scenario: Given four independently controlled sections are displayed, when the page loads, then one configuration request supplies their values.

R4.2 — A page can request only catalogued public keys and receives the current effective boolean for each.

  Scenario: Given `homepage_show_memory_stories=true`, when that page feature reads its key, then it receives `true`.

R4.3 — Consumers can distinguish a snapshot that has not resolved from a resolved snapshot and can explicitly request a refresh.

  Scenario: Given the first configuration request is pending, when a consumer checks readiness, then it sees unresolved until the request completes.

R4.4 — While the public snapshot is loading or unreachable, each flag resolves to its code-defined storage-failure value. Controlled public content does not appear briefly before the controlling value resolves.

  Scenario: Given the Stories navigation flag has failure value `false`, when configuration is unreachable, then the Stories link never appears.

R4.5 — The public snapshot refreshes when the application starts and when a backgrounded page becomes active again. It does not poll continuously.

  Scenario: Given configuration changed while a page was backgrounded, when the page becomes active, then it requests a refreshed public snapshot.

R5 — Every server-enforced behavior uses one consistent effective flag snapshot for the duration of a request.

  Scenario: Given one request evaluates a server flag twice, when it completes, then both evaluations use the same effective snapshot.

R5.1 — A request that checks multiple flags observes one set of values; an administrator update cannot change decisions halfway through that request.

  Scenario: Given an administrator updates a flag while a request is in progress, when that request performs a second check, then it observes the same value as its first check.

R5.2 — Behavioral endpoints check their controlling server flag before performing side effects.

  Scenario: Given story submissions are disabled, when a valid write request arrives, then no story is created or updated.

R5.3 — An administrator update applies to the next server request that can reach the database; a prior request's resolved values are not reused by later requests.

  Scenario: Given an administrator enables submissions between two requests, when the second request resolves flags, then it observes submissions enabled.

R5.4 — On storage failure, a server consumer receives the flag's catalogued storage-failure value. Mutation capabilities use `false` as that value.

  Scenario: Given flag storage fails during a story write, when the endpoint checks `memory_stories_accept_submissions`, then it rejects the request before any story is changed.

R6 — Only administrators can view or change the complete flag catalog.

  Scenario: Given a staff user opens `/staff/config`, when access is checked, then the page is denied and no catalog metadata is shown.

R6.1 — `/staff/config` groups flags by catalog group and displays each flag's label, description, effective value, default value, exposure, and enforcement.

  Scenario: Given flags belong to Memories and Operations, when an admin opens `/staff/config`, then each appears under its catalog group with all listed fields.

R6.2 — Changing controls does not persist immediately. The administrator reviews pending changes and saves them as one atomic update.

  Scenario: Given an admin changes a toggle but has not saved, when another client loads configuration, then it still receives the old value.

R6.3 — If any submitted key or value is invalid, no submitted flag change is persisted.

  Scenario: Given one valid and one unknown key are submitted together, when validation fails, then neither value changes.

R6.4 — A successful save refreshes the displayed effective values and shows who changed them and when.

  Scenario: Given an administrator saves one changed flag, when the save completes, then the displayed value, actor, and update time reflect that save.

R6.5 — The page shows a warning when a UI-only visibility flag does not disable the corresponding server capability.

  Scenario: Given an admin disables only the Stories navigation flag, when reviewing pending changes, then the page warns that direct story access remains available.

  Scenario: Given an administrator changes two flags and saves, when the update succeeds, then both values change together and one audit entry describes both changes.

R7 — Public feature visibility and behavioral availability are independent.

  Scenario: Given the Stories link is hidden while story reading remains enabled, when a visitor opens the direct route, then stories remain readable.

R7.1 — Hiding a navigation link or homepage section does not implicitly disable its route or mutation endpoint.

  Scenario: Given only `navigation_show_stories=false`, when an attendee uses a direct story URL, then the story page and enabled submission capability still work.

R7.2 — Disabling a behavioral flag does not require hiding explanatory UI; a visible CTA may lead to an unavailable-state message.

  Scenario: Given story submissions are disabled while the homepage story section is visible, when a visitor follows `Share yours`, then the page can explain that submissions are closed.

R8 — The initial catalog includes these story flags:

  Scenario: Given a fresh deployment with no overrides, when the initial catalog is resolved, then all four story flags and `debug_tools` resolve to `false`.

| Key | Default | Failure value | Exposure | Enforcement |
|---|---:|---:|---|---|
| `navigation_show_stories` | `false` | `false` | public | ui |
| `homepage_show_memory_stories` | `false` | `false` | public | ui |
| `memories_show_stories` | `false` | `false` | public | both |
| `memory_stories_accept_submissions` | `false` | `false` | public | both |
| `debug_tools` | `false` | `false` | admin_only | both |

R8.1 — Existing `debug_tools` behavior remains admin-only and fail-closed when moved into the catalogued system.

  Scenario: Given all story flags have no persisted override after deployment, when a public client loads the site, then no Stories navigation, homepage section, page, or submission capability becomes available until an administrator enables it.

## States

- Catalog default: known flag with no persisted override.
- Overridden: known flag with a persisted value.
- Loading: the public application has not received a snapshot.
- Ready: the public application has a resolved snapshot.
- Public fallback: public snapshot unavailable; failure values are used.
- Server fallback: flag storage unavailable; catalogued failure values are used.
- Admin clean: no unsaved changes.
- Admin dirty: one or more valid changes await save.
- Admin saving: atomic update in progress.
- Admin save error: no pending change persisted.

## Data Flow

1. Code catalog defines all supported keys and metadata.
2. Runtime storage supplies zero or more value overrides.
3. The server resolver merges catalog defaults with valid overrides.
4. Public APIs filter the resolved snapshot by exposure.
5. Public-page consumers read the shared public snapshot.
6. Server consumers read the request-scoped resolved snapshot.
7. Admin updates validate against the catalog, persist atomically, and append audit history.

## Edge Cases

- A database row uses a valid key shape but has no catalog definition: ignore it.
- A catalogued row contains a non-boolean stored value: use the storage-failure value and log the invalid row.
- The config request fails while a page is already rendered: retain the last successful in-memory snapshot until a later refresh succeeds.
- Two administrators save conflicting values: the last complete atomic save wins and both saves remain visible in audit history.
- An administrator disables a server capability while a form is open: the next submit is rejected by the server and no data changes.

## Dependencies

- Admin authentication and role enforcement (see `authentication.spec.md` R1-R9 and `access-control.spec.md` R1.3-R3).
- Public and administrative API shapes (see `interfaces/runtime-feature-flags.ispec.md` R1-R4).
- First public and behavioral consumers (see `memory-stories.spec.md` R1-R7).
