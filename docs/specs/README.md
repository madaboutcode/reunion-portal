# Spec Index

| Spec | Type | Status |
|------|------|--------|
| `registration-page.spec.md` | Page (registration wizard) | Updated 2026-06-04 |
| `theme.spec.md` | Design tokens | Draft |
| `components/button.spec.md` | Primitive | Draft |
| `components/input.spec.md` | Primitive | Draft |
| `components/select.spec.md` | Primitive | Draft |
| `components/stepper.spec.md` | Primitive | Updated 2026-06-04 |
| `components/file-upload.spec.md` | Primitive | Draft |
| `components/form-field.spec.md` | Composed | Draft |
| `components/meal-toggle.spec.md` | Composed | Draft |
| `estimate-sidebar.spec.md` | Feature | Updated 2026-06-04 |
| `step1-participation.spec.md` | Feature | **NEW** 2026-06-04 — to be created |
| `alumni-details.spec.md` | Feature | Updated 2026-06-05 (wizard step 2) |
| `attendees-meals.spec.md` | Feature | Updated 2026-06-05 (wizard step 3) |
| `accommodation.spec.md` | Feature | Updated 2026-07-04 (wizard step 4 — room availability gating) |
| `room-availability.spec.md` | Feature | Updated 2026-08-09 — room inventory, occupancy, availability API |
| `room-assignment.spec.md` | Feature | **NEW** 2026-08-09 — physical rooms and registration-to-room assignment by night |
| `roommate-preferences.spec.md` | Feature | Existing — roommate preference data model and allocation workflow |
| `giving-back.spec.md` | Feature | Updated 2026-06-05 (wizard step 5) |
| `photo-id.spec.md` | Feature | Updated 2026-06-05 (wizard step 6) |
| `review-pay.spec.md` | Feature | Updated 2026-06-05 (wizard step 7) |
| `confirmation.spec.md` | Feature | Draft |
| `payment-advice-page.spec.md` | Page (print-ready payment advice) | Updated 2026-07-15 |
| `staff-console.spec.md` | Page (staff shell + nav) | **NEW** 2026-06-08 |
| `staff-dashboard.spec.md` | Page (attendees, donors, detail) | Updated 2026-06-08 |
| `staff-resources.spec.md` | Page (event planning aggregates) | Updated 2026-07-04 (room inventory button + occupancy display) |
| `staff-reports.spec.md` | Page (committee analytics) | Updated 2026-07-12 (Budget Progress: event/accommodation split cards) |
| `team-management.spec.md` | Page (admin team CRUD) | Updated 2026-06-08 |
| `predictions-replay.spec.md` | Page (V1 match replay at `/predictions`) | **Updated** 2026-06-17 |
| `staff-operations.spec.md` | Service logic (staff operations) | Updated 2026-07-01 (partial verification + refunds) |
| `staff-api.spec.md` | API (staff + admin endpoints) | Updated 2026-07-01 (partial verification + refunds) |
| `photo-replacement.spec.md` | Feature (staff photo replacement) | **NEW** 2026-07-15 — view-mode replace action, render-then-overwrite, global photosVersion cache-bust |
| `registration-desk.spec.md` | Feature (external registration desk workflow) | **NEW** — privacy-minimized lookup, spot registration, and check-in |
| `interfaces/registration-desk-api.ispec.md` | Interface (registration desk API) | **NEW** — narrow API contract |
| `interfaces/attendance-feed.ispec.md` | Interface (public attendance feed) | **NEW** — checked-in indicators and future live feed |
| `led-wall.spec.md` | Feature (fullscreen attendance display) | **NEW** 2026-08-13 — rotation + spotlight, present-only, controls panel |
| `interfaces/led-wall-data-source.ispec.md` | Interface (LED wall data source) | **NEW** 2026-08-13 — pluggable snapshot/subscribe/re-sync boundary |
| `glossary.md` | Domain glossary | **NEW** — registration desk and attendance terms |
| `interfaces/whos-coming-avatars.ispec.md` | Interface (Who's Coming avatar fields) | Existing — shared public response fields |
| `feature-flags.spec.md` | Feature (code-catalogued runtime flags + admin configuration) | Proposed 2026-08-17 |
| `interfaces/runtime-feature-flags.ispec.md` | Interface (public/admin runtime flag APIs) | Proposed 2026-08-17 |
| `memory-stories.spec.md` | Feature (public memory stories + authenticated writing + moderation) | Proposed 2026-08-17 |
| `interfaces/memory-stories.ispec.md` | Interface (public, author, and admin story APIs) | Proposed 2026-08-17 |
| `magazine-viewer.spec.md` | Feature (configurable CDN-backed magazine viewer) | Proposed 2026-08-17 |

## Update Protocol

1. When adding a new spec: add row to this table
2. When a spec changes behavior: update status to `Updated`, note date
3. When a component is removed: remove row, check cross-references in other specs
