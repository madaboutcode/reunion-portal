import { useState, forwardRef } from "react";
import { Link } from "react-router-dom";
import { initials, branchInitialsGradient } from "./utils";

const CARD_ROTATIONS = [-2.8, 1.4, -1.2, 2.6, -3.2, 0.9, -2.1, 1.8];
/** Gentle vertical nudge for mobile collage — kept small so cards don't crowd neighbors. */
const MOBILE_NUDGES = [2, -1.5, 3, -1, 2.5, -2, 1.5, -2.5];
const TAPE_ROTATIONS = [-6, 4, -3, 5, -5, 3, -4, 6];

/** Bright polaroid white with a whisper of warm age at the edges. */
const PAPER_BG =
  "linear-gradient(180deg, #FFFFFF 0%, #FEFEFE 30%, #FCFBF8 65%, #F8F6F1 100%)";
const FRAME_BORDER = "1px solid rgba(205,190,165,0.09)";
const FRAME_SHADOW =
  "0 1px 0 rgba(255,255,255,1) inset, 0 1px 3px rgba(90,72,52,0.05), 0 6px 20px rgba(90,72,52,0.08), 0 18px 36px rgba(90,72,52,0.04)";
const HOVER_SHADOW =
  "0 1px 0 rgba(255,255,255,1) inset, 0 8px 22px rgba(90,72,52,0.12), 0 22px 48px rgba(90,72,52,0.1)";
const PHOTO_WELL_SHADOW =
  "inset 0 1px 5px rgba(70,58,42,0.09), inset 0 0 0 1px rgba(130,115,95,0.05)";
const DEFAULT_ACCENT = "#B9DFE2";

function TapeStrip({ fluid = false, index = 0 }: { fluid?: boolean; index?: number }) {
  const tapeTilt = TAPE_ROTATIONS[index % TAPE_ROTATIONS.length] ?? -4;
  return (
    <div
      className={[
        "pointer-events-none absolute left-1/2 z-20 rounded-[1px]",
        fluid ? "-top-[10px] h-[18px] w-[38%] min-w-[48px] max-w-[64px]" : "-top-[9px] h-4 w-[52px]",
      ].join(" ")}
      style={{
        transform: `translateX(-50%) rotate(${tapeTilt}deg)`,
        background:
          "linear-gradient(180deg, rgba(255,250,220,0.92) 0%, rgba(255,238,160,0.55) 100%)",
        boxShadow:
          "0 2px 4px rgba(90,72,52,0.14), inset 0 1px 0 rgba(255,255,255,0.75)",
        border: "1px solid rgba(255,255,255,0.5)",
      }}
      aria-hidden="true"
    />
  );
}

// ── PolaroidPhoto (CDN URL with native lazy loading) ────────────────────────

interface PublicPolaroidPhotoProps {
  fullName: string;
  photoSrc?: string;
  accentColor: string;
}

function PublicPolaroidPhoto({ fullName, photoSrc, accentColor }: PublicPolaroidPhotoProps) {
  const [error, setError] = useState(false);

  if (error || !photoSrc) {
    return <InitialsFallback fullName={fullName} accentColor={accentColor} />;
  }

  return (
    <div className="absolute inset-0">
      <img
        src={photoSrc}
        alt={fullName}
        loading="lazy"
        onError={() => setError(true)}
        className="absolute inset-0 w-full h-full object-cover rounded-[2px]"
      />
    </div>
  );
}

// ── Initials fallback ────────────────────────────────────────────────────────

interface InitialsFallbackProps {
  fullName: string;
  accentColor: string;
}

const InitialsFallback = forwardRef<HTMLDivElement, InitialsFallbackProps>(
  function InitialsFallback({ fullName, accentColor }, ref) {
    return (
      <div
        ref={ref}
        className="absolute inset-0 flex items-center justify-center rounded-[2px]"
        style={{
          background: branchInitialsGradient(accentColor),
          boxShadow:
            "inset 0 -28px 56px rgba(0,0,0,0.14), inset 0 0 0 1px rgba(255,255,255,0.12)",
        }}
        aria-label={initials(fullName)}
      >
        <span
          className="font-heading font-bold text-[26px] text-white tracking-wide"
          style={{ textShadow: "0 2px 6px rgba(0,0,0,0.28)" }}
        >
          {initials(fullName)}
        </span>
      </div>
    );
  },
);

// ── PolaroidCard ─────────────────────────────────────────────────────────────

export interface PolaroidCardPerson {
  id: number;
  fullName: string;
  subtitle: string;
  hasPhoto: boolean;
  photoSrc?: string;
  status?: string;
}

export interface PolaroidCardProps {
  person: PolaroidCardPerson;
  index: number;
  variant: "public" | "staff";
  href?: string;
  branchAccentColor?: string;
  /** Fill grid cell width; halves tilt for tighter mobile layouts. */
  fluid?: boolean;
}

