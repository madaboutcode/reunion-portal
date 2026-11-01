import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "./Button";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** @default "Confirm" */
  confirmLabel?: string;
  /** @default "Cancel" */
  cancelLabel?: string;
  /** @default "primary" */
  confirmVariant?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
  /** Disable confirm button and show spinner during async operations. */
  loading?: boolean;
  /** Disable the confirm button without showing a spinner (e.g. required
   *  input missing). Ignored while loading. */
  confirmDisabled?: boolean;
  /** Optional content rendered between the message and the action buttons
   *  (e.g. an inline form field). */
  children?: ReactNode;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  onConfirm,
  onCancel,
  loading = false,
  confirmDisabled = false,
  children,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = dialog.querySelectorAll<HTMLElement>("button, [tabindex]");
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const confirmButtonClass =
    confirmVariant === "danger"
      ? "bg-red-600 hover:bg-red-700 text-white shadow-md active:brightness-85 h-9 px-3 text-sm rounded-lg relative inline-flex items-center justify-center font-semibold focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 transition duration-150 select-none whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-600"
      : undefined;

  return (
    <div
      className="fixed inset-0 z-[900] bg-black/40 flex items-center justify-center"
      style={{ animation: "fadeIn 0.15s ease" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="bg-surface rounded-2xl p-6 max-w-[400px] w-[calc(100%-2rem)] shadow-xl border border-border-warm"
      >
        <h2
          id="confirm-dialog-title"
          className="font-heading text-lg font-bold text-charcoal mb-2"
        >
          {title}
        </h2>
        <p className="text-sm text-muted mb-6 whitespace-pre-line">{message}</p>
        {children}
        <div className="flex flex-row gap-3 justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          {confirmVariant === "danger" ? (
            <button
              type="button"
              className={confirmButtonClass}
              onClick={loading ? undefined : onConfirm}
              disabled={loading || confirmDisabled}
              aria-busy={loading || undefined}
            >
              {loading ? (
                <>
                  <span
                    className="absolute inset-0 flex items-center justify-center"
                    aria-hidden="true"
                  >
                    <span className="animate-spin rounded-full border-current border-t-transparent h-3.5 w-3.5 border-[1.5px]" />
                  </span>
                  <span className="invisible">{confirmLabel}</span>
                </>
              ) : (
                confirmLabel
              )}
            </button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={onConfirm}
              loading={loading}
              disabled={confirmDisabled && !loading}
            >
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
