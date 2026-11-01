import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export type ActionButtonPhase = "idle" | "preparing" | "loading" | "success";

export interface ActionButtonProps {
  /**
   * The async server action. The button drives its own multi-stage animation
   * over this promise: preparing → loading (while it runs) → success. A
   * rejection returns the button to idle, so surface/clear any error in here
   * (and re-throw) rather than swallowing it.
   */
  onAction: () => Promise<void>;
  /** Idle label. */
  children: ReactNode;
  /** Label shown beside the checkmark once the action resolves. */
  successLabel?: ReactNode;
  /** Disables the button in idle (a run in progress always disables it). */
  disabled?: boolean;
  /**
   * Minimum time (ms) the loading state stays up, so a fast server response
   * doesn't flash the spinner. Effective loading time is
   * `max(onAction duration, minLoadingMs)`. @default 800
   */
  minLoadingMs?: number;
  className?: string;
  "aria-label"?: string;
  /** aria-label once resolved (falls back to aria-label). */
  successAriaLabel?: string;
  "data-testid"?: string;
}

/** Delay before compressing to the loading circle — lets the label fade and the
 *  spinner appear at the trailing edge first, so the collapse reads as caused. */
const PREPARE_MS = 180;

/**
 * CONTRACT: Async action button whose animation is tied to a server callback.
 *
 * GUARANTEES:
 *   - Runs `onAction` exactly once per activation; ignores clicks unless idle.
 *   - Exposes its stage on `data-phase` (idle | preparing | loading | success)
 *     so the CSS choreography (and tests) can key off it.
 *   - Reaches "success" only when `onAction` resolves; a rejection returns it to
 *     "idle" with no success/green flash.
 *   - Holds "loading" for at least `minLoadingMs` (floor, not additive) so a
 *     fast response can't make the compress/spinner/expand flash.
 *   - Success is terminal: the button stays disabled and green afterwards.
 */
export function ActionButton({
  onAction,
  children,
  successLabel = "Done",
  disabled = false,
  minLoadingMs = 800,
  className,
  "aria-label": ariaLabel,
  successAriaLabel,
  "data-testid": testId,
}: ActionButtonProps) {
  const [phase, setPhase] = useState<ActionButtonPhase>("idle");
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = useCallback(() => {
    if (phase !== "idle" || disabled) return;
    setPhase("preparing");
    timerRef.current = window.setTimeout(async () => {
      timerRef.current = null;
      setPhase("loading");
      // Start the floor timer alongside the call so loading lasts
      // max(call, minLoadingMs) — a fast response can't flash the spinner.
      const floor = new Promise<void>((resolve) => window.setTimeout(resolve, minLoadingMs));
      let succeeded = true;
      try {
        await onAction();
      } catch {
        succeeded = false;
      }
      await floor;
      if (mountedRef.current) setPhase(succeeded ? "success" : "idle");
    }, PREPARE_MS);
  }, [phase, disabled, onAction, minLoadingMs]);

  const busy = phase === "preparing" || phase === "loading";
  const isDisabled = disabled || busy || phase === "success";

  return (
    <button
      type="button"
      data-phase={phase}
      data-testid={testId}
      disabled={isDisabled}
      aria-busy={busy || undefined}
      aria-label={phase === "success" ? (successAriaLabel ?? ariaLabel) : ariaLabel}
      onClick={handleClick}
      className={`action-btn${className ? ` ${className}` : ""}`}
    >
      <span className="action-btn__bg" aria-hidden="true" />
      <span className="action-btn__label">{children}</span>
      <span className="action-btn__ring" aria-hidden="true">
        <span className="action-btn__ring-spinner" />
      </span>
      <span className="action-btn__success-content" aria-hidden={phase !== "success"}>
        <span className="action-btn__check">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <span className="action-btn__success-label">{successLabel}</span>
      </span>
    </button>
  );
}
