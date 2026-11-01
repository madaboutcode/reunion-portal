# Specification: Staff Photo Replacement

## Purpose

Lets a staff member replace a registrant's photo from the registration detail page. Shortly after a valid image is submitted, the registrant's private original, private staff-facing thumbnail, and public "Who's Coming" thumbnail all show the replacement. Only the generated public thumbnail is exposed through the public CDN bucket; the original and private thumbnail remain private.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [Staff UI Action](#staff-ui-action)
  - [Thumbnail Rendering Helper (Extraction)](#thumbnail-rendering-helper-extraction)
  - [Photo Replacement Sequence](#photo-replacement-sequence)
  - [API Contract Addition](#api-contract-addition)
  - [Public Cache Invalidation](#public-cache-invalidation)
- [States](#states)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** The "Replace Photo" staff action (view mode only), removal of photo mutation from the general Edit path, the server-side replacement sequence, extraction of a shared thumbnail-rendering helper, and public-photo cache invalidation via a global `photosVersion`.

**Does not cover:** Registration edit flow changes other than removing `photo`/`photoFileKey` as an editable cosmetic field. Initial photo upload during registration (see `photo-id.spec.md`). Bulk thumbnail backfill (`regenerateMissingThumbnails` — existing, unchanged, out of scope). Rollback, versioned asset storage, or edit-lock synchronization — explicitly rejected (see Edge Cases).

## Requirements

### Staff UI Action

R1 — A "Replace Photo" action is shown beside `PhotoAvatar` in the Contact card of the Registration Detail Overview tab (`RegistrationDetailPage.tsx`), not inside any edit form. It is available only in view mode; the current page replaces the Overview with `EditForm` while editing, so the action is not rendered during Edit.

  Scenario: Given a staff member viewing a registration's Overview tab, when they look at the Contact card, then a "Replace Photo" control is visible next to the photo avatar, independent of the Edit action.

R1.1 — Clicking "Replace Photo" opens a native file picker restricted to `image/jpeg` and `image/png` (same accept constraints as R4 below).

R1.2 — On file selection, the client immediately submits the file via `POST /api/staff/registrations/:id/photo` (see `staff-api.spec.md` addition, R30 below). No separate "confirm" step or preview crop — selection is submission.

R1.3 — While the request is in flight, the control shows a loading state (e.g. spinner replacing the action label). The existing photo continues to display unchanged during this time — no optimistic swap.

R1.4 — On success: a success toast is shown ("Photo updated.") and the page calls its existing `loadDetail()` reload function. `PhotoAvatar` remounts with the fresh `photoThumbKey`/`photoFileKey` from the reloaded registration and fetches the new image through the existing `fetchFile()` mechanism — no new prop-passing or parent-state patching is introduced.

  Scenario: Given a staff member selects a valid JPEG, when the upload completes, then a success toast appears and the Contact card's avatar shows the new photo after reload.

R1.5 — On failure, an inline/toast error is shown with the server's error message (see R4.4–R4.6, R4.9). Validation and rendering failures leave all stored photos untouched. An infrastructure failure may have completed an earlier deterministic storage write (R3.1); staff may retry by selecting the file again.

R1.6 — This action does not require or pass an `updatedAt` lock token. It is unavailable while Edit is open, so it never attempts to preserve or rebase an Edit form's unsaved state.

R1.7 — `photo`/`photoFileKey` is removed from the general registration Edit form and update allowlist. "Replace Photo" is the sole sanctioned staff path for changing a registrant photo, preventing the original, private thumbnail, and public thumbnail from becoming desynchronized.

### Thumbnail Rendering Helper (Extraction)

R2 — A new private helper `renderPhotoThumbnail(input: ReadableStream): Promise<ArrayBuffer>` is extracted in `registration.service.ts`. It performs only the Cloudflare Images transform (`width: 200, height: 200, fit: 'cover', gravity: 'face'`, output `image/jpeg` quality 80) and returns the resulting bytes.

R2.1 — `renderPhotoThumbnail` throws if the input cannot be decoded or transformed by the Images binding. It performs no storage I/O and no DB writes.

R2.2 — The existing `generatePhotoThumbnail(regId, regCode, photoKey)` (registration.service.ts:278) is refactored to call `renderPhotoThumbnail` internally for the transform step, then continues its existing best-effort behavior unchanged: catch-and-log on failure, upload to `registrations/{regCode}/photo-thumb.jpg`, update `photo_thumb_key`, publish to the public bucket. Its return type (`Promise<void>`) and callers (`relocateFiles`, `regenerateMissingThumbnails`) are unchanged.

R2.3 — `regenerateMissingThumbnails()` (registration.service.ts:324) is not modified as part of this feature. Its existing error-reporting behavior — including any latent bug in how it aggregates errors — is out of scope.

### Photo Replacement Sequence

R3 — A new service method (e.g. `replacePhoto(regId: number, actorEmail: string, file: { bytes: ArrayBuffer, mimeType: string, sizeBytes: number })`) performs the replacement. Before multipart parsing, the route caps the whole request body at 5 MB + 64 KiB to bound framing overhead; after parsing, it enforces an exact 5 MB file limit and materializes the accepted file as one service-owned `ArrayBuffer`. The same bytes remain available both for rendering and original upload. Steps, in order:

1. Find the registration by `regId`. Not found → `404`.
2. Confirm `fileStorage`, `imagesBinding`, and `publicThumbsBucket` bindings are present (same guard pattern as `generatePhotoThumbnail`'s existing `if (!this.imagesBinding || !this.fileStorage || !photoKey) return;`). Missing binding → `500`.
3. Create a fresh readable input from `file.bytes` and call `renderPhotoThumbnail(input)` (R2). This runs **before any write**. If it throws, the request fails and **no writes have occurred** — the registration's existing photo and thumbnails are untouched.
4. Upload the canonical original to `registrations/{regCode}/photo.{ext}` where `{ext}` derives from `file.mimeType` (`jpg` for `image/jpeg`, `png` for `image/png` — same mapping as `extFromMime` in `upload.routes.ts`).
5. Upload the canonical private thumbnail to `registrations/{regCode}/photo-thumb.jpg` (the bytes rendered in step 3).
6. Upload the canonical public thumbnail to the public bucket at key `{registrationId}.jpg` (same `publishThumbToPublicBucket` cache-control: `public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, immutable`).
7. Update `registrations.photo_file_key` and `registrations.photo_thumb_key` in a single `registrationRepo.update()` call. Repository updates allocate a globally monotonic `updated_at` value using `MAX(unixepoch() * 1000, (SELECT COALESCE(MAX(updated_at), 0) + 1 FROM registrations))`. D1 serializes writes, so the value changes even for multiple updates in the same second; this drives reliable cache-busting (R6).
8. If the previous `photo_file_key`'s extension differs from the new one (e.g. `.png` → `.jpg`), best-effort delete the old original key. Delete failure is logged, not thrown.
9. Append an audit entry: action `photo_replaced`, actor = `actorEmail`, `registration_id = regId`, `changes.photoFileKey = { old: oldPhotoKey, new: newPhotoKey }`, and the required registration snapshot. Audit failure is logged only (existing pattern, e.g. registration.service.ts:172) — it does not fail an otherwise-successful replacement.
10. Return success.

R3.1 — If any infrastructure write (steps 4–7) fails, the request returns an ordinary error (`500` or the underlying error's status). No rollback of prior steps in this sequence is attempted.

R3.2 — Retry is the recovery mechanism: because all three storage keys and the D1 key update are deterministic (same keys every time), staff re-submitting the same file after a failure safely overwrites whatever partially completed. The storage/DB result converges safely; the overall operation is not strictly idempotent because a successful retry produces another `updated_at` value and audit entry.

R3.3 — No transaction/saga wraps steps 4–9. This is an accepted tradeoff at this scale (~200 registrants, ~3–5 expected replacements) — see Edge Cases.

R3.4 — `photo_replaced` is added to the `AuditAction` union in `domain/status.ts` (currently: `'created' | 'updated' | 'payment_created' | 'proof_uploaded' | 'proof_rejected' | 'proof_uploaded_by_staff' | 'payment_verified' | 'amended' | 'payment_amended' | 'registration_archived' | 'refund_created' | 'refund_completed'` — no photo-related value exists today). This is a type-level change, not a migration — `audit_log.action` is stored as free-text.

R3.5 — `PUT /staff/registrations/:id` no longer accepts `fields.photoFileKey` as a cosmetic field. The standalone replacement sequence is the only path that may change photo keys, because it keeps the original, private thumbnail, public thumbnail, DB keys, and cache version synchronized.

### API Contract Addition

R4 — `POST /api/staff/registrations/:id/photo` — staff/admin auth required (same role gate as other `/api/staff/*` endpoints, `staff-api.spec.md` R1.1). `:id` is the registration ID.

R4.1 — Request: multipart form data with a single `file` field.

R4.2 — Accepted types: `image/jpeg`, `image/png` only (matches `photo-id.spec.md` R2.2 and `validation.spec.md` R8's `MAX_PHOTO_FILE_SIZE` photo rule — not the ID-document PDF allowance).

R4.3 — Maximum file size: 5 MB, matching the existing initial photo upload endpoint. A route-level body limit rejects multipart requests larger than 5 MB + 64 KiB before parsing; the post-parse file check enforces the exact 5 MB limit. This route must not use a larger generic/shared file limit.

R4.4 — Missing file → `422` with `{ "error": "Validation failed", "details": { "fieldErrors": { "file": "Required" } } }` (same shape family as `staff-api.spec.md` R2.3).

R4.5 — Non-image or oversized file → `400` with `{ "error": "Invalid file type", "details": { "allowedTypes": ["image/jpeg", "image/png"] } }` for type, or the size-equivalent error per `submission-api.spec.md` R6.12 pattern, before any rendering is attempted.

R4.6 — Empty file (0 bytes) → `400` with the size-validation error shape used for an invalid upload; rendering is not attempted.

R4.7 — `404` if no registration exists with the given `:id` (`staff-api.spec.md` R2.4 shape).

R4.8 — On success, returns `200` with:

```json
{ "status": "ok", "message": "Photo updated." }
```

R4.9 — Failure during rendering (R3 step 3 — corrupt/undecodable image that nonetheless passed the MIME/size checks) returns `422` with `{ "error": "Could not process image" }`. No writes occur in this case (R3 step 3 guarantee).

R4.10 — Audit entry per R3 step 9. See `staff-operations.spec.md` R12.2 action table addition below.

### Public Cache Invalidation

R5 — `GET /api/public/whos-coming` (`public.routes.ts`) response gains a top-level `photosVersion` field.

R5.1 — `photosVersion = Math.max(...people.map(p => p.updatedAt))`. This requires the query to additionally `SELECT updated_at` (aliased to `updatedAt` on each person) — the field is used only to compute `photosVersion`; it is not exposed per-person. Repository updates allocate globally monotonic `updated_at` values (R3 step 7), so successive updates cannot reuse the current maximum.

R5.2 — Modified response shape:

```json
{
  "people": [ { "id": 42, "fullName": "Omar Mock", "...": "unchanged fields" } ],
  "count": 70,
  "thumbsBaseUrl": "/api/public/photos",
  "photosVersion": 1752600000000
}
```

R5.3 — Empty `people` result → `photosVersion` is `0` (or the server start-relevant fallback) — no crash on `Math.max()` of an empty array.

R6 — Public photo URLs are constructed client-side as `` `${thumbsBaseUrl}/${id}.jpg?v=${photosVersion}` ``. All response types, prop paths, helpers, and consumers must carry the version consistently:

- `publicPhotoUrl(id, thumbsBaseUrl)` in `src/web/src/lib/api.ts:108` — the nominal shared helper; gains a `photosVersion` parameter.
- `WhosComingResponse` in both `src/web/src/lib/api.ts` and `src/web/src/lib/prediction-types.ts` gains `photosVersion`.
- `PublicWhosComingPage.tsx` passes `photosVersion` into `WhosComingView.tsx`, whose `publicPhotoUrl(...)` calls use it.
- `WhosComingPage.tsx` passes the version to its `publicPhotoUrl(...)` call.
- `useWhosComingAvatars.ts` uses the shared `publicPhotoUrl(...)` helper instead of constructing an unversioned URL inline.

R6.1 — A successful photo replacement (R3 step 7) allocates a new globally monotonic `updated_at`, which changes the max across all people, which changes `photosVersion`, which changes the query string on every public photo URL — busting the CDN's `immutable` cache entry for that photo (and, as a side effect, for all ~200 public thumbnails, since `photosVersion` is global, not per-person).

R6.2 — This is an accepted tradeoff: no new DB column, no migration, no per-person version tracking. At ~200 registrants and infrequent edits/replacements, invalidating all public thumbnail URLs together is cheap. See Edge Cases.

## States

| State | What happens |
|---|---|
| Replace control idle | "Replace Photo" visible, clickable, no request in flight |
| Registration in Edit mode | Overview and Replace Photo control are not rendered |
| Upload in flight | Loading state shown on the control; existing photo still displayed; Edit form (if open) is unaffected |
| Upload succeeded | Success toast; `loadDetail()` reloads; `PhotoAvatar` remounts with new image |
| Upload failed (validation) | Inline/toast error with server message; existing photo unchanged; control returns to idle |
| Upload failed (infrastructure, partial writes) | Ordinary error shown; staff retries with the same file; retry overwrites deterministic keys safely (R3.1–R3.2) |

## Edge Cases

- Invalid/corrupt image (passes MIME/size checks but Images binding can't transform it) → fails at R3 step 3, zero writes occur, `422` returned (R4.9).
- Infrastructure write fails mid-sequence (e.g. R2 bucket outage after original upload but before thumbnail upload) → ordinary error returned; no rollback; staff retries the same file; overwrite is idempotent (R3.1–R3.2).
- Audit append fails after all image writes succeed → the replacement is still reported as successful to staff (R3 step 9); only the audit write is logged as an internal failure.
- Old original had a different file extension than the new upload (e.g. registrant originally uploaded a PNG, staff replaces with a JPEG) → best-effort delete of the stale-extension original (R3 step 8); delete failure is logged, not surfaced to staff.
- An unrelated registration edit (e.g. staff changes a phone number) also bumps `updated_at`, which also changes the global `photosVersion` and busts all public thumbnail cache entries even though no photo changed. Accepted — occasional over-invalidation of ~200 cached thumbnails is cheap at this scale (R6.2).
- Two staff members replace photos within the same second → serialized repository writes allocate distinct globally monotonic `updated_at` values, so each successful replacement changes `photosVersion`.
- A registration in Edit mode has no Replace Photo action. Staff must save or cancel Edit before replacing the photo; no draft preservation or lock-token rebasing is required.

## Dependencies

- UI: `staff-dashboard.spec.md` (Registration Detail, R5.5 Contact card — this action lives beside the existing `PhotoAvatar` there)
- API: `staff-api.spec.md` (new endpoint alongside existing `/api/staff/registrations/:id/*` actions)
- Service logic: `staff-operations.spec.md` (audit action table, R7/R12 — add `photo_replaced`)
- Public interface: `interfaces/whos-coming-avatars.ispec.md` (response shape and `useWhosComingAvatars`/avatar URL construction — this spec adds `photosVersion`)
- Initial upload constraints: `photo-id.spec.md` R2.2 (file types); the replacement endpoint matches the running initial-upload limit of 5 MB
- Existing thumbnail generation: `registration.service.ts` `generatePhotoThumbnail`, `relocateFiles`, `regenerateMissingThumbnails` (unchanged except the R2 extraction)
- File storage adapter: `file-storage.ts` (`IFileStorage.upload`/`get` — reused, no new methods needed)
