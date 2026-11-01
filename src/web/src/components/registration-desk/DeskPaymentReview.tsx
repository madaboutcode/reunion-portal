import { Button } from "@/components/ui/Button";
import { formatRegCodeForDisplay } from "@/lib/constants";
import type { DeskSpotRegistrationResponse } from "@/lib/staff-types";

export interface DeskPaymentReviewProps {
  registration: DeskSpotRegistrationResponse["registration"];
  onContinue: () => void;
}

export function DeskPaymentReview({ registration, onContinue }: DeskPaymentReviewProps) {
  return (
    <section data-testid="desk-payment-review" className="animate-[slideIn_0.3s_ease-out] rounded-[1.75rem] bg-white p-5 shadow-sm sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-soft-aqua-deep">Registration created</p>
      <h3 className="mt-3 font-heading text-3xl font-bold text-charcoal">One more thing before they join us.</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted">The server has created this registration and its payment record. Payment remains separate from attendance.</p>
      <div className="mt-7 divide-y divide-border-warm rounded-2xl border border-border-warm bg-surface">
        <div className="flex items-center justify-between px-4 py-4"><span className="text-sm text-muted">Registration code</span><strong className="font-mono text-sm text-charcoal">{formatRegCodeForDisplay(registration.regCode)}</strong></div>
        <div className="flex items-center justify-between px-4 py-4"><span className="text-sm text-muted">Payment</span><strong className="text-sm text-terracotta-deep">{registration.payment.state === "payment_pending" ? "Payment due" : "Payment confirmed"}</strong></div>
        {registration.payment.state === "payment_pending" && <div className="flex items-center justify-between px-4 py-5"><span className="font-heading text-lg font-bold text-charcoal">Amount due</span><strong className="text-2xl text-charcoal">₹{registration.payment.amountDue.toLocaleString("en-IN")}</strong></div>}
        <div className="flex items-center justify-between px-4 py-4"><span className="text-sm text-muted">Check-in</span><strong className="text-sm text-charcoal">Not checked in</strong></div>
      </div>
      <p className="mt-5 rounded-xl bg-soft-aqua-light px-4 py-3 text-sm leading-relaxed text-soft-aqua-ink">They are not marked present yet. Continue to their overview when they are ready to enter.</p>
      <Button type="button" onClick={onContinue} className="mt-6 w-full" data-testid="desk-payment-continue">Continue to attendance</Button>
    </section>
  );
}
