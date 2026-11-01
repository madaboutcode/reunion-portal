# Specification: FileUpload

## Purpose

A drop zone + file picker for uploading ID verification documents. Accepts JPG, PNG, PDF with configurable size limit.

## Scope

**MUST:** Drag-and-drop zone, click-to-browse, file type validation, size validation, selected file display, remove button
**WILL NOT:** Multi-file upload, upload progress (mock only in v1), image preview

## Requirements

### Visual

R1 — Empty state: dashed border rectangle with upload icon, "Drag & drop or click to browse" text, accepted formats hint

R2 — Selected state: file icon, filename, file size (formatted: KB/MB), remove button (✕)

R3 — Error state: terracotta border, error message (e.g., "File too large. Max 5MB." or "Invalid file type. Accepted: JPG, PNG, PDF.")

R4 — Dimensions: full-width, min-height ~120px for drop zone, compacts when file selected

### Behavior

R5 — `accept` prop: comma-separated MIME types and/or extensions (default: ".jpg,.jpeg,.png,.pdf")

R6 — `maxSizeMB` prop: configurable max file size (default: 5)

R7 — Click on drop zone opens native file picker filtered to accepted types

R8 — Drag over: drop zone border highlights (soft-aqua)

R9 — File dropped or selected: validates type and size, calls `onFileSelect(file)` on success, shows error on failure

R10 — Remove button: clears selected file, calls `onFileSelect(null)`

### Validation

R11 — File type check: extension and MIME type must match `accept` list

R12 — File size check: must be ≤ `maxSizeMB` (converted to bytes)

R13 — Both checks run on file selection — type failure OR size failure shows specific error message

R14 — Validation error clears the file selection (does not retain invalid file)

### Accessibility

R15 — Drop zone is keyboard focusable, Enter/Space opens file picker

R16 — Error message is announced to screen readers via `aria-live="polite"`

R17 — "Drag and drop" instruction is visually hidden for screen readers (browse button is the accessible path)

## States

| State | Visual |
|-------|--------|
| Empty | Dashed border, upload prompt text, format hint |
| Drag-over | Aqua highlighted border, "Drop file here" text |
| Selected | File icon + name + size + remove button |
| Error (type) | Terracotta border, "Invalid file type" message |
| Error (size) | Terracotta border, "File too large" message |
| Disabled | Grayed out, no interaction |

## Edge Cases

- **File API unsupported**: Falls back to `<input type="file">` only (no drag-and-drop)
- **Multiple files dropped**: Only the first file is accepted, others ignored
- **0-byte file**: Treated as error ("File is empty")
- **File name too long**: Truncated with ellipsis

## Data Flow

```
Props:
  accept?: string              (default: ".jpg,.jpeg,.png,.pdf")
  maxSizeMB?: number           (default: 5)
  onFileSelect: (file: File | null) => void
  disabled?: boolean
  error?: string               (external error, e.g., from form validation)

Emits:
  onFileSelect(file) on valid selection
  onFileSelect(null) on remove
```

## Dependencies

- `theme.spec.md` for color tokens, border radius
