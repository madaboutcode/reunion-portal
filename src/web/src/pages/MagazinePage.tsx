import { useEffect, useRef, useState } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
import { MagazineIntro } from "@/components/magazine/MagazineIntro";
import { MagazineReader } from "@/components/magazine/MagazineReader";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  fetchMagazineManifest,
  selectIntro,
  type MagazineManifest,
  type SelectedIntro,
} from "@/lib/magazine";

/*
 * CONTRACT: MagazinePage
 *
 * GUARANTEES:
 * - Resolves the default issue from the CDN index and validates the manifest before rendering
 *   children.
 * - Captures the initial viewport width once before any fetch and selects the intro (mobile
 *   or desktop) once when the manifest loads.
 * - Renders SiteNav and SiteFooter from the portal; does not duplicate navigation.
 * - Shows "Magazine unavailable" with a Retry action when metadata load fails.
 *
 * EXPECTS:
 * - The CDN index and manifest are published and CORS-accessible from the deployed origin.
 *
 * FAILURE BEHAVIOR:
 * - Network, HTTP, schema, or reference error during metadata load: render error state with
 *   the error message and a Retry button (page reload).
 * - AbortController signal during unmount: silently ignore the aborted fetch.
 *
 * DOES NOT:
 * - Own frame preloading, scroll progress, or page mounting state — MagazineIntro and
 *   MagazineReader own those.
 * - Construct CDN paths — all URLs come from the validated manifest.
 */

interface MagazineLoadingState {
  status: "loading";
}

interface MagazineReadyState {
  status: "ready";
  manifest: MagazineManifest;
  selectedIntro: SelectedIntro | null;
}

interface MagazineErrorState {
  status: "error";
  message: string;
}

type MagazineLoadState =
  | MagazineLoadingState
  | MagazineReadyState
  | MagazineErrorState;

export default function MagazinePage() {
  useDocumentTitle("Magazine");
  const initialWidthRef = useRef(
    typeof window !== "undefined" ? window.innerWidth : 1024,
  );
  const [loadState, setLoadState] = useState<MagazineLoadState>({
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();

    fetchMagazineManifest(controller.signal)
      .then((manifest) => {
        const selected = selectIntro(
          manifest.intro,
          initialWidthRef.current <= 800,
        );
        setLoadState({ status: "ready", manifest, selectedIntro: selected });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setLoadState({
          status: "error",
          message:
            error instanceof Error ? error.message : "Magazine unavailable.",
        });
      });

    return () => controller.abort();
  }, []);

  if (loadState.status === "loading") {
    return (
      <div className="min-h-screen bg-page" role="status" aria-live="polite">
        <SiteNav />
        <main className="mx-auto max-w-3xl px-5 py-20 text-center font-body text-charcoal">
          Loading magazine...
        </main>
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="min-h-screen bg-page" role="alert">
        <SiteNav />
        <main className="mx-auto max-w-3xl px-5 py-20 text-center font-body text-charcoal">
          <h1 className="font-heading text-3xl font-bold">
            Magazine unavailable
          </h1>
          <p className="mt-3 text-sm text-muted">{loadState.message}</p>
          <button
            type="button"
            className="mt-6 min-h-11 rounded-xl bg-terracotta px-5 py-3 font-body text-sm font-bold text-white"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </main>
      </div>
    );
  }

  const { manifest, selectedIntro } = loadState;

  return (
    <div className="min-h-screen bg-page">
      <SiteNav />

      <main>
        <MagazineIntro selectedIntro={selectedIntro} cover={manifest.cover} />
        <MagazineReader manifest={manifest} />
      </main>

      <SiteFooter />
    </div>
  );
}
