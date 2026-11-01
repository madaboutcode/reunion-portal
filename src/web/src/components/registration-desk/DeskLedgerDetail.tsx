import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/format-date";
import { formatRegCodeForDisplay } from "@/lib/constants";
import { waUrl } from "@/lib/whatsapp";
import { DeskPhoto } from "@/components/registration-desk/DeskPhoto";
import { DeskPhotoStamp } from "@/components/registration-desk/DeskPhotoStamp";
import { DeskStatusPill } from "@/components/registration-desk/DeskStatusPill";
import { DeskCollectPayment } from "@/components/registration-desk/DeskCollectPayment";
import { DeskAddCharge } from "@/components/registration-desk/DeskAddCharge";
import type { DeskAttendeeOverview, DeskPaymentMethod } from "@/lib/staff-types";

/**
 * Ephemeral add-charge success feedback (2026-08-12 plan "Add-charge result").
 * Local UI state — not an API shape and not a persisted charge ledger.
 * `updatedTotalDue` is the authoritative amountDue from the fresh overview the
 * charge endpoint returned.
 */
export interface DeskChargeResult {
  description: string;
  amount: number;
  updatedTotalDue: number;
}

export interface DeskLedgerDetailProps {
  attendee: DeskAttendeeOverview;
  /** Revocable object URL from the authenticated desk photo fetch; null when unavailable. */
  photoUrl: string | null;
  /** The async check-in. Resolves on success; rejects on failure so the
      ActionButton can return to idle. */
  onMarkPresent: () => Promise<void>;
  /** The async undo (R4.5). Resolves on success. On failure the page shows the
      inline error itself and clears `undoing`; the handler MUST NOT reject —
      this Button's onClick does not catch rejections, so a rejection would be
      an unhandled promise rejection (latest review). Unavailable while the
      present-state card is showing the celebratory success animation. */
  onMarkAbsent: () => Promise<void>;
  /** True only while a present-state → undo round-trip is in flight, so the
      undo button shows its spinner instead of letting a second tap fire. */
  undoing: boolean;
  checkInError: string | null;
  /** True only right after a live check-in — keeps the animated ActionButton
      (in its success state) mounted instead of the static present card. False
      when reopening an already-present attendee. */
  celebrate?: boolean;
  /** The async full settlement (desk-payment-collection design §1). Resolves
      on success (this component then closes the form); rejects so the form
      shows the error and stays open. */
  onCollectPayment: (method: DeskPaymentMethod, note?: string) => Promise<void>;
  /** The async ad-hoc charge (desk-payment-collection design §2). Resolves
      on success (this component then closes the form); rejects so the form
      shows the error and stays open. */
  onAddCharge: (description: string, amount: number) => Promise<void>;
  /** Immediate add-charge success feedback — reason, charge amount, and the
      authoritative updated total due. null when no charge has just been added. */
  chargeResult: DeskChargeResult | null;
}

const PARTICIPATION_LABELS: Record<string, string> = {
  full_celebration: "Full Celebration",
  campus_only: "Campus Only",
};

const ACCOMMODATION_LABELS: Record<string, string> = {
  private: "Private room",
  shared_double: "Shared double",
  shared_triple: "Shared triple",
};

function guestsSummary(attendee: DeskAttendeeOverview): string {
  const group = attendee.additionalAttendees;
  const names = [
    ...group.spouse.map((a) => a.name),
    ...group.children.map((a) => a.name),
    ...group.guests.map((a) => a.name),
  ].filter((n): n is string => n !== null);
  const count = group.spouse.length + group.children.length + group.guests.length;
  if (count === 0) return "No spouse, children, or guests";
  return names.length > 0 ? `${count} · ${names.join(", ")}` : `${count}`;
}

/** Rooms are a top-level field, independent of accommodation type (spec R3.7, plan edge case). */
function staySummary(attendee: DeskAttendeeOverview): string {
  const accommodation = attendee.accommodation;
  const roomsPart = attendee.rooms.length > 0 ? `Room ${attendee.rooms.join(", ")}` : null;
  if (!accommodation) return roomsPart ?? "No accommodation";
  const type = ACCOMMODATION_LABELS[accommodation.type] ?? accommodation.type;
  const dates = accommodation.checkIn ? `${accommodation.checkIn} → ${accommodation.checkOut ?? "—"}` : null;
  return [roomsPart, type, dates].filter(Boolean).join(" · ");
}

