import { useEffect, useRef, useState, type ReactNode } from "react";

export interface SlideOverProps {
  /** Called on Esc, backdrop click, or an internal close/back action. */
  onClose: () => void;
  /** Accessible name — ignored when `labelledById` is set. */
  ariaLabel: string;
  /** Id of an element (e.g. the detail's heading) that labels the dialog. */
  labelledById?: string;
  children: ReactNode;
  /** Test hook on the sliding panel element. */
  panelTestId?: string;
}

/**
 * CONTRACT: Shared overlay shell for BOTH the attendee detail route and spot
 * registration (registration-desk-ui plan, "SlideOver shell shared by BOTH").
 *
 * GUARANTEES:
 *   - Sits BELOW the app's SiteNav (52px, sticky/z-[300] — see SiteNav.tsx)
 *     rather than covering it: the overlay, backdrop, and panel all start at
 *     `top-[52px]` instead of the viewport top, on every breakpoint. This
 *     keeps the SiteNav hamburger/menu reachable AND keeps this shell's own
 *     internal top bar (e.g. the attendee detail's "← Back") from being
 *     visually and functionally occluded by SiteNav painting on top of it —
 *     both pin to y=0 by default (SiteNav is `sticky top-0`, this panel is
 *     `fixed`), and SiteNav's z-[300] beats this shell's z-40, so without the
 *     52px offset SiteNav's logo sits on top of and swallows clicks meant for
 *     this shell's own back control. Not a literal "full-screen" on mobile
 *     anymore — deliberately, to fix that collision.
 *   - Desktop (sm+): a right panel min(940px,82vw) over a dimmed backdrop,
 *     both also starting below the 52px nav.
 *   - Traps Tab focus within the panel while mounted.
 *   - Escape or a backdrop click calls onClose — the caller decides what
 *     that means (navigate back for the routed detail, close state for spot
 *     registration).
 *   - Restores focus to the previously focused element on unmount.
 *
 * EXPECTS: mounted only while the overlay should be visible — the caller
 *   controls mount/unmount (a route match, or local open state). Mounted
 *   under the app's SiteNav (StaffLayout), which reserves the top 52px.
 */
export function SlideOver({ onClose, ariaLabel, labelledById, children, panelTestId }: SlideOverProps) {
  const [entered, setEntered] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // The mount/unmount effect below must run exactly once, so it can capture
  // `previouslyFocused` at true mount time and restore it at true unmount
  // time. Reading onClose through a ref keeps the effect's deps empty even
  // though onClose (e.g. the spot-reg closeSpot callback) gets a new
  // identity on every parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []); // stable — never re-runs, so previouslyFocused is captured once at true mount

  return (
    <div className="fixed inset-x-0 top-[52px] bottom-0 z-40">
      <div
        className={`fixed inset-x-0 top-[52px] bottom-0 bg-charcoal/30 transition-opacity duration-300 motion-reduce:transition-none ${entered ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        aria-hidden="true"
        data-testid="slide-over-backdrop"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledById ? undefined : ariaLabel}
        aria-labelledby={labelledById}
        tabIndex={-1}
        data-testid={panelTestId}
        className={`fixed inset-x-0 top-[52px] bottom-0 flex flex-col overflow-y-auto overscroll-contain bg-page outline-none transition-transform duration-300 ease-out motion-reduce:transition-none max-sm:[&_input]:text-base max-sm:[&_select]:text-base max-sm:[&_textarea]:text-base sm:left-auto sm:right-0 sm:w-[min(940px,82vw)] sm:shadow-[-22px_0_60px_rgba(31,42,51,0.25)] ${entered ? "translate-x-0" : "translate-x-full"}`}
      >
        {children}
      </div>
    </div>
  );
}
