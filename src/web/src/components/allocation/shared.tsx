import { useState } from "react";

// ── Icons ──────────────────────────────────────────────────────────────────

export function CalendarIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

export function GenderIcon({ gender, className = "w-4 h-4", colored = true }: { gender: string; className?: string; colored?: boolean }) {
  const maleColor = colored ? "text-[#5B8FB9]" : "";
  const femaleColor = colored ? "text-[#C97B8B]" : "";
  if (gender === "male") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${className} ${maleColor}`}>
        <circle cx="12" cy="8" r="4" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
    );
  }
  if (gender === "female") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${className} ${femaleColor}`}>
        <circle cx="12" cy="8" r="4" />
        <path d="M8 14h8l1 6H7z" />
      </svg>
    );
  }
  return null;
}

// ── DatePills ──────────────────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components
export function ordinal(day: number): string {
  const s = day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th";
  return `${day}${s}`;
}

export function DatePills({ checkIn, checkOut }: { checkIn: string | null; checkOut: string | null }) {
  if (!checkIn) return null;
  const cinDay = new Date(checkIn + "T00:00:00").getDate();
  const coutDay = checkOut ? new Date(checkOut + "T00:00:00").getDate() : null;
  const days: number[] = [];
  if (coutDay && coutDay > cinDay) {
    for (let d = cinDay; d < coutDay; d++) days.push(d);
  } else {
    days.push(cinDay);
  }
  return (
    <>
      {days.map((d) => (
        <span key={d} className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#1F2A33] bg-[#EEE9E1] px-1.5 py-0.5 rounded-full">
          <CalendarIcon className="w-3 h-3" />{ordinal(d)}
        </span>
      ))}
    </>
  );
}

// ── PersonAvatar ───────────────────────────────────────────────────────────

const AVATAR_COLORS = ["#D76B51", "#B9DFE2", "#8B6F4E", "#6B8E7B", "#9B7EA5", "#C49A6C"];

// Cache-buster for photo URLs — computed once per page load so avatars don't
// need to thread a photoVersion prop through every call site.
const PHOTO_V = Date.now();

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function readableTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1F2A33" : "#FFFFFF";
}

export function PersonAvatar({
  id,
  name,
  photoUrl,
  photoVersion = PHOTO_V,
  size = "md",
}: {
  id: number;
  name: string;
  photoUrl?: string | null;
  photoVersion?: number;
  size?: "sm" | "md" | "lg";
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const sizeClasses = { sm: "w-7 h-7 text-[11px]", md: "w-11 h-11 text-[15px]", lg: "w-16 h-16 text-[22px]" }[size];
  const bg = AVATAR_COLORS[id % AVATAR_COLORS.length];
  const src = photoUrl ? `${photoUrl}${photoUrl.includes("?") ? "&" : "?"}v=${photoVersion ?? ""}` : null;
  if (src && !imgFailed) {
    return <img src={src} alt="" onError={() => setImgFailed(true)} className={`${sizeClasses} rounded-full object-cover flex-shrink-0`} />;
  }
  return (
    <div className={`${sizeClasses} rounded-full flex items-center justify-center font-bold flex-shrink-0 select-none`} style={{ backgroundColor: bg, color: readableTextColor(bg) }}>
      {initialsFor(name)}
    </div>
  );
}

// ── Roommate compatibility ────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components
export function incompatibleReason(
  candidate: { gender: string; accommodationType: string },
  anchor: { gender: string; accommodationType: string },
): string | null {
  const diffGender = candidate.gender !== anchor.gender;
  const diffType = candidate.accommodationType !== anchor.accommodationType;
  if (diffGender && diffType) return "Different gender & room type";
  if (diffGender) return "Different gender";
  if (diffType) {
    const label = candidate.accommodationType === "shared_double" ? "2-Share" : "3-Share";
    return `Different room type (${label})`;
  }
  return null;
}

// eslint-disable-next-line react-refresh/only-export-components
export function sortCompatibleFirst<T extends { gender: string; accommodationType: string }>(
  items: T[],
  anchor: { gender: string; accommodationType: string },
  thenBy?: (a: T, b: T) => number,
): T[] {
  return [...items].sort((a, b) => {
    const aOk = !incompatibleReason(a, anchor);
    const bOk = !incompatibleReason(b, anchor);
    if (aOk !== bOk) return aOk ? -1 : 1;
    return thenBy ? thenBy(a, b) : 0;
  });
}

// ── TypePill ───────────────────────────────────────────────────────────────

export function TypePill({ type }: { type: string }) {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
      type === "private" ? "bg-[#EFEDE9] text-[#888]"
        : type === "shared_double" ? "bg-[#E8F0FA] text-[#2D6FB0]"
        : "bg-[#E0F4F1] text-[#1A7A6D]"
    }`}>
      {type === "private" ? "Private" : type === "shared_double" ? "2-Share" : "3-Share"}
    </span>
  );
}

// ── StatusPill ─────────────────────────────────────────────────────────────
// Registration payment status (staff-api R27.7). Kept local to the allocation
// feature — DF-B consolidation with other pages' status helpers is explicitly
// not attempted this cycle (recorded debt, avoids cross-page churn).

export function StatusPill({ status }: { status: string }) {
  if (status === "pending") {
    return (
      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#fff0c9] text-[#8b6200]">
        Pending
      </span>
    );
  }
  if (status === "pending_verification") {
    return (
      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#e5f0ff] text-[#2563a6]">
        Needs Verification
      </span>
    );
  }
  return null;
}
