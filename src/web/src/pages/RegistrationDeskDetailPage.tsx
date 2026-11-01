import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { normalizePassCode } from "@/lib/desk-utils";
import { ApiError } from "@/lib/http";
import { deskAddCharge, deskCollectPayment, deskLookup, deskMarkAbsent, deskMarkPresent, deskPhoto } from "@/lib/staff-api";
import type { DeskAttendeeOverview, DeskPaymentMethod } from "@/lib/staff-types";
import { SlideOver } from "@/components/registration-desk/SlideOver";
import { DeskLedgerDetail, type DeskChargeResult } from "@/components/registration-desk/DeskLedgerDetail";

function apiErrorMessage(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

/**
 * Bounded post-create photo wait (P1, latest review). Spot registration
 * finalizes its photo off the create response path
 * (c.executionCtx.waitUntil(relocateFiles) in registration-desk.routes.ts), so
 * "Continue to attendance" can reach the detail before photo_thumb_key exists.
 * When the receipt navigated here with `{ waitForPhoto: true }`, the lookup is
 * retried at most PHOTO_WAIT_MAX_ATTEMPTS times, PHOTO_WAIT_RETRY_MS apart, and
 * only while the returned attendee still has no photo. The attendee is shown
 * with the normal placeholder once the photo appears or the bound is reached —
 * never an infinite loop.
 */
const PHOTO_WAIT_MAX_ATTEMPTS = 10;
const PHOTO_WAIT_RETRY_MS = 250;

/**
 * Nested route at check-in/registration/:regCode (registration-desk-ui plan,
 * ROUTING). Rendered via <Outlet/> inside RegistrationDeskPage, which stays
 * mounted underneath — Back is a navigate() to check-in, never an unmount of
 * the search page, so the typed query survives.
 */
export function RegistrationDeskDetailPage() {
  useDocumentTitle("Attendee — Registration Desk");
  const { regCode } = useParams<{ regCode: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [attendee, setAttendee] = useState<DeskAttendeeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [justCheckedIn, setJustCheckedIn] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const photoUrlRef = useRef<string | null>(null);
  const [chargeResult, setChargeResult] = useState<DeskChargeResult | null>(null);

  // P1 (third review): request-generation guard. Every async handler — the
  // lookup, the photo loader, and ALL four mutation handlers — captures the
  // current generation when it starts and discards its response if the
  // generation changed while in flight. The generation is bumped on every
  // in-place route change, so a late response for attendee A can never update
  // attendee B's state, check-in state, charge result, or visible errors.
  const requestGenRef = useRef(0);

  // Pending photo-wait retry timer for the CURRENT lookup run; cleared on
  // route change/unmount so a stale retry can never fire after the page moved.
  const photoWaitTimerRef = useRef<number | null>(null);

  // One-shot router-state hint set by the post-create receipt's "Continue to
  // attendance" (P1, latest review): retry the lookup a bounded number of
  // times when the freshly-created attendee's photo isn't finalized yet.
  // "Latest-ref" pattern (same as SlideOver's onCloseRef): the layout effect
  // reads it without depending on location.state, so consuming the hint (a
  // replace-navigate to state:null) does NOT re-run the lookup effect.
  const waitForPhotoRef = useRef(false);
  waitForPhotoRef.current = location.state?.waitForPhoto === true;

  const goBack = useCallback(() => navigate("/staff/check-in"), [navigate]);

  /** Revokes whatever object URL is currently displayed and clears the photo
   *  state. Idempotent — safe to call when nothing is loaded. */
  const revokePhoto = useCallback(() => {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = null;
    setPhotoUrl(null);
  }, []);

  // useLayoutEffect (client-only page): route-owned state is invalidated
  // SYNCHRONOUSLY after commit, BEFORE the browser can paint a stale frame. On
  // an in-place A → B param change the old attendee/detail would otherwise be
  // committed and painted once before the passive effect ran. The render guard
  // below (`attendee?.regCode === regCode`) is the second layer: even a stale
  // attendee still in state can never render under a different route param.
  useLayoutEffect(() => {
    if (!regCode) return;
    // Narrowed copy — the async retry closure below can't see the guard.
    const code = regCode;
    // Invalidate every in-flight request for the PREVIOUS attendee (lookup,
    // photo loader, and all four mutation handlers check this generation
    // before applying their responses).
    const generation = ++requestGenRef.current;
    let cancelled = false;

    // One-shot router-state hint: consume it immediately so a later history
    // revisit of this entry does not re-trigger photo-waiting.
    const waitForPhoto = waitForPhotoRef.current;
    if (waitForPhoto) {
      navigate(location.pathname, { replace: true, state: null });
    }

    // P1 (2026-08-12 review): when regCode changes in place, the PREVIOUS
    // attendee's private photo must be cleared and its object URL revoked
    // BEFORE the next attendee can render — otherwise the new detail briefly
    // shows the old attendee's photo (a privacy leak across records). The
    // placeholder renders until the new attendee's own photo resolves.
    revokePhoto();
    // Drop the previous attendee entirely while the new route loads — the new
    // detail must never render the old attendee or her photo (third review).
    setAttendee(null);
    setLoading(true);
    setError(null);
    setCheckInError(null);
    setUndoError(null);
    setJustCheckedIn(false);
    setUndoing(false);
    setChargeResult(null);

    async function lookupWithRetry(attempt: number) {
      try {
        const response = await deskLookup(code);
        if (cancelled || requestGenRef.current !== generation) return;
        if (waitForPhoto && !response.attendee.photo.available && attempt < PHOTO_WAIT_MAX_ATTEMPTS) {
          // Photo not finalized yet — retry after a short delay (bounded).
          photoWaitTimerRef.current = window.setTimeout(() => {
            photoWaitTimerRef.current = null;
            void lookupWithRetry(attempt + 1);
          }, PHOTO_WAIT_RETRY_MS);
          return;
        }
        // Photo available, the bound is reached (normal placeholder shown), or
        // this is a regular lookup — show the attendee.
        setAttendee(response.attendee);
        setLoading(false);
      } catch (err) {
        if (cancelled || requestGenRef.current !== generation) return;
        setError(apiErrorMessage(err) ?? "Could not open this attendee. Please try again.");
        setLoading(false);
      }
    }
    void lookupWithRetry(1);

    return () => {
      cancelled = true;
      if (photoWaitTimerRef.current !== null) {
        window.clearTimeout(photoWaitTimerRef.current);
        photoWaitTimerRef.current = null;
      }
    };
  }, [regCode, revokePhoto, navigate, location.pathname]);

  useEffect(() => {
    if (!attendee?.photo.available) {
      // No photo for this attendee — never show a previous attendee's photo.
      revokePhoto();
      return;
    }
    let cancelled = false;
    const registrationId = attendee.id;
    const requestGen = requestGenRef.current;

    async function loadPhoto() {
      // 1. First paint: the authenticated 200px thumbnail (plan "Photo
      //    enhancement" step 1). A failure here leaves the letter placeholder.
      let thumb: { url: string; contentType: string };
      try {
        thumb = await deskPhoto(registrationId, 200);
      } catch {
        if (!cancelled && requestGenRef.current === requestGen) revokePhoto();
        return;
      }
      // A late response for a previous attendee (route changed in place) must
      // never repopulate the photo state — revoke and drop it (P1, third
      // review). The generation was bumped by the lookup effect on the change.
      if (cancelled || requestGenRef.current !== requestGen) {
        URL.revokeObjectURL(thumb.url);
        return;
      }
      revokePhoto();
      photoUrlRef.current = thumb.url;
      setPhotoUrl(thumb.url);

      // 2. Best-effort upgrade: request the server-resized responsive variant
      //    (560 mobile / 960 desktop, matching the Tailwind md breakpoint —
      //    plan Pre-Decisions "Responsive photo variant selection"). A failed
      //    larger request is IGNORED so the already-rendered thumbnail remains
      //    (plan Pre-Decisions "Enhancement failure") — never a placeholder.
      const largeSize = window.matchMedia("(max-width: 767px)").matches ? 560 : 960;
      try {
        const large = await deskPhoto(registrationId, largeSize);
        if (cancelled || requestGenRef.current !== requestGen) {
          URL.revokeObjectURL(large.url);
          return;
        }
        revokePhoto();
        photoUrlRef.current = large.url;
        setPhotoUrl(large.url);
      } catch {
        // Thumbnail stays — nothing to do.
      }
    }

    loadPhoto();
    return () => {
      cancelled = true;
      // Defense in depth: if the attendee changes/unmounts while a fetch is
      // in flight, revoke whatever is currently displayed. The lookup effect
      // already cleared the photo before this re-run, so this is a no-op in
      // the normal path — but it guarantees no stale URL survives an
      // attendee change or unmount.
      revokePhoto();
    };
  }, [attendee?.id, attendee?.photo.available, revokePhoto]);

  // Belt-and-braces: revoke on final unmount even if the effect above didn't run again.
  useEffect(
    () => () => {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    },
    [],
  );

  async function handleMarkPresent() {
    if (!attendee) return;
    const requestGen = requestGenRef.current;
    setCheckInError(null);
    setUndoError(null);
    try {
      const response = await deskMarkPresent(attendee.id);
      // Stale (route moved on in place): never update the NEW attendee's state.
      if (requestGenRef.current !== requestGen) return;
      setAttendee((current) => (current ? { ...current, checkIn: response.checkIn } : current));
      setJustCheckedIn(true);
    } catch (err) {
      // Stale errors must never surface for the new attendee (P1, third
      // review). Fresh errors keep the ActionButton retry/error behavior.
      if (requestGenRef.current !== requestGen) return;
      setCheckInError(apiErrorMessage(err) ?? "Could not confirm arrival. Please try again.");
      throw err; // let the ActionButton fall back to idle instead of flashing success
    }
  }

  async function handleMarkAbsent() {
    if (!attendee) return;
    const requestGen = requestGenRef.current;
    setUndoError(null);
    setUndoing(true);
    try {
      const response = await deskMarkAbsent(attendee.id);
      if (requestGenRef.current !== requestGen) return;
      setAttendee((current) => (current ? { ...current, checkIn: response.checkIn } : current));
      // Just-checked-in animation should NOT replay after an undo — the user
      // is no longer in the celebratory state, so return to the static card.
      setJustCheckedIn(false);
    } catch (err) {
      if (requestGenRef.current !== requestGen) return;
      // Do NOT rethrow (latest review): DeskLedgerDetail passes onMarkAbsent
      // to a plain Button whose onClick does not await/catch the promise, so
      // rethrowing would surface as an UNHANDLED promise rejection even though
      // the inline undoError below is displayed. The button re-enables through
      // `undoing` in the finally block, which preserves retry behavior.
      setUndoError(apiErrorMessage(err) ?? "Could not undo attendance. Please try again.");
    } finally {
      // Only a fresh undo may clear the in-flight flag — a stale one must not
      // clobber a newer undo that started for the current attendee.
      if (requestGenRef.current === requestGen) setUndoing(false);
    }
  }

  // Collect payment / add charge (desk-payment-collection design §1/§2). Both
  // return the fresh allowlisted overview, so the page just swaps it in — no
  // extra refetch. Errors are NOT surfaced here: DeskCollectPayment /
  // DeskAddCharge show them inline themselves (they await this promise and
  // catch the rejection), so this stays a thin pass-through.
  //
  // Both also reset justCheckedIn: celebrate (the just-checked-in success
  // animation) otherwise stays true, which makes DeskLedgerDetail's
  // `present && !celebrate` branch skip — a charge added right after
  // check-in would then wrongly render the Collect-payment gate over an
  // already-present attendee instead of the calm Present/Undo card.
  // Attendance and payment are independent (design §3): neither call should
  // leave the celebratory animation stuck on.
  async function handleCollectPayment(method: DeskPaymentMethod, note?: string) {
    if (!attendee) return;
    const requestGen = requestGenRef.current;
    try {
      const response = await deskCollectPayment(attendee.id, { method, note });
      // Stale (route moved on): the response belongs to a different attendee.
      if (requestGenRef.current !== requestGen) return;
      setAttendee(response.attendee);
      setJustCheckedIn(false);
      // The balance is settled — an earlier "New total due" charge result would
      // now be stale.
      setChargeResult(null);
    } catch (err) {
      // A stale rejection must not surface for the new attendee; a fresh one
      // propagates to the form, which shows it inline.
      if (requestGenRef.current !== requestGen) return;
      throw err;
    }
  }

  async function handleAddCharge(description: string, amount: number) {
    if (!attendee) return;
    const requestGen = requestGenRef.current;
    try {
      const response = await deskAddCharge(attendee.id, { description, amount });
      if (requestGenRef.current !== requestGen) return;
      setAttendee(response.attendee);
      setJustCheckedIn(false);
      // The authoritative updated total comes from the fresh overview the
      // charge endpoint returned (plan "Add-charge result"). The endpoint
      // always returns payment_pending with amountDue after a charge — an
      // overview without one is an unreasoned state, so fail closed rather than
      // inventing a total.
      const updatedTotalDue = response.attendee.payment.amountDue;
      if (updatedTotalDue === undefined) {
        throw new Error("Add-charge succeeded but the overview carried no updated amount due");
      }
      setChargeResult({ description, amount, updatedTotalDue });
    } catch (err) {
      if (requestGenRef.current !== requestGen) return;
      throw err;
    }
  }

  // The footer shows whichever error happened most recently; the inline alert
  // covers both flows without the user having to track two separate strings.
  const visibleCheckInError = undoError ?? checkInError;

  // P1 (latest review) render guard: the ledger (and its photo) renders ONLY
  // when the loaded attendee belongs to the CURRENT route param. A stale
  // attendee still in state during an in-place route change can never render
  // under the new regCode — this is the second layer under the layout-effect
  // invalidation above.
  //
  // Codes are compared NORMALIZED: the server lookup accepts lowercase and
  // hyphenated codes (normalizePassCode on both sides of the route boundary),
  // so a direct URL like /registration/smrt-79ww-4a25-nwg1 must match the
  // canonical attendee code SMRT79WW4A25NWG1 instead of rendering blank.
  // Missing/invalid values fail closed: an empty normalized code never matches.
  const normalizedRouteCode = regCode !== undefined ? normalizePassCode(regCode) : "";
  const attendeeMatchesRoute =
    attendee !== null &&
    normalizedRouteCode !== "" &&
    normalizePassCode(attendee.regCode) === normalizedRouteCode;

  return (
    <SlideOver
      onClose={goBack}
      ariaLabel="Attendee record"
      labelledById={attendeeMatchesRoute ? "desk-detail-name" : undefined}
      panelTestId="desk-detail-panel"
    >
      <nav className="sticky top-0 z-20 flex min-h-[56px] items-center justify-between border-b border-border-warm bg-surface/95 px-3 backdrop-blur-md">
        <button
          type="button"
          onClick={goBack}
          data-testid="desk-detail-back"
          className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-bold text-charcoal hover:bg-terracotta-light hover:text-terracotta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </button>
        <span className="mr-2 text-[11px] font-bold uppercase tracking-[0.12em] text-charcoal/80">Attendee record</span>
      </nav>

      {loading && <p role="status" className="px-5 py-8 text-sm text-muted">Opening their reunion details…</p>}
      {error && <p role="alert" className="px-5 py-8 text-sm text-terracotta-deep">{error}</p>}
      {!loading && attendeeMatchesRoute && (
        <DeskLedgerDetail
          attendee={attendee}
          photoUrl={photoUrl}
          checkInError={visibleCheckInError}
          onMarkPresent={handleMarkPresent}
          onMarkAbsent={handleMarkAbsent}
          undoing={undoing}
          celebrate={justCheckedIn}
          onCollectPayment={handleCollectPayment}
          onAddCharge={handleAddCharge}
          chargeResult={chargeResult}
        />
      )}
    </SlideOver>
  );
}
