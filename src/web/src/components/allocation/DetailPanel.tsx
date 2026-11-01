import { useState } from "react";
import { getDeptCode } from "@/components/leaderboard/department";
import { formatINR } from "@/lib/pricing";
import type { AllocationRegistration, PreferenceEntry } from "@/lib/staff-types";
import { GenderIcon, DatePills, PersonAvatar, TypePill, StatusPill } from "./shared";

// ── Types ──────────────────────────────────────────────────────────────────

interface IncomingRequest {
  fromId: number;
  fromName: string;
  fromBranch: string;
  isMutual: boolean;
}

export interface DetailPanelProps {
  registration: AllocationRegistration | null;
  prefs: PreferenceEntry[];
  incoming: IncomingRequest[];
  prefsLoading: boolean;
  prefsError: string | null;
  dirty: boolean;
  conflict: boolean;
  onReorder: (from: number, to: number) => void;
  onDelete: (prefRegId: number) => void;
  onAddClick: () => void;
  onMakeMutual: (fromRegId: number) => void;
  onWhatsAppReminder: () => void;
  onReload: () => void;
  onConvertClick: () => void;
  onCopyPaymentLink: () => void;
  onWhatsAppPayment: () => void;
  linkActionPending: boolean;
}

const MAX_PREFS = 5;

// ── Component ──────────────────────────────────────────────────────────────

