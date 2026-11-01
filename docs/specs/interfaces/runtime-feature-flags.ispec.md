# Interface Specification: Runtime Feature Flags

## Purpose

Define the public and administrative HTTP interfaces through which catalogued feature flags are read and changed.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
- [Public Snapshot](#public-snapshot)
- [Administrative Snapshot](#administrative-snapshot)
- [Administrative Update](#administrative-update)
- [Compatibility](#compatibility)
- [Dependencies](#dependencies)

## Scope

**Covers:** Public bulk flag reads, administrative catalog reads, atomic administrative updates, authentication, validation, fallback responses, and migration from the old single-key endpoint.

**Does not cover:** Application-internal hook or service signatures, non-boolean settings, percentage rollouts, or simultaneous events.

## Requirements

## Public Snapshot

R1 — `GET /api/config/features` is unauthenticated and returns the resolved values of all public flags.

  Scenario: Given an anonymous visitor, when they request `/api/config/features`, then the response is `200` and contains a `flags` object.

### Success: `200`

```json
{
  "flags": {
    "navigation_show_stories": true,
    "homepage_show_memory_stories": true,
    "memories_show_stories": true,
    "memory_stories_accept_submissions": true
  },
  "resolvedAt": 1786924800000
}
```

R1.1 — `flags` contains every catalog entry with `exposure=public`, each exactly once, as a boolean.

  Scenario: Given four public catalog entries, when the endpoint responds, then `flags` contains four distinct boolean keys.

R1.2 — The response never includes labels, descriptions, defaults, failure values, update actors, audit records, or admin-only keys.

  Scenario: Given `debug_tools` has an override and update actor, when the public snapshot is returned, then neither the key nor its metadata appears.

R1.3 — The response uses `Cache-Control: no-store`.

  Scenario: Given a successful public snapshot, when response headers are inspected, then `Cache-Control` is `no-store`.

R1.4 — If flag storage cannot be read, the endpoint still returns `200`; every public key uses its catalogued storage-failure value.

  Scenario: Given flag storage is unavailable, when an anonymous client requests the snapshot, then the response is `200` and all initial story flags are `false`.

## Administrative Snapshot

R2 — `GET /api/admin/config/features` requires an admin JWT and returns the complete catalog plus current values and recent audit history.

  Scenario: Given an admin JWT, when the administrative snapshot is requested, then the response is `200` with `flags` and `audit`.

### Success: `200`

```json
{
  "flags": [
    {
      "key": "memories_show_stories",
      "label": "Show stories page",
      "description": "Makes the public stories page and read API available.",
      "group": "Memories",
      "enabled": true,
      "defaultValue": false,
      "failureValue": false,
      "source": "override",
      "exposure": "public",
      "enforcement": "both",
      "updatedAt": 1786924800000,
      "updatedBy": "admin@example.com"
    }
  ],
  "audit": [
    {
      "actor": "admin@example.com",
      "changedAt": 1786924800000,
      "changes": [
        { "key": "memories_show_stories", "from": false, "to": true }
      ]
    }
  ]
}
```

R2.1 — `source` is `default` when no override exists and `override` when one exists.

  Scenario: Given one flag has an override and one does not, when both are returned, then their sources are `override` and `default` respectively.

R2.2 — `updatedAt` and `updatedBy` are null when `source=default`.

  Scenario: Given a default-sourced flag, when it is returned, then both update metadata fields are null.

R2.3 — Audit history is newest first and limited to the most recent 50 configuration updates.

  Scenario: Given 60 configuration updates, when the snapshot is returned, then the 50 newest audit entries appear newest first.

R2.4 — Storage failure returns `503` with `{ "error": "Configuration unavailable", "code": "CONFIG_UNAVAILABLE" }`; the admin endpoint does not pretend fallback values are persisted values.

  Scenario: Given storage is unavailable, when an admin requests configuration, then the response is `503 CONFIG_UNAVAILABLE` with no flag list.

R2.5 — Missing/invalid JWT returns `401`; a valid attendee or staff JWT returns `403`.

  Scenario: Given a staff JWT, when the administrative snapshot is requested, then the response is `403` and contains no flag metadata.

## Administrative Update

R3 — `PUT /api/admin/config/features` requires an admin JWT and atomically applies one or more changes.

  Scenario: Given an admin submits two valid changes, when the update succeeds, then both new values appear in the `200` response.

### Request

```json
{
  "changes": [
    { "key": "memories_show_stories", "enabled": true },
    { "key": "navigation_show_stories", "enabled": true }
  ]
}
```

R3.1 — `changes` contains 1-100 entries.

  Scenario: Given an empty `changes` array, when it is submitted, then the response is `422 INVALID_FLAG_UPDATE`.

R3.2 — Each key must be defined in the catalog; each key may appear only once; `enabled` must be boolean.

  Scenario: Given the same key appears twice, when the update is submitted, then it is rejected and no value changes.

R3.3 — Success returns `200` with the same complete shape as R2 after all changes and audit history are committed.

  Scenario: Given one valid change, when it succeeds, then the response includes the updated full catalog and a corresponding newest audit entry.

R3.4 — An unknown key, duplicate key, wrong type, empty change list, or oversized list returns `422` with:

  Scenario: Given `unknown_flag` is submitted, when validation runs, then the response is `422` with a detail at `changes.0.key`.

```json
{
  "error": "Invalid feature flag update",
  "code": "INVALID_FLAG_UPDATE",
  "details": [{ "path": "changes.0.key", "message": "Unknown feature flag" }]
}
```

R3.5 — A validation or storage failure persists none of the requested changes and no success audit record.

  Scenario: Given storage fails while saving two changes, when the request completes, then neither value nor a success audit record is persisted.

R3.6 — Submitting a value equal to the current effective value is accepted but omitted from the persisted change set and audit change list. If every submitted value is unchanged, the response succeeds without a new audit entry.

  Scenario: Given two valid changes and one unknown key, when the update is submitted, then the response is `422` and neither valid change is persisted.

## Compatibility

R4 — The catalogued system supersedes the single-key `GET /api/feature-flags/:name` interface.

  Scenario: Given the new administrative snapshot is deployed, when portal consumers request flags, then none call the old single-key endpoint.

R4.1 — `debug_tools` retains its current admin-only, fail-closed behavior through the new administrative snapshot.

  Scenario: Given `debug_tools` cannot be resolved, when an admin opens a debug route outside development, then access remains closed.

R4.2 — The old single-key endpoint is removed only in the release that migrates its existing portal consumer to the administrative snapshot.

  Scenario: Given the migrated portal loads its debug gate, when `debug_tools` is disabled or configuration is unavailable, then debug routes remain inaccessible without calling the old single-key endpoint.

## Dependencies

- Flag definitions, defaults, exposure, and failure values (see `../feature-flags.spec.md` R1-R8).
- Admin authentication and access failures (see `../authentication.spec.md` R1-R9 and `../access-control.spec.md` R1.3-R3).
