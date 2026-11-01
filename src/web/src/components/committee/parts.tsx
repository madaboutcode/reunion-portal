/** Small shared presentational bits for the Committee Todo screens. */

import { useState } from "react";
import { initials } from "@/components/whos-coming/utils";
import { formatDue, isOverdue } from "./model";

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M4 10.5l3.5 3.5L16 5.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Presentational checkbox mark. The enclosing row owns the click, so this is
 *  a plain span (no nested button). */
export function CheckMark({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <span
      className={[
        "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border-2 text-white transition",
        checked ? "border-success bg-success" : "border-soft-aqua-deep bg-white",
        disabled ? "opacity-50" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {checked && <CheckIcon />}
    </span>
  );
}

/** Small due-date chip. Terracotta when overdue (and not done), else muted. */
export function DuePill({ due, done }: { due: string; done?: boolean }) {
  const overdue = !done && isOverdue(due);
  return (
    <span
      className={[
        "flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[13px] font-semibold",
        overdue ? "bg-terracotta/10 text-terracotta" : "bg-border/60 text-muted",
      ].join(" ")}
      title={overdue ? "Overdue" : "Due"}
    >
      <svg viewBox="0 0 20 20" fill="none" className="h-3 w-3" aria-hidden="true">
        <circle cx="10" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 8v3l2 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M7 3.5 5 5M13 3.5 15 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {formatDue(due)}
    </span>
  );
}

/** Pencil affordance that opens the edit modal. Its own tap target, so it must
 *  never sit inside another button — the row splits toggle vs. edit. */
export function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-subtle transition hover:bg-black/[0.04] hover:text-terracotta active:scale-90"
    >
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
        <path
          d="M13.5 3.9a1.6 1.6 0 0 1 2.3 2.3L7.3 14.7 4 15.5l.8-3.3 8.7-8.3Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/** Rounded-SQUARE avatar (Concept 4 roster + person identity). Photo with an
 *  initials fallback on missing/error. `size` px, `radius` px corner. */
export function SquareAvatar({
  name,
  photoSrc,
  size = 36,
  radius = 8,
  className,
}: {
  name: string;
  photoSrc?: string;
  size?: number;
  radius?: number;
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);
  const showPhoto = Boolean(photoSrc) && !imgError;
  return (
    <span
      className={[
        "flex shrink-0 items-center justify-center overflow-hidden bg-soft-aqua-light font-semibold text-muted",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {showPhoto ? (
        <img
          src={photoSrc}
          alt={name}
          loading="lazy"
          onError={() => setImgError(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.34) }}>{initials(name)}</span>
      )}
    </span>
  );
}

/** Thin right-chevron used on roster rows. */
export function RowChevron() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-4 w-4 shrink-0 text-subtle"
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