export function DetailPanel({
  registration,
  prefs,
  incoming,
  prefsLoading,
  prefsError,
  dirty,
  conflict,
  onReorder,
  onDelete,
  onAddClick,
  onMakeMutual,
  onWhatsAppReminder,
  onReload,
  onConvertClick,
  onCopyPaymentLink,
  onWhatsAppPayment,
  linkActionPending,
}: DetailPanelProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (!registration) {
    return (
      <div className="bg-white border-l border-[#E8E2DA] p-5 sticky top-0 h-full flex items-center justify-center">
        <p className="text-[#8a8f94] text-sm text-center">
          ← Select someone to view their preferences
        </p>
      </div>
    );
  }

  const deptCode = getDeptCode(registration.branch);
  const full = prefs.length >= MAX_PREFS;

  return (
    <div className="bg-white border-l border-[#E8E2DA] p-5 sticky top-0">
      {/* Header */}
      <div className="flex items-start gap-4">
        <PersonAvatar id={registration.id} name={registration.fullName} photoUrl={registration.photoThumbUrl} size="lg" />
        <div>
          <h2 className="font-serif text-[1.1rem] font-bold text-charcoal">
            {registration.fullName}
          </h2>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <GenderIcon gender={registration.gender} className="w-4 h-4" />
            <span className="text-[12.5px] text-[#8a8f94]">{deptCode}</span>
            <TypePill type={registration.accommodationType} />
            <DatePills checkIn={registration.checkIn} checkOut={registration.checkOut} />
          </div>
        </div>
      </div>

      {/* Room switch + payment actions (staff-api R41/R42) — apply regardless of
          accommodation type; convert is triple-only, payment actions are any
          non-confirmed listed registration (D1b). */}
      {registration.accommodationType === "shared_triple" && (
        <div className="mt-4">
          <button
            type="button"
            onClick={onConvertClick}
            className="border border-[#4a7380] bg-[#edf6f7] text-[#255b67] font-semibold text-[13px] rounded-lg px-4 py-2.5 min-h-11 hover:opacity-90 active:scale-[0.97] transition-transform"
          >
            Convert to 2-Share
          </button>
        </div>
      )}

      {registration.status !== "confirmed" && (
        <div className="mt-4 flex items-center gap-2.5 flex-wrap">
          <StatusPill status={registration.status} />
          {registration.pendingAmount != null && (
            <span className="font-bold text-[15px] text-charcoal">
              {formatINR(registration.pendingAmount)} due
            </span>
          )}
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <button
              type="button"
              onClick={onCopyPaymentLink}
              disabled={linkActionPending}
              className="border border-[#E8E2DA] rounded-lg px-3.5 py-2 min-h-11 text-[13px] font-semibold text-charcoal hover:border-terracotta hover:text-terracotta disabled:opacity-50"
            >
              Copy payment link
            </button>
            <button
              type="button"
              onClick={onWhatsAppPayment}
              disabled={linkActionPending}
              className="bg-[#25D366] text-white font-semibold text-[13px] rounded-lg px-3.5 py-2 min-h-11 hover:bg-[#20BD5A] disabled:opacity-50"
            >
              WhatsApp
            </button>
          </div>
        </div>
      )}

      {/* Private room — basic info only, no prefs */}
      {registration.accommodationType === "private" && (
        <div className="mt-6">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#8a8f94] mb-2">Contact</div>
          <div className="flex flex-col gap-2">
            <a href={`mailto:${registration.email}`} className="text-sm text-charcoal hover:text-[#D76B51]">
              ✉ {registration.email}
            </a>
            {registration.whatsapp && (
              <a href={`https://wa.me/${registration.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="text-sm text-charcoal hover:text-[#D76B51]">
                ☎ {registration.whatsapp}
              </a>
            )}
          </div>
          <p className="text-sm text-[#8a8f94] italic mt-4">Private room — no roommate preferences needed.</p>
        </div>
      )}

      {registration.accommodationType !== "private" && (<>
      {/* Conflict banner */}
      {conflict && (
        <div className="mt-4 flex items-center gap-3 flex-wrap bg-[#FDF3F0] border border-[#D76B51] rounded-lg px-3.5 py-2.5">
          <span className="flex-1 text-[13px] text-charcoal min-w-0">
            Conflict — someone else edited this. Your changes are preserved below.
          </span>
          <button
            type="button"
            onClick={onReload}
            className="bg-[#D76B51] text-white font-semibold text-[12.5px] rounded-lg px-3.5 py-2 min-h-9 hover:opacity-90 active:scale-[0.97] transition-transform flex-shrink-0"
          >
            Reload
          </button>
        </div>
      )}

      {/* Incoming Requests */}
      <div className="mt-6">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#8a8f94]">
          Incoming Requests
        </h3>
        {incoming.length === 0 ? (
          <p className="mt-2 text-[13px] italic text-[#8a8f94]">No incoming requests</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            {incoming.map((req) => (
              <div key={req.fromId}>
                <div className="flex items-center gap-2.5 border border-[#E8E2DA] rounded-lg px-3 py-2.5 flex-wrap">
                  <span className="flex-1 min-w-0 text-sm">
                    <span className="font-semibold text-charcoal">{req.fromName}</span>{" "}
                    <span className="text-[#8a8f94]">({req.fromBranch})</span>
                  </span>
                  {!req.isMutual && (
                    <button
                      type="button"
                      onClick={() => onMakeMutual(req.fromId)}
                      className="bg-[#2d7a3a] text-white font-semibold text-[12px] rounded-full px-3 min-h-9 hover:opacity-90 active:scale-[0.97] transition-transform flex-shrink-0"
                    >
                      Make mutual ✓
                    </button>
                  )}
                </div>
                {!req.isMutual && (
                  <p className="text-[11.5px] text-[#8a8f94] mt-1 ml-1">
                    One click adds you both to each other&apos;s preferences
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preferences */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#8a8f94]">
            Preferences
          </h3>
          <span className="text-[12px] text-[#8a8f94]">
            {prefs.length} of {MAX_PREFS} filled
          </span>
        </div>
        <p className="text-[12px] text-[#8a8f94] mt-1 italic">
          Ranked by preference — 1 = first choice. More picks from everyone
          means easier matching.
        </p>

        {prefsLoading ? (
          <p className="text-sm text-[#8a8f94] mt-3">Loading preferences…</p>
        ) : prefsError ? (
          <p className="text-sm text-[#D76B51] mt-3">{prefsError}</p>
        ) : prefs.length === 0 ? (
          <button
            type="button"
            onClick={onAddClick}
            className="w-full mt-2 border border-dashed border-[#E8E2DA] rounded-lg px-3 py-4 text-[13px] font-semibold text-[#D76B51] text-center hover:bg-[#FFF8F5] active:scale-[0.99] transition-transform min-h-11"
          >
            ＋ Add preference
          </button>
        ) : (
          <>
            <ol className="flex flex-col gap-2 mt-2">
              {prefs.map((p, i) => {
                const isDropTarget = overIndex === i && dragIndex !== null && dragIndex !== i;
                return (
                  <li
                    key={p.preferredRegistrationId}
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(i);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setOverIndex(i);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null && dragIndex !== i) onReorder(dragIndex, i);
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    className={`flex items-center gap-2.5 border rounded-lg px-3 py-2.5 flex-wrap bg-white transition-colors ${
                      isDropTarget ? "border-[#D76B51] border-t-2" : "border-[#E8E2DA]"
                    } ${dragIndex === i ? "opacity-50" : ""}`}
                  >
                    <span
                      aria-hidden="true"
                      title="Drag to reorder"
                      className="cursor-grab active:cursor-grabbing text-[#8a8f94] hover:text-[#D76B51] select-none text-[15px] leading-none flex-shrink-0"
                    >
                      ⠿
                    </span>
                    <span className="w-[22px] h-[22px] rounded-full bg-soft-aqua text-charcoal text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-sm font-medium text-charcoal min-w-0">
                      {p.fullName}
                      <span className="text-[#8a8f94] font-normal text-[13px] ml-1">
                        ({p.branch})
                      </span>
                    </span>
                    {p.isMutual && (
                      <span className="text-[11px] font-bold text-[#1F6B73] bg-[#E0F4F1] px-1.5 py-0.5 rounded-full">
                        mutual
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(p.preferredRegistrationId)}
                      aria-label="Remove"
                      className="min-w-9 min-h-9 flex items-center justify-center text-[#8a8f94] hover:text-[#D76B51] text-base active:scale-[0.9] transition-transform flex-shrink-0"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ol>

            {!full && (
              <button
                type="button"
                onClick={onAddClick}
                className="w-full flex items-center gap-2.5 mt-2 border border-dashed border-[#D76B51] rounded-lg px-3 py-2.5 text-[13px] font-semibold text-[#D76B51] hover:bg-[#FFF8F5] active:scale-[0.99] transition-transform min-h-11"
              >
                ＋ Add preference
              </button>
            )}
          </>
        )}
      </div>

      {/* WhatsApp Reminder */}
      <div className="mt-6">
        <button
          type="button"
          onClick={onWhatsAppReminder}
          className="w-full border border-[#E8E2DA] rounded-lg px-3.5 py-2.5 min-h-11 text-[13px] font-semibold text-charcoal hover:border-[#D76B51] hover:text-[#D76B51] active:scale-[0.97] transition-transform"
        >
          📱 Send WhatsApp Reminder
        </button>
        <p className="text-[11.5px] text-[#8a8f94] mt-1.5">Last sent: never</p>
      </div>

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-[#E8E2DA] flex items-center justify-between flex-wrap gap-2">
        {dirty && (
          <span className="text-[12.5px] font-semibold text-[#D76B51]">● Unsaved changes</span>
        )}
        <span className="text-[11.5px] text-[#8a8f94] ml-auto">Changes save automatically</span>
      </div>
      </>)}
    </div>
  );
}
