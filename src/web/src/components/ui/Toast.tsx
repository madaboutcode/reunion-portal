import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type ToastType = "success" | "error";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
}

// ── Context ────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────────────────

const MAX_TOASTS = 3;
const DISMISS_DELAY_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timeouts = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const handle = timeouts.current.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      timeouts.current.delete(id);
    }
  }, []);

  const add = useCallback(
    (type: ToastType, message: string) => {
      const id = nextId.current++;

      setToasts((prev) => {
        const next = [...prev, { id, type, message }];
        // If we're over the limit, drop the oldest ones and clear their timeouts
        if (next.length > MAX_TOASTS) {
          const removed = next.splice(0, next.length - MAX_TOASTS);
          removed.forEach((t) => {
            const handle = timeouts.current.get(t.id);
            if (handle !== undefined) {
              clearTimeout(handle);
              timeouts.current.delete(t.id);
            }
          });
        }
        return next;
      });

      const handle = setTimeout(() => dismiss(id), DISMISS_DELAY_MS);
      timeouts.current.set(id, handle);
    },
    [dismiss],
  );

  const success = useCallback((message: string) => add("success", message), [add]);
  const error = useCallback((message: string) => add("error", message), [add]);

  return (
    <ToastContext.Provider value={{ success, error }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ── ToastContainer ─────────────────────────────────────────────────────────

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[1000] flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// ── ToastCard ──────────────────────────────────────────────────────────────

interface ToastCardProps {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}

function ToastCard({ toast, onDismiss }: ToastCardProps) {
  const accentClass =
    toast.type === "success"
      ? "border-l-4 border-l-green-500"
      : "border-l-4 border-l-terracotta";

  return (
    <div
      className={[
        "min-w-[300px] max-w-[420px] p-4 rounded-xl bg-white shadow-lg border border-border",
        accentClass,
        "flex items-start gap-3",
      ].join(" ")}
      style={{ animation: "slideIn 0.2s ease both" }}
      role="alert"
      aria-live="polite"
    >
      <p className="text-sm text-charcoal font-medium flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 text-muted hover:text-charcoal transition-colors leading-none text-base"
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}
