import { useEffect, useState } from "react";

/** Chrome/Android fire this before showing their install UI; we stash it and
 *  trigger it from our own button. Not in the standard DOM lib types. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "committee_pwa_dismissed";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS marks home-screen apps here rather than via display-mode.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/** Install nudge for the Committee Todo page only. Android gets a real install
 *  button; iOS gets Add-to-Home-Screen instructions (Safari has no prompt). */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY) === "1") return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      localStorage.setItem(DISMISS_KEY, "1");
      setDeferred(null);
      setShowIOS(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // iOS never fires beforeinstallprompt — show the manual hint instead.
    if (isIOS()) setShowIOS(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setDeferred(null);
    setShowIOS(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }

  if (!deferred && !showIOS) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-3 animate-[fadeSlideIn_0.3s_ease]">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-border-warm bg-surface px-4 py-3 shadow-lg">
        <img src="/assets/pwa/icon-192.png" alt="" className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-charcoal">Add to your phone</p>
          {deferred ? (
            <p className="text-xs text-muted">Open the todo like an app — one tap from your home screen.</p>
          ) : (
            <p className="text-xs text-muted">
              Tap Share <span aria-hidden="true">⎋</span> then “Add to Home Screen”.
            </p>
          )}
        </div>
        {deferred && (
          <button
            type="button"
            onClick={install}
            className="shrink-0 rounded-lg bg-terracotta px-3 py-2 text-sm font-semibold text-white transition active:scale-95"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-lg px-2 py-2 text-lg text-muted"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
