import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type DragEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface FileUploadProps {
  /**
   * Comma-separated list of accepted file extensions.
   * @default ".jpg,.jpeg,.png,.pdf"
   */
  accept?: string;
  /**
   * Maximum file size in megabytes.
   * @default 5
   */
  maxSizeMB?: number;
  /** Called with the selected File on valid selection, or null on clear. */
  onFileSelect: (file: File | null) => void;
  /** When true, all interaction is disabled. */
  disabled?: boolean;
  /**
   * External error message from parent validation.
   * Overrides internal validation errors when set.
   */
  error?: string;
  /** When true, shows a progress bar instead of file info. */
  uploading?: boolean;
  /** Upload progress percentage (0-100). Only used when uploading=true. */
  uploadProgress?: number;
  /** Previously uploaded file name (from localStorage restore). Shows "uploaded" state without a File object. */
  uploadedFileName?: string;
  /** Called when the user removes a previously uploaded file. */
  onRemoveUploaded?: () => void;
  /**
   * When true, shows a thumbnail below the filename for images (JPG/PNG)
   * or a PDF icon placeholder for PDF files.
   */
  preview?: boolean;
  /** Optional test identifier for the drop zone element. */
  "data-testid"?: string;
  /** Hint mobile browsers to offer the camera alongside the file picker. */
  capture?: "user" | "environment";
}

// ── MIME type lookup ──────────────────────────────────────────────────────

