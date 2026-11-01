# Specification: Photo & ID (Wizard Step 6)

## Purpose

Captures the registrant's photo (required for all users) and identity document (required for attending users). This step is shown for all participation types — it is not skipped for donation-only.

## Contents

- [Scope](#scope)
- [Requirements](#requirements)
  - [Section A: Your Photo](#section-a-your-photo)
  - [Section B: ID Proof](#section-b-id-proof)
  - [Donation-Only Path](#donation-only-path)
  - [Navigation](#navigation)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)

## Scope

**Covers:** Photo upload (all users), ID proof upload (attending users), section visibility rules per intent, upload interactions, continue button logic, data written to draft.

**Does not cover:** File storage (server-side concern), admin access to uploaded files, file upload component internals (see `file-upload.spec.md`), camera API or device-level media capture.

## Requirements

### Section A: Your Photo

R1 — A "Your Photo" section is displayed at the top of the step for all users regardless of intent.

R1.1 — A purpose note is shown before the upload area: "Your photo will be featured in the event magazine — a yearbook-style keepsake with everyone's photos and memories. Please upload a passport-size photo."

R1.2 — A privacy/security assurance is shown immediately after the purpose note: photos are stored securely, accessible only to the event committee, never publicly visible, and deleted after the event.

R2 — A file upload zone is displayed that accepts drag-and-drop or click-to-browse (see `file-upload.spec.md`).

R2.1 — On mobile browsers, tapping the upload zone opens the native photo picker, prompting "Take Photo or Choose from Library." No special camera API is needed.

R2.2 — Accepted file types: JPG and PNG only. PDF is not accepted for photos.

R2.3 — Maximum file size: 5MB.

R2.4 — On validation failure (wrong type or too large), an error message appears inline on the upload zone.

R2.5 — On successful file selection, the upload zone shows the selected filename with an option to remove it.

R3 — On valid file selection, the file is immediately sent to the server for upload along with registrant metadata (name, branch, email). The server returns a unique file reference on success.

R3.1 — The server-returned file reference is retained in the draft so the photo can be linked to the submission at the end of the wizard.

R3.2 — While the upload is in progress, the continue button is disabled and a loading indicator is shown in the upload zone.

R3.3 — If the upload request fails, an inline error is shown on the upload zone and no file reference is retained. The user must retry before proceeding.

R4 — Photo upload is **required** for all users regardless of participation type (full_celebration, campus_only, and donation_only). The user cannot proceed without a successfully uploaded photo.

### Section B: ID Proof

R5 — A "Verify Your Identity" section is displayed below the photo section for `full_celebration` and `campus_only` users. This section is hidden for `donation_only` users.

R5.1 — At the top of this section, before the upload area, explain why identity verification is needed:
- The venue requires valid ID for accommodation check-in
- Verification ensures safety and security for all attendees at the event

R5.2 — Immediately after the explanation, the privacy/security assurance is displayed: documents are stored securely, accessible only to the event committee, never publicly visible, and deleted after the event.

R6 — A file upload zone is displayed that accepts drag-and-drop or click-to-browse (see `file-upload.spec.md`).

R6.1 — Accepted file types: JPG, PNG, PDF. Max 5MB.

R6.2 — On successful file selection, the upload zone shows the selected filename with an option to remove it.

R6.3 — On validation failure (wrong type or too large), an error message appears inline on the upload zone.

R7 — A list of accepted ID types is displayed as badges: Aadhaar Card, PAN Card, Passport, Driving Licence.

R7.1 — The badges are informational guidance only. Any file matching the accepted format and size constraints is accepted regardless of which document type was uploaded.

R8 — An optional text area (2 rows) allows the user to add notes about their upload.

R8.1 — Placeholder example: "Name on ID differs from registered name."

R9 — Validation rules for `photoIdSchema` (see `validation.spec.md` R8):

R9.1 — Upload is **required** for `full_celebration` and `campus_only` participation types. The user cannot proceed without uploading a file.

R9.2 — Upload is optional for `donation_only` participation type. The user may proceed without uploading an ID.

R9.4 — If a file is uploaded, it must pass type and size validation (see `file-upload.spec.md` R11–R13).

### Donation-Only Path

R10 — When participation type is `donation_only`, the ID proof section (Section B) is not rendered.

R10.1 — Donation-only users see only the photo section.

R10.2 — Photo upload remains required — the user must upload a photo before proceeding.

R10.3 — This step is not skipped for donation-only users. They visit Step 6 on the way to Step 7.

### Navigation

R11 — Back transitions to Step 5 (Giving Back). Continue transitions to Step 7 (Review & Pay) and scrolls to top (see `registration-page.spec.md` R6).

R11.1 — The continue button label and enabled state follow this logic:

| Condition | Button label | Enabled |
|-----------|-------------|---------|
| Photo not uploaded | "Continue to Review" | Disabled |
| Photo uploaded, ID required (full_celebration or campus_only) and not uploaded | "Continue to Review" | Disabled |
| Photo uploaded, ID required and uploaded | "Continue to Review" | Enabled |
| Photo uploaded, donation-only (no ID section) | "Continue to Review" | Enabled |

## States

| State | Description |
|-------|-------------|
| Photo empty | No photo selected — continue button disabled for all participation types |
| Photo uploading | Upload in progress — continue button disabled, loading shown in zone |
| Photo upload error | Upload request failed — inline error shown, continue disabled |
| Photo uploaded, ID empty (required — full_celebration or campus_only) | Photo done, ID not yet uploaded — continue disabled |
| Photo uploaded, ID uploading | ID upload in progress — continue disabled |
| Photo uploaded, ID uploaded | Both done — continue enabled |
| Photo uploaded, donation-only | ID section hidden — continue enabled once photo is uploaded |
| File error (type or size) | Upload zone shows type or size error — continue disabled |

## Data Flow

**Reads from context:** `participationType`, `photoFileName`, `photoFileKey`, `photoFileType`, `photoFileSizeBytes`, `idFileName`, `idFileKey`, `idFileType`, `idFileSizeBytes`, `idNote`.

**Writes to context:** `photoFileName` (string), `photoFileKey` (string), `photoFileType` (MIME string), `photoFileSizeBytes` (number), `idFileName` (string), `idFileKey` (string), `idFileType` (MIME string), `idFileSizeBytes` (number), `idNote` (string).

## Edge Cases

- Removing a selected photo reverts to the photo-empty state (`photoFileKey`, `photoFileName` cleared). Continue button becomes disabled.
- Removing a selected ID file reverts to the ID-empty state (`idFileKey`, `idFileName` cleared). If ID is required, continue button becomes disabled.
- A 0-byte file fails size validation (see `file-upload.spec.md` edge cases).
- If the user uploads a photo, navigates back to Step 5 (Giving Back), then returns to Step 6 — previously uploaded photo state is restored from draft (filename shown, continue available if ID also satisfied).
- The file object itself is not stored in context — only metadata (name, type, size) and the server-returned `fileKey`.

## Dependencies

- Parent: `registration-page.spec.md`
- Uses: `file-upload.spec.md` (upload component contract)
- Reads: `step1-participation.spec.md` (`participationType` — for ID requirement logic)
- Validation: `validation.spec.md` R8 (`photoIdSchema`)