export function PolaroidCard({
  person,
  index,
  variant,
  href,
  branchAccentColor = DEFAULT_ACCENT,
  fluid = false,
}: PolaroidCardProps) {
  const rotation = CARD_ROTATIONS[index % CARD_ROTATIONS.length] ?? 0;
  const nudgeY = fluid ? (MOBILE_NUDGES[index % MOBILE_NUDGES.length] ?? 0) : 0;
  const isConfirmed = person.status === "confirmed";
  const showStatus = variant === "staff" && person.status !== undefined;

  const frameTransform = fluid
    ? `rotate(${rotation}deg) translateY(${nudgeY}px)`
    : `rotate(${rotation}deg)`;

  const frameStyle: React.CSSProperties = {
    width: fluid ? "100%" : "148px",
    background: PAPER_BG,
    border: FRAME_BORDER,
    boxShadow: FRAME_SHADOW,
    transform: frameTransform,
    transformOrigin: "center center",
    transformStyle: fluid ? undefined : "preserve-3d",
    transition: "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
  };

  const hoverHandlers = fluid
    ? {
        onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
          const el = e.currentTarget;
          el.style.transform = `rotate(0deg) translateY(${nudgeY - 6}px) scale(1.04)`;
          el.style.zIndex = "10";
          el.style.boxShadow = HOVER_SHADOW;
        },
        onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
          const el = e.currentTarget;
          el.style.transform = frameTransform;
          el.style.zIndex = "";
          el.style.boxShadow = FRAME_SHADOW;
        },
      }
    : {
        onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
          const el = e.currentTarget;
          el.style.transform = "rotate(0deg) translateY(-10px) scale(1.07) rotateX(5deg)";
          el.style.zIndex = "10";
          el.style.boxShadow = HOVER_SHADOW;
        },
        onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
          const el = e.currentTarget;
          el.style.transform = `rotate(${rotation}deg)`;
          el.style.zIndex = "";
          el.style.boxShadow = FRAME_SHADOW;
        },
      };

  const cardInner = (
    <div
      className={
        fluid
          ? "relative w-full rounded-[3px] px-[6%] pt-[6%] pb-[22%]"
          : "relative rounded-[3px] px-[10px] pt-[10px] pb-[38px]"
      }
      style={frameStyle}
      {...hoverHandlers}
    >
      <TapeStrip fluid={fluid} index={index} />

      {/* Photo well — inset mat like a real polaroid */}
      <div
        className="relative w-full overflow-hidden rounded-[2px] bg-black/[0.02]"
        style={{ aspectRatio: "1 / 1", boxShadow: PHOTO_WELL_SHADOW }}
      >
        {person.hasPhoto ? (
          <PublicPolaroidPhoto
            fullName={person.fullName}
            photoSrc={person.photoSrc}
            accentColor={branchAccentColor}
          />
        ) : (
          <InitialsFallback fullName={person.fullName} accentColor={branchAccentColor} />
        )}

        {showStatus && (
          <div
            className="absolute bottom-1.5 right-1.5 w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm"
            style={{ backgroundColor: isConfirmed ? "#22c55e" : "#fbbf24" }}
            aria-label={isConfirmed ? "Confirmed" : "Pending"}
          />
        )}
      </div>

      {/* Handwritten caption on the bottom white strip */}
      <div className={fluid ? "mt-[0.35rem] min-h-[2rem] text-center" : "mt-2 min-h-[28px] text-center"}>
        <p
          className="font-semibold text-charcoal leading-snug line-clamp-2"
          style={{ fontSize: fluid ? "clamp(0.75rem, 3.2vw, 0.875rem)" : "0.6875rem" }}
          title={person.fullName}
        >
          {person.fullName}
        </p>
        <p
          className="font-accent text-muted truncate mt-[3px]"
          style={{ fontSize: fluid ? "clamp(0.8rem, 3.4vw, 0.9rem)" : "0.75rem", lineHeight: 1.2 }}
          title={person.subtitle}
        >
          {person.subtitle}
        </p>
      </div>
    </div>
  );

  const wrapperClass = fluid
    ? "flex w-full justify-center overflow-visible select-none py-3 px-2"
    : "inline-block select-none";

  const sizedCard = fluid ? (
    <div className="w-[84%] pt-2">{cardInner}</div>
  ) : (
    cardInner
  );

  if (variant === "staff" && href) {
    return (
      <Link to={href} className={`${wrapperClass} no-underline`}>
        {sizedCard}
      </Link>
    );
  }

  return <div className={wrapperClass}>{sizedCard}</div>;
}

export function ShimmerCard({ fluid = false }: { fluid?: boolean }) {
  const card = (
    <div
      className={
        fluid
          ? "w-full rounded-[3px] px-[6%] pt-[6%] pb-[22%] animate-pulse"
          : "rounded-[3px] px-[10px] pt-[10px] pb-[38px] animate-pulse"
      }
      style={{
        width: fluid ? "100%" : "148px",
        background: PAPER_BG,
        border: FRAME_BORDER,
        boxShadow: "0 4px 14px rgba(90,72,52,0.07)",
      }}
    >
      <div
        className="w-full rounded-[2px] bg-[#eceae6]"
        style={{ aspectRatio: "1 / 1", boxShadow: PHOTO_WELL_SHADOW }}
      />
      <div className="mt-2 h-2 w-4/5 bg-[#eceae6] rounded mx-auto" />
      <div className="mt-[3px] h-1.5 w-3/5 bg-[#eceae6] rounded mx-auto" />
    </div>
  );

  if (!fluid) return card;

  return (
    <div className="flex w-full justify-center py-3 px-2">
      <div className="w-[84%] pt-2">{card}</div>
    </div>
  );
}