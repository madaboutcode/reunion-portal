import type { ReactNode } from "react";
import type { WizardDraft } from "@/types/registration";
import { calculateTotal, getAttendeeCounts, toRegistration } from "@/lib/pricing";
import { formatINR, getAccommodationCatalog, PARTICIPATION_LABELS } from "@/lib/constants";
// import { CostBreakup } from "@/components/ui/CostBreakup"; // hidden: static categories don't match actual per-type pricing

// ── Types ──────────────────────────────────────────────────────────────────

export interface PricingSummaryProps {
  data: WizardDraft;
  className?: string;
  children?: ReactNode;
}

// ── Inline heart doodle SVG ────────────────────────────────────────────────

function HeartDoodle() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="#D76B51"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function PricingSummary({ data, className, children }: PricingSummaryProps) {
  const reg = toRegistration(data);
  const bd = calculateTotal(reg);
  const counts = getAttendeeCounts(reg);

  return (
    <div
      className={[
        "bg-surface",
        "rounded-2xl",
        "border border-[rgba(200,180,150,0.25)]",
        "px-5 py-5",
        "shadow-[0_4px_24px_rgba(80,60,40,0.08)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* ── Title row ── */}
      <div className="flex items-center gap-1.5">
        <span className="font-heading text-base font-bold text-charcoal">
          Summary
        </span>
        <HeartDoodle />
      </div>

      {/* ── Subtitle ── */}
      <div className="text-xs text-subtle mt-0.5 mb-5">
        Working rates · confirmed at payment
      </div>

      {/* ── Line items container ── */}
      <div className="space-y-3">

        {/* ── Alumni registration fee ── */}
        {bd.base > 0 && (
          <>
            <div className="flex justify-between">
              <span className="text-sm text-muted">{PARTICIPATION_LABELS[data.participationType ?? "full_celebration"]}</span>
              <span className="text-sm font-medium text-charcoal tabular-nums">
                {formatINR(bd.base)}
              </span>
            </div>
            {/* <CostBreakup /> — hidden: static categories don't match actual per-type pricing */}
          </>
        )}

        {/* ── Line items (spouse / children / guests / accommodation) ── */}
        {bd.lines.map((line, i) => (
          <div key={i} className="flex items-baseline justify-between">
            <span className="text-sm text-muted">
              {line.label}
            </span>
            <span
              className={`text-sm font-medium tabular-nums shrink-0 ml-3 ${
                line.free ? "text-subtle" : "text-charcoal"
              }`}
            >
              {line.free ? "Free" : formatINR(line.fee)}
            </span>
          </div>
        ))}

        {/* ── Breakfast note — catalog-driven ── */}
        {reg.accommodation && (() => {
          const entry = getAccommodationCatalog().find(
            (e) => e.value === reg.accommodation!.type,
          );
          if (!entry) return null;
          return (
            <p className="text-xs text-subtle">
              ☕ Breakfast for {entry.breakfastFor} included
            </p>
          );
        })()}

        {/* ── Donation ── */}
        {bd.donation > 0 && (
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">Donation</span>
            <span className="text-sm font-medium text-charcoal tabular-nums">
              {formatINR(bd.donation)}
            </span>
          </div>
        )}

      </div>

      {/* ── Divider ── */}
      <div className="border-t border-border-warm mt-4 mb-4" />

      {/* ── Total row ── */}
      <div className="flex justify-between items-baseline">
        <span className="font-heading text-base font-bold text-charcoal">Total</span>
        <span className="text-lg font-bold text-terracotta tabular-nums">
          {formatINR(bd.total)}
        </span>
      </div>

      {/* ── Attendee count ── */}
      {counts.total > 0 && (
        <p className="text-xs text-subtle mt-2.5 text-center">
          {counts.total} attendee{counts.total !== 1 ? "s" : ""} ·{" "}
          {counts.veg} Veg · {counts.nonveg} Non-veg
        </p>
      )}

      {/* ── Slot for caller-provided content (e.g. pay button) ── */}
      {children && <div className="mt-5">{children}</div>}

    </div>
  );
}
