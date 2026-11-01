import { useState, type FormEvent } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { deskAddChargeSchema } from "@/lib/validation";
import { ApiError } from "@/lib/http";

export interface DeskAddChargeProps {
  /** The async add-charge call. Resolves on success; rejects on failure so
      the form stays open and shows the error. */
  onSubmit: (description: string, amount: number) => Promise<void>;
  onClose: () => void;
  /** True while a DIFFERENT footer action (check-in or undo) is in flight —
   *  disables submit even before this form's own `submitting` becomes true,
   *  so an already-open form can't fire while another mutation is pending.
   *  @default false */
  busy?: boolean;
}

function apiErrorMessage(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

/**
 * CONTRACT: Add-charge form (desk-payment-collection design §2).
 *
 * GUARANTEES:
 *   - `description` (non-empty) and `amount` (positive whole rupees) are
 *     validated client-side against the same `deskAddChargeSchema` the
 *     server enforces before the network call.
 *   - Calls `onSubmit(description, amount)` on submit.
 *   - A 409 from `onSubmit` means the registration's payment is
 *     `pending_verification` — the plan's guard-test list names this as the
 *     ONLY reasoned 409 case for the add-charge endpoint (amount<=0 / empty
 *     description are 422s, not 409s). On 409 the guard box replaces the
 *     generic error; there is no `underVerification` field on the overview
 *     to pre-disable the form, so the guard is shown reactively, only after
 *     a submit actually hits it.
 *   - Any other failure (network, unexpected status) shows a generic inline
 *     terracotta error instead of the guard box.
 *   - `busy` (a DIFFERENT footer action in flight) disables submit
 *     independently of this form's own `submitting` — structural defense so
 *     an already-open form can't fire while another mutation is pending,
 *     not reliant solely on the caller having disabled the entry point.
 *
 * FAILURE BEHAVIOR: see GUARANTEES — the two failure modes render
 *   differently by design (guard box vs generic error), both visible, never
 *   a silent no-op.
 */
export function DeskAddCharge({ onSubmit, onClose, busy = false }: DeskAddChargeProps) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [underVerification, setUnderVerification] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || busy) return;
    setError(null);
    setUnderVerification(false);

    const parsed = deskAddChargeSchema.safeParse({
      description,
      amount: Number(amount),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the charge details.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(parsed.data.description, parsed.data.amount);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setUnderVerification(true);
      } else {
        setError(apiErrorMessage(err) ?? "Could not add the charge. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className="bg-surface border border-border-warm rounded-[1.75rem] p-5 sm:p-6"
      aria-label="Add additional charge"
      data-testid="desk-add-charge-form"
    >
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-heading text-xl text-charcoal font-bold">Add charge</h2>
        {/* Disabled mid-submit: closing while the request is in flight would
            unmount this form before a failure's inline error (or the
            pending_verification guard) could render. */}
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
          Close
        </Button>
      </div>
      <p className="text-sm text-muted mb-5">
        This adds a charge to the balance. You&rsquo;ll collect it in the next step.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="charge-description" className="block text-sm font-semibold text-charcoal mb-1.5">
            Reason *
          </label>
          <Input
            id="charge-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Extra t-shirt XL"
          />
        </div>

        <div>
          <label htmlFor="charge-amount" className="block text-sm font-semibold text-charcoal mb-1.5">
            Amount ₹ *
          </label>
          <Input
            id="charge-amount"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 500"
          />
        </div>

        <Button
          type="submit"
          loading={submitting}
          disabled={busy}
          className="w-full"
          size="lg"
          data-testid="desk-add-charge-submit"
        >
          Add charge
        </Button>

        {error && (
          <p role="alert" className="text-sm text-terracotta-deep" data-testid="desk-add-charge-error">
            {error}
          </p>
        )}
        {underVerification && (
          <div
            role="alert"
            data-testid="desk-add-charge-guard"
            className="rounded-2xl border border-terracotta/40 bg-terracotta-light p-4 text-sm text-terracotta-deep"
          >
            Payment is under verification — charges are blocked until it clears.
          </div>
        )}
      </form>
    </section>
  );
}
