# Specification: Memory Stories

## Purpose

Give registered alumni a public place to share what stayed with them after the event and to read stories written by their batchmates.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)
- [Memory stories API](./interfaces/memory-stories.ispec.md)
- [Runtime feature flags](./feature-flags.spec.md)

## Scope

**Covers:** The `/memories/stories` page, homepage story preview, Stories navigation, authenticated create/edit/delete, public author identity, immediate publication, administrator hide/unhide moderation, and hide-notification email.

**Does not cover:** Photos, video, rich text, comments, reactions, titles, anonymous stories, drafts, approval-before-publication, staff editing attendee text, pagination, automatic curation, or story behavior during registration archival and event-data cleanup.

## Requirements

R1 — When `memories_show_stories` is enabled, `/memories/stories` is publicly readable and lists visible stories newest first.

R1.1 — Each story displays its complete text, the author's real registration name, branch, and original publication date.

R1.2 — Editing a story does not move it to the top of the list; ordering uses original publication time.

R1.3 — The V1 page returns all visible stories without pagination.

R1.4 — `/autograph` is a public short alias that redirects to the canonical `/memories/stories` route without preserving query or hash fragments.

  Scenario: Given a visitor opens `/autograph`, when the route loads, then they are redirected to `/memories/stories` and see the public stories page.

  Scenario: Given three visible stories with different publication times, when a visitor opens `/memories/stories`, then all three appear with the newest published story first.

R2 — The top navigation contains a `Stories` link to `/memories/stories` only when `navigation_show_stories` is enabled.

R2.1 — The link appears in both desktop and mobile public navigation.

R2.2 — Navigation visibility does not control direct page availability.

  Scenario: Given the Stories navigation flag is enabled, when a visitor opens the mobile menu, then `Stories` is visible and opens `/memories/stories`.

R3 — The homepage contains an `In Our Own Words` section only when `homepage_show_memory_stories` is enabled.

R3.1 — The section displays the three newest visible stories using shortened previews, author name, and branch.

R3.2 — The section provides `Read the stories` linking to `/memories/stories`.

R3.3 — The section provides `Share yours`; anonymous visitors are sent through login with a return destination of `/memories/stories`, while eligible authenticated users go directly to the writing area on that page.

R3.4 — When no visible stories exist, the section shows an invitation to publish the first story rather than empty cards.

  Scenario: Given four visible stories, when the homepage section is enabled, then only the newest three previews appear and `Read the stories` opens the complete list.

R4 — Writing happens on `/memories/stories`; there is no separate create page.

R4.1 — Anonymous visitors can read stories and see a `Sign in to share yours` action.

R4.2 — After magic-link authentication, the attendee returns to `/memories/stories`.

R4.3 — An eligible author with no story sees the writing form. An eligible author with a story sees their current text and Edit/Delete actions.

  Scenario: Given a registered attendee signs in from the story page, when magic-link verification succeeds, then they return to `/memories/stories` and can write there.

R5 — Any authenticated identity that resolves to a current registration may author one story.

R5.1 — An attendee JWT resolves directly to its registration.

R5.2 — A staff or admin JWT resolves authorship by case-insensitive email match to a registration. A staff/admin identity with no matching registration cannot author a story.

R5.3 — Registration payment status, participation type, and check-in state do not affect eligibility.

R5.4 — The server resolves the registration at every create, update, or delete request; client-stored identity is not authoritative.

  Scenario: Given an administrator is also registered under the same email address, when they publish a story, then the story is attributed to the matching registration's name and branch.

R6 — Each registration can own at most one story.

R6.1 — A story contains plain text only, with no title or formatting markup.

R6.2 — Leading and trailing whitespace is removed before validation and storage.

R6.3 — The trimmed text must contain between 50 and 2,000 characters inclusive.

R6.4 — The writing prompt is `What stayed with you after Smriti?` and the primary action is `Share your story`.

R6.5 — Submitting a second create request for the same registration does not create a duplicate.

  Scenario: Given an eligible author has no story, when they submit 50 valid characters, then exactly one visible story is published under their registration identity.

R7 — A newly submitted story is public immediately when `memory_stories_accept_submissions` is enabled.

R7.1 — If submissions are disabled, create and update requests are rejected before changing data; public reading remains controlled independently by `memories_show_stories`.

R7.2 — The successful submission state confirms publication and returns the author to their story in the public list.

  Scenario: Given story reading and submissions are enabled, when an eligible author submits a 50-character story, then it appears in the public list and homepage preview without administrator approval.

