import { useState, useRef, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface UseFileUploadOptions {
  onSuccess: (fileKey: string, file: File) => void;
  onClear: () => void;
}

export interface UseFileUploadReturn {
  uploading: boolean;
  progress: number;
  error: string;
  handleFileSelect: (file: File | null) => void;
  handleRemove: () => void;
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Manages a single XHR file upload with progress tracking.
 *
 * @param url - The endpoint to POST the file to (expects 201 + { fileKey: string })
 * @param commonFields - Extra FormData fields appended to every upload (fullName, branch, email)
 * @param options - Callbacks for success and clear events
 */
export function useFileUpload(
  url: string,
  commonFields: Record<string, string>,
  options: UseFileUploadOptions,
): UseFileUploadReturn {
  const { onSuccess, onClear } = options;

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const upload = useCallback(
    (file: File) => {
      setUploading(true);
      setProgress(0);
      setError("");

      const formData = new FormData();
      formData.append("file", file);
      for (const [key, value] of Object.entries(commonFields)) {
        formData.append(key, value);
      }

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress((e.loaded / e.total) * 100);
        }
      };

      xhr.onload = () => {
        setUploading(false);
        xhrRef.current = null;
        if (xhr.status === 201) {
          try {
            const resp = JSON.parse(xhr.responseText) as { fileKey: string };
            onSuccess(resp.fileKey, file);
          } catch {
            setError("Upload succeeded but response was invalid.");
          }
        } else {
          try {
            const resp = JSON.parse(xhr.responseText) as { error: string };
            setError(resp.error || "Upload failed.");
          } catch {
            setError("Upload failed.");
          }
        }
      };

      xhr.onerror = () => {
        setUploading(false);
        xhrRef.current = null;
        setError("Network error. Check your connection and try again.");
      };

      xhr.open("POST", url);
      xhr.send(formData);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, JSON.stringify(commonFields), onSuccess],
  );

  const handleFileSelect = useCallback(
    (file: File | null) => {
      setError("");
      if (file) {
        upload(file);
      } else {
        if (xhrRef.current) {
          xhrRef.current.abort();
          xhrRef.current = null;
        }
        setUploading(false);
        onClear();
      }
    },
    [upload, onClear],
  );

  const handleRemove = useCallback(() => {
    onClear();
  }, [onClear]);

  return { uploading, progress, error, handleFileSelect, handleRemove };
}
