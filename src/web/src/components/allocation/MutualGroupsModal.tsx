import { useState } from "react";
import { getDeptCode } from "@/components/leaderboard/department";
import { GenderIcon, TypePill } from "./shared";

// ── Types ──────────────────────────────────────────────────────────────────

interface AllocationRegistration {
  id: number;
  regCode: string;
  fullName: string;
  branch: string;
  gender: string;
  accommodationType: string;
  preferenceCount: number;
  incomingPreferenceCount: number;
}

interface MutualGroup {
  members: AllocationRegistration[];
  branch: string;
  accommodationType: string;
}

export interface MutualGroupsModalProps {
  open: boolean;
  onClose: () => void;
  groups: MutualGroup[];
  unmatchedRegistrations: AllocationRegistration[];
  branches: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function unmatchedNote(preferenceCount: number): string {
  if (preferenceCount === 0) return "no prefs";
  return `${preferenceCount} one-way`;
}

// ── Component ──────────────────────────────────────────────────────────────

export function MutualGroupsModal({
  open,
  onClose,
  groups,
  unmatchedRegistrations,
  branches,
}: MutualGroupsModalProps) {
  const groupsByBranch = new Map<string, MutualGroup[]>();
  for (const group of groups) {
    const list = groupsByBranch.get(group.branch) ?? [];
    list.push(group);
    groupsByBranch.set(group.branch, list);
  }

  const unmatchedByBranch = new Map<string, AllocationRegistration[]>();
  for (const reg of unmatchedRegistrations) {
    const list = unmatchedByBranch.get(reg.branch) ?? [];
    list.push(reg);
    unmatchedByBranch.set(reg.branch, list);
  }

  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(
    () => new Set(branches.filter((b) => (unmatchedByBranch.get(b)?.length ?? 0) > 0)),
  );

  if (!open) return null;

  function toggleBranch(branch: string) {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(branch)) {
        next.delete(branch);
      } else {
        next.add(branch);
      }
      return next;
    });
  }

  const totalMatched = groups.reduce((sum, g) => sum + g.members.length, 0);
  const totalUnmatched = unmatchedRegistrations.length;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-[580px] w-full max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#E8E2DA]">
          <div>
            <h2 className="font-serif text-lg font-bold text-charcoal">Mutual Matches</h2>
            <p className="text-sm text-[#8a8f94] mt-0.5">
              Groups where all members mutually selected each other
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-w-9 min-h-9 flex items-center justify-center text-[#8a8f94] hover:text-charcoal text-base flex-shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Stats banner */}
        <div className="mx-5 mt-4 bg-[#F5F2ED] rounded-lg px-4 py-2 text-sm text-charcoal flex items-center gap-1.5">
          <span className="font-bold">{groups.length}</span>
          <span className="text-[#8a8f94]">groups ·</span>
          <span className="font-bold">{totalMatched}</span>
          <span className="text-[#8a8f94]">matched ·</span>
          <span className="font-bold">{totalUnmatched}</span>
          <span className="text-[#8a8f94]">unmatched</span>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto px-5 py-4 flex-1">
          {branches.map((branch) => {
            const branchGroups = groupsByBranch.get(branch) ?? [];
            const branchUnmatched = unmatchedByBranch.get(branch) ?? [];
            const isExpanded = expandedBranches.has(branch);
            const isAllMatched = branchGroups.length === 0 && branchUnmatched.length === 0;

            return (
              <div key={branch} className="border border-[#E8E2DA] rounded-lg mb-2 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleBranch(branch)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-3 min-h-11 cursor-pointer text-left"
                >
                  <span
                    className={`text-[#8a8f94] text-xs transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  >
                    ▶
                  </span>
                  <span className="font-bold text-charcoal">{getDeptCode(branch)}</span>
                  <span className="text-sm text-[#8a8f94]">
                    {branchGroups.length} group{branchGroups.length === 1 ? "" : "s"} ·{" "}
                    {branchUnmatched.length} unmatched
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-3.5 pb-3.5">
                    {isAllMatched ? (
                      <p className="text-sm text-[#2d7a3a] font-medium">All matched ✓</p>
                    ) : (
                      <>
                        {branchGroups.map((group, gi) => (
                          <div
                            key={gi}
                            className="bg-white border border-[#E8E2DA] rounded-lg p-3 mb-2"
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[12.5px] font-semibold text-[#1F6B73]">
                                {group.members.length === 2
                                  ? "Mutual pair"
                                  : `Mutual group · ${group.members.length} people`}
                              </span>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              {group.members.map((m) => (
                                <div
                                  key={m.id}
                                  className="flex items-center gap-2 flex-wrap text-sm"
                                >
                                  <a
                                    href={`/staff/registrations/${m.id}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[#1F6B73] hover:underline font-medium"
                                  >
                                    {m.fullName}
                                  </a>
                                  <GenderIcon gender={m.gender} className="w-3.5 h-3.5" />
                                  <TypePill type={m.accommodationType} />
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}

                        {branchUnmatched.length > 0 && (
                          <div className="flex flex-col gap-1.5 mt-1">
                            {branchUnmatched.map((r) => (
                              <div
                                key={r.id}
                                className="flex items-center gap-2 flex-wrap text-sm px-1 py-1"
                              >
                                <a
                                  href={`/staff/registrations/${r.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[#1F6B73] hover:underline font-medium"
                                >
                                  {r.fullName}
                                </a>
                                <GenderIcon gender={r.gender} className="w-3.5 h-3.5" />
                                <TypePill type={r.accommodationType} />
                                <span className="text-[12.5px] text-[#8a8f94]">
                                  {unmatchedNote(r.preferenceCount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-[#E8E2DA]">
          <button
            type="button"
            onClick={onClose}
            className="bg-charcoal text-white font-semibold text-[13px] rounded-lg px-4 py-2 min-h-9 hover:opacity-90 active:scale-[0.97] transition-transform"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