R8 — An author can edit or delete their own story and cannot change another author's story.

R8.1 — Editing changes only the text and update time; author identity and original publication time remain unchanged.

R8.2 — Deleting requires confirmation and permanently removes the story from public and author views.

R8.3 — Administrative audit history shows who deleted the story and when, but does not expose or retain the deleted text.

  Scenario: Given an author has a visible story, when they replace it with exactly 50 characters of valid text, then the new text is public at the same list position and no second story is created.

R9 — Only administrators can hide or unhide stories.

R9.1 — Administrators moderate stories from an admin-only story moderation page that includes visible and hidden stories.

R9.2 — Hiding requires a non-empty staff comment between 10 and 1,000 characters.

R9.3 — A hidden story disappears immediately from the public page and homepage section but remains stored for moderation and author editing.

R9.4 — Editing a hidden story does not automatically make it visible.

R9.5 — Unhiding restores public visibility without changing the original publication time.

R9.6 — Administrative audit history shows the administrator, story, comment where applicable, action, and time for every hide and unhide.

  Scenario: Given a visible story, when an administrator hides it with the comment `Please contact the committee about this story.`, then it disappears from all public responses and remains present in the administrator's moderation list.

R10 — Hiding a story attempts to email the author at the registration email address.

R10.1 — The email identifies the story action and includes the administrator's comment.

R10.2 — The hide operation remains successful if email delivery fails; the failure is logged for staff follow-up and the story remains hidden.

R10.3 — Unhiding does not send an email in V1.

  Scenario: Given email delivery fails, when an administrator hides a story, then the API still reports success, the story is hidden, and the delivery failure is logged.

R11 — Story text is always displayed as plain text.

R11.1 — Markup-like input is shown literally and never interpreted as HTML, Markdown, links, or executable content.

  Scenario: Given a story contains `<script>alert(1)</script>`, when it is displayed, then those characters appear as text and no script executes.

R12 — Story survival during registration archival, registration deletion, or event-data cleanup is unresolved and not implemented in V1.

R12.1 — V1 does not modify existing archive, cancellation, or retention workflows to include stories.

R12.2 — Those workflows must not silently delete, preserve, or block on stories without a later approved specification.

  Scenario: Given a future cleanup change touches registrations that own stories, when that change is planned, then story lifecycle behavior is treated as an open product decision rather than inferred from V1.

## States

### Public page

- Loading.
- Populated.
- Empty.
- Read error with retry.
- Feature unavailable when `memories_show_stories` is disabled.

### Author area

- Anonymous sign-in prompt.
- Authenticated but not registration-matched.
- Eligible with no story.
- Editing existing story.
- Submitting.
- Submission disabled.
- Validation error.
- Save error.
- Delete confirmation.
- Save/delete success.

### Moderation

- Loading.
- Visible story.
- Hidden story.
- Hide-comment validation error.
- Hide/unhide in progress.
- Moderation error.
- Email delivery warning after a successful hide.

## Data Flow

1. Public clients request visible stories.
2. Homepage requests the newest three visible stories.
3. Authenticated clients request their author state using the current JWT.
4. The server resolves JWT identity to a registration.
5. Create/update/delete validates ownership, feature availability, and text.
6. Admin moderation changes visibility, records audit history, and attempts hide notification.

## Edge Cases

- Staff/admin login matches multiple registrations: use the most recently created registration, matching existing magic-link attendee resolution.
- Author session expires during save: no change is persisted; prompt sign-in with return destination `/memories/stories`.
- Story is hidden while the author is editing: a valid save updates text but does not restore visibility.
- Story is deleted while an administrator has moderation open: the next moderation action returns not found and changes nothing.
- Two create requests race for the same registration: exactly one story is created; the other response identifies that a story already exists.
- Homepage preview fetch fails: the rest of the homepage remains available and the story section shows a retryable local error.

## Dependencies

- Attendee/staff/admin identity resolution (see `authentication.spec.md` R1-R8).
- Admin-only moderation (see `access-control.spec.md` R1.3-R3).
- Visibility and submission controls (see `feature-flags.spec.md` R3-R8).
- Public, author, and moderation APIs (see `interfaces/memory-stories.ispec.md` R1-R10).
- Flag snapshot API behavior (see `interfaces/runtime-feature-flags.ispec.md` R1-R4).
