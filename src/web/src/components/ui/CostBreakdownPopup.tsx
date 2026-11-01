/**
 * CONTRACT
 *
 * GUARANTEE: RENDER — When isOpen=true, renders a modal dialog with 6 cost
 *   category rows (label + amount), a subtotal row, a sponsorship deduction
 *   row, the net registration fee matching the base prop formatted as INR via
 *   formatINR(), a college contribution note, and COST_TOTAL_NOTE as a footer
 *   explanation. Rendered into document.body via React.createPortal.
 *
 * GUARANTEE: CLOSE_ESCAPE — Pressing the Escape key calls onClose().
 *
 * GUARANTEE: CLOSE_BACKDROP — Clicking the backdrop overlay (outside the card)
 *   calls onClose().
 *
 * GUARANTEE: CLOSE_BUTTON — The X close button in the top-right corner triggers
 *   onClose() on click.
 *
 * GUARANTEE: HIDDEN — When isOpen=false, the component renders nothing (null).
 *
 * GUARANTEE: ACCESSIBILITY — The dialog element has role="dialog" and
 *   aria-modal="true". The close button has an aria-label. Focus is trapped
 *   within the dialog: Tab cycles between the first and last focusable
 *   elements; Shift+Tab cycles in reverse. On mount, the first focusable
 *   element receives focus. On close, focus is restored to the element that
 *   was focused before the dialog opened.
 *
 * EXPECTS:
 * - `base` is a non-negative number in INR.
 * - `onClose` is a stable callback (consumers should use useCallback or a
 *   stable reference to avoid unnecessary effect re-runs).
 * - The document body exists when isOpen becomes true (portal target).
 */

import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { formatINR } from "@/lib/pricing";
import {
  COST_CATEGORIES,
  COST_TOTAL_BEFORE_SPONSORSHIP,
  COST_TOTAL_NOTE,
  SPONSORSHIP_ADJUSTMENT,
} from "@/lib/cost-categories";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CostBreakdownPopupProps {
  /** The base alumni registration fee to display as the total (in INR). */
  base: number;
  /** Whether the popup is visible. */
  isOpen: boolean;
  /** Called when the popup should close (Escape key, backdrop click, close button). */
  onClose: () => void;
}

// ── Focus trap helpers ─────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.offsetParent !== null);
}

// ── Component ──────────────────────────────────────────────────────────────

export function CostBreakdownPopup({
  base,
  isOpen,
  onClose,
}: CostBreakdownPopupProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // ── Keydown handler (document-level for reliable Escape + focus trap) ──
  const handleGlobalKeyDown = useCallback(
    (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusable = getFocusableElements(dialogRef.current);
        if (focusable.length === 0) {
          // No focusable elements — prevent Tab from leaving the dialog
          e.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          // Shift+Tab: if focus is on (or before) first, wrap to last
          if (active === first || !dialogRef.current.contains(active as Node | null)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          // Tab: if focus is on (or after) last, wrap to first
          if (active === last || !dialogRef.current.contains(active as Node | null)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose],
  );

  // ── Attach / detach document-level keydown listener ──
  useEffect(() => {
    if (!isOpen) return;

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isOpen, handleGlobalKeyDown]);

  // ── Focus management on open / close ──
  useEffect(() => {
    if (isOpen) {
      // Save currently focused element to restore on close
      previousFocusRef.current = document.activeElement as HTMLElement | null;

      // After portal DOM is painted, focus the first focusable element
      requestAnimationFrame(() => {
        if (dialogRef.current) {
          const focusable = getFocusableElements(dialogRef.current);
          if (focusable.length > 0) {
            focusable[0].focus();
          } else {
            // Fallback: focus the dialog itself so keyboard events still work
            dialogRef.current.focus();
          }
        }
      });
    } else if (previousFocusRef.current) {
      // Restore focus to the element that was focused before the dialog opened
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);

  // ── Backdrop click: close only when clicking the overlay, not the card ──
  const handleBackdropClick = useCallback(
    (e: MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  // ── Render ──
  if (!isOpen) return null;

  return createPortal(
    // Overlay / backdrop — clicking it closes the popup
    <div
      className={[
        "fixed inset-0 z-50",
        "flex items-center justify-center",
        "bg-black/45",
        "p-4",
      ].join(" ")}
      onClick={handleBackdropClick}
    >
      {/* Dialog card */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="How your registration fee is used"
        tabIndex={-1}
        className={[
          // Layout
          "relative w-full max-w-md",
          "rounded-2xl",
          // Surface
          "bg-surface",
          "border border-border-warm",
          // Shadow
          "shadow-[0_8px_30px_rgba(30,40,50,0.18)]",
          // Animation
          "animate-step-in",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2
            className={[
              "font-heading text-lg font-bold text-charcoal",
              "leading-snug",
            ].join(" ")}
          >
            How your registration fee is used
          </h2>

          {/* Close button — 44px minimum touch target */}
          <button
            type="button"
            aria-label="Close cost breakdown"
            onClick={onClose}
            className={[
              // Sizing — 44px minimum touch target
              "min-h-[44px] min-w-[44px]",
              "flex items-center justify-center",
              "rounded-lg",
              // Visual
              "text-charcoal/60 hover:text-charcoal",
              "hover:bg-charcoal/5",
              "transition-colors duration-150",
              // Focus
              "focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2",
            ].join(" ")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="3" y1="3" x2="15" y2="15" />
              <line x1="15" y1="3" x2="3" y2="15" />
            </svg>
          </button>
        </div>

        {/* ── Divider ── */}
        <div className="mx-5 border-t border-border-warm" />

        {/* ── Category list ── */}
        <div className="px-5 py-4 space-y-2">
          {COST_CATEGORIES.map((category) => (
            <div
              key={category.label}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="text-sm text-charcoal leading-snug">
                {category.label}
              </span>
              <span className="text-sm text-charcoal tabular-nums whitespace-nowrap">
                {category.amount != null ? formatINR(category.amount) : "TBD"}
              </span>
            </div>
          ))}

          {/* Subtotal before sponsorship */}
          <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-border-warm">
            <span className="text-sm text-charcoal/60 leading-snug">
              Subtotal
            </span>
            <span className="text-sm text-charcoal/60 tabular-nums whitespace-nowrap">
              {formatINR(COST_TOTAL_BEFORE_SPONSORSHIP)}
            </span>
          </div>

          {/* Sponsorship deduction */}
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-emerald-700 leading-snug">
              {SPONSORSHIP_ADJUSTMENT.label}
            </span>
            <span className="text-sm text-emerald-700 tabular-nums whitespace-nowrap">
              −{formatINR(Math.abs(SPONSORSHIP_ADJUSTMENT.amount))}
            </span>
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="mx-5 border-t border-border-warm" />

        {/* ── Total ── */}
        <div className="px-5 py-4 space-y-1">
          {/* Net registration fee */}
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-heading text-base font-bold text-charcoal">
              Net registration fee
            </span>
            <span className="text-lg font-bold text-terracotta tabular-nums whitespace-nowrap">
              {formatINR(base)}
            </span>
          </div>

          {/* College contribution note */}
          <p className="text-[11px] text-charcoal/50 leading-relaxed pt-0.5">
            College contribution (min ₹500) is a separate line item paid on top of this.
          </p>

          {/* Explanation note */}
          <p className="text-[11px] text-charcoal/50 leading-relaxed pt-1">
            {COST_TOTAL_NOTE}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
