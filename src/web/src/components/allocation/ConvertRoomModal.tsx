import type { AllocationRegistration } from "@/lib/staff-types";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ConvertRoomModalProps {
  open: boolean;
  registration: AllocationRegistration | null;
  confirming: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────
// Confirm dialog for triple -> double conversion (flow-delta.md Job 1 step 2).
// House style follows RoomTogetherModal / MutualGroupsModal.

export function ConvertRoomModal({
  open,
  registration,
  confirming,
  onClose,
  onConfirm,
}: ConvertRoomModalProps) {
  if (!open || !registration) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-[440px] w-full overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Convert to 2-Share"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E8E2DA]">
          <h2 className="font-heading text-lg font-bold text-charcoal">
            Convert to 2-Share?
          </h2>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-2.5">
          <p className="text-sm text-charcoal">
            <strong>{registration.fullName}:</strong> 3-Share → 2-Share
          </p>
          <p className="text-sm text-charcoal">
            The room price goes up. {registration.fullName} will owe the difference
            and their registration drops to Pending until it&apos;s paid. You can
            send a payment link right after.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[#E8E2DA]">
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
            className="h-11 px-4 rounded-lg border-[1.5px] border-[#E8E2DA] text-sm font-semibold text-charcoal hover:border-terracotta hover:text-terracotta transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className="h-11 px-4 rounded-lg bg-[#D76B51] text-white text-sm font-semibold hover:brightness-90 active:brightness-85 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirming ? "Converting..." : "Convert"}
          </button>
        </div>
      </div>
    </div>
  );
}
