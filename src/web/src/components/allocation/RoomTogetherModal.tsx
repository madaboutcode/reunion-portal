import { useEffect, useMemo, useState } from "react";
import type { AllocationRegistration, PreferenceEntry } from "@/lib/staff-types";
import { incompatibleReason, sortCompatibleFirst } from "./shared";

// ── Types ──────────────────────────────────────────────────────────────────

export interface RoomTogetherModalProps {
  open: boolean;
  onClose: () => void;
  registrations: AllocationRegistration[];
  prefIndex: {
    outgoing: Map<number, PreferenceEntry[]>;
    loaded: boolean;
  };
  onConfirm: (groupIds: number[]) => void;
  confirming: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function typePill(accommodationType: string) {
  if (accommodationType === "shared_double") {
    return { label: "2-Share", className: "bg-[#E8F0FA] text-[#2D6FB0]" };
  }
  if (accommodationType === "shared_triple") {
    return { label: "3-Share", className: "bg-[#E0F4F1] text-[#1A7A6D]" };
  }
  return { label: accommodationType, className: "bg-[#F1EEE8] text-charcoal" };
}

function formatStay(reg: AllocationRegistration): string {
  if (!reg.checkIn) return "";
  const inDay = reg.checkIn === "2026-08-14" ? "Aug 14" : reg.checkIn;
  return reg.checkOut ? `${inDay}–${reg.checkOut === "2026-08-16" ? "Aug 16" : reg.checkOut}` : inDay;
}

// ── Component ──────────────────────────────────────────────────────────────

export function RoomTogetherModal({
  open,
  onClose,
  registrations,
  prefIndex,
  onConfirm,
  confirming,
}: RoomTogetherModalProps) {
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (open) {
      setGroupIds([]);
      setSearchQuery("");
    }
  }, [open]);

  const regById = useMemo(() => {
    const map = new Map<number, AllocationRegistration>();
    for (const r of registrations) map.set(r.id, r);
    return map;
  }, [registrations]);

  const anchor = groupIds.length > 0 ? regById.get(groupIds[0]) ?? null : null;

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = registrations
      .filter((r) => !groupIds.includes(r.id))
      .filter((r) => r.fullName.toLowerCase().includes(q));
    const byName = (a: AllocationRegistration, b: AllocationRegistration) => a.fullName.localeCompare(b.fullName);
    const sorted = anchor ? sortCompatibleFirst(matches, anchor, byName) : matches;
    return sorted.slice(0, 12);
  }, [searchQuery, groupIds, registrations, anchor]);

  if (!open) return null;

  const groupMembers = groupIds
    .map((id) => regById.get(id))
    .filter((r): r is AllocationRegistration => !!r);

  const existingPairs = new Set<string>();
  for (const member of groupMembers) {
    const prefs = prefIndex.outgoing.get(member.id) ?? [];
    for (const p of prefs) {
      existingPairs.add(`${member.id}-${p.preferredRegistrationId}`);
    }
  }

  const newPairs: Array<{ a: AllocationRegistration; b: AllocationRegistration }> = [];
  for (let i = 0; i < groupMembers.length; i++) {
    for (let j = 0; j < groupMembers.length; j++) {
      if (i === j) continue;
      const a = groupMembers[i];
      const b = groupMembers[j];
      if (!existingPairs.has(`${a.id}-${b.id}`)) {
        newPairs.push({ a, b });
      }
    }
  }

  const handleAdd = (id: number) => {
    setGroupIds((prev) => [...prev, id]);
    setSearchQuery("");
  };

  const handleRemove = (id: number) => {
    setGroupIds((prev) => prev.filter((gid) => gid !== id));
  };

  const canConfirm = groupIds.length >= 2 && !confirming;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-[520px] w-full max-h-[80vh] flex flex-col overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-[#E8E2DA] flex-shrink-0">
          <div>
            <h2 className="font-heading text-lg font-bold text-charcoal">Room Together</h2>
            <p className="text-sm text-muted mt-0.5">
              Add mutual roommate preferences for a group
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-charcoal w-11 h-11 -mr-2 -mt-2 flex items-center justify-center flex-shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Search section */}
          <div>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name to add..."
                className="w-full h-11 text-sm text-charcoal placeholder:text-subtle bg-white border-[1.5px] border-[#E8E2DA] rounded-[10px] outline-none px-3.5 focus:border-soft-aqua transition-colors"
              />
            </div>
            <p className="text-xs text-muted mt-1.5">
              {groupIds.length} {groupIds.length === 1 ? "person" : "people"} added
              {anchor && (
                <span className="text-subtle">
                  {" "}· must be {anchor.gender === "male" ? "male" : "female"},{" "}
                  {anchor.accommodationType === "shared_double" ? "2-Share" : "3-Share"}
                </span>
              )}
            </p>

            {searchResults.length > 0 && (
              <div className="mt-2 border border-[#E8E2DA] rounded-lg overflow-hidden divide-y divide-[#E8E2DA]">
                {searchResults.map((r) => {
                  const pill = typePill(r.accommodationType);
                  const reason = anchor ? incompatibleReason(r, anchor) : null;
                  const disabled = !!reason;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={disabled ? undefined : () => handleAdd(r.id)}
                      disabled={disabled}
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors min-h-[44px] ${
                        disabled
                          ? "opacity-45 cursor-not-allowed"
                          : "hover:bg-[#FAF8F5]"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className={`block text-sm font-medium truncate ${disabled ? "text-muted" : "text-charcoal"}`}>
                          {r.fullName}
                        </span>
                        <span className="block text-xs text-muted truncate">
                          {disabled ? reason : r.branch}
                        </span>
                      </span>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0 ${pill.className}`}
                      >
                        {pill.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Added people list */}
          {groupMembers.length > 0 && (
            <div className="space-y-2">
              {groupMembers.map((member) => {
                const pill = typePill(member.accommodationType);
                const prefs = prefIndex.outgoing.get(member.id) ?? [];
                const stay = formatStay(member);
                return (
                  <div
                    key={member.id}
                    className="bg-white border border-[#E8E2DA] rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-charcoal truncate">
                        {member.fullName}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemove(member.id)}
                        className="text-xs text-muted hover:text-terracotta flex-shrink-0 px-1"
                      >
                        ✕ Remove
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${pill.className}`}
                      >
                        {pill.label}
                      </span>
                      <span className="text-xs text-muted">
                        {member.branch}
                        {stay && ` · ${stay}`}
                      </span>
                    </div>
                    {prefIndex.loaded && (
                      <div className="mt-1.5">
                        <span className="text-[11px] text-subtle">Current preferences: </span>
                        {prefs.length === 0 ? (
                          <span className="text-[11px] text-subtle italic">none</span>
                        ) : (
                          prefs.map((p, idx) => (
                            <span key={p.preferredRegistrationId} className="text-[11px]">
                              <span className={p.isMutual ? "text-[#1A7A6D] font-medium" : "text-muted"}>
                                {p.fullName}
                                {p.isMutual ? " (mutual ✓)" : ""}
                              </span>
                              {idx < prefs.length - 1 && <span className="text-subtle">, </span>}
                            </span>
                          ))
                        )}
                      </div>
                    )}
                    {prefs.length >= 3 && (
                      <p className="text-[11px] text-terracotta font-medium mt-1">
                        Has {prefs.length} of 5 slots filled
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* What will happen */}
          {groupMembers.length >= 2 && (
            <div className="bg-[#F0F8F8] rounded-lg p-3">
              <p className="text-sm font-bold text-charcoal">When confirmed:</p>
              <ul className="mt-1 space-y-0.5">
                {newPairs
                  .reduce<Array<{ a: AllocationRegistration; b: AllocationRegistration }>>(
                    (acc, pair) => {
                      const alreadyListed = acc.some(
                        (p) =>
                          (p.a.id === pair.a.id && p.b.id === pair.b.id) ||
                          (p.a.id === pair.b.id && p.b.id === pair.a.id),
                      );
                      if (!alreadyListed) acc.push(pair);
                      return acc;
                    },
                    [],
                  )
                  .map((pair) => (
                    <li key={`${pair.a.id}-${pair.b.id}`} className="text-sm text-charcoal">
                      • {pair.a.fullName} → {pair.b.fullName} (new)
                    </li>
                  ))}
              </ul>
              <p className="text-xs text-muted mt-2">
                All participants will be added to each other's preferences
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[#E8E2DA] flex-shrink-0">
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
            onClick={() => onConfirm(groupIds)}
            disabled={!canConfirm}
            className="h-11 px-4 rounded-lg bg-[#D76B51] text-white text-sm font-semibold hover:brightness-90 active:brightness-85 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirming ? "Adding..." : "Confirm — Add mutual preferences"}
          </button>
        </div>
      </div>
    </div>
  );
}
