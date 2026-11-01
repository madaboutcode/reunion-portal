import { BrowserRouter } from "react-router-dom";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App";
import { ToastProvider } from "./components/ui/Toast";
import { GlobalErrorCatcher } from "./components/ui/GlobalErrorCatcher";
import { PolaroidPoolProvider } from "./context/PolaroidPoolProvider";
import { FeatureFlagsProvider } from "./context/FeatureFlagsProvider";

// After a deployment, Vite's modulepreload links may reference hashes that no
// longer exist. Reload once to pick up the new index.html and its current
// asset references. The sessionStorage guard prevents a reload loop if the new
// build itself has an issue.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  const key = "smriti-chunk-reload";
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, "1");
    window.location.reload();
  }
});
sessionStorage.removeItem("smriti-chunk-reload");

// Unique per build (vite.config.ts) — forces new content hashes and lets you
// inspect which build is running via <html data-build="...">.
document.documentElement.dataset.build = __BUILD_ID__;

// Service worker (registerType: autoUpdate). autoUpdate skips waiting, claims
// clients, and reloads the page once a new SW activates. The problem it does
// NOT solve on its own is iOS: a standalone PWA only checks for a new SW on a
// cold launch — a warm resume from the app switcher keeps the stale bundle.
// So we force registration.update() whenever the app returns to the foreground
// (plus an hourly poll while it stays open); autoUpdate then swaps + reloads.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const check = () => {
      if (document.visibilityState === "visible") void registration.update();
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    setInterval(check, 60 * 60 * 1000);
  },
});

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <GlobalErrorCatcher />
    <BrowserRouter>
      <FeatureFlagsProvider>
        <PolaroidPoolProvider>
          <App />
        </PolaroidPoolProvider>
      </FeatureFlagsProvider>
    </BrowserRouter>
  </ToastProvider>,
);
