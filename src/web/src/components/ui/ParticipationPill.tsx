export interface ParticipationPillProps {
  participationType: string;
}

export function ParticipationPill({ participationType }: ParticipationPillProps) {
  if (participationType === "full_celebration") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border"
        style={{ background: "#fdf6dc", color: "#7a5200", borderColor: "#e8c84a" }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
          <path
            d="M8 1l2.2 4.5L15 6.3l-3.5 3.4.8 4.8L8 12.2 3.7 14.5l.8-4.8L1 6.3l4.8-.8L8 1z"
            fill="currentColor"
          />
        </svg>
        Full
      </span>
    );
  }

  if (participationType === "campus_only") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border"
        style={{ background: "#f2f3f5", color: "#3d4a59", borderColor: "#b8c2cc" }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
          <circle cx="8" cy="8" r="3" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <line x1="8" y1="1" x2="8" y2="3" />
            <line x1="8" y1="13" x2="8" y2="15" />
            <line x1="1" y1="8" x2="3" y2="8" />
            <line x1="13" y1="8" x2="15" y2="8" />
            <line x1="2.9" y1="2.9" x2="4.3" y2="4.3" />
            <line x1="11.7" y1="11.7" x2="13.1" y2="13.1" />
            <line x1="2.9" y1="13.1" x2="4.3" y2="11.7" />
            <line x1="11.7" y1="4.3" x2="13.1" y2="2.9" />
          </g>
        </svg>
        Campus
      </span>
    );
  }

  // donation_only (and any unknown type falls through to copper/donor)
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border"
      style={{ background: "#fdf0ea", color: "#7a3010", borderColor: "#d4956a" }}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
        <path
          d="M8 14l-0.9-0.8C3.6 10 2 8.4 2 6.4 2 4.8 3.3 3.5 4.9 3.5c0.9 0 1.8 0.4 2.4 1.1L8 5.3l0.7-0.7C9.3 3.9 10.2 3.5 11.1 3.5 12.7 3.5 14 4.8 14 6.4c0 2-1.6 3.6-5.1 6.8L8 14z"
          fill="currentColor"
        />
      </svg>
      Donor
    </span>
  );
}