function tshirtSummary(attendee: DeskAttendeeOverview): string {
  if (attendee.tshirts.length === 0) return "None recorded";
  return attendee.tshirts
    .map((t) => `${t.size}${t.gender ? ` (${t.gender})` : ""}${t.isIncluded ? "" : " · extra"}`)
    .join(", ");
}

function Fact({ label, value, warning }: { label: string; value: ReactNode; warning?: boolean }) {
  return (
    <div className="min-h-[64px] px-3.5 py-2.5">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.1em] text-muted">{label}</span>
      <strong className={`block break-words text-xs font-semibold leading-tight ${warning ? "text-terracotta-deep" : "text-charcoal"}`}>
        {value}
      </strong>
    </div>
  );
}

/**
 * Reunion Ledger attendee detail (registration-desk-ui plan, mockup
 * data-design="ledger" .identity-panel + .facts + .action-bar). Shows only
 * the documented allowlisted fields (registration-desk.spec.md R3) — the
 * private storage key never reaches this component, only the fetched blob
 * object URL (R3.3).
 *
 * GUARANTEES (desk-payment-collection design §3 — the footer gate):
 *   - Net rule (attendance and payment are independent dimensions):
 *     "Collect payment" shows iff pending (with a known amountDue); "Confirm
 *     attendance" shows iff (payment.state === 'confirmed', checked
 *     explicitly) AND not present; "Undo" shows iff present. Present + pending
 *     shows BOTH the present-state card/Undo AND Collect payment — a charge
 *     added after check-in must be collectible without leaving and reopening
 *     the record; Confirm attendance stays hidden either way (already present).
 *   - Fail-closed money gate (plan Pre-Decisions: attendance gate for pending
 *     registrations): Confirm attendance never shows for pending, or for an
 *     unreasoned third state — an unreasoned state also shows no Collect
 *     payment CTA (nothing safe to render without a known amountDue).
 *   - "+ Add additional charge" opens the inline DeskAddCharge form in ALL
 *     states.
 *   - The two inline forms share one open slot (openForm) — opening one
 *     closes the other; a successful submit closes the form, a rejection
 *     leaves it open showing the error.
 *   - ONE unified in-flight signal (`busy`: checking-in, undoing, collecting,
 *     or charging) disables the OTHER three footer actions while any one is
 *     running, so a slow response can't be raced by starting another; a
 *     payment form being open (`openForm !== null`) also blocks Confirm
 *     attendance and Undo, even before `busy`'s `mutating` turns true on
 *     submit. Both inline forms additionally take a `busy` prop (check-in or
 *     undo in flight) so their own submit refuses to fire independently of
 *     the caller having disabled the entry point.
 *   - The payment status pill/Fact fail closed the same way as the CTA:
 *     "Payment confirmed" shows ONLY for an explicit 'confirmed' state; an
 *     unreasoned third state shows "Payment status unknown", never a falsely
 *     reassuring "confirmed".
 */
