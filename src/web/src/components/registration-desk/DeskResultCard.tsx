import { publicPhotoUrl } from "@/lib/api";
import { formatRegCodeForDisplay } from "@/lib/constants";
import { DeskPhoto } from "@/components/registration-desk/DeskPhoto";
import { DeskPhotoStamp } from "@/components/registration-desk/DeskPhotoStamp";
import { DeskStatusPill } from "@/components/registration-desk/DeskStatusPill";
import type { DeskSearchResult } from "@/lib/staff-types";

export interface DeskResultCardProps {
  result: DeskSearchResult;
  thumbsBaseUrl: string;
  photosVersion: number;
  onSelect: () => void;
}

/**
 * Ribbon landing result row (registration-desk-ui plan, mockup .result).
 * Photo is the PUBLIC CDN thumbnail — never the authenticated desk-photo
 * endpoint (registration-desk.spec.md R2.5) — so a result list never costs
 * one authenticated fetch per row.
 */
export function DeskResultCard({ result, thumbsBaseUrl, photosVersion, onSelect }: DeskResultCardProps) {
  const present = result.checkIn.present;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Open attendee record for ${result.fullName}`}
      className="desk-photo-stamp--list group relative grid min-h-[124px] w-full grid-cols-[98px_minmax(0,1fr)_24px] items-center gap-3.5 rounded-xl border-b border-border-warm py-3 pl-0 pr-1.5 text-left transition-[background-color,transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:bg-surface/70 hover:shadow-[0_6px_18px_rgba(80,60,40,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta focus-visible:ring-offset-2 active:translate-y-0 sm:min-h-[142px] sm:grid-cols-[116px_minmax(0,1fr)_28px]"
    >
      {/* Photo — overflow-visible so the stamp can extend past the rounded
          edge when it spills onto the row. The image's own rounded corners
          still clip the photo content. */}
      <span className="relative block aspect-square w-full rounded-[13px] transition-transform duration-300 ease-out group-hover:scale-[1.03]">
        <DeskPhoto
          src={result.hasPhoto ? publicPhotoUrl(result.id, thumbsBaseUrl, photosVersion) : null}
          alt=""
          fallbackLetter={result.fullName.charAt(0).toUpperCase()}
          testId="desk-result-photo"
          className="h-full w-full rounded-[13px] border border-border-warm text-3xl"
        />
      </span>
      <span className="min-w-0">
        <strong className="block truncate font-heading text-[18px] leading-[1.1] text-charcoal transition-colors duration-200 group-hover:text-charcoal sm:text-[20px]">
          {result.fullName}
        </strong>
        <span className="mt-1 block break-words text-[12px] font-bold tracking-[0.045em] text-charcoal/80">
          {formatRegCodeForDisplay(result.regCode)}
        </span>
        <span className="mt-1 block truncate text-[12px] text-muted">{result.branch}</span>
        <span className="mt-2 inline-block">
          <DeskStatusPill label={present ? "Present" : "Not present"} tone={present ? "positive" : "warning"} />
        </span>
      </span>
      <svg
        className="h-5 w-5 text-muted transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-charcoal"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
      {/* Stamp lives at the BUTTON level (not inside the photo span) so it
          can roam across the photo AND the name/pills to the right — like a
          real rubber stamp that doesn't care about UI boundaries. The
          button has `relative` (above) + `desk-photo-stamp--list` so the
          CSS vars that drive geometry cascade down to the stamp; the
          dev-mode studio panel overrides them live on a higher ancestor. */}
      {present && <DeskPhotoStamp testId="desk-result-stamp" />}
    </button>
  );
}
