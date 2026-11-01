# Specification: Roommate Preferences

## Purpose

Records roommate preferences for shared-accommodation alumni, enabling branch reps to coordinate room pairings for the committee to act on.

## Contents

- [Scope](#scope)
- [Domain](#domain)
- [Requirements](#requirements)
  - [Data Model](#data-model)
  - [Preference Constraints](#preference-constraints)
  - [Visibility](#visibility)
  - [Branch Rep Workflow](#branch-rep-workflow)
  - [Mutual Preferences](#mutual-preferences)
  - [Data Integrity](#data-integrity)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Roommate preference data model, preference constraints (count, same-type, same-gender), visibility rules, branch rep workflow, mutual preference detection, data integrity on accommodation changes.

**Does not cover:** Automatic room allocation or grouping (deferred — see DF2). Physical room records and the committee's manual room-assignment workflow (see `room-assignment.spec.md`). Alumni self-service preference entry (deferred — see DF1). Allocation page UI layout (see visual design wireframe). API endpoint contracts (see `staff-api.spec.md` delta). Scoped permissions model (see `authentication.spec.md` R13–R17).

## Domain

Three nouns introduced by this feature:

- **Roommate preference** — a directed edge from one shared-accommodation registration to another, expressing "this person wants to room with that person." Preferences are input to the committee's manual room-assignment workflow — not binding commitments.
- **Branch representative** — a staff user whose access is scoped to the allocation feature only. Created by an admin with `permissions: {"scopes": ["allocation"]}`. Coordinates with alumni via phone/WhatsApp, then enters their preferences into the system.
- **Scope** — a permission unit that restricts which staff features a user can access. Defined in `authentication.spec.md` R13–R17.

## Requirements

### Data Model

R1 — Roommate preferences are stored in a `roommate_preferences` table — a many-to-many junction between registrations:

```sql
CREATE TABLE roommate_preferences (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id           INTEGER NOT NULL REFERENCES registrations(id),
  preferred_registration_id INTEGER NOT NULL REFERENCES registrations(id),
  preference_order          INTEGER NOT NULL,
  created_by                INTEGER NOT NULL REFERENCES users(id),
  created_at                INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at                INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(registration_id, preferred_registration_id),
  CHECK(registration_id != preferred_registration_id),
  CHECK(preference_order BETWEEN 1 AND 5)
);
```

R1.1 — Indexes for efficient lookup in both directions:

```sql
CREATE INDEX idx_roommate_prefs_reg ON roommate_preferences(registration_id);
CREATE INDEX idx_roommate_prefs_preferred ON roommate_preferences(preferred_registration_id);
```

R1.2 — `preference_order` is 1–5 (1 = first choice). Order is meaningful — the committee uses it as a signal of strength.

R1.3 — `created_by` records which staff user (branch rep or admin) entered the preference. Audit trail for the committee.

### Preference Constraints

R2 — A registration may have at most 5 roommate preferences. The API rejects a 6th.

R2.1 — Both `registration_id` and `preferred_registration_id` must have a shared accommodation type (`shared_double` or `shared_triple`). Registrations with `accommodation = 'none'` or `accommodation = 'private'` cannot appear in either column.

R2.2 — Both registrations must have the **same** accommodation type. A `shared_double` registration cannot prefer a `shared_triple` registration, and vice versa.

R2.3 — Both registrations must have the **same gender**. The API validates `registrations.gender` for both sides.

R2.4 — A registration cannot prefer itself (`registration_id != preferred_registration_id`).

R2.5 — A registration cannot appear twice in the same person's preference list (enforced by the UNIQUE constraint).

R2.6 — Constraint violations return `422` with a descriptive error indicating which constraint failed (see `staff-api.spec.md` for response shapes).

### Visibility

R3 — The allocation page shows registrations where `accommodation IN ('shared_double', 'shared_triple', 'private')`. Registrations with `accommodation = 'none'` are excluded. Private-room registrations are list-visible only (client may hide them behind a display toggle) — they remain ineligible for preferences (R2.1). (Drift fix 2026-08-03, aligned with `staff-api.spec.md` R27.1 — shipped behavior included `private` since the master-detail cycle.)

R3.1 — All shared-accommodation registrations are visible regardless of the viewer's branch or batch. No data scoping by branch — any staff user with the `allocation` scope sees all shared-accommodation registrations.

R3.2 — Registrations are displayed in a flat list, filterable by branch (tabs), gender, check-in date, and match status. Branch tabs show per-branch counts.

R3.3 — Each registration card shows: full name, gender, branch, accommodation type pill (2-Share / 3-Share), preference dots (filled/empty), and a status label indicating match state (see R3.5).

R3.4 — Status filter pills in the toolbar: "All" (default), "Unmatched" (has preferences but no mutual match), "No prefs" (no preferences entered). These filter the card list.

R3.5 — Status labels on each card, derived from preference data:
- "✓ matched" (green, card dimmed) — all preferences are mutual
- "N mutual" (teal) — has N mutual matches but not fully matched
- "unmatched" (terracotta) — has preferences but none are mutual
- "no prefs" (gray) — no preferences entered

R3.6 — Layout: On desktop (≥768px), the page displays a master-detail split. Left panel (~42%): scrollable card selection list — click to select, not expand. Right panel (~54%): detail view for the selected registration (see R4.5). On mobile (<768px): single-column accordion cards with inline editing on expand.

R3.7 — Summary cards at the top show: Total registrations, Collected (have preferences), Missing (no preferences), Mutual (have at least one mutual match). The Mutual card is clickable and opens the Mutual Groups modal (see R5.3).

### Branch Rep Workflow

R4 — The branch rep workflow (experience fold-in):

1. Admin creates a staff account with `permissions: {"scopes": ["allocation"]}` via the Team management page.
2. Branch rep receives a magic link email, clicks to log in.
3. Staff console nav shows only "Allocation" (other links hidden — scope restriction).
4. Allocation page shows shared-accommodation registrations in a filterable list with branch tabs.
5. Branch rep selects a registration to view their detail (desktop: right panel; mobile: expand accordion).
6. Branch rep manages preferences via per-person editing (R4.5) or Room Together (R4.4).
7. Preferences auto-save via debounced flush. Branch rep can reorder, add, or remove preferences.
8. Mutual preferences are highlighted with status labels and the `isMutual` flag (see R5).

R4.1 — The branch rep collects preference information from alumni directly (phone, WhatsApp, in-person) and enters it into the system. The system is not alumni-facing for this feature.

R4.2 — Any staff user with the `allocation` scope can manage preferences for any shared-accommodation registration. There is no ownership — multiple branch reps can coordinate on the same registrations.

R4.3 — Full-access staff (permissions = null) also have access to the allocation page alongside their other capabilities.

R4.4 — **Room Together** (primary workflow): A toolbar action that opens a modal for creating mutual roommate preferences between 2+ people. The flow:
1. Rep clicks "Room Together" in the toolbar.
2. Modal opens with a search bar. Rep searches and adds people to the group.
3. For each person added, the modal shows: name, branch, accommodation type pill, current preferences (with mutual indicators), and a warning if slots are full.
4. A "What will happen" summary shows the mutual preference pairs that will be created.
5. On confirm: the system adds mutual preferences for all pairs (A→B and B→A for every pair in the group). Each participant is marked dirty in the auto-save state machine; preferences are flushed as batched PUTs.
6. Before writing, the system re-fetches current preference data for all participants to ensure version tokens are current.
7. If any write fails (e.g., 409 conflict), the system shows an informative error message identifying which participant's update failed. Successful writes are not rolled back — partial success is accepted and clearly communicated.

R4.5 — **Per-person detail view** (right panel on desktop, expanded card on mobile): Selecting a registration shows:
1. **Incoming requests**: People who have this registration as a preference. Each incoming request shows a "Make mutual" button — one click adds the mutual preference (both directions). When no incoming requests exist, shows "No incoming requests."
2. **Outgoing preferences**: Current roommate preferences with drag-to-reorder, delete. "Add preference" button opens the candidate search modal.
3. **WhatsApp Reminder**: Send reminder button with last-sent timestamp.
4. **Auto-save indicator**: "Changes save automatically" with a dirty indicator when unsaved changes exist.

R4.6 — **Incoming requests data**: On page load, the system background-loads preferences for all registrations with `preferenceCount > 0` and builds a client-side index of incoming preferences per registration. This index powers: the right panel's incoming section (R4.5), card status labels (R3.5), and the Mutual Groups modal (R5.3). No additional API endpoints required — uses existing per-registration preference GET.

### Mutual Preferences

R5 — A mutual preference exists when registration A prefers registration B **and** registration B prefers registration A.

R5.1 — The system surfaces mutual preferences as a visual indicator on both sides. The committee treats mutual preferences as the strongest pairing signal. Card status labels (R3.5) and preference dots (green for mutual, terracotta for one-way) communicate match state at a glance.

R5.2 — Mutual detection is read-time — derived from the existing preference data, not stored separately. The `isMutual` flag on each `PreferenceEntry` is computed by the server.

R5.3 — **Mutual Groups modal**: Clicking the "Mutual" summary card (R3.7) opens a modal showing all mutual match groups. A mutual group is a set of 2+ registrations where all members mutually selected each other. Groups are displayed with branch labels and accommodation type pills (2-Share / 3-Share) on each member. Branch filter tabs inside the modal allow filtering by branch. Registrations not in any mutual group are listed separately. Registration names are links — clicking opens the attendee detail view in a new tab (subject to the viewer's permissions). An export option is available.

R5.4 — **Bidirectional add** ("Room Together"): When the Room Together flow (R4.4) confirms, the system creates preference records in both directions for every pair. For a group of N people, this creates N×(N-1) directed preference edges (each pair in both directions). Each participant's preference list is updated via the existing PUT endpoint — one PUT per participant, containing their updated full preference list. The auto-save state machine handles these as independent dirty entries, each with their own version token.

### Data Integrity

R6 — Preferences are advisory — they inform the committee's room assignment, they are not binding.

R6.1 — When a registration's accommodation type changes (e.g., staff edits from `shared_double` to `private` or `none`), all preferences involving that registration (both as `registration_id` and `preferred_registration_id`) are deleted. The system does not retain invalid preferences. [REVIEW: this cleanup is currently unimplemented — no code path deletes `roommate_preferences` on accommodation or gender change, and the `preferences_cleaned` audit action exists only as a type constant (verified 2026-08-03, cycle 2026-08-03-allocation-room-switch, DF-D). Disposition is out of that cycle's scope — confirm implement-or-descope separately.] Exception: a shared→shared conversion (`shared_triple` → `shared_double` via `staff-api.spec.md` R41) retains all preferences involving the registration — decided at `docs/decisions/20260803-allocation-scope-upgrade-carveout.md` #5. Type-mismatched pairs are surfaced as incompatible by the client until staff adjust them.

R6.2 — When a registration is archived (hard-deleted from `registrations`, snapshot in `archived_registrations`), cascade delete removes their preferences.

R6.3 — When a registration's gender changes via staff edit, all preferences involving that registration are deleted (same rationale as R6.1 — gender constraint may be violated).

R6.4 — Preference deletion due to accommodation/gender change is logged in the audit trail: `preferences_cleaned`, records the registration ID, count deleted, and the triggering change.

## States

| State | Description |
|-------|-------------|
| No preferences | Registration has no roommate preferences entered. Default state. |
| Partial preferences | 1–4 preferences entered. Branch rep may add more. |
| Full preferences | 5 preferences entered (maximum). Adding more is rejected. |
| Mutual match | At least one preference is mutual (both sides prefer each other). |
| Preferences invalidated | Accommodation type or gender changed — preferences auto-deleted. |
| Registration archived | Registration deleted — preferences cascade-deleted. |

## Data Flow

**Reads:** Registration data (full_name, branch, accommodation, gender) from `registrations` table. Existing preferences from `roommate_preferences` table. Staff user identity from auth context (for `created_by`).

**Writes:** Preference records to `roommate_preferences` table. Audit entries on create/update/delete/clean operations.

## Edge Cases

- A registration changes from `shared_double` to `shared_triple`: all existing preferences are deleted (R6.1), because the pool of eligible roommates changes entirely.
- A registration changes from `shared_double` to `shared_double` (no-op edit): preferences are retained.
- Two branch reps manage the same registration's preferences concurrently: optimistic locking prevents silent overwrites. The `version` token (`MAX(updated_at)` per registration) is returned by GET (R28.6) and required on PUT (R29.8) and DELETE (R30.5). A stale `version` returns `409` — the client must reload before retrying. Concurrency is scoped per-registration: edits to different registrations never conflict. See `staff-api.spec.md` R28.6, R29.8, R30.5.
- A branch rep enters preferences for a registration that another branch rep already filled to 5: the first branch rep's preferences remain; the second sees the current state and can edit/reorder.
- A registration with incoming preferences (others prefer them) changes accommodation type: their incoming preferences are also deleted (R6.1 — both directions).
- `campus_only` and `donation_only` registrations skip accommodation entirely — they never appear in the allocation page.
- Room Together with a participant whose preference slots are full: the system shows a warning in the modal ("has N of N slots filled") but allows the rep to proceed — the rep decides whether to replace or skip.
- Room Together where one participant's write succeeds but another's fails (409): successful writes are not rolled back. The system shows which writes succeeded and which failed. The rep can retry the failed ones after reloading.
- Room Together across different accommodation types: blocked by R2.2 constraint — the candidate search in the Room Together modal only shows registrations of the same accommodation type and gender.
- Mutual groups modal with large groups: a mutual group can contain N people if every pair is mutually preferred. The display handles groups of 2, 3, or more.
- Background preference loading fails for some registrations: status labels show counts-based approximation until the full data is available. The mutual groups modal shows a loading indicator and retries on open.

## Dependencies

- Data: `registrations` table — accommodation type, gender, full_name, branch
- Auth: `authentication.spec.md` R13–R17 — scoped permissions, `requireScope("allocation")`
- Staff operations: `staff-operations.spec.md` — accommodation edit triggers preference cleanup (R6.1)
- Archive: existing archive flow — cascade delete on registration archive (R6.2)
- API: `staff-api.spec.md` — endpoint contracts for preference CRUD (defined in ifspecs phase)
- Deferred: DF1 (alumni self-service), DF2 (auto-allocation)
- Physical assignment: `room-assignment.spec.md`