export function DeskLedgerDetail({
  attendee,
  photoUrl,
  checkInError,
  onMarkPresent,
  onMarkAbsent,
  undoing,
  celebrate = false,
  onCollectPayment,
  onAddCharge,
  chargeResult,
}: DeskLedgerDetailProps) {
  const pending = attendee.payment.state === "payment_pending";
  // Fail-closed attendance gate: Confirm attendance requires an EXPLICIT
  // 'confirmed' state, not merely "not pending". A state that's neither
  // 'payment_pending' nor 'confirmed' shouldn't happen (the server mapper
  // throws on anything else) — but if it ever did, this falls through to the
  // non-confirm path below rather than revealing Confirm attendance.
  const confirmed = attendee.payment.state === "confirmed";
  const amountDue = attendee.payment.amountDue;
  const present = attendee.checkIn.present;
  const wa = waUrl(attendee.whatsapp);
  const presentSince = attendee.checkIn.checkedInAt !== null ? formatDateTime(attendee.checkIn.checkedInAt) : "—";

  // Both inline forms share one slot — opening one closes the other (design
  // "How forms open — inline expand"). Purely local UI state: the parent
  // page owns the actual API calls (onCollectPayment/onAddCharge props).
  const [openForm, setOpenForm] = useState<"collect" | "charge" | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // True only while a collect/charge request is in flight (shared by both —
  // only one form can be open at a time).
  const [mutating, setMutating] = useState(false);
  // True only while a live check-in request is in flight. ActionButton
  // manages its own animation internally over `onMarkPresent`, so this
  // wrapper is the only way the footer learns "check-in is running".
  const [checking, setChecking] = useState(false);

  // ONE unified in-flight signal across all four footer actions (check-in,
  // undo, collect, charge). Every action already self-disables while IT is
  // the one running (ActionButton's own phase, Button's `loading`, or the
  // inline forms' own `submitting`) — `busy` additionally disables the
  // OTHER three, so a slow response from one action can't be raced by
  // starting another (e.g. a slow collect landing after an undo already
  // flipped the attendee back to not-present, or vice versa).
  const busy = checking || undoing || mutating;
  // A payment form being open is ALSO grounds to block attendance actions —
  // staff mid collect/charge shouldn't also be able to fire Confirm
  // attendance or Undo, even before they've hit submit (mutating is only
  // true once submit is clicked).
  const formOpen = openForm !== null;

  useEffect(() => {
    // FALLBACK-OK: optional call — jsdom (the test environment) doesn't
    // implement scrollIntoView; every real browser does.
    if (openForm) formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [openForm]);

  async function handleMarkPresent() {
    setChecking(true);
    try {
      await onMarkPresent();
    } finally {
      setChecking(false);
    }
  }

  // Wrap the page's async calls so a successful submit also closes the form;
  // a rejection propagates to the form component, which shows the error and
  // stays open (DeskCollectPayment/DeskAddCharge FAILURE BEHAVIOR).
  async function handleCollectPayment(method: DeskPaymentMethod, note?: string) {
    setMutating(true);
    try {
      await onCollectPayment(method, note);
      setOpenForm(null);
    } finally {
      setMutating(false);
    }
  }
  async function handleAddCharge(description: string, amount: number) {
    setMutating(true);
    try {
      await onAddCharge(description, amount);
      setOpenForm(null);
    } finally {
      setMutating(false);
    }
  }

  return (
    <div className="flex-1 sm:grid sm:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)] sm:items-start sm:gap-6 sm:px-7 sm:py-6" data-testid="desk-detail">
      <section
        className="relative mx-3 mt-3 border border-border-warm bg-surface shadow-[0_12px_30px_rgba(80,60,40,0.09)] sm:mx-0 sm:mt-0"
        aria-label="Attendee identity"
      >
        <div className="mx-auto aspect-square w-full max-w-[280px] overflow-hidden border-b border-border-warm sm:max-w-none">
          <DeskPhoto
            src={photoUrl}
            alt={photoUrl ? `Photo of ${attendee.fullName}` : ""}
            fallbackLetter={attendee.fullName.charAt(0).toUpperCase()}
            testId="desk-photo"
            className="h-full w-full text-5xl"
          />
        </div>
        <div className="p-4">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-terracotta-deep">Registration identity</p>
          <h2 id="desk-detail-name" className="font-heading text-[28px] font-bold leading-[0.98] text-charcoal sm:text-[37px]">
            {attendee.fullName}
          </h2>
          <p className="mt-1.5 break-words text-[12px] font-bold tracking-[0.045em] text-charcoal/80">{formatRegCodeForDisplay(attendee.regCode)}</p>
          <p className="mt-1 text-xs font-bold text-muted">{attendee.branch}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <DeskStatusPill
              label={confirmed ? "Payment confirmed" : pending ? "Payment pending" : "Payment status unknown"}
              tone={confirmed ? "positive" : "warning"}
            />
            <DeskStatusPill label={present ? "Present" : "Not present"} tone={present ? "positive" : "warning"} />
          </div>
        </div>
        {/* Last child + absolute → paints over the photo AND the identity text
            by source order, so it can be placed across both (or just the photo). */}
        {present && <DeskPhotoStamp animate={celebrate} testId="desk-photo-stamp" />}
      </section>

      <section className="mx-3 mt-4 border border-border-warm bg-surface sm:mx-0 sm:mt-0" aria-labelledby="desk-facts-title" data-testid="desk-facts">
        <header className="flex min-h-11 items-center justify-between border-b border-border-warm bg-terracotta-light px-3.5">
          <strong id="desk-facts-title" className="font-heading text-base text-charcoal">Desk essentials</strong>
          <span className="font-accent text-base text-terracotta-deep">one clear handover</span>
        </header>
        <div className="divide-y divide-border-warm">
          <Fact
            label="Payment"
            value={
              confirmed
                ? "Payment confirmed"
                : pending
                  ? amountDue !== undefined
                    ? `₹${amountDue.toLocaleString("en-IN")} due`
                    : "Pending"
                  : "Payment status unknown"
            }
            warning={!confirmed}
          />
          <Fact label="Participation" value={PARTICIPATION_LABELS[attendee.participationType] ?? attendee.participationType} />
          <Fact label="Guests" value={guestsSummary(attendee)} />
          <Fact label="Stay" value={staySummary(attendee)} />
          <Fact
            label="WhatsApp"
            value={
              wa ? (
                <a href={wa} target="_blank" rel="noreferrer" className="text-soft-aqua-deep underline">
                  {attendee.whatsapp}
                </a>
              ) : (
                attendee.whatsapp || "—"
              )
            }
          />
          <Fact label="T-shirt" value={tshirtSummary(attendee)} />
        </div>
      </section>

      {/* Inline forms — sit between "Desk essentials" and the sticky footer
          (design "How forms open — inline expand"). Only one renders at a
          time (openForm). */}
      {openForm === "collect" && amountDue !== undefined && (
        <div ref={formRef} className="mx-3 mt-4 sm:col-span-full sm:mx-0 sm:mt-0">
          <DeskCollectPayment
            amountDue={amountDue}
            attendeeName={attendee.fullName}
            regCode={attendee.regCode}
            busy={checking || undoing}
            onSubmit={handleCollectPayment}
            onClose={() => setOpenForm(null)}
          />
        </div>
      )}
      {openForm === "charge" && (
        <div ref={formRef} className="mx-3 mt-4 sm:col-span-full sm:mx-0 sm:mt-0">
          <DeskAddCharge busy={checking || undoing} onSubmit={handleAddCharge} onClose={() => setOpenForm(null)} />
        </div>
      )}

      {/* Immediate add-charge success feedback (plan "Add-charge result") —
          reason, entered charge amount, and the authoritative updated total
          from the fresh overview. Ephemeral; no historical charge rows. */}
      {chargeResult && (
        <div
          role="status"
          data-testid="desk-charge-result"
          className="mx-3 mt-4 rounded-2xl border border-soft-aqua bg-soft-aqua-light p-4 sm:col-span-full sm:mx-0 sm:mt-0"
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-soft-aqua-ink">Charge added</p>
          <p className="mt-1 text-sm font-semibold text-charcoal">{chargeResult.description}</p>
          <p className="mt-1 text-sm text-soft-aqua-ink">
            ₹{chargeResult.amount.toLocaleString("en-IN")} added · New total due{" "}
            <strong className="text-charcoal">₹{chargeResult.updatedTotalDue.toLocaleString("en-IN")}</strong>
          </p>
        </div>
      )}

      <footer className="sticky bottom-0 z-20 col-span-full border-t border-border-warm bg-surface/95 px-3 py-2.5 backdrop-blur-md sm:px-7">
        {/* Prominent pending-payment block (plan "Pending-payment hierarchy"):
            the exact server amount in heading type and the blocking condition
            the operator must resolve before attendance. Replaces the old
            11px footer warning. */}
        {pending && amountDue !== undefined && (
          <div
            role="alert"
            data-testid="desk-pending-warning"
            className="mb-2 rounded-xl border border-terracotta/40 bg-terracotta-light px-4 py-3"
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-terracotta-deep">Payment due</p>
            <p className="mt-1 font-heading text-2xl font-bold leading-none text-charcoal sm:text-[28px]">
              ₹{amountDue.toLocaleString("en-IN")}
            </p>
            <p className="mt-1.5 text-xs font-semibold leading-relaxed text-terracotta-deep/85">
              Full balance must be collected before attendance.
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-stretch gap-2 sm:items-center sm:gap-3">
          {present && !celebrate ? (
            // Reopening an already-present attendee: static welcomed state PLUS
            // the undo button, PLUS Collect payment if a balance is still
            // outstanding (a charge added after check-in must be collectible
            // without leaving and reopening the record — net rule: Collect
            // payment shows iff pending, Undo shows iff present, regardless
            // of each other). The undo uses a regular Button (not the
            // ActionButton) — there's no celebratory green flash on reversal, and
            // we want a quiet, easily-reversible destructive action. Attendance
            // and payment are independent (design §3): a charge added while
            // present does NOT undo check-in.
            <>
              <div
                className="flex min-h-[54px] flex-1 items-center gap-3 rounded-xl border border-veg-border/40 bg-veg-bg px-4 py-2.5"
                data-testid="desk-present-state"
                role="status"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-veg-text text-white shadow-[0_4px_12px_rgba(45,155,103,0.4)]">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 13l4 4L19 7" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <p className="font-heading text-[15px] font-bold leading-tight text-veg-text">Present</p>
                  <p className="truncate text-[11px] font-semibold text-veg-text/85">Present since {presentSince}</p>
                </div>
              </div>
              {pending && amountDue !== undefined && (
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => setOpenForm("collect")}
                  disabled={busy}
                  className="shrink-0"
                  data-testid="desk-collect-payment-open"
                >
                  {`Collect full payment · ₹${amountDue.toLocaleString("en-IN")}`}
                </Button>
              )}
              <Button
                variant="secondary"
                size="md"
                onClick={onMarkAbsent}
                loading={undoing}
                disabled={busy || formOpen}
                aria-label="Undo attendance"
                data-testid="desk-mark-absent"
                className="shrink-0"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 7v6h6" />
                  <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
                </svg>
                Undo
              </Button>
            </>
          ) : confirmed ? (
            // Not present, settled, and the live check-in in progress/just
            // done: the button animates over the server call (idle → loading
            // → green success) and stays green ("Checked in") once it resolves.
            <ActionButton
              onAction={handleMarkPresent}
              successLabel="Checked in"
              aria-label="Confirm attendance"
              successAriaLabel="Checked in"
              data-testid="desk-mark-present"
              disabled={busy || formOpen}
              className="min-w-0 flex-1"
            >
              Confirm attendance
            </ActionButton>
          ) : (
            // Hard gate (design §3, plan Pre-Decisions "Attendance gate for
            // pending registrations"), fail-closed: Confirm attendance shows
            // ONLY on an explicit 'confirmed' state above — anything else
            // (pending, or an unreasoned third state) lands here. Pending
            // shows Collect payment; amountDue is absent only in an edge
            // state the overview doesn't otherwise reason about (mirrors the
            // "Pending" fallback in the facts card above), and there's
            // nothing safe to render for it, so no CTA shows at all.
            pending &&
            amountDue !== undefined && (
              <Button
                variant="primary"
                size="lg"
                onClick={() => setOpenForm("collect")}
                disabled={busy}
                className="min-w-0 flex-1"
                data-testid="desk-collect-payment-open"
              >
                {`Collect full payment · ₹${amountDue.toLocaleString("en-IN")}`}
              </Button>
            )
          )}
          {/* Compact secondary action beside the primary CTA. It matches the
              primary action's 54px height while keeping the mobile label short
              enough to leave the balance of the row to Collect/Confirm. The
              full label returns at sm+. Remains clickable while the
              OTHER form is open: the shared openForm slot switches forms
              (opening one closes the other). Only a mutation in flight (busy)
              disables it. */}
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setOpenForm("charge")}
            disabled={busy}
            aria-label="Add additional charge"
            data-testid="desk-add-charge-open"
            className="shrink-0 !px-4"
          >
            <span className="sm:hidden">+ Charge</span>
            <span className="hidden sm:inline">+ Add additional charge</span>
          </Button>
        </div>
        {checkInError && (
          <p role="alert" className="mt-1.5 text-xs text-terracotta-deep">
            {checkInError}
          </p>
        )}
      </footer>
    </div>
  );
}
