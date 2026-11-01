import { useCallback, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { extractPassCode } from "@/lib/desk-utils";
import { ApiError } from "@/lib/http";
import { deskSearch } from "@/lib/staff-api";
import type { DeskSearchResult, DeskSpotRegistrationResponse } from "@/lib/staff-types";
import { DeskArch } from "@/components/registration-desk/DeskArch";
import { DeskStats } from "@/components/registration-desk/DeskStats";
import { DeskSearchPanel } from "@/components/registration-desk/DeskSearchPanel";
import { SlideOver } from "@/components/registration-desk/SlideOver";
import { DeskSpotRegistrationPanel } from "@/components/registration-desk/DeskSpotRegistrationPanel";
import { DeskPaymentReview } from "@/components/registration-desk/DeskPaymentReview";

function apiErrorMessage(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

/**
 * CONTRACT: Parent layout route for /staff/check-in (registration-desk-ui
 * plan, ROUTING).
 *
 * GUARANTEES:
 *   - Owns the typed search query and result list as its own state, so both
 *     survive opening AND closing the nested detail route
 *     (check-in/registration/:regCode, rendered below via <Outlet/>) — this
 *     page never unmounts when the detail overlay opens or closes.
 *   - A scanned pass payload (or pasted pass URL) navigates straight to the
 *     detail route instead of loading an attendee inline.
 *   - Selecting a search result navigates to the detail route without
 *     clearing the query or results, so Back lands on the same search state.
 */
export function RegistrationDeskPage() {
  useDocumentTitle("Registration Desk");
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DeskSearchResult[] | null>(null);
  const [thumbsBaseUrl, setThumbsBaseUrl] = useState("");
  const [photosVersion, setPhotosVersion] = useState(0);

  const [spotOpen, setSpotOpen] = useState(false);
  const [spotStage, setSpotStage] = useState<"form" | "review" | "receipt">("form");
  const [spotDirty, setSpotDirty] = useState(false);
  const [spotSubmitting, setSpotSubmitting] = useState(false);
  const [spotCreated, setSpotCreated] = useState<DeskSpotRegistrationResponse["registration"] | null>(null);

  const handleSubmit = useCallback(
    (raw: string) => {
      const clean = raw.trim();
      if (!clean) return;
      const isScannedPass = clean.includes("/pass#") || clean.includes("#");
      if (isScannedPass) {
        navigate(`/staff/check-in/registration/${extractPassCode(clean)}`);
        return;
      }
      setLoading(true);
      setError(null);
      deskSearch(clean)
        .then((response) => {
          setResults(response.results);
          setThumbsBaseUrl(response.thumbsBaseUrl);
          setPhotosVersion(response.photosVersion);
        })
        .catch((err) => {
          setError(apiErrorMessage(err) ?? "The guest list could not be reached. Please try again.");
        })
        .finally(() => setLoading(false));
    },
    [navigate],
  );

  function handleSelectResult(regCode: string) {
    navigate(`/staff/check-in/registration/${regCode}`);
  }

  function closeSpot() {
    setSpotOpen(false);
    setSpotStage("form");
    setSpotDirty(false);
    setSpotCreated(null);
  }

  /** ONE parent close path for header Close, Escape, and backdrop (plan
   *  "Dirty close protection"). A clean form or post-create receipt closes
   *  immediately; a dirty form/review asks for discard confirmation and stays
   *  fully mounted (form state + photoFileKey) when the operator cancels.
   *
   *  While the final create POST is in flight (spotSubmitting), EVERY close
   *  path is blocked: discarding would unmount the panel and lose the receipt
   *  for a registration the server already created (P1, 2026-08-12 review).
   *  The header Close button is also disabled in that window. */
  function requestCloseSpot() {
    if (spotSubmitting) return;
    const clean =
      spotStage === "receipt" || (spotStage === "form" && !spotDirty);
    if (clean) {
      closeSpot();
      return;
    }
    const discard = window.confirm(
      "Discard this spot registration? The details you've entered will be lost.",
    );
    if (discard) closeSpot();
  }

  const handleDirtyChange = useCallback((dirty: boolean) => {
    setSpotDirty(dirty);
  }, []);

  const handleSubmittingChange = useCallback((submitting: boolean) => {
    setSpotSubmitting(submitting);
  }, []);

  function handleSpotCreated(created: DeskSpotRegistrationResponse["registration"]) {
    // The create POST has finished — clear the in-flight signal in the SAME
    // state batch that switches to the receipt, so the receipt's Close is
    // immediately usable (the panel unmounts in this batch too).
    setSpotSubmitting(false);
    setSpotCreated(created);
    setSpotStage("receipt");
  }

  function continueFromPayment() {
    if (!spotCreated) return;
    const regCode = spotCreated.regCode;
    closeSpot();
    // One-shot router-state hint (P1, latest review): the spot-create photo is
    // finalized OFF the create response path (waitUntil relocateFiles), so the
    // detail's first lookup may see photo.available: false. The detail page
    // retries the lookup a bounded number of times when this hint is present.
    navigate(`/staff/check-in/registration/${regCode}`, { state: { waitForPhoto: true } });
  }

  return (
    <div className="relative mx-auto max-w-[1120px] pb-10">
      {/* Watercolour courtyard-arch backdrop — landing/search only (NOT the
          attendee detail page). Vertical art <768px, wide art >=768px, via
          <picture> so only the matching source loads. The band's aspect ratio
          matches each image exactly, so the art shows full and uncropped — the
          painted arch frames the composition and its side detail (pillars,
          bench, bicycle, foliage) stays visible. It breaks out of the staff
          shell padding (-top-6/-left-5/-right-5 cancel the layout's px-5/py-6)
          to reach the header and both edges, and `desk-art-fade` dissolves all
          four edges into the page cream so there's no hard seam. */}
      <div
        aria-hidden="true"
        className="desk-art-fade pointer-events-none absolute -left-5 -right-5 -top-6 aspect-[1086/1448] overflow-hidden md:aspect-[1642/958]"
      >
        <picture>
          <source media="(min-width: 768px)" srcSet="/assets/desk/welcome-ribbon-desktop.webp" />
          <img
            src="/assets/desk/welcome-ribbon-mobile.webp"
            alt=""
            className="h-full w-full object-cover object-top"
          />
        </picture>
      </div>
      {/* Localized cream glow behind the heading only — enough to keep the copy
          legible over the art, without a flat wash that would hide the detail. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[360px] bg-[radial-gradient(ellipse_62%_100%_at_50%_28%,color-mix(in_srgb,var(--color-surface)_82%,transparent),transparent_72%)]"
      />

      {/* Dev-only stamp studio — Vite constant-folds `import.meta.env.DEV`, so
          the panel + the render-prop wrapping here are tree-shaken out of
          production builds. In dev, the panel injects --stamp-* CSS vars on a
          wrapper above the present-row stamps, letting desk staff tune the
          stamp live without touching index.css. In prod, the panel is gone and
          the page renders identically to before. */}
      <RegistrationDeskContent
        query={query}
        setQuery={setQuery}
        handleSubmit={handleSubmit}
        loading={loading}
        error={error}
        results={results}
        thumbsBaseUrl={thumbsBaseUrl}
        photosVersion={photosVersion}
        handleSelectResult={handleSelectResult}
        spotOpen={spotOpen}
        spotStage={spotStage}
        spotSubmitting={spotSubmitting}
        spotCreated={spotCreated}
        setSpotOpen={setSpotOpen}
        setSpotStage={setSpotStage}
        handleDirtyChange={handleDirtyChange}
        handleSubmittingChange={handleSubmittingChange}
        requestCloseSpot={requestCloseSpot}
        handleSpotCreated={handleSpotCreated}
        continueFromPayment={continueFromPayment}
      />
    </div>
  );
}

/** Inner content — kept as a separate component so the dev-mode studio can wrap
    it in a render-prop that injects CSS vars, without duplicating the JSX. */
function RegistrationDeskContent(props: {
  query: string;
  setQuery: (v: string) => void;
  handleSubmit: (raw: string) => void;
  loading: boolean;
  error: string | null;
  results: DeskSearchResult[] | null;
  thumbsBaseUrl: string;
  photosVersion: number;
  handleSelectResult: (regCode: string) => void;
  spotOpen: boolean;
  spotStage: "form" | "review" | "receipt";
  spotSubmitting: boolean;
  spotCreated: DeskSpotRegistrationResponse["registration"] | null;
  setSpotOpen: (b: boolean) => void;
  setSpotStage: (s: "form" | "review" | "receipt") => void;
  handleDirtyChange: (dirty: boolean) => void;
  handleSubmittingChange: (submitting: boolean) => void;
  requestCloseSpot: () => void;
  handleSpotCreated: (created: DeskSpotRegistrationResponse["registration"]) => void;
  continueFromPayment: () => void;
}) {
  const inner = (
    <div className="relative mx-auto max-w-[600px]">
      <DeskArch />
      <DeskSearchPanel
        query={props.query}
        onQueryChange={props.setQuery}
        onSubmit={props.handleSubmit}
        loading={props.loading}
        error={props.error}
        results={props.results}
        thumbsBaseUrl={props.thumbsBaseUrl}
        photosVersion={props.photosVersion}
        onSelectResult={props.handleSelectResult}
      />

      <section className="mx-auto mt-8 flex w-full flex-col items-center gap-3 border-t border-border-warm pt-7 text-center sm:w-[72%]">
        <div>
          <p className="font-heading text-xl font-bold text-charcoal">Someone new at the door?</p>
          <p className="mt-1 text-sm text-muted">Create a small, server-priced registration in a few steps.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            props.setSpotOpen(true);
            props.setSpotStage("form");
          }}
          data-testid="desk-open-spot"
          className="w-full sm:w-auto"
        >
          New spot registration
        </Button>
      </section>

      {/* Live roster counts — total + present by participation type, self-
          refreshing every 30s (its own poll; independent of search state). */}
      <DeskStats />

      {/* Nested detail route — an overlay over this page, never a replacement of it. */}
      <Outlet />

      {props.spotOpen && (
        <SlideOver
          onClose={props.requestCloseSpot}
          ariaLabel={
            props.spotStage === "receipt"
              ? "Payment review"
              : props.spotStage === "review"
                ? "Review registration"
                : "New spot registration"
          }
          panelTestId="desk-spot-panel"
        >
          <div className="flex items-center justify-between border-b border-border-warm bg-page px-5 py-4 sm:px-7">
            <div>
              <p className="font-accent text-lg text-terracotta">A new arrival</p>
              <h2 className="font-heading text-2xl font-bold text-charcoal">
                {props.spotStage === "review"
                  ? "Review registration"
                  : props.spotStage === "receipt"
                    ? "Review payment"
                    : "Make room at the table"}
              </h2>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={props.requestCloseSpot}
              disabled={props.spotSubmitting}
              aria-label="Close spot registration"
              data-testid="desk-spot-close"
            >
              Close
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
            {props.spotStage === "receipt" ? (
              props.spotCreated ? (
                <DeskPaymentReview registration={props.spotCreated} onContinue={props.continueFromPayment} />
              ) : null
            ) : (
              <DeskSpotRegistrationPanel
                stage={props.spotStage}
                onRequestReview={() => props.setSpotStage("review")}
                onEditDetails={() => props.setSpotStage("form")}
                onDirtyChange={props.handleDirtyChange}
                onSubmittingChange={props.handleSubmittingChange}
                onCreated={props.handleSpotCreated}
              />
            )}
          </div>
        </SlideOver>
      )}
    </div>
  );

  // No wrapper needed — DeskResultCard puts `desk-photo-stamp--list` directly
  // on its button so the CSS-var defaults cascade to the stamp wherever it
  // sits in the card.
  return inner;
}