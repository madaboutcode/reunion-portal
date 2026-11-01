import { useIsMobile } from "@/hooks/useIsMobile";
import { PolaroidFrame } from "@/components/polaroids/PolaroidFrame";
import { BatchBadge } from "./BatchBadge";
import {
  HeartDoodle,
  PaperPlaneDoodle,
  CalendarDoodle,
  PinDoodle,
} from "@/components/ui/Doodles";

// Re-export so existing importers of Hero.tsx continue to work.
export { HeartDoodle, PaperPlaneDoodle };

// ─── ScriptText ─────────────────────────────────────────────────────────────────

export interface ScriptTextProps {
  size?: number;
  color?: string;
  className?: string;
  children: React.ReactNode;
}

export function ScriptText({
  size = 16,
  color = "#D76B51",
  className = "",
  children,
}: ScriptTextProps) {
  return (
    <span
      className={`font-accent ${className}`}
      style={{ fontSize: size, color, fontWeight: 600, lineHeight: 1.3 }}
    >
      {children}
    </span>
  );
}





// ─── DateChip / LocationChip ────────────────────────────────────────────────────

function DateChip() {
  return (
    <span className="inline-flex items-center gap-1.5 bg-[rgba(215,107,81,0.12)] border border-[rgba(215,107,81,0.32)] rounded-full px-3.5 py-1.5 backdrop-blur-[2px] whitespace-nowrap">
      <CalendarDoodle size={13} color="#D76B51" />
      <span className="text-xs font-bold text-terracotta">
        August 15, 2026
      </span>
    </span>
  );
}

function LocationChip() {
  return (
    <span className="inline-flex items-center gap-1.5 bg-[rgba(185,223,226,0.25)] border border-[rgba(185,223,226,0.45)] rounded-full px-3.5 py-1.5 backdrop-blur-[2px] whitespace-nowrap">
      <PinDoodle size={13} color="#2a7a80" />
      <span className="text-xs font-semibold text-[#2a7a80]">
        Kollam, Kerala
      </span>
    </span>
  );
}

// ─── MobileDateChip / MobileLocationChip ────────────────────────────────────────

function MobileDateChip() {
  return (
    <span className="inline-flex items-center gap-1.5 bg-[rgba(215,107,81,0.1)] border border-[rgba(215,107,81,0.25)] rounded-full px-3 py-1.5">
      <CalendarDoodle size={13} color="#D76B51" />
      <span className="text-xs font-bold text-terracotta">
        August 15, 2026
      </span>
    </span>
  );
}

function MobileLocationChip() {
  return (
    <span className="inline-flex items-center gap-1.5 bg-[rgba(185,223,226,0.15)] border border-[rgba(185,223,226,0.3)] rounded-full px-3 py-1.5">
      <PinDoodle size={13} color="#2a7a80" />
      <span className="text-xs font-medium text-[#2a7a80]">
        Kollam, Kerala
      </span>
    </span>
  );
}

// ─── SmritiHero ─────────────────────────────────────────────────────────────────

export interface SmritiHeroProps {
  title?: string;
  subtitle?: React.ReactNode;
  tagline?: React.ReactNode;
}

export default function SmritiHero({
  title = "Registration",
  subtitle = <>2006 <span className="text-terracotta">Batch</span> Reunion</>,
  tagline = <>Two decades. Countless memories.<br />One unforgettable bond.</>,
}: SmritiHeroProps = {}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="relative overflow-hidden bg-surface">
        {/* Building strip */}
        <div className="relative h-[160px] overflow-hidden animate-[fadeIn_0.6s_ease_both]">
          <img
            src="/assets/tkmce-building-hero-centered.png"
            alt="TKM College of Engineering"
            className="w-full h-full object-cover object-[center_25%] block"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent from-40% to-surface" />
          {/* Bottom gradient fade */}
        </div>

        {/* Text */}
        <div className="px-5 pt-3 pb-6">
          <h1 className="font-heading text-[28px] text-charcoal font-bold leading-tight m-0 mb-1 animate-[settle-down_0.5s_ease_0.25s_both]">
            {title}
          </h1>
          <h2 className="font-heading text-[26px] text-terracotta font-bold leading-tight m-0 mb-3 animate-[settle-down_0.5s_ease_0.25s_both]">
            {subtitle}
          </h2>
          <p className="text-[13px] text-muted italic m-0 mb-[18px] animate-[settle-down_0.5s_ease_0.25s_both]">
            {tagline}
          </p>
          <div className="flex gap-2 flex-wrap animate-[settle-down_0.5s_ease_0.4s_both]">
            <MobileDateChip />
            <MobileLocationChip />
          </div>
        </div>
      </div>
    );
  }

  // ── Desktop ──
  return (
    <div className="bg-surface overflow-hidden">
      <div className="max-w-[1280px] mx-auto h-[380px] relative overflow-hidden">
        {/* Background — full-bleed building photo */}
        <img
          src="/assets/tkmce-building-hero-desktop.png"
          alt="TKM College of Engineering"
          className="absolute inset-0 w-full h-full object-cover object-[60%_55%] block animate-[fadeIn_0.6s_ease_both]"
        />

        {/* Gradient wash for text readability */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(to right, rgba(253,251,247,0.92) 0%, rgba(253,251,247,0.7) 28%, rgba(253,251,247,0.2) 48%, rgba(253,251,247,0) 60%)",
          }}
        />

        {/* Content overlay */}
        <div className="absolute top-0 left-0 bottom-0 w-[54%] flex flex-col justify-center z-[2] py-8 pl-14">
          <h1 className="font-heading text-charcoal font-bold leading-none m-0 mb-1 [font-size:clamp(28px,3.2vw,42px)] animate-[settle-down_0.5s_ease_0.25s_both]">
            {title}
          </h1>
          <h2 className="font-heading text-charcoal font-bold italic leading-[1.1] m-0 mb-[14px] [font-size:clamp(26px,3vw,40px)] animate-[settle-down_0.5s_ease_0.25s_both]">
            {subtitle}
          </h2>
          <p className="text-sm text-muted italic m-0 mb-[18px] leading-relaxed max-w-[380px] animate-[settle-down_0.5s_ease_0.25s_both]">
            {tagline}
          </p>

          <div className="flex gap-2 flex-wrap animate-[settle-down_0.5s_ease_0.4s_both]">
            <DateChip />
            <LocationChip />
          </div>
        </div>

        {/* Polaroid — top right */}
        <PolaroidFrame
          slotId="register-hero"
          rotation={4}
          width={128}
          className="!absolute z-[3]"
          style={{
            top: 28,
            right: 32,
            boxShadow: "2px 6px 18px rgba(0,0,0,0.18)",
          }}
        />

        {/* Vintage Batch Badge — bottom right */}
        <BatchBadge
          size={104}
          style={{ position: "absolute", bottom: 26, right: 32, transform: "rotate(8deg)" }}
        />
      </div>
    </div>
  );
}
