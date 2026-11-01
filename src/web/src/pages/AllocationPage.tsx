import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/http";
import { getDeptCode } from "@/components/leaderboard/department";
import { formatINR } from "@/lib/pricing";
import { SearchInput } from "@/components/ui/SearchInput";
import { FilterPills } from "@/components/ui/FilterPills";
import {
  fetchAllocationRegistrations,
  fetchPreferences,
  savePreferences,
  convertAccommodation,
  generateAllocationPaymentLink,
} from "@/lib/staff-api";
import type {
  AllocationRegistration,
  PreferenceEntry,
} from "@/lib/staff-types";
import { DetailPanel } from "@/components/allocation/DetailPanel";
import { RoomTogetherModal } from "@/components/allocation/RoomTogetherModal";
import { MutualGroupsModal } from "@/components/allocation/MutualGroupsModal";
import { ConvertRoomModal } from "@/components/allocation/ConvertRoomModal";
import { CalendarIcon, GenderIcon, DatePills, PersonAvatar, TypePill, StatusPill, ordinal, incompatibleReason, sortCompatibleFirst } from "@/components/allocation/shared";

// ── Constants ──────────────────────────────────────────────────────────────

const SAVE_DEBOUNCE_MS = 5000;

type GenderFilter = "all" | "male" | "female";
type RoomTypeFilter = "all" | "shared_double" | "shared_triple" | "private";
type StatusFilter = "all" | "unmatched" | "no-prefs";

interface PrefIndex {
  outgoing: Map<number, PreferenceEntry[]>;
  incoming: Map<number, { fromId: number; fromName: string; fromBranch: string; isMutual: boolean }[]>;
  loaded: boolean;
}

interface MutualGroup {
  members: AllocationRegistration[];
  branch: string;
  accommodationType: string;
}

// Per-registration edit state — the source of truth for any touched registration,
// persisted across expand/collapse and filter switches so unsaved edits and the
// optimistic-lock token survive until they are written (or reloaded on conflict).
interface RegEntry {
  prefs: PreferenceEntry[];
  version: number | null;
  dirty: boolean;
  conflict: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function typeLabel(type: string): string {
  return type === "shared_double" ? "Shared Double" : "Shared Triple";
}

function genderLabel(gender: string): string {
  if (gender === "male") return "men";
  if (gender === "female") return "women";
  return gender;
}

function genderEmoji(gender: string): string {
  if (gender === "male") return "👨";
  if (gender === "female") return "👩";
  return "";
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to legacy fallback
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatStay(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn || !checkOut) return "";
  const cin = new Date(checkIn + "T00:00:00");
  const cout = new Date(checkOut + "T00:00:00");
  const m = MONTHS[cin.getMonth()];
  return `${m} ${cin.getDate()}–${cout.getDate()}`;
}

function regStatus(
  reg: AllocationRegistration,
  prefIdx: PrefIndex,
): { label: string; color: string; mutualCount: number; allMutual: boolean } {
  if (!prefIdx.loaded) {
    if (reg.preferenceCount === 0) return { label: "no prefs", color: "text-[#8a8f94]", mutualCount: 0, allMutual: false };
    if (reg.incomingPreferenceCount > 0 && reg.preferenceCount > 0)
      return { label: "has prefs", color: "text-[#8a8f94]", mutualCount: 0, allMutual: false };
    return { label: "unmatched", color: "text-[#D76B51]", mutualCount: 0, allMutual: false };
  }
  const out = prefIdx.outgoing.get(reg.id) ?? [];
  if (out.length === 0) return { label: "no prefs", color: "text-[#8a8f94]", mutualCount: 0, allMutual: false };
  const mc = out.filter((p) => p.isMutual).length;
  if (mc === 0) return { label: "unmatched", color: "text-[#D76B51]", mutualCount: 0, allMutual: false };
  if (mc === out.length) return { label: "✓ matched", color: "text-[#2d7a3a]", mutualCount: mc, allMutual: true };
  return { label: `${mc} mutual`, color: "text-[#1F6B73]", mutualCount: mc, allMutual: false };
}

function computeMutualGroups(
  registrations: AllocationRegistration[],
  prefIdx: PrefIndex,
): MutualGroup[] {
  if (!prefIdx.loaded) return [];
  const mutualAdj = new Map<number, Set<number>>();
  for (const [regId, prefs] of prefIdx.outgoing) {
    for (const p of prefs) {
      if (p.isMutual) {
        if (!mutualAdj.has(regId)) mutualAdj.set(regId, new Set());
        mutualAdj.get(regId)!.add(p.preferredRegistrationId);
      }
    }
  }
  const visited = new Set<number>();
  const groups: MutualGroup[] = [];
  const regMap = new Map(registrations.map((r) => [r.id, r]));
  for (const [nodeId] of mutualAdj) {
    if (visited.has(nodeId)) continue;
    const component: number[] = [];
    const queue = [nodeId];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      component.push(cur);
      const neighbors = mutualAdj.get(cur);
      if (neighbors) for (const n of neighbors) if (!visited.has(n)) queue.push(n);
    }
    if (component.length >= 2) {
      const members = component.map((id) => regMap.get(id)).filter(Boolean) as AllocationRegistration[];
      if (members.length >= 2) {
        groups.push({
          members,
          branch: members[0].branch,
          accommodationType: members[0].accommodationType,
        });
      }
    }
  }
  return groups.sort((a, b) => a.branch.localeCompare(b.branch));
}

// ── SummaryCards ───────────────────────────────────────────────────────────

