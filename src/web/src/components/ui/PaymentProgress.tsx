// ── Types ──────────────────────────────────────────────────────────────────

export type PaymentStatus = "pending" | "pending_verification" | "confirmed";

export interface PaymentProgressProps {
  /** Current payment lifecycle status. Determines which stage is active. */
  currentStatus: PaymentStatus;
}

// ── Constants ──────────────────────────────────────────────────────────────

const STAGES = [
  { key: "registration", label: "Registered" },
  { key: "payment_proof", label: "Payment" },
  { key: "verification", label: "We're Verifying" },
  { key: "passes", label: "You're In!" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

/** Maps each status to the active stage key. */
const ACTIVE_STAGE: Record<PaymentStatus, StageKey> = {
  pending: "payment_proof",
  pending_verification: "verification",
  confirmed: "passes",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function getStageIndex(key: StageKey): number {
  return STAGES.findIndex((s) => s.key === key);
}

type StageState = "complete" | "active" | "future";

function getStageState(stageKey: StageKey, activeKey: StageKey): StageState {
  const stageIdx = getStageIndex(stageKey);
  const activeIdx = getStageIndex(activeKey);
  if (stageIdx < activeIdx) return "complete";
  if (stageIdx === activeIdx) return "active";
  return "future";
}

// ── SVG Icons ──────────────────────────────────────────────────────────────

const CheckmarkIcon = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M5 13l4 4L19 7"
      stroke="#2A7A80"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ActiveDotIcon = (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="5" cy="5" r="4" fill="white" />
  </svg>
);

// ── Style helpers ──────────────────────────────────────────────────────────

function circleClass(state: StageState): string {
  switch (state) {
    case "complete":
      return "bg-soft-aqua border-soft-aqua";
    case "active":
      return "bg-terracotta border-terracotta shadow-[0_3px_10px_rgba(215,107,81,0.25)]";
    case "future":
      return "bg-transparent border-[rgba(200,180,150,0.3)]";
  }
}

function labelClass(state: StageState): string {
  switch (state) {
    case "complete":
      return "text-[#2A7A80]";
    case "active":
      return "text-terracotta font-bold";
    case "future":
      return "text-[#B8A898]";
  }
}

/** Line between stage[i] and stage[i+1]. Solid if stage[i] is complete, dashed otherwise. */
function lineClass(stageState: StageState): string {
  if (stageState === "complete") return "border-soft-aqua border-solid";
  return "border-dashed border-[rgba(200,180,150,0.3)]";
}

// ── Component ──────────────────────────────────────────────────────────────

export function PaymentProgress({ currentStatus }: PaymentProgressProps) {
  const activeKey = ACTIVE_STAGE[currentStatus];

  return (
    // Desktop: horizontal flex. Mobile: vertical flex (flex-col).
    <div
      role="list"
      className="flex flex-col sm:flex-row sm:items-start w-full"
    >
      {STAGES.map((stage, i) => {
        const state = getStageState(stage.key, activeKey);
        const isLast = i === STAGES.length - 1;

        // ── Circle content ──────────────────────────────────────────
        const circleContent =
          state === "complete" ? (
            CheckmarkIcon
          ) : state === "active" ? (
            ActiveDotIcon
          ) : null;

        return (
          <div
            key={stage.key}
            className="contents"
            role="listitem"
            aria-current={state === "active" ? "step" : undefined}
          >
            {/*
             * Desktop: circle on top, label below, horizontal.
             * Mobile: circle on left, label beside, vertical stack.
             */}
            <div className="flex sm:flex-col sm:items-center items-center gap-3 sm:gap-[6px] shrink-0">
              {/* Circle */}
              <div
                className={[
                  "w-9 h-9 rounded-full",
                  "border-2",
                  "flex items-center justify-center",
                  "shrink-0",
                  circleClass(state),
                ].join(" ")}
              >
                {circleContent}
                {state === "complete" && (
                  <span className="sr-only">Complete</span>
                )}
              </div>

              {/* Label */}
              <span
                className={[
                  "text-sm sm:text-center leading-[1.3]",
                  labelClass(state),
                ].join(" ")}
              >
                {stage.label}
              </span>
            </div>

            {/* Connecting line — not after last stage */}
            {!isLast && (
              /*
               * Desktop: horizontal line (flex-1, border-t-2, vertically centered
               *   with the circles via mt-[17px]).
               * Mobile: vertical line on the left (w-0 border-l-2, ml-[17px]).
               *   Height py-2 gives a visible gap.
               */
              <div
                className={[
                  // Mobile: vertical left-side line
                  "ml-[17px] border-l-2 py-2",
                  // Desktop: horizontal line
                  "sm:ml-0 sm:border-l-0 sm:flex-1 sm:mt-[17px] sm:mx-1 sm:border-t-2 sm:py-0",
                  lineClass(state),
                ].join(" ")}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
