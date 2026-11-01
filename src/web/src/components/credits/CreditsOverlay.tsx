import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CreditsReel } from "./CreditsReel";

export interface CreditsOverlayProps {
  /**
   * Ref to the page element (the "That's a wrap" closer) whose entry into the
   * viewport reveals the invitation panel. The overlay never opens on its own —
   * the panel is only a tap target.
   */
  triggerRef: React.RefObject<HTMLElement | null>;
}

export function CreditsOverlay({ triggerRef }: CreditsOverlayProps) {
  const [inviteVisible, setInviteVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const inviteButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Reveal the invitation panel while the closer is in view; hide it again once
  // it scrolls away. The panel stays available for the whole session.
  useEffect(() => {
    const el = triggerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setInviteVisible(entry.isIntersecting),
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [triggerRef]);

  const handleClose = useCallback(() => {
    // Return focus to the trigger synchronously, before the overlay unmounts —
    // the pill is always mounted, so once it holds focus the close button's
    // removal can't reset focus to <body>. (A deferred rAF focus proved flaky.)
    inviteButtonRef.current?.focus();
    setOpen(false);
  }, []);

  // While the overlay is open: lock body scroll, move focus to the close button,
  // trap Tab on it (the reel has no focusable controls), and close on Esc.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClose();
      } else if (e.key === "Tab") {
        e.preventDefault();
        closeButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, handleClose]);

  return (
    <>
      {/* Invitation panel — slides up from the bottom edge when the closer is in
          view. Rendered inside .awards-page so its CSS vars resolve. */}
      <div
        className={`fixed inset-x-0 bottom-0 z-[320] flex justify-center px-4 pb-5 transition-transform duration-500 ease-out motion-reduce:transition-none ${
          inviteVisible && !open ? "translate-y-0" : "pointer-events-none translate-y-[160%]"
        }`}
      >
        <button
          ref={inviteButtonRef}
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto inline-flex min-h-[44px] items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--ink)] px-6 py-3 text-white shadow-[0_12px_30px_rgba(31,42,51,0.35)] transition-transform hover:-translate-y-0.5 motion-reduce:transition-none"
          aria-label="Roll the credits"
        >
          <span aria-hidden="true">🎬</span>
          <span className="font-accent text-2xl text-[var(--gold-soft)]">Roll the credits</span>
        </button>
      </div>

      {/* Full-screen overlay — above SiteNav (z-[300]); portalled to body so it
          escapes the awards-page stacking context. */}
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Prediction contest credits"
            className="fixed inset-0 z-[400] bg-black animate-[fadeIn_0.4s_ease_both] motion-reduce:animate-none"
          >
            <div className="absolute inset-0">
              <CreditsReel />
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={handleClose}
              aria-label="Close credits"
              className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition hover:bg-black/70 motion-reduce:transition-none"
            >
              <svg
                className="h-6 w-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
