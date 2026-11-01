// ConfirmationActions — Download Pass + Share buttons for confirmed,
// Complete Payment for pending, Check Status for pending_verification.
// Uses the portal's Button component.

import { Button } from "@/components/ui/Button";

const REGISTER_ANOTHER_LINK_CLASS =
  "text-sm text-[#2A7A80] underline hover:text-terracotta transition-colors font-body";

export interface ConfirmationActionsProps {
  onReset?: () => void;
  status?: "pending" | "pending_verification" | "confirmed";
  regCode?: string;
}

export function ConfirmationActions({
  status,
  regCode,
}: ConfirmationActionsProps) {
  const resolvedStatus = status ?? "confirmed";

  // ── Pending: Complete Payment CTA ──
  if (resolvedStatus === "pending") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex gap-3 flex-wrap">
          <Button
            variant="primary"
            size="lg"
            className="flex-1 min-w-[180px] bg-[linear-gradient(135deg,#D76B51_0%,#c45a40_100%)] shadow-[0_6px_18px_rgba(215,107,81,0.3)] border-0 hover:brightness-95"
            onClick={() => {
              if (regCode) {
                window.location.href = `/pay/${regCode}`;
              }
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <rect x="2" y="5" width="20" height="14" rx="2" stroke="white" strokeWidth="2" />
              <path d="M2 10h20" stroke="white" strokeWidth="2" />
              <path d="M6 14h4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Complete Payment
          </Button>
        </div>

        {/* Secondary: register another */}
        <div className="text-center">
          <a href="/new" className={REGISTER_ANOTHER_LINK_CLASS}>
            Register another batchmate
          </a>
        </div>
      </div>
    );
  }

  // ── Pending verification: Check Status ──
  if (resolvedStatus === "pending_verification") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex gap-3 flex-wrap">
          <Button
            variant="primary"
            size="lg"
            className="flex-1 min-w-[180px] bg-[linear-gradient(135deg,#D76B51_0%,#c45a40_100%)] shadow-[0_6px_18px_rgba(215,107,81,0.3)] border-0 hover:brightness-95"
            onClick={() => {
              window.location.reload();
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <polyline
                points="23,4 23,10 17,10"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M20.49 15a9 9 0 11-2.12-9.36L23 10"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Check Status
          </Button>
        </div>

        {/* Secondary: register another */}
        <div className="text-center">
          <a href="/new" className={REGISTER_ANOTHER_LINK_CLASS}>
            Register another batchmate
          </a>
        </div>
      </div>
    );
  }

  // ── Confirmed: register another ──
  return (
    <div className="flex flex-col gap-3">
      <div className="text-center">
        <a href="/new" className={REGISTER_ANOTHER_LINK_CLASS}>
          Register another batchmate
        </a>
      </div>
    </div>
  );
}
