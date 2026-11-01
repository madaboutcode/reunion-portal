export type DeskPillTone = "positive" | "warning";

export interface DeskStatusPillProps {
  label: string;
  tone: DeskPillTone;
}

const TONE_CLASSES: Record<DeskPillTone, string> = {
  positive: "bg-soft-aqua-light text-soft-aqua-ink",
  warning: "bg-terracotta-light text-terracotta-deep",
};

/** Shared payment/attendance/check-in status pill (registration-desk-ui plan, shared primitives). */
export function DeskStatusPill({ label, tone }: DeskStatusPillProps) {
  return (
    <span
      className={`inline-flex min-h-[27px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${TONE_CLASSES[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}