const EXTENSION_TO_MIME: Record<string, string[]> = {
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".pdf": ["application/pdf"],
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function parseAcceptPatterns(accept: string): string[] {
  return accept
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function isValidFileType(file: File, patterns: string[]): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();

  return patterns.some((pattern) => {
    // MIME glob: e.g. "image/*"
    if (/^[a-z]+\/\*$/.test(pattern)) {
      const prefix = pattern.slice(0, pattern.length - 1); // "image/"
      return mimeType.startsWith(prefix);
    }
    // Full MIME type: e.g. "application/pdf"
    if (pattern.includes("/")) {
      return mimeType === pattern;
    }
    // Extension: e.g. ".jpg"
    const nameMatch = fileName.endsWith(pattern);
    const mimeMatch = EXTENSION_TO_MIME[pattern]?.includes(mimeType) ?? false;
    return nameMatch || mimeMatch;
  });
}

function formatsHint(accept: string): string {
  return accept
    .split(",")
    .map((s) => {
      const pattern = s.trim().toLowerCase();
      // MIME glob: "image/*" → "Images"
      if (/^[a-z]+\/\*$/.test(pattern)) {
        const type = pattern.split("/")[0];
        return type.charAt(0).toUpperCase() + type.slice(1) + "s";
      }
      // Full MIME type: "application/pdf" → "PDF"
      if (pattern.includes("/")) {
        const subtype = pattern.split("/")[1];
        return subtype.toUpperCase();
      }
      // Extension: ".jpg" → "JPG"
      return pattern.replace(/^\./, "").toUpperCase();
    })
    .join(", ");
}

const MAX_FILENAME_LENGTH = 40;

function truncateFilename(name: string): string {
  if (name.length <= MAX_FILENAME_LENGTH) return name;
  return name.slice(0, MAX_FILENAME_LENGTH - 3) + "...";
}

// ── Component ──────────────────────────────────────────────────────────────

export function FileUpload({
  accept = ".jpg,.jpeg,.png,.pdf",
  maxSizeMB = 5,
  onFileSelect,
  disabled = false,
  error: externalError,
  uploading = false,
  uploadProgress = 0,
  uploadedFileName,
  onRemoveUploaded,
  preview = false,
  capture,
  "data-testid": dataTestId,
}: FileUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [internalError, setInternalError] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Manage object URL lifecycle — create only for image files, revoke on cleanup
  useEffect(() => {
    if (!preview || !selectedFile || !selectedFile.type.startsWith("image/")) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [preview, selectedFile]);

  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const isUploading = uploading;
  const effectiveDisabled = disabled || isUploading;
  const displayError = externalError ?? internalError;
  const extensions = parseAcceptPatterns(accept);
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  const hasUploadedFile = !selectedFile && !!uploadedFileName && !isUploading;

  // ── File validation + state update ──

  const handleFile = useCallback(
    (file: File | null) => {
      setInternalError("");

      if (!file) {
        setSelectedFile(null);
        onFileSelect(null);
        return;
      }

      // 0-byte file
      if (file.size === 0) {
        setInternalError("File is empty.");
        setSelectedFile(null);
        onFileSelect(null);
        return;
      }

      // Type validation (extension + MIME)
      if (!isValidFileType(file, extensions)) {
        setInternalError(
          `Invalid file type. Accepted: ${formatsHint(accept)}.`,
        );
        setSelectedFile(null);
        onFileSelect(null);
        return;
      }

      // Size validation
      if (file.size > maxSizeBytes) {
        setInternalError(`File too large. Max ${maxSizeMB}MB.`);
        setSelectedFile(null);
        onFileSelect(null);
        return;
      }

      setSelectedFile(file);
      onFileSelect(file);
    },
    [accept, extensions, maxSizeBytes, maxSizeMB, onFileSelect],
  );

  // ── Input change handler ──

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFile(e.target.files?.[0] ?? null);
    // Reset input value so the same file can be re-selected after removal
    if (inputRef.current) inputRef.current.value = "";
  };

  // ── Remove handler ──

  const handleRemove = () => {
    setSelectedFile(null);
    setInternalError("");
    onFileSelect(null);
  };

  // ── Drag handlers (counter-based to avoid flicker on child elements) ──

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (!disabled) setDragActive(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setDragActive(false);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragActive(false);
    if (disabled) return;
    handleFile(e.dataTransfer.files?.[0] ?? null);
  };

  // ── Keyboard ──

  const handleKeyDown = (e: KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  // ── Click ──

  const handleClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  // ── Derived classes ──

  const borderColor = displayError
    ? "border-terracotta"
    : dragActive
      ? "border-soft-aqua"
      : "border-border";

  const iconColor = displayError
    ? "text-terracotta"
    : dragActive
      ? "text-soft-aqua"
      : "text-muted";

  const promptColor = displayError
    ? "text-terracotta"
    : dragActive
      ? "text-soft-aqua"
      : "text-muted";

  return (
    <div className="relative">
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        capture={capture}
        onChange={handleChange}
        disabled={disabled}
        data-testid={dataTestId ? `${dataTestId}-input` : "file-input"}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Error announcement for screen readers */}
      {displayError && (
        <div role="alert" aria-live="polite" className="sr-only">
          {displayError}
        </div>
      )}

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={effectiveDisabled ? -1 : 0}
        data-testid={dataTestId}
        onClick={isUploading ? undefined : handleClick}
        onKeyDown={isUploading ? undefined : handleKeyDown}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={isUploading ? undefined : handleDrop}
        aria-disabled={effectiveDisabled || undefined}
        className={[
          "w-full",
          "rounded-[10px]",
          "border-[1.5px]",
          displayError || dragActive ? "border-solid" : "border-dashed",
          isUploading ? "border-soft-aqua" : borderColor,
          "transition-[border-color,box-shadow] duration-150",
          "outline-none",
          "box-border",
          "flex flex-col items-center justify-center",
          selectedFile || hasUploadedFile || isUploading ? "min-h-0 p-3" : "min-h-[120px] p-6",
          effectiveDisabled ? "bg-[#F8F9FB] cursor-not-allowed" : "bg-white cursor-pointer",
          effectiveDisabled ? "opacity-60" : "",
          !effectiveDisabled && "focus-visible:ring-2 focus-visible:ring-soft-aqua/40",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {isUploading ? (
          // ── Uploading state ──
          <div className="w-full">
            <div className="flex items-center gap-3 mb-2">
              <svg
                className="w-5 h-5 text-soft-aqua shrink-0 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-[14px] text-charcoal font-body">
                Uploading... {Math.round(uploadProgress)}%
              </span>
            </div>
            <div className="w-full h-[6px] bg-[#f0f0f0] rounded-full overflow-hidden">
              <div
                className="h-full bg-soft-aqua rounded-full transition-[width] duration-200"
                style={{ width: `${Math.min(100, Math.max(0, uploadProgress))}%` }}
              />
            </div>
          </div>
        ) : selectedFile ? (
          // ── Selected file (local, pre-upload or post-upload) ──
          <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center gap-3 w-full">
              <FileIcon />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] text-charcoal truncate font-body leading-snug">
                  {truncateFilename(selectedFile.name)}
                </p>
                <p className="text-[12px] text-muted font-body leading-snug">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
              <RemoveButton onClick={(e) => { e.stopPropagation(); handleRemove(); }} disabled={effectiveDisabled} />
            </div>
            {displayError && (
              <p className="text-[12px] text-terracotta font-body leading-snug">
                {displayError}
              </p>
            )}
            {preview && previewUrl && selectedFile.type.startsWith("image/") && (
              <img
                src={previewUrl}
                alt="Preview"
                data-testid="file-preview-image"
                className="max-h-[200px] w-auto object-contain rounded-md self-start"
              />
            )}
            {preview && selectedFile.type === "application/pdf" && (
              <div
                data-testid="file-preview-pdf"
                className="flex items-center gap-2 text-[13px] text-muted font-body"
              >
                <PdfIcon />
                <span>PDF document</span>
              </div>
            )}
          </div>
        ) : hasUploadedFile ? (
          // ── Previously uploaded (restored from localStorage) ──
          <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center gap-3 w-full">
              <CheckIcon />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] text-charcoal truncate font-body leading-snug">
                  {truncateFilename(uploadedFileName!)}
                </p>
                <p className="text-[12px] text-[#2A7A80] font-body leading-snug">
                  Previously uploaded
                </p>
              </div>
              <RemoveButton
                onClick={(e) => { e.stopPropagation(); onRemoveUploaded?.(); }}
                disabled={effectiveDisabled}
              />
            </div>
            {displayError && (
              <p className="text-[12px] text-terracotta font-body leading-snug">
                {displayError}
              </p>
            )}
          </div>
        ) : (
          // ── Empty / Drag-over / Error state ──
          <>
            <svg
              className={`w-8 h-8 mb-3 ${iconColor} transition-colors`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p
              className={`text-[14px] font-body text-center ${promptColor} transition-colors`}
            >
              {dragActive
                ? "Drop file here"
                : "Drag & drop or click to browse"}
            </p>
            {displayError ? (
              <p className="text-[12px] text-terracotta font-body mt-1 text-center leading-snug">
                {displayError}
              </p>
            ) : (
              <p className="text-sm text-subtle font-body mt-1 text-center leading-snug">
                {formatsHint(accept)} up to {maxSizeMB}MB
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Extracted icons ───────────────────────────────────────────────────────

function FileIcon() {
  return (
    <svg className="w-6 h-6 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-6 h-6 text-[#2A7A80] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg
      className="w-6 h-6 text-terracotta shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-testid="pdf-icon-svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 13h6M9 17h4"
      />
    </svg>
  );
}

function RemoveButton({ onClick, disabled }: { onClick: (e: React.MouseEvent) => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-muted hover:text-terracotta transition-colors p-1 rounded hover:bg-terracotta-light shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
      aria-label="Remove file"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}
