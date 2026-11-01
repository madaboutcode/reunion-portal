import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { deskCollectPaymentSchema } from "@/lib/validation";
import { formatRegCodeForDisplay } from "@/lib/constants";
import { ApiError } from "@/lib/http";
import type { DeskPaymentMethod } from "@/lib/staff-types";

export interface DeskCollectPaymentProps {
  /** The full outstanding balance, in rupees — there is no partial-amount
   *  input by design (plan Pre-Decisions: settlement granularity). */
  amountDue: number;
  /** Attendee identity repeated at the point of commitment — protection
   *  against collecting against the wrong record (plan "Collection
   *  safeguards"). */
  attendeeName: string;
  /** Registration code repeated alongside the name, formatted for display. */
  regCode: string;
  /** The async settle call. Resolves on success; rejects on failure so the
      form stays open and shows the error (the caller decides what success
      means — it refreshes the attendee and closes the form). */
  onSubmit: (method: DeskPaymentMethod, note?: string) => Promise<void>;
  onClose: () => void;
  /** True while a DIFFERENT footer action (check-in or undo) is in flight —
   *  disables submit even before this form's own `submitting` becomes true,
   *  so an already-open form can't fire while another mutation is pending.
   *  @default false */
  busy?: boolean;
}

const METHOD_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
];

function apiErrorMessage(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

/**
 * CONTRACT: Collect-payment form (desk-payment-collection design §1; 2026-08-12
 * plan "Collection safeguards").
 *
 * GUARANTEES:
 *   - Records a FULL settlement of the outstanding balance only — no
 *     partial-amount field (plan Pre-Decisions: settlement granularity).
 *   - REPEATS_IDENTITY — attendee name and formatted registration code are
 *     shown at the point of commitment, next to the read-only full amount,
 *     as the cheapest protection against collecting against the wrong record.
 *   - METHOD_REQUIRED — `method` starts unselected and the operator must
 *     explicitly choose cash/upi/bank_transfer before submit is enabled; the
 *     schema (method required) is the same one the server enforces.
 *   - Calls `onSubmit(method, note)` on submit. A rejection shows an inline
 *     terracotta error (role=alert) below the submit button and returns the
 *     button to idle for retry; the form stays open and the fields keep
 *     their values.
 *   - `busy` (a DIFFERENT footer action in flight) disables submit
 *     independently of this form's own `submitting` — structural defense so
 *     an already-open form can't fire while another mutation is pending,
 *     not reliant solely on the caller having disabled the entry point.
 *
 * FAILURE BEHAVIOR: see GUARANTEES — every failure path is a visible inline
 *   error, never a silent no-op.
 */
export function DeskCollectPayment({ amountDue, attendeeName, regCode, onSubmit, onClose, busy = false }: DeskCollectPaymentProps) {
  const [method, setMethod] = useState<DeskPaymentMethod | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || busy) return;
    setError(null);

    if (!method) {
      setError("Please select a payment method.");
      return;
    }

    const parsed = deskCollectPaymentSchema.safeParse({
      method,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the payment details.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(parsed.data.method, parsed.data.note);
    } catch (err) {
      setError(apiErrorMessage(err) ?? "Could not record the payment. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const amountLabel = `₹${amountDue.toLocaleString("en-IN")}`;

  return (
    <section
      className="bg-surface border border-border-warm rounded-[1.75rem] p-5 sm:p-6"
      aria-label="Collect payment"
      data-testid="desk-collect-payment-form"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading text-xl text-charcoal font-bold">Collect payment</h2>
        {/* Disabled mid-submit: closing while the request is in flight would
            unmount this form before a failure's inline error could render. */}
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
          Close
        </Button>
      </div>

      {/* Identity + amount repeated at the point of commitment (plan
          "Collection safeguards"). The operator verifies the WHO before
          committing the full settlement. */}
      <div className="rounded-2xl border border-border-warm bg-white p-4 mb-4">
        <p className="font-heading text-lg font-bold leading-tight text-charcoal">{attendeeName}</p>
        <p className="mt-0.5 text-[12px] font-bold tracking-[0.045em] text-charcoal/80">
          {formatRegCodeForDisplay(regCode)}
        </p>
        <div className="mt-3 rounded-xl bg-terracotta-light border border-terracotta/40 p-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-terracotta-deep mb-0.5">
            Full amount due
          </p>
          <p className="font-heading text-[28px] font-bold text-charcoal leading-none">{amountLabel}</p>
          <p className="text-xs text-muted mt-1">Full settlement — no partial payment</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <span id="collect-payment-mode-label" className="block text-sm font-semibold text-charcoal mb-1.5">
            Payment mode *
          </span>
          <Toggle
            options={METHOD_OPTIONS}
            value={method ?? ""}
            onChange={(v) => setMethod(v as DeskPaymentMethod)}
            ariaLabelledBy="collect-payment-mode-label"
            // 44px minimum touch target on mobile (repository rule) — the
            // shared Toggle default is 40px (h-10), so the payment method
            // controls opt into the taller option buttons.
            optionClassName="h-11"
          />
        </div>

        <div>
          <label htmlFor="collect-payment-note" className="block text-sm font-semibold text-charcoal mb-1.5">
            Comment (optional)
          </label>
          <textarea
            id="collect-payment-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Received by Ajith at 3pm"
            className="w-full min-h-[88px] text-[14px] font-body text-charcoal placeholder:text-subtle bg-white border-[1.5px] border-border rounded-[10px] outline-none box-border px-[14px] py-2.5 transition-[border-color] duration-150 focus:border-soft-aqua"
          />
        </div>

        <Button
          type="submit"
          loading={submitting}
          disabled={busy || method === null}
          className="w-full"
          size="lg"
          data-testid="desk-collect-payment-submit"
        >
          {`Record full payment · ${amountLabel}`}
        </Button>

        {error && (
          <p role="alert" className="text-sm text-terracotta-deep" data-testid="desk-collect-payment-error">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
