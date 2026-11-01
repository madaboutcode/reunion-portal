# Interface Specification: Memory Stories

## Purpose

Define the public, author, and administrator API boundaries for event memory stories.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
- [Shared Shapes](#shared-shapes)
- [Public List](#public-list)
- [Current Author State](#current-author-state)
- [Create](#create)
- [Update](#update)
- [Delete](#delete)
- [Administrator List](#administrator-list)
- [Hide and Unhide](#hide-and-unhide)
- [Content Safety](#content-safety)
- [Feature Flag Interactions](#feature-flag-interactions)
- [Dependencies](#dependencies)

## Scope

**Covers:** Public story reads, authenticated author state and mutations, admin moderation, response shapes, validation, errors, content safety, and flag interactions.

**Does not cover:** Browser layout, email template design, media uploads, comments, reactions, drafts, pagination, or registration archival behavior.

## Requirements

### Shared Shapes

R1 — A public story has this shape:

```json
{
  "id": 42,
  "text": "What stayed with me was how quickly twenty years disappeared...",
  "authorName": "Anjali Nair",
  "branch": "Computer Science & Engineering",
  "publishedAt": 1786924800000,
  "updatedAt": 1786924800000
}
```

R1.1 — `id` is a positive integer.

R1.2 — `text` contains the stored plain text after outer whitespace trimming.

R1.3 — `authorName` and `branch` are public registration identity fields. Email, registration ID, payment state, participation type, and check-in state are never exposed in a public story.

R1.4 — Timestamps are Unix epoch milliseconds.

  Scenario: Given a story is returned publicly, when its fields are enumerated, then it contains only the R1 fields and both timestamps are integer epoch milliseconds.

### Public List

R2 — `GET /api/public/memory-stories` is unauthenticated and returns all visible stories newest-published first.

### Success: `200`

```json
{
  "stories": [],
  "count": 0
}
```

R2.1 — `count` equals `stories.length`.

R2.2 — Hidden stories are omitted without placeholders or count leakage.

R2.3 — If `memories_show_stories=false`, the endpoint returns `404` with `{ "error": "Not found", "code": "FEATURE_UNAVAILABLE" }`.

R2.4 — A storage failure returns `503` with `{ "error": "Stories unavailable", "code": "STORIES_UNAVAILABLE" }`.

  Scenario: Given one visible and one hidden story, when the public list is requested, then only the visible story is returned and `count` is `1`.

### Current Author State

R3 — `GET /api/memory-stories/mine` requires an attendee, staff, or admin JWT and resolves it to a registration.

### Success: `200`

```json
{
  "story": null,
  "author": {
    "name": "Anjali Nair",
    "branch": "Computer Science & Engineering"
  },
  "submissionsEnabled": true
}
```

R3.1 — When the registration owns a story, `story` uses the R1 shape, including when that story is hidden.

R3.2 — `submissionsEnabled` is the effective value of `memory_stories_accept_submissions` for this request.

R3.3 — Missing/invalid JWT returns `401` with `{ "error": "Authentication required", "code": "AUTH_REQUIRED" }`.

R3.4 — A valid staff/admin JWT with no registration matching its email returns `403` with `{ "error": "A matching registration is required", "code": "REGISTRATION_REQUIRED" }`.

R3.5 — A valid attendee JWT whose registration no longer exists returns the same `403 REGISTRATION_REQUIRED` response.

  Scenario: Given an admin email matches a registration, when the current-author endpoint is called with the admin JWT, then it returns that registration's public author identity and current story.

### Create

R4 — `POST /api/memory-stories` requires a JWT that resolves to a registration and `memory_stories_accept_submissions=true`.

### Request

```json
{ "text": "A string between 50 and 2,000 characters after trimming." }
```

### Success: `201`

```json
{ "story": { "id": 42, "text": "...", "authorName": "...", "branch": "...", "publishedAt": 1786924800000, "updatedAt": 1786924800000 } }
```

R4.1 — Invalid text returns `422` with code `INVALID_STORY` and field-level details.

R4.2 — An existing story for the resolved registration returns `409` with `{ "error": "You have already shared a story", "code": "STORY_EXISTS" }`.

R4.3 — Disabled submissions or flag-storage failure returns `409` with `{ "error": "Story submissions are currently closed", "code": "SUBMISSIONS_DISABLED" }`.

R4.4 — Authentication/registration failures use R3.3-R3.5.

  Scenario: Given two create requests race for one registration, when both complete, then one returns `201`, one returns `409 STORY_EXISTS`, and one story exists.

### Update

R5 — `PUT /api/memory-stories/mine` requires the same eligibility and request body as create.

R5.1 — Success returns `200` with the updated public story shape.

R5.2 — No existing story returns `404` with `{ "error": "Story not found", "code": "STORY_NOT_FOUND" }`.

R5.3 — A valid update preserves `publishedAt`, author identity, and hidden/visible state while changing text and `updatedAt`.

R5.4 — Disabled submissions also disable updates and return `409 SUBMISSIONS_DISABLED`.

  Scenario: Given a hidden story, when its author submits valid replacement text, then the response contains the new text and unchanged `publishedAt`; the public list still omits it.

### Delete

R6 — `DELETE /api/memory-stories/mine` requires a JWT that resolves to the owning registration.

R6.1 — Success permanently deletes the story and returns `204` with no response body.

R6.2 — No existing story returns `404 STORY_NOT_FOUND`.

R6.3 — Delete remains available when submissions are disabled.

R6.4 — Authentication/registration failures use R3.3-R3.5.

  Scenario: Given submissions are disabled and an author owns a story, when they delete it, then the response is `204` and it no longer appears in author or public reads.

### Administrator List

R7 — `GET /api/admin/memory-stories` requires an admin JWT and returns visible and hidden stories newest-published first.

### Success: `200`

```json
{
  "stories": [
    {
      "id": 42,
      "text": "...",
      "authorName": "Anjali Nair",
      "branch": "Computer Science & Engineering",
      "publishedAt": 1786924800000,
      "updatedAt": 1786924800000,
      "visibility": "visible",
      "hiddenAt": null,
      "hiddenBy": null,
      "moderationComment": null
    }
  ]
}
```

R7.1 — A valid attendee or staff JWT returns `403`; missing/invalid JWT returns `401`.

R7.2 — The response does not include author email. The server resolves email only when sending a moderation notification.

  Scenario: Given one visible and one hidden story, when an admin requests the moderation list, then both appear with their visibility state.

### Hide and Unhide

R8 — `PUT /api/admin/memory-stories/:id/visibility` requires an admin JWT.

### Hide request

```json
{ "visibility": "hidden", "comment": "A required comment between 10 and 1,000 characters." }
```

### Unhide request

```json
{ "visibility": "visible" }
```

### Success: `200`

```json
{
  "story": { "id": 42, "visibility": "hidden" },
  "notification": "sent"
}
```

R8.1 — Hiding without a valid comment returns `422` with code `INVALID_MODERATION_COMMENT` and changes nothing.

R8.2 — Unknown story ID returns `404 STORY_NOT_FOUND`.

R8.3 — Hide success returns `notification` as `sent` or `failed`. `failed` does not change the `200` status or restore visibility.

R8.4 — Unhide success returns `notification: not_requested`.

R8.5 — Repeating the current visibility is idempotent: it returns `200`, makes no state change, sends no email, and writes no duplicate audit entry.

  Scenario: Given hide notification delivery fails, when an admin hides a visible story with a valid comment, then the response is `200` with `notification: failed` and public reads omit the story.

### Content Safety

R9 — Story and moderation text are accepted as plain JSON strings and are always returned as plain text content.

R9.1 — The API does not accept HTML fields, rich-text structures, or media fields.

  Scenario: Given a create request includes an unsupported `html` field, when it is submitted, then the response is `422 INVALID_STORY` and no story is created.

### Feature Flag Interactions

R10 — `memories_show_stories` gates R2 and the public page but does not prevent authenticated authors from deleting their own existing story.

R10.1 — `memory_stories_accept_submissions` gates R4 and R5, not R2, R3, R6, R7, or R8.

R10.2 — `navigation_show_stories` and `homepage_show_memory_stories` do not gate any API endpoint.

  Scenario: Given both navigation and homepage story flags are false while `memories_show_stories` is true, when the public story API is called directly, then it returns the visible stories.

## Dependencies

- Story behavior, identity, moderation, and lifecycle limits (see `../memory-stories.spec.md` R1-R12).
- Controlling flags and their independence (see `../feature-flags.spec.md` R7-R8).
- Authentication error semantics (see `../authentication.spec.md` R4-R9).
