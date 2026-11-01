export function ParticipationStepMarker({ n }: { n: number }) {
  return (
    <span
      className={[
        "w-7 h-7 shrink-0 rounded-full",
        "bg-terracotta text-white",
        "text-xs font-bold",
        "flex items-center justify-center",
        "shadow-[0_2px_6px_rgba(215,107,81,0.35)]",
      ].join(" ")}
      aria-hidden
    >
      {n}
    </span>
  );
}

export function ParticipationChapter({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-2.5 items-start min-w-0">
      <ParticipationStepMarker n={n} />
      <div className="min-w-0 pt-0.5">
        <p className="font-heading text-sm font-bold text-charcoal leading-tight mb-0.5">
          {title}
        </p>
        <p className="text-xs text-muted leading-[1.45]">{body}</p>
      </div>
    </div>
  );
}