function SummaryCards({
  total,
  collected,
  missing,
  mutual,
  onMutualClick,
}: {
  total: number;
  collected: number;
  missing: number;
  mutual: number;
  onMutualClick?: () => void;
}) {
  const cards = [
    { key: "total", label: "Total People", value: total, className: "text-charcoal" },
    { key: "collected", label: "Prefs Collected", value: collected, className: "text-success" },
    { key: "missing", label: "Missing", value: missing, className: "text-terracotta" },
    { key: "mutual", label: "Mutual Matches", value: mutual, className: "text-[#1F6B73]", onClick: onMutualClick },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-6">
      {cards.map((c) => (
        <div
          key={c.key}
          role={c.onClick ? "button" : undefined}
          tabIndex={c.onClick ? 0 : undefined}
          onClick={c.onClick}
          onKeyDown={c.onClick ? (e) => { if (e.key === "Enter") c.onClick?.(); } : undefined}
          className={`bg-white border border-border-warm rounded-[10px] p-3 text-center ${
            c.onClick ? "cursor-pointer hover:border-[#1F6B73] hover:shadow-sm transition-all" : ""
          }`}
        >
          <div className={`text-2xl font-bold leading-tight ${c.className}`}>{c.value}</div>
          <div className="text-[11px] text-muted mt-0.5 uppercase tracking-wide font-semibold">
            {c.label}
          </div>
          {c.onClick && (
            <div className="text-[10px] text-[#1F6B73] font-semibold mt-1">View groups →</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── BranchTabs ─────────────────────────────────────────────────────────────

function BranchTabs({
  branches,
  active,
  onSelect,
}: {
  branches: { key: string; count: number }[];
  active: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex gap-1 mt-4 border-b border-border-warm overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
    >
      {branches.map((b) => (
        <button
          key={b.key}
          type="button"
          role="tab"
          aria-selected={active === b.key}
          onClick={() => onSelect(b.key)}
          className={`shrink-0 px-4 py-2.5 min-h-11 text-sm font-semibold border-b-[3px] -mb-px transition-colors ${
            active === b.key
              ? "text-terracotta border-terracotta"
              : "text-muted border-transparent hover:text-charcoal"
          }`}
        >
          {b.key === "All" ? "All" : getDeptCode(b.key)} <span className="opacity-70 font-medium">({b.count})</span>
        </button>
      ))}
    </div>
  );
}

// ── AccordionCard ──────────────────────────────────────────────────────────

interface AccordionCardProps {
  reg: AllocationRegistration;
  displayCount: number;
  dirty: boolean;
  expanded: boolean;
  onToggle: () => void;
  prefs: PreferenceEntry[];
  prefsLoading: boolean;
  prefsError: string | null;
  lastAddedId: number | null;
  onRemove: (idx: number) => void;
  onMove: (idx: number, dir: -1 | 1) => void;
  onReorder: (from: number, to: number) => void;
  onAddClick: () => void;
  onAsk: () => void;
  askMessage: string | null;
  onConvertClick: () => void;
  onCopyPaymentLink: () => void;
  onWhatsAppPayment: () => void;
  linkActionPending: boolean;
}

function AccordionCard({
  reg,
  displayCount,
  dirty,
  expanded,
  onToggle,
  prefs,
  prefsLoading,
  prefsError,
  lastAddedId,
  onRemove,
  onMove,
  onReorder,
  onAddClick,
  onAsk,
  askMessage,
  onConvertClick,
  onCopyPaymentLink,
  onWhatsAppPayment,
  linkActionPending,
}: AccordionCardProps) {
  const count = expanded ? prefs.length : displayCount;
  const waDigits = reg.whatsapp.replace(/\D/g, "");
  const full = prefs.length >= 5;
  const deptCode = getDeptCode(reg.branch);
  const stay = formatStay(reg.checkIn, reg.checkOut);
  const needsAttention = count === 0;
  const complete = count >= 5;

  // Keep the detail content mounted through the collapse transition so both the
  // open and close animations play (unmount on transition end).
  const [contentMounted, setContentMounted] = useState(expanded);
  useEffect(() => {
    if (expanded) setContentMounted(true);
  }, [expanded]);

  // Drag-to-reorder state (desktop).
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  return (
    <div
      className={`border rounded-[10px] overflow-hidden ${
        needsAttention
          ? "bg-[#FFF8F5] border-border-warm border-l-[3px] border-l-terracotta"
          : "bg-white border-border-warm"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-3 text-left px-4 py-3.5 min-h-11 transition-colors ${
          expanded ? "bg-terracotta-light" : "bg-transparent"
        } ${complete ? "opacity-60" : ""}`}
      >
        <PersonAvatar id={reg.id} name={reg.fullName} photoUrl={reg.photoThumbUrl} size="md" />
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 min-w-0">
            <span className="block font-semibold text-[15px] text-charcoal truncate">
              {reg.fullName} {genderEmoji(reg.gender)}
            </span>
            {dirty && (
              <span className="text-[10px] font-bold uppercase tracking-wide text-terracotta bg-terracotta-light px-1.5 py-0.5 rounded-full flex-shrink-0">
                Unsaved
              </span>
            )}
          </span>
          <span className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <TypePill type={reg.accommodationType} />
            <StatusPill status={reg.status} />
            <span className="text-[12.5px] text-muted">
              {deptCode}
              {stay && ` · ${stay}`}
            </span>
          </span>
        </span>
        <span className="flex gap-1 flex-shrink-0">
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={`w-[7px] h-[7px] rounded-full transition-all duration-200 ${
                i < count ? "bg-terracotta" : "bg-[#E3DFD8]"
              }`}
            />
          ))}
        </span>
        <span
          className={`w-4 text-center text-xs text-muted transition-transform flex-shrink-0 ${
            expanded ? "rotate-90 text-terracotta" : ""
          }`}
        >
          ▶
        </span>
      </button>

      {/* Animated accordion body — max-height + opacity, ~200ms ease-out */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          expanded ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"
        }`}
        onTransitionEnd={() => {
          if (!expanded) setContentMounted(false);
        }}
      >
        {contentMounted && (
          <div className="px-4 pb-4 pt-1 border-t border-border-warm">
            <div className="flex gap-4 flex-wrap mt-3">
              <a
                href={`mailto:${reg.email}`}
                className="flex items-center gap-1.5 text-[13px] text-charcoal hover:text-terracotta"
              >
                <span aria-hidden="true">✉</span>
                {reg.email}
              </a>
              <a
                href={`https://wa.me/${waDigits}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[13px] text-charcoal hover:text-terracotta"
              >
                <span aria-hidden="true">☎</span>
                {reg.whatsapp}
              </a>
            </div>

            {/* Room switch + payment actions (staff-api R41/R42) */}
            {(reg.status !== "confirmed" || reg.accommodationType === "shared_triple") && (
              <div className="mt-3.5">
                {reg.status !== "confirmed" && reg.pendingAmount != null && (
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                    <span className="font-bold text-[14px] text-charcoal">
                      {formatINR(reg.pendingAmount)} due
                    </span>
                  </div>
                )}
                <div className="grid gap-2">
                  {reg.status !== "confirmed" && (
                    <>
                      <button
                        type="button"
                        onClick={onCopyPaymentLink}
                        disabled={linkActionPending}
                        className="w-full min-h-11 border border-border-warm rounded-lg px-3.5 text-[13px] font-semibold text-charcoal hover:border-terracotta hover:text-terracotta disabled:opacity-50"
                      >
                        Copy payment link
                      </button>
                      <button
                        type="button"
                        onClick={onWhatsAppPayment}
                        disabled={linkActionPending}
                        className="w-full min-h-11 bg-[#25D366] text-white font-semibold text-[13px] rounded-lg hover:bg-[#20BD5A] disabled:opacity-50"
                      >
                        WhatsApp
                      </button>
                    </>
                  )}
                  {reg.accommodationType === "shared_triple" && (
                    <button
                      type="button"
                      onClick={onConvertClick}
                      className="w-full min-h-11 border border-[#4a7380] bg-[#edf6f7] text-[#255b67] font-semibold text-[13px] rounded-lg hover:opacity-90"
                    >
                      Convert to 2-Share
                    </button>
                  )}
                </div>
              </div>
            )}

            {prefsLoading ? (
              <p className="text-sm text-muted mt-4">Loading preferences…</p>
            ) : prefsError ? (
              <p className="text-sm text-terracotta mt-4">{prefsError}</p>
            ) : (
              <>
                {prefs.length === 0 && (
                  <p className="mt-3.5 text-[13px] text-muted bg-[#FBF8F3] border border-dashed border-border-warm rounded-md px-3 py-2">
                    No preferences yet. Ask them to pick up to 5 people they&apos;d
                    like to share with — ranked by preference (1 = first choice). More
                    picks means easier matching.
                  </p>
                )}

                <ol className="flex flex-col gap-2 mt-3.5">
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
                        style={
                          p.preferredRegistrationId === lastAddedId
                            ? { animation: "prefIn 150ms ease-out" }
                            : undefined
                        }
                        className={`flex items-center gap-2.5 border rounded-lg px-3 py-2.5 flex-wrap bg-white transition-colors ${
                          isDropTarget
                            ? "border-terracotta border-t-2"
                            : "border-border-warm"
                        } ${dragIndex === i ? "opacity-50" : ""}`}
                      >
                        <span
                          aria-hidden="true"
                          title="Drag to reorder"
                          className="hidden sm:flex cursor-grab active:cursor-grabbing text-muted hover:text-terracotta select-none text-[15px] leading-none flex-shrink-0"
                        >
                          ⠿
                        </span>
                        <span className="w-[22px] h-[22px] rounded-full bg-soft-aqua text-charcoal text-xs font-bold flex items-center justify-center flex-shrink-0">
                          {i + 1}
                        </span>
                        <PersonAvatar id={p.preferredRegistrationId} name={p.fullName} size="sm" />
                        <span className="flex-1 text-sm font-medium text-charcoal min-w-0">
                          {p.fullName}
                          <span className="text-muted font-normal text-[13px] ml-1">
                            ({p.branch})
                          </span>
                        </span>
                        {p.isMutual && (
                          <span
                            className="text-xs bg-soft-aqua px-1.5 py-0.5 rounded-full"
                            title="Mutual preference"
                          >
                            🔄 Mutual
                          </span>
                        )}
                        <span className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => onMove(i, -1)}
                            disabled={i === 0}
                            aria-label="Move up"
                            className="min-w-9 min-h-9 max-sm:min-w-11 max-sm:min-h-11 flex items-center justify-center text-muted disabled:opacity-30 hover:text-terracotta active:scale-[0.9] transition-transform"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            onClick={() => onMove(i, 1)}
                            disabled={i === prefs.length - 1}
                            aria-label="Move down"
                            className="min-w-9 min-h-9 max-sm:min-w-11 max-sm:min-h-11 flex items-center justify-center text-muted disabled:opacity-30 hover:text-terracotta active:scale-[0.9] transition-transform"
                          >
                            ▼
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemove(i)}
                            aria-label="Remove"
                            className="min-w-9 min-h-9 max-sm:min-w-11 max-sm:min-h-11 flex items-center justify-center text-muted hover:text-terracotta text-base active:scale-[0.9] transition-transform"
                          >
                            ×
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ol>

                {!full && (
                  <button
                    type="button"
                    onClick={onAddClick}
                    className="w-full flex items-center gap-2.5 mt-2 border border-dashed border-terracotta rounded-lg px-3 py-2.5 text-[13px] font-semibold text-terracotta hover:bg-terracotta-light active:scale-[0.99] transition-transform"
                  >
                    <span className="w-[22px] h-[22px] rounded-full bg-[#FFF0EC] text-terracotta text-sm font-bold flex items-center justify-center flex-shrink-0">
                      +
                    </span>
                    Add preference #{prefs.length + 1}
                  </button>
                )}

                <p className="text-[12px] text-muted mt-2.5 italic">
                  Picked by preference — 1 = first choice. More picks from
                  everyone means better matches.
                </p>

                <div className="flex items-center gap-2.5 flex-wrap mt-3.5 max-sm:flex-col max-sm:items-stretch">
                  <button
                    type="button"
                    onClick={onAsk}
                    className="flex items-center justify-center gap-1.5 bg-[#25D366] text-white font-semibold text-[13px] rounded-lg px-3.5 py-2 min-h-11 hover:bg-[#20BD5A] max-sm:w-full active:scale-[0.97] transition-transform"
                  >
                    💬 WhatsApp Reminder
                  </button>
                  {askMessage && (
                    <span className="text-[13px] font-semibold text-success">Opening WhatsApp ✓</span>
                  )}
                </div>

                {askMessage && (
                  <div className="mt-2.5 px-3 py-2.5 bg-[#FBF8F3] border border-border-warm rounded-lg text-[12.5px] leading-relaxed whitespace-pre-wrap text-charcoal">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1.5">
                      Message (also copied to clipboard)
                    </div>
                    {askMessage}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── PrivateCard ────────────────────────────────────────────────────────────
// Private accommodation: read-only, not expandable — no preferences to collect.

function PrivateCard({
  reg,
  onCopyPaymentLink,
  onWhatsAppPayment,
  linkActionPending,
}: {
  reg: AllocationRegistration;
  onCopyPaymentLink: () => void;
  onWhatsAppPayment: () => void;
  linkActionPending: boolean;
}) {
  const deptCode = getDeptCode(reg.branch);
  const stay = formatStay(reg.checkIn, reg.checkOut);
  // Private registrations are list-visible (R27.1) and still qualify for payment-
  // link actions when non-confirmed (R42 — "any registration in the allocation
  // list ... not only converted ones"); they never get the Convert action.
  const showPayment = reg.status !== "confirmed";

  return (
    <div className="bg-white border border-border-warm rounded-[10px] overflow-hidden">
      <div className="w-full flex items-center gap-3 px-4 py-3.5 min-h-11">
        <PersonAvatar id={reg.id} name={reg.fullName} photoUrl={reg.photoThumbUrl} size="md" />
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-[15px] text-charcoal truncate">
            {reg.fullName} {genderEmoji(reg.gender)}
          </span>
          <span className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <TypePill type="private" />
            <StatusPill status={reg.status} />
            <span className="text-[12.5px] text-muted">
              {deptCode}
              {stay && ` · ${stay}`}
            </span>
          </span>
        </span>
      </div>
      {showPayment && (
        <div className="px-4 pb-3.5">
          {reg.pendingAmount != null && (
            <div className="text-[13px] font-bold text-charcoal mb-2">
              {formatINR(reg.pendingAmount)} due
            </div>
          )}
          <div className="grid gap-2">
            <button
              type="button"
              onClick={onCopyPaymentLink}
              disabled={linkActionPending}
              className="w-full min-h-11 border border-border-warm rounded-lg px-3.5 text-[13px] font-semibold text-charcoal hover:border-terracotta hover:text-terracotta disabled:opacity-50"
            >
              Copy payment link
            </button>
            <button
              type="button"
              onClick={onWhatsAppPayment}
              disabled={linkActionPending}
              className="w-full min-h-11 bg-[#25D366] text-white font-semibold text-[13px] rounded-lg hover:bg-[#20BD5A] disabled:opacity-50"
            >
              WhatsApp
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AddRoommateModal ───────────────────────────────────────────────────────

function ModalCandidateRow({
  candidate,
  crossBranch,
  disabledReason,
  onSelect,
}: {
  candidate: AllocationRegistration;
  crossBranch: boolean;
  disabledReason?: string | null;
  onSelect: () => void;
}) {
  const disabled = !!disabledReason;
  return (
    <div
      className={`flex items-center gap-3 border rounded-lg p-2.5 ${
        disabled
          ? "opacity-45 border-border-warm"
          : crossBranch
            ? "bg-terracotta-light border-[#EFD9CF]"
            : "border-border-warm"
      }`}
    >
      <PersonAvatar id={candidate.id} name={candidate.fullName} photoUrl={candidate.photoThumbUrl} size="lg" />
      <div className="flex-1 min-w-0">
        <div className={`font-semibold text-sm truncate ${disabled ? "text-muted" : "text-charcoal"}`}>{candidate.fullName}</div>
        {disabled ? (
          <div className="text-[12.5px] text-muted mt-0.5">{disabledReason}</div>
        ) : crossBranch ? (
          <span className="inline-block bg-terracotta text-white text-[11px] font-bold px-2 py-0.5 rounded-full mt-1">
            {candidate.branch}
          </span>
        ) : (
          <div className="text-[12.5px] text-muted mt-0.5">{candidate.branch}</div>
        )}
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={onSelect}
          className="bg-charcoal text-white font-semibold text-[12.5px] rounded-lg px-3.5 min-h-11 flex-shrink-0 hover:bg-[#101820] active:scale-[0.97] transition-transform"
        >
          Select
        </button>
      )}
    </div>
  );
}

function AddRoommateModal({
  open,
  onClose,
  person,
  sameBranch,
  otherBranch,
  query,
  onQueryChange,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  person: AllocationRegistration | null;
  sameBranch: AllocationRegistration[];
  otherBranch: AllocationRegistration[];
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (candidate: AllocationRegistration) => void;
}) {
  // Enter/exit animation: mount while open OR animating out; `show` drives the
  // transition and is flipped one frame after mount so the enter transition runs.
  const [mounted, setMounted] = useState(open);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setShow(true));
      return () => cancelAnimationFrame(id);
    }
    setShow(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!mounted || !person) return null;
  const empty = sameBranch.length === 0 && otherBranch.length === 0;

  return (
    <div
      className={`fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center transition-opacity duration-200 ${
        show ? "opacity-100" : "opacity-0"
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onTransitionEnd={() => {
        if (!open) setMounted(false);
      }}
    >
      <div
        className={`bg-white w-full sm:max-w-[480px] sm:max-h-[80vh] h-[88vh] sm:h-auto rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden transition-transform duration-[250ms] ease-out ${
          show ? "translate-y-0" : "translate-y-full sm:translate-y-4"
        }`}
      >
        <div className="flex items-center justify-between px-4.5 py-4 border-b border-border-warm flex-shrink-0">
          <h3 className="font-heading text-lg font-bold text-charcoal">Add Roommate</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-2xl text-muted hover:text-terracotta leading-none w-11 h-11 flex items-center justify-center flex-shrink-0"
          >
            ×
          </button>
        </div>
        <div className="px-4.5 pt-3.5 flex-shrink-0">
          <p className="text-[12.5px] text-muted mb-2">
            Roommates must be {genderLabel(person.gender)} with{" "}
            {typeLabel(person.accommodationType)}. Others are shown greyed out.
          </p>
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by name or branch..."
            autoFocus
            className="w-full border border-border-warm rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-terracotta"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-4.5 py-3 flex flex-col gap-2 mt-1">
          {empty ? (
            <p className="text-sm text-muted py-3">
              No matches found.
            </p>
          ) : (
            <>
              {sameBranch.length > 0 && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-muted pt-1">
                    Your Branch — {person.branch}
                  </div>
                  {sameBranch.map((c) => (
                    <ModalCandidateRow
                      key={c.id}
                      candidate={c}
                      crossBranch={false}
                      disabledReason={incompatibleReason(c, person)}
                      onSelect={() => onSelect(c)}
                    />
                  ))}
                </>
              )}
              {otherBranch.length > 0 && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-muted pt-2 border-t border-border-warm mt-1">
                    Other Branches
                  </div>
                  {otherBranch.map((c) => (
                    <ModalCandidateRow
                      key={c.id}
                      candidate={c}
                      crossBranch={true}
                      disabledReason={incompatibleReason(c, person)}
                      onSelect={() => onSelect(c)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ReportModal ────────────────────────────────────────────────────────────

interface BranchReportStat {
  branch: string;
  total: number;
  collected: number;
  missing: string[];
  pct: number;
}

function ReportModal({
  open,
  onClose,
  branchStats,
  totalPeople,
  prefsCollected,
  mutualMatches,
}: {
  open: boolean;
  onClose: () => void;
  branchStats: BranchReportStat[];
  totalPeople: number;
  prefsCollected: number;
  mutualMatches: number;
}) {
  if (!open) return null;
  const pct = totalPeople ? Math.round((prefsCollected / totalPeople) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl max-w-[560px] w-full max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center px-5 py-4 border-b border-border-warm flex-shrink-0">
          <h2 className="font-heading text-lg font-bold text-charcoal flex-1">
            Preference Collection Report
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-2xl text-muted hover:text-terracotta leading-none w-9 h-9 flex items-center justify-center flex-shrink-0"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted pb-2">
            Branch-wise completion
          </div>
          {branchStats.map((b) => (
            <div key={b.branch} className="py-2.5 border-b border-[#F0ECE6] last:border-b-0">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[15px] text-charcoal">{b.branch}</span>
                <span className="text-[13px] text-muted">
                  {b.collected} / {b.total}
                </span>
              </div>
              <div className="h-1 bg-[#E8E2DA] rounded-full mt-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full ${b.pct >= 80 ? "bg-[#2d7a3a]" : "bg-terracotta"}`}
                  style={{ width: `${b.pct}%` }}
                />
              </div>
              {b.missing.length > 0 && (
                <div className="text-[12.5px] text-muted mt-1.5">
                  Missing: <span className="text-terracotta">{b.missing.join(", ")}</span>
                </div>
              )}
            </div>
          ))}

          <div className="text-[11px] font-bold uppercase tracking-wide text-muted pt-4 pb-1.5">
            Summary
          </div>
          <div className="text-[15px] text-charcoal py-1">
            <strong>
              {prefsCollected} / {totalPeople}
            </strong>{" "}
            have preferences ({pct}%) · <strong>{mutualMatches}</strong> mutual matches
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AllocationPage ─────────────────────────────────────────────────────────

export default function AllocationPage() {
  useDocumentTitle("Allocation");
  const toast = useToast();

  const [registrations, setRegistrations] = useState<AllocationRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeBranch, setActiveBranch] = useState<string>("All");
  const [activeGender, setActiveGender] = useState<GenderFilter>("all");
  const [activeDate, setActiveDate] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [roomTypeFilter, setRoomTypeFilter] = useState<RoomTypeFilter>("all");

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [askMessage, setAskMessage] = useState<string | null>(null);
  const [lastAddedId, setLastAddedId] = useState<number | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [modalQuery, setModalQuery] = useState("");

  const [showReportModal, setShowReportModal] = useState(false);
  const [showMutualGroups, setShowMutualGroups] = useState(false);
  const [showRoomTogether, setShowRoomTogether] = useState(false);
  const [roomTogetherConfirming, setRoomTogetherConfirming] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Room switch + payment-link actions (staff-api R41/R42) ───────────────────
  const [convertTarget, setConvertTarget] = useState<AllocationRegistration | null>(null);
  const [converting, setConverting] = useState(false);
  const [linkActionId, setLinkActionId] = useState<number | null>(null);

  const isMobile = useIsMobile();

  const [prefIndex, setPrefIndex] = useState<PrefIndex>({
    outgoing: new Map(),
    incoming: new Map(),
    loaded: false,
  });

  // Auto-save state ──────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<Map<number, RegEntry>>(new Map());
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  const savingRef = useRef(false);
  const editEpochRef = useRef(0);
  const saveTimer = useRef<number | undefined>(undefined);
  // flush and scheduleSave reference each other (debounce re-arm); the ref breaks
  // the definition-order cycle so neither is used before it is declared.
  const flushRef = useRef<() => void>(() => {});
  const seededRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    seededRef.current = false;
    try {
      const res = await fetchAllocationRegistrations();
      setRegistrations(res.registrations);
    } catch {
      setLoadError("Failed to load allocation data.");
      toast.error("Failed to load allocation data.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Build prefIndex from inline preferences. This is pure derived data (read-only)
  // and safe to rebuild whenever registrations changes.
  useEffect(() => {
    if (loading || registrations.length === 0) return;
    const outgoing = new Map<number, PreferenceEntry[]>();
    const incoming = new Map<number, { fromId: number; fromName: string; fromBranch: string; isMutual: boolean }[]>();

    for (const r of registrations) {
      if (r.preferences.length > 0) {
        outgoing.set(r.id, r.preferences);
        for (const p of r.preferences) {
          const list = incoming.get(p.preferredRegistrationId) ?? [];
          list.push({ fromId: r.id, fromName: r.fullName, fromBranch: r.branch, isMutual: p.isMutual });
          incoming.set(p.preferredRegistrationId, list);
        }
      }
    }
    setPrefIndex({ outgoing, incoming, loaded: true });
  }, [loading, registrations]);

  // Seed entries from inline preferences on the initial load only. Subsequent
  // registrations changes (e.g. preferenceCount patches after saves) must not
  // overwrite entries that may have unsaved edits. Reset by load() on full reload.
  useEffect(() => {
    if (loading || registrations.length === 0 || seededRef.current) return;
    seededRef.current = true;
    const initialEntries = new Map<number, RegEntry>();
    for (const r of registrations) {
      if (r.preferences.length > 0) {
        initialEntries.set(r.id, {
          prefs: r.preferences,
          version: r.prefsVersion,
          dirty: false,
          conflict: false,
        });
      }
    }
    setEntries(initialEntries);
  }, [loading, registrations]);

  const branches = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of registrations) counts.set(r.branch, (counts.get(r.branch) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [registrations]);

  const branchTabs = useMemo(
    () => [{ key: "All", count: registrations.length }, ...branches],
    [branches, registrations.length],
  );

  const branchPeople = useMemo(
    () =>
      activeBranch === "All"
        ? registrations
        : registrations.filter((r) => r.branch === activeBranch),
    [registrations, activeBranch],
  );
  const branchGenderPeople = useMemo(
    () => {
      let list = branchPeople.filter((r) => activeGender === "all" || r.gender === activeGender);
      if (activeDate !== "all") {
        list = list.filter((r) => r.checkIn === activeDate);
      }
      return list;
    },
    [branchPeople, activeGender, activeDate],
  );

  const checkInDates = useMemo(() => {
    const dates = new Set<string>();
    for (const r of registrations) {
      if (r.checkIn) dates.add(r.checkIn);
    }
    return Array.from(dates).sort();
  }, [registrations]);

  const sharedInScope = branchGenderPeople.filter((r) => r.accommodationType !== "private");
  const doubleCount = sharedInScope.filter((r) => r.accommodationType === "shared_double").length;
  const tripleCount = sharedInScope.filter((r) => r.accommodationType === "shared_triple").length;
  const unmatchedInScope = sharedInScope.filter((r) => r.preferenceCount === 0).length;

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let base = roomTypeFilter === "all"
      ? branchGenderPeople.filter((r) => r.accommodationType !== "private")
      : branchGenderPeople.filter((r) => r.accommodationType === roomTypeFilter);
    if (q) base = base.filter((r) => r.fullName.toLowerCase().includes(q));
    if (statusFilter === "no-prefs") base = base.filter((r) => r.preferenceCount === 0);
    else if (statusFilter === "unmatched") {
      base = base.filter((r) => {
        if (r.preferenceCount === 0) return false;
        const s = regStatus(r, prefIndex);
        return s.mutualCount === 0;
      });
    }
    return base;
  }, [branchGenderPeople, searchQuery, roomTypeFilter, statusFilter, prefIndex]);

  const mutualGroups = useMemo(
    () => computeMutualGroups(registrations, prefIndex),
    [registrations, prefIndex],
  );

  const selectedReg = useMemo(
    () => (expandedId ? registrations.find((r) => r.id === expandedId) ?? null : null),
    [registrations, expandedId],
  );

  const selectedIncoming = useMemo(
    () => (expandedId ? prefIndex.incoming.get(expandedId) ?? [] : []),
    [expandedId, prefIndex],
  );

  const totalPeople = registrations.length;

  // Global summary — never changes with filters (task: summary cards).
  // Private accommodation doesn't need preferences, so it's excluded from
  // "Prefs Collected" / "Missing" / the report — matching only applies to shared rooms.
  const sharedRegistrations = useMemo(
    () => registrations.filter((r) => r.accommodationType !== "private"),
    [registrations],
  );
  const prefsCollectedCount = useMemo(
    () => sharedRegistrations.filter((r) => r.preferenceCount > 0).length,
    [sharedRegistrations],
  );
  const missingCount = useMemo(
    () => sharedRegistrations.filter((r) => r.preferenceCount === 0).length,
    [sharedRegistrations],
  );
  const mutualMatchesCount = useMemo(
    () =>
      sharedRegistrations.filter((r) => r.incomingPreferenceCount > 0 && r.preferenceCount > 0)
        .length,
    [sharedRegistrations],
  );

  const unmatchedRegs = useMemo(
    () => {
      if (!prefIndex.loaded) return [];
      const inGroup = new Set(mutualGroups.flatMap((g) => g.members.map((m) => m.id)));
      return sharedRegistrations.filter((r) => !inGroup.has(r.id));
    },
    [sharedRegistrations, mutualGroups, prefIndex.loaded],
  );

  const branchReportStats = useMemo<BranchReportStat[]>(
    () =>
      branches.map((b) => {
        const people = sharedRegistrations.filter((r) => r.branch === b.key);
        const collected = people.filter((r) => r.preferenceCount > 0).length;
        const missing = people.filter((r) => r.preferenceCount === 0).map((r) => r.fullName);
        const pct = people.length ? Math.round((collected / people.length) * 100) : 0;
        return { branch: b.key, total: people.length, collected, missing, pct };
      }),
    [branches, sharedRegistrations],
  );

  // Displayed preference count — optimistic local edits win over the list value.
  const displayCountFor = useCallback(
    (reg: AllocationRegistration): number => {
      const entry = entries.get(reg.id);
      return entry ? entry.prefs.length : reg.preferenceCount;
    },
    [entries],
  );

  // Entry mutation helpers ────────────────────────────────────────────────────
  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      flushRef.current();
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const flush = useCallback(async () => {
    if (saveTimer.current !== undefined) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
    }
    if (savingRef.current) return;

    const snapshot = Array.from(entriesRef.current.entries()).filter(
      ([, e]) => e.dirty && !e.conflict,
    );
    if (snapshot.length === 0) return;

    savingRef.current = true;
    setSaving(true);
    const startEpoch = editEpochRef.current;

    const results = await Promise.all(
      snapshot.map(async ([id, e]) => {
        try {
          const payload = e.prefs.map((p, i) => ({
            preferredRegistrationId: p.preferredRegistrationId,
            preferenceOrder: i + 1,
          }));
          const res = await savePreferences(id, payload, e.version);
          return { id, ok: true as const, res, sentPrefs: e.prefs };
        } catch (err) {
          return { id, ok: false as const, err };
        }
      }),
    );

    const conflictIds: number[] = [];
    let otherError = false;

    setEntries((prev) => {
      const next = new Map(prev);
      for (const r of results) {
        const cur = next.get(r.id);
        if (!cur) continue;
        if (r.ok) {
          // If the user edited this registration again during the save, keep the
          // local edits dirty; otherwise adopt the server's canonical prefs.
          const editedDuringSave = cur.prefs !== r.sentPrefs;
          next.set(r.id, {
            prefs: editedDuringSave ? cur.prefs : r.res.preferences,
            version: r.res.version,
            dirty: editedDuringSave,
            conflict: false,
          });
        } else if (r.err instanceof ApiError && r.err.status === 409) {
          conflictIds.push(r.id);
          next.set(r.id, { ...cur, conflict: true });
        } else {
          otherError = true;
          next.set(r.id, { ...cur, dirty: true });
        }
      }
      return next;
    });

    // Patch the list's inline preferences for successful writes so the prefIndex
    // rebuild effect picks up the saved data (no full reload — avoids skeleton
    // flash / scroll reset).
    setRegistrations((prev) =>
      prev.map((reg) => {
        const r = results.find((x) => x.id === reg.id && x.ok);
        return r && r.ok
          ? { ...reg, preferenceCount: r.res.preferences.length, preferences: r.res.preferences, prefsVersion: r.res.version }
          : reg;
      }),
    );

    savingRef.current = false;
    setSaving(false);

    const anyOk = results.some((r) => r.ok);
    if (otherError) toast.error("Failed to save. Will retry.");
    if (anyOk && conflictIds.length === 0 && !otherError) {
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 3000);
    }
    // Re-arm the debounce if edits landed during the save or a retryable error occurred.
    if (otherError || editEpochRef.current !== startEpoch) scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleSave]);

  useEffect(() => {
    flushRef.current = () => {
      void flush();
    };
  }, [flush]);

  const markDirty = useCallback(
    (id: number, nextPrefs: PreferenceEntry[]) => {
      editEpochRef.current += 1;
      setEntries((prev) => {
        const next = new Map(prev);
        const cur = next.get(id);
        if (!cur) return prev;
        next.set(id, { ...cur, prefs: nextPrefs, dirty: true, conflict: false });
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  // Flush any pending debounced save on unmount so edits aren't silently lost.
  useEffect(() => {
    return () => {
      if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
    };
  }, []);

  function collapse() {
    setExpandedId(null);
    setPrefsError(null);
    setAskMessage(null);
    setShowModal(false);
  }

  function selectBranch(key: string) {
    setActiveBranch(key);
    collapse();
  }
  function selectGender(key: GenderFilter) {
    setActiveGender(key);
    collapse();
  }

  async function handleToggle(id: number) {
    setShowModal(false);
    if (expandedId === id) {
      collapse();
      return;
    }
    setExpandedId(id);
    setPrefsError(null);
    setAskMessage(null);
    setLastAddedId(null);

    const existing = entriesRef.current.get(id);
    // Preserve unsaved local edits; only fetch when we have no dirty state to lose.
    if (existing && existing.dirty) return;

    setPrefsLoading(true);
    try {
      const res = await fetchPreferences(id);
      setEntries((prev) => {
        const next = new Map(prev);
        next.set(id, {
          prefs: res.preferences,
          version: res.version,
          dirty: false,
          conflict: false,
        });
        return next;
      });
    } catch {
      setPrefsError("Failed to load preferences.");
    } finally {
      setPrefsLoading(false);
    }
  }

  function currentPrefs(id: number): PreferenceEntry[] {
    return entries.get(id)?.prefs ?? [];
  }

  function handleRemove(idx: number) {
    if (expandedId === null) return;
    const prefs = currentPrefs(expandedId);
    markDirty(
      expandedId,
      prefs.filter((_, i) => i !== idx),
    );
  }

  function handleMove(idx: number, dir: -1 | 1) {
    if (expandedId === null) return;
    const prefs = currentPrefs(expandedId);
    const target = idx + dir;
    if (target < 0 || target >= prefs.length) return;
    const nextPrefs = [...prefs];
    [nextPrefs[idx], nextPrefs[target]] = [nextPrefs[target], nextPrefs[idx]];
    markDirty(expandedId, nextPrefs);
  }

  function handleReorder(from: number, to: number) {
    if (expandedId === null) return;
    const prefs = currentPrefs(expandedId);
    if (from < 0 || from >= prefs.length || to < 0 || to >= prefs.length) return;
    const nextPrefs = [...prefs];
    const [moved] = nextPrefs.splice(from, 1);
    nextPrefs.splice(to, 0, moved);
    markDirty(expandedId, nextPrefs);
  }

  function handleAddCandidate(candidate: AllocationRegistration) {
    if (expandedId === null) return;
    const prefs = currentPrefs(expandedId);
    if (prefs.length >= 5) {
      setShowModal(false);
      return;
    }
    if (prefs.some((p) => p.preferredRegistrationId === candidate.id)) {
      setShowModal(false);
      return;
    }
    markDirty(expandedId, [
      ...prefs,
      {
        preferredRegistrationId: candidate.id,
        regCode: candidate.regCode,
        fullName: candidate.fullName,
        branch: candidate.branch,
        gender: candidate.gender,
        preferenceOrder: prefs.length + 1,
        isMutual: false,
      },
    ]);
    setLastAddedId(candidate.id);
    setShowModal(false);
  }

  async function reloadRegistration(id: number) {
    setPrefsLoading(expandedId === id);
    try {
      const res = await fetchPreferences(id);
      setEntries((prev) => {
        const next = new Map(prev);
        next.set(id, {
          prefs: res.preferences,
          version: res.version,
          dirty: false,
          conflict: false,
        });
        return next;
      });
      setExpandedId(id);
    } catch {
      toast.error("Failed to reload preferences.");
    } finally {
      setPrefsLoading(false);
    }
  }

  function eligibleAskList(reg: AllocationRegistration): AllocationRegistration[] {
    const excludeIds = new Set(currentPrefs(reg.id).map((p) => p.preferredRegistrationId));
    return registrations
      .filter(
        (r) =>
          r.id !== reg.id &&
          r.branch === reg.branch &&
          r.accommodationType === reg.accommodationType &&
          r.gender === reg.gender &&
          !excludeIds.has(r.id),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  function buildAskMessage(reg: AllocationRegistration): string {
    const prefs = currentPrefs(reg.id);
    const eligible = eligibleAskList(reg);
    const firstName = reg.fullName.split(" ")[0];
    const roomType = reg.accommodationType === "shared_double" ? "a room shared between 2" : "a room shared between 3";

    let msg = `Hi ${firstName}! We're sorting out rooms for Smriti 2026. You'll be in ${roomType}.`;

    if (prefs.length > 0) {
      const picked = prefs
        .map((p, i) => `${i + 1}. ${p.fullName} (${getDeptCode(p.branch)})`)
        .join("\n");
      msg += `\n\nYour current picks:\n${picked}`;
    }

    if (eligible.length > 0) {
      const list = eligible.map((r) => `• ${r.fullName} (${getDeptCode(r.branch)})`).join("\n");
      msg += `\n\n${prefs.length > 0 ? "Want to change or add more? Here's who else is available" : "Who would you like to share with? Pick up to 5 from this list"}:\n${list}`;
    }

    msg += `\n\nJust reply with the names in order of preference!`;
    return msg;
  }

  async function handleAsk(reg: AllocationRegistration) {
    const msg = buildAskMessage(reg);
    // Copy as a fallback, then open WhatsApp pre-filled with the message.
    await copyToClipboard(msg);
    const waDigits = reg.whatsapp.replace(/\D/g, "");
    window.open(
      `https://wa.me/${waDigits}?text=${encodeURIComponent(msg)}`,
      "_blank",
      "noopener,noreferrer",
    );
    setAskMessage(msg);
  }

  // Room switch (R41) ───────────────────────────────────────────────────────

  function openConvertConfirm(reg: AllocationRegistration) {
    setConvertTarget(reg);
  }

  function handleConvertError(err: unknown, target: AllocationRegistration) {
    setConvertTarget(null);
    // R41.5 (pending-verification block): nothing about the registration changed
    // server-side — inform only, no refetch (flow-delta.md failure paths).
    if (err instanceof ApiError && err.status === 409 && err.code.includes("awaiting verification")) {
      toast.error(`A payment is awaiting verification for ${target.fullName} — verify or reject it first.`);
      return;
    }
    // R41.5.1 (capacity block): the registration is unchanged, so a refetch
    // would be unnecessary and would misdescribe the failure as a concurrent edit.
    if (err instanceof ApiError && err.status === 409 && err.code.includes("rooms at capacity")) {
      toast.error("Shared-double rooms are at capacity. Add room inventory before converting.");
      return;
    }
    // R41.4 (stale token) / R41.3 (already converted, 422) both mean our local
    // list is out of date — refresh.
    toast.error("This registration changed elsewhere — refreshing.");
    void load();
  }

  async function handleConvertConfirm() {
    if (!convertTarget) return;
    const target = convertTarget;
    setConverting(true);
    try {
      const result = await convertAccommodation(target.id, target.updatedAt);
      setRegistrations((prev) =>
        prev.map((r) =>
          r.id === target.id
            ? {
                ...r,
                accommodationType: result.accommodationType,
                status: result.status,
                pendingAmount: result.pendingAmount,
                updatedAt: result.updatedAt,
              }
            : r,
        ),
      );
      toast.success(`Converted — ${target.fullName} now owes ${formatINR(result.pendingAmount ?? 0)}`);
      setConvertTarget(null);
    } catch (err) {
      handleConvertError(err, target);
    } finally {
      setConverting(false);
    }
  }

  // Payment link generation (R42) — shared by "Copy payment link" and "WhatsApp" ─

  function handlePaymentLinkError(err: unknown) {
    if (err instanceof ApiError && err.status === 409) {
      toast.error("This registration is already confirmed.");
      void load();
      return;
    }
    toast.error("Failed to generate payment link. Please try again.");
  }

  async function handleCopyPaymentLink(reg: AllocationRegistration) {
    setLinkActionId(reg.id);
    try {
      const { link } = await generateAllocationPaymentLink(reg.id);
      await copyToClipboard(link);
      toast.success("Payment link copied");
    } catch (err) {
      handlePaymentLinkError(err);
    } finally {
      setLinkActionId(null);
    }
  }

  function buildPaymentMessage(reg: AllocationRegistration, link: string): string {
    const firstName = reg.fullName.split(" ")[0];
    const amount = formatINR(reg.pendingAmount ?? 0);
    return `Hi ${firstName}! You have an outstanding balance of ${amount} for your Smriti 2026 room. Please complete your payment here:\n${link}\n\nThis link is valid for 24 hours.`;
  }

  async function handleWhatsAppPayment(reg: AllocationRegistration) {
    setLinkActionId(reg.id);
    try {
      const { link } = await generateAllocationPaymentLink(reg.id);
      const msg = buildPaymentMessage(reg, link);
      const waDigits = reg.whatsapp.replace(/\D/g, "");
      window.open(
        `https://wa.me/${waDigits}?text=${encodeURIComponent(msg)}`,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (err) {
      handlePaymentLinkError(err);
    } finally {
      setLinkActionId(null);
    }
  }

  // Room Together confirm handler — adds mutual prefs for all pairs in the group
  async function handleRoomTogetherConfirm(groupIds: number[]) {
    if (groupIds.length < 2) return;
    setRoomTogetherConfirming(true);
    try {
      // Re-fetch current prefs for all participants to get fresh version tokens
      const freshData = await Promise.all(
        groupIds.map(async (id) => {
          try {
            const res = await fetchPreferences(id);
            return { id, prefs: res.preferences, version: res.version };
          } catch {
            return null;
          }
        }),
      );

      const regMap = new Map(registrations.map((r) => [r.id, r]));
      const failed: string[] = [];
      const fetchFailed: string[] = [];

      for (const data of freshData) {
        if (!data) {
          const idx = freshData.indexOf(data);
          const failedReg = regMap.get(groupIds[idx]);
          if (failedReg) fetchFailed.push(failedReg.fullName);
          continue;
        }
        const reg = regMap.get(data.id);
        if (!reg) continue;

        // Dirty-guard: if this entry already has unsaved local edits, merge into
        // those edits (preserving the user's work) instead of overwriting from server.
        const existingEntry = entriesRef.current.get(data.id);
        const basePrefs = existingEntry?.dirty ? existingEntry.prefs : data.prefs;
        const baseVersion = existingEntry?.dirty ? existingEntry.version : data.version;

        const existingPrefIds = new Set(basePrefs.map((p) => p.preferredRegistrationId));
        const newPrefs = [...basePrefs];
        for (const otherId of groupIds) {
          if (otherId === data.id || existingPrefIds.has(otherId)) continue;
          const other = regMap.get(otherId);
          if (!other) continue;
          if (newPrefs.length >= 5) {
            failed.push(`${reg.fullName}: preference slots full`);
            break;
          }
          newPrefs.push({
            preferredRegistrationId: otherId,
            regCode: other.regCode,
            fullName: other.fullName,
            branch: other.branch,
            gender: other.gender,
            preferenceOrder: newPrefs.length + 1,
            isMutual: false,
          });
        }
        setEntries((prev) => {
          const next = new Map(prev);
          next.set(data.id, { prefs: newPrefs, version: baseVersion, dirty: true, conflict: false });
          return next;
        });
        editEpochRef.current += 1;
      }
      if (fetchFailed.length > 0) {
        failed.push(...fetchFailed.map((n) => `${n}: failed to load preferences`));
      }
      scheduleSave();
      setShowRoomTogether(false);
      if (failed.length > 0) {
        toast.error(`Some additions skipped: ${failed.join("; ")}`);
      } else {
        toast.success("Mutual preferences added — saving...");
      }
    } catch {
      toast.error("Failed to create mutual preferences.");
    } finally {
      setRoomTogetherConfirming(false);
    }
  }

  // Make Mutual — adds the selected person as a pref for the incoming person AND vice versa
  function handleMakeMutual(fromRegId: number) {
    if (!expandedId) return;
    const selectedId = expandedId;
    const fromReg = registrations.find((r) => r.id === fromRegId);
    const selReg = registrations.find((r) => r.id === selectedId);
    if (!fromReg || !selReg) return;

    // Add fromReg to selected person's prefs (if not already there)
    const selPrefs = currentPrefs(selectedId);
    if (!selPrefs.some((p) => p.preferredRegistrationId === fromRegId) && selPrefs.length < 5) {
      markDirty(selectedId, [
        ...selPrefs,
        {
          preferredRegistrationId: fromRegId,
          regCode: fromReg.regCode,
          fullName: fromReg.fullName,
          branch: fromReg.branch,
          gender: fromReg.gender,
          preferenceOrder: selPrefs.length + 1,
          isMutual: true,
        },
      ]);
    }
  }

  // Export — current filtered view (branch tab + gender + search).
  const scopeLabel = activeBranch === "All" ? "All" : getDeptCode(activeBranch ?? "");

  function exportFilteredCsv() {
    const header = "Name,Branch,Type,Gender,Email,WhatsApp\n";
    const rows = filteredList
      .map((r) =>
        [r.fullName, r.branch, r.accommodationType, r.gender, r.email, r.whatsapp]
          .map(csvEscape)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `allocation-${scopeLabel}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const expandedReg = registrations.find((r) => r.id === expandedId) ?? null;

  const modalCandidates = useMemo(() => {
    if (!expandedReg) return { sameBranch: [], otherBranch: [] };
    const excludeIds = new Set(
      (entries.get(expandedReg.id)?.prefs ?? []).map((p) => p.preferredRegistrationId),
    );
    const q = modalQuery.trim().toLowerCase();
    const pool = registrations.filter(
      (r) =>
        r.id !== expandedReg.id &&
        r.accommodationType !== "private" &&
        !excludeIds.has(r.id) &&
        (!q || r.fullName.toLowerCase().includes(q) || r.branch.toLowerCase().includes(q)),
    );
    const byName = (a: AllocationRegistration, b: AllocationRegistration) =>
      a.fullName.localeCompare(b.fullName);
    return {
      sameBranch: sortCompatibleFirst(
        pool.filter((r) => r.branch === expandedReg.branch), expandedReg, byName,
      ),
      otherBranch: sortCompatibleFirst(
        pool.filter((r) => r.branch !== expandedReg.branch), expandedReg, byName,
      ),
    };
  }, [expandedReg, registrations, entries, modalQuery]);

  // Page-level save status derived from entries.
  const dirtyCount = useMemo(
    () => Array.from(entries.values()).filter((e) => e.dirty && !e.conflict).length,
    [entries],
  );
  const conflicts = useMemo(
    () =>
      registrations
        .filter((r) => entries.get(r.id)?.conflict)
        .map((r) => ({ id: r.id, name: r.fullName })),
    [registrations, entries],
  );

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 bg-gray-200 rounded" />
        <div className="h-4 w-96 bg-gray-200 rounded" />
        <div className="h-10 w-full bg-gray-200 rounded" />
        <div className="h-16 bg-gray-200 rounded" />
        <div className="h-16 bg-gray-200 rounded" />
        <div className="h-16 bg-gray-200 rounded" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <p className="text-sm text-terracotta">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 border border-border-warm rounded-lg px-4 py-2 min-h-11 text-sm font-semibold text-charcoal hover:border-terracotta hover:text-terracotta"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Local keyframes for the preference add slide-in (scoped to this page). */}
      <style>{`@keyframes prefIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      <h1 className="font-heading text-[28px] sm:text-3xl font-bold text-charcoal">
        Room Allocation
      </h1>
      <p className="text-[13px] text-muted mt-1.5 max-w-[520px] leading-relaxed">
        Each person picks up to 5 people they&apos;d like to share with — 1 being
        their first choice. More picks makes it easier to match everyone well.
      </p>

      {branches.length === 0 ? (
        <p className="text-sm text-muted mt-6">No shared-accommodation registrations found.</p>
      ) : (
        <>
          <SummaryCards
            total={totalPeople}
            collected={prefsCollectedCount}
            missing={missingCount}
            mutual={mutualMatchesCount}
            onMutualClick={() => setShowMutualGroups(true)}
          />

          <BranchTabs branches={branchTabs} active={activeBranch} onSelect={selectBranch} />

          <div className="flex items-center gap-3 flex-wrap mt-4">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search name, email, reg code..."
              debounceMs={0}
              className="flex-1 max-w-[280px]"
            />
            <FilterPills
              activeKey={activeGender}
              onChange={(key) => selectGender(key as GenderFilter)}
              options={[
                { key: "all", label: "All", count: branchPeople.length },
                {
                  key: "male",
                  label: <span className="inline-flex items-center gap-1"><GenderIcon gender="male" className="w-3.5 h-3.5" colored={false} /> Men</span>,
                  count: branchPeople.filter((r) => r.gender === "male").length,
                },
                {
                  key: "female",
                  label: <span className="inline-flex items-center gap-1"><GenderIcon gender="female" className="w-3.5 h-3.5" colored={false} /> Women</span>,
                  count: branchPeople.filter((r) => r.gender === "female").length,
                },
              ]}
            />
            {checkInDates.length > 1 && (
              <FilterPills
                activeKey={activeDate}
                onChange={setActiveDate}
                options={[
                  {
                    key: "all",
                    label: <span className="inline-flex items-center gap-1"><CalendarIcon className="w-3.5 h-3.5" /> All dates</span>,
                    count: branchPeople.filter((r) => activeGender === "all" || r.gender === activeGender).length,
                  },
                  ...checkInDates.map((d) => {
                    const day = new Date(d + "T00:00:00").getDate();
                    return {
                      key: d,
                      label: <span className="inline-flex items-center gap-1"><CalendarIcon className="w-3.5 h-3.5" /> {ordinal(day)}</span>,
                      count: branchPeople.filter((r) => r.checkIn === d && (activeGender === "all" || r.gender === activeGender)).length,
                    };
                  }),
                ]}
              />
            )}
            <FilterPills
              activeKey={roomTypeFilter}
              onChange={(key) => setRoomTypeFilter(key as RoomTypeFilter)}
              options={[
                { key: "all", label: "All" },
                { key: "shared_double", label: "2-Share" },
                { key: "shared_triple", label: "3-Share" },
                { key: "private", label: "Private" },
              ]}
            />
          </div>

          <div className="flex items-center gap-3 flex-wrap mt-3">
            <FilterPills
              activeKey={statusFilter}
              onChange={(key) => setStatusFilter(key as StatusFilter)}
              options={[
                { key: "all", label: "All" },
                { key: "unmatched", label: "Unmatched" },
                { key: "no-prefs", label: "No prefs" },
              ]}
            />
            <button
              type="button"
              onClick={() => setShowRoomTogether(true)}
              className="bg-[#D76B51] text-white font-semibold text-[13px] rounded-lg px-4 py-2.5 min-h-11 hover:bg-[#C25A42] active:scale-[0.97] transition-transform"
            >
              🔗 Room Together
            </button>
            <button
              type="button"
              onClick={() => setShowReportModal(true)}
              className="border border-border-warm rounded-lg px-3.5 py-2 min-h-11 text-[13px] font-semibold text-charcoal bg-white hover:border-terracotta hover:text-terracotta active:scale-[0.97] transition-transform"
            >
              📊 Report
            </button>
            <button
              type="button"
              onClick={exportFilteredCsv}
              className="border border-border-warm rounded-lg px-3.5 py-2 min-h-11 text-[13px] font-semibold text-charcoal bg-white hover:border-terracotta hover:text-terracotta active:scale-[0.97] transition-transform"
            >
              ↓ Export
            </button>

            {/* Page-level save indicator */}
            {saving ? (
              <span className="flex items-center gap-2 text-[13px] font-semibold text-muted">
                <span className="w-3.5 h-3.5 border-2 border-terracotta border-t-transparent rounded-full animate-spin" />
                Saving…
              </span>
            ) : dirtyCount > 0 ? (
              <>
                <span className="text-[13px] font-semibold text-terracotta bg-terracotta-light px-2.5 py-1 rounded-full">
                  Unsaved changes ({dirtyCount})
                </span>
                <button
                  type="button"
                  onClick={() => void flush()}
                  className="bg-charcoal text-white font-semibold text-[13px] rounded-lg px-4 py-2 min-h-9 hover:bg-[#101820] active:scale-[0.97] transition-transform"
                >
                  Save All
                </button>
              </>
            ) : savedFlash ? (
              <span className="text-[13px] font-semibold text-success transition-opacity duration-500">
                All changes saved ✓
              </span>
            ) : null}

            <span className="ml-auto text-[13px] text-muted">
              {scopeLabel} —{" "}
              <span className="text-terracotta font-semibold">
                {unmatchedInScope} of {sharedInScope.length} unmatched
              </span>{" "}
              · {doubleCount} double, {tripleCount} triple
            </span>
          </div>

          {/* Conflict banners — one per registration another instance changed */}
          {conflicts.length > 0 && (
            <div className="mt-3 max-w-[760px] flex flex-col gap-2">
              {conflicts.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 flex-wrap bg-[#FDF3F0] border border-terracotta rounded-lg px-3.5 py-2.5"
                >
                  <span className="flex-1 text-[13px] text-charcoal min-w-0">
                    Someone else updated <strong>{c.name}</strong>&apos;s preferences. Reload to see
                    their changes.
                  </span>
                  <button
                    type="button"
                    onClick={() => void reloadRegistration(c.id)}
                    className="bg-terracotta text-white font-semibold text-[12.5px] rounded-lg px-3.5 py-2 min-h-9 hover:bg-[#C25A42] active:scale-[0.97] transition-transform flex-shrink-0"
                  >
                    Reload
                  </button>
                </div>
              ))}
            </div>
          )}


          {/* Master-detail on desktop, accordion on mobile */}
          <div className={`mt-2.5 ${isMobile ? "max-w-[760px]" : "flex gap-5"}`}>
            {/* LEFT PANEL — Card list */}
            <div className={isMobile ? "" : "w-[44%] flex-shrink-0 max-h-[calc(100vh-280px)] overflow-y-auto flex flex-col gap-1.5"}>
              {filteredList.length === 0 ? (
                <p className="text-sm text-muted italic py-4">No one matches this filter.</p>
              ) : isMobile ? (
                filteredList.map((reg) =>
                  reg.accommodationType === "private" ? (
                    <PrivateCard
                      key={reg.id}
                      reg={reg}
                      onCopyPaymentLink={() => void handleCopyPaymentLink(reg)}
                      onWhatsAppPayment={() => void handleWhatsAppPayment(reg)}
                      linkActionPending={linkActionId === reg.id}
                    />
                  ) : (
                    <AccordionCard
                      key={reg.id}
                      reg={reg}
                      displayCount={displayCountFor(reg)}
                      dirty={entries.get(reg.id)?.dirty ?? false}
                      expanded={expandedId === reg.id}
                      onToggle={() => void handleToggle(reg.id)}
                      prefs={currentPrefs(reg.id)}
                      prefsLoading={expandedId === reg.id && prefsLoading}
                      prefsError={expandedId === reg.id ? prefsError : null}
                      lastAddedId={expandedId === reg.id ? lastAddedId : null}
                      onRemove={handleRemove}
                      onMove={handleMove}
                      onReorder={handleReorder}
                      onAddClick={() => setShowModal(true)}
                      onAsk={() => void handleAsk(reg)}
                      askMessage={expandedId === reg.id ? askMessage : null}
                      onConvertClick={() => openConvertConfirm(reg)}
                      onCopyPaymentLink={() => void handleCopyPaymentLink(reg)}
                      onWhatsAppPayment={() => void handleWhatsAppPayment(reg)}
                      linkActionPending={linkActionId === reg.id}
                    />
                  ),
                )
              ) : (
                filteredList.map((reg) => {
                  if (reg.accommodationType === "private") {
                    const isSelected = expandedId === reg.id;
                    return (
                      <button
                        key={reg.id}
                        type="button"
                        onClick={() => setExpandedId(isSelected ? null : reg.id)}
                        className={`w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg border transition-all ${
                          isSelected
                            ? "border-[#D76B51] border-2 bg-[#FDFAF8] shadow-sm"
                            : "border-[#E8E2DA] bg-white hover:bg-[#FDFCFA]"
                        }`}
                      >
                        <PersonAvatar id={reg.id} name={reg.fullName} photoUrl={reg.photoThumbUrl} size="sm" />
                        <span className="flex-1 min-w-0">
                          <span className="font-semibold text-sm text-charcoal truncate flex items-center gap-1">
                            {reg.fullName} <GenderIcon gender={reg.gender} className="w-3.5 h-3.5 flex-shrink-0" />
                          </span>
                          <span className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-xs font-medium text-[#555]">{getDeptCode(reg.branch)}</span>
                            <DatePills checkIn={reg.checkIn} checkOut={reg.checkOut} />
                          </span>
                        </span>
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#EFEDE9] text-[#888] flex-shrink-0">
                          Private
                        </span>
                      </button>
                    );
                  }
                  const st = regStatus(reg, prefIndex);
                  const isSelected = expandedId === reg.id;
                  const deptCode = getDeptCode(reg.branch);
                  return (
                    <button
                      key={reg.id}
                      type="button"
                      onClick={() => void handleToggle(reg.id)}
                      className={`w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg border transition-all ${
                        isSelected
                          ? "border-[#D76B51] border-2 bg-[#FDFAF8] shadow-sm"
                          : st.label === "no prefs"
                            ? "border-[#E8E2DA] bg-[#FFF8F5] hover:bg-[#FFF0EC]"
                            : "border-[#E8E2DA] bg-white hover:bg-[#FDFCFA]"
                      } ${st.allMutual ? "opacity-65" : ""}`}
                    >
                      <PersonAvatar id={reg.id} name={reg.fullName} photoUrl={reg.photoThumbUrl} size="sm" />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="font-semibold text-sm text-charcoal truncate flex items-center gap-1">
                            {reg.fullName} <GenderIcon gender={reg.gender} className="w-3.5 h-3.5 flex-shrink-0" />
                          </span>
                          <TypePill type={reg.accommodationType} />
                          {entries.get(reg.id)?.dirty && (
                            <span className="text-[9px] font-bold text-[#D76B51]">●</span>
                          )}
                        </span>
                        <span className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs font-medium text-[#555]">{deptCode}</span>
                          <DatePills checkIn={reg.checkIn} checkOut={reg.checkOut} />
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-0.5 flex-shrink-0">
                        {st.label === "no prefs" ? (
                          <span className="text-[11px] text-[#8a8f94]">–</span>
                        ) : (
                          <span className="flex gap-[3px]">
                            {(() => {
                              const outPrefs = prefIndex.loaded ? (prefIndex.outgoing.get(reg.id) ?? []) : [];
                              const count = prefIndex.loaded ? outPrefs.length : reg.preferenceCount;
                              return Array.from({ length: 5 }, (_, i) => (
                                <span
                                  key={i}
                                  className={`w-[6px] h-[6px] rounded-full ${
                                    i >= count ? "bg-[#E3DFD8]"
                                      : prefIndex.loaded && outPrefs[i]?.isMutual ? "bg-[#2d7a3a]"
                                      : "bg-[#D76B51]"
                                  }`}
                                />
                              ));
                            })()}
                          </span>
                        )}
                        <span className={`font-semibold ${
                          st.label === "no prefs"
                            ? "text-[12px] font-bold text-[#D76B51]"
                            : st.label === "unmatched"
                              ? "text-[10px] text-[#8a8f94]"
                              : `text-[10px] ${st.color}`
                        }`}>
                          {st.label === "no prefs" ? "No preferences yet" : st.label}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {/* RIGHT PANEL — Detail view (desktop only) */}
            {!isMobile && (
              <div className="flex-1 min-w-0 sticky top-0 self-start">
                <DetailPanel
                  registration={selectedReg}
                  prefs={expandedId ? currentPrefs(expandedId) : []}
                  incoming={selectedIncoming}
                  prefsLoading={prefsLoading}
                  prefsError={prefsError}
                  dirty={expandedId ? (entries.get(expandedId)?.dirty ?? false) : false}
                  conflict={expandedId ? (entries.get(expandedId)?.conflict ?? false) : false}
                  onReorder={handleReorder}
                  onDelete={(prefRegId) => {
                    if (!expandedId) return;
                    const prefs = currentPrefs(expandedId);
                    const idx = prefs.findIndex((p) => p.preferredRegistrationId === prefRegId);
                    if (idx >= 0) handleRemove(idx);
                  }}
                  onAddClick={() => setShowModal(true)}
                  onMakeMutual={handleMakeMutual}
                  onWhatsAppReminder={() => { if (selectedReg) void handleAsk(selectedReg); }}
                  onReload={() => { if (expandedId) void reloadRegistration(expandedId); }}
                  onConvertClick={() => { if (selectedReg) openConvertConfirm(selectedReg); }}
                  onCopyPaymentLink={() => { if (selectedReg) void handleCopyPaymentLink(selectedReg); }}
                  onWhatsAppPayment={() => { if (selectedReg) void handleWhatsAppPayment(selectedReg); }}
                  linkActionPending={selectedReg ? linkActionId === selectedReg.id : false}
                />
              </div>
            )}
          </div>
        </>
      )}

      <AddRoommateModal
        open={showModal}
        onClose={() => setShowModal(false)}
        person={expandedReg}
        sameBranch={modalCandidates.sameBranch}
        otherBranch={modalCandidates.otherBranch}
        query={modalQuery}
        onQueryChange={setModalQuery}
        onSelect={handleAddCandidate}
      />

      <ReportModal
        open={showReportModal}
        onClose={() => setShowReportModal(false)}
        branchStats={branchReportStats}
        totalPeople={totalPeople}
        prefsCollected={prefsCollectedCount}
        mutualMatches={mutualMatchesCount}
      />

      <RoomTogetherModal
        open={showRoomTogether}
        onClose={() => setShowRoomTogether(false)}
        registrations={registrations.filter((r) => r.accommodationType !== "private")}
        prefIndex={prefIndex}
        onConfirm={handleRoomTogetherConfirm}
        confirming={roomTogetherConfirming}
      />

      <MutualGroupsModal
        open={showMutualGroups}
        onClose={() => setShowMutualGroups(false)}
        groups={mutualGroups}
        unmatchedRegistrations={unmatchedRegs}
        branches={branches.map((b) => b.key)}
      />

      <ConvertRoomModal
        open={!!convertTarget}
        registration={convertTarget}
        confirming={converting}
        onClose={() => setConvertTarget(null)}
        onConfirm={() => void handleConvertConfirm()}
      />
    </div>
  );
}
