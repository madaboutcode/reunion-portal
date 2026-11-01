// ─── Doodles.tsx ──────────────────────────────────────────────────────────────
// Canonical stroke-only SVG doodle components.
// Design language: hand-drawn feel, no fills, rounded caps, slight opacity.

export interface DoodleProps {
  size?: number;
  color?: string;
  className?: string;
}

// ─── GradCapDoodle ────────────────────────────────────────────────────────────

export function GradCapDoodle({
  size = 24,
  color = "#1F2A33",
  className = "",
}: DoodleProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`inline-block align-middle${className ? ` ${className}` : ""}`}
    >
      <path
        d="M2 10l10-5 10 5-10 5-10-5zM6 12v5c0 2 3 4 6 4s6-2 6-4v-5"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />
      <line
        x1="22"
        y1="10"
        x2="22"
        y2="16"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}

// ─── HeartDoodle ──────────────────────────────────────────────────────────────

export function HeartDoodle({
  size = 15,
  color = "#D76B51",
  className = "",
}: DoodleProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`inline-block align-middle${className ? ` ${className}` : ""}`}
    >
      <path
        d="M12 21s-9-6.5-9-12A5.5 5.5 0 018.5 3c1.74 0 3.41.81 4.5 2.09A6.04 6.04 0 0115.5 3 5.5 5.5 0 0121 9c0 5.5-9 12-9 12z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
        fill="none"
      />
    </svg>
  );
}

// ─── ThinkingDoodle ───────────────────────────────────────────────────────────

export function ThinkingDoodle({
  size = 24,
  color = "#1F2A33",
  className = "",
}: DoodleProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`inline-block align-middle${className ? ` ${className}` : ""}`}
    >
      {/* Face circle */}
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
      {/* Left eye */}
      <circle cx="9" cy="10" r="1" fill={color} opacity="0.5" />
      {/* Right eye */}
      <circle cx="15" cy="10" r="1" fill={color} opacity="0.5" />
      {/* Uncertain mouth */}
      <path
        d="M9 15c1 1 2 1 3 0"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
      {/* Hand on chin */}
      <path
        d="M7 16c-1 2-2 4-1 5"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}

// ─── CalendarDoodle ───────────────────────────────────────────────────────────

export function CalendarDoodle({
  size = 24,
  color = "#1F2A33",
  className = "",
}: DoodleProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`inline-block align-middle${className ? ` ${className}` : ""}`}
    >
      <path
        d="M4 8h16M4 8V6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V8z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
      {/* Hooks */}
      <path
        d="M8 2v4M16 2v4"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
      {/* Date dots */}
      <path
        d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}

// ─── PinDoodle ────────────────────────────────────────────────────────────────

export function PinDoodle({
  size = 24,
  color = "#1F2A33",
  className = "",
}: DoodleProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`inline-block align-middle${className ? ` ${className}` : ""}`}
    >
      <path
        d="M12 21c-4-4-8-7.5-8-12a8 8 0 1116 0c0 4.5-4 8-8 12z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
      <circle
        cx="12"
        cy="9"
        r="3"
        stroke={color}
        strokeWidth="1.5"
        opacity="0.6"
      />
    </svg>
  );
}

// ─── HotelDoodle ──────────────────────────────────────────────────────────────

export function HotelDoodle({
  size = 24,
  color = "#1F2A33",
  className = "",
}: DoodleProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`inline-block align-middle${className ? ` ${className}` : ""}`}
    >
      {/* Building outline */}
      <path
        d="M3 21h18M5 21V7l7-4 7 4v14"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
      {/* Windows */}
      <path
        d="M9 10v2M15 10v2M9 15v2M15 15v2"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
      {/* Door */}
      <path
        d="M10 21v-4h4v4"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </svg>
  );
}

// ─── CameraDoodle ─────────────────────────────────────────────────────────────

export function CameraDoodle({
  size = 24,
  color = "#1F2A33",
  className = "",
}: DoodleProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`inline-block align-middle${className ? ` ${className}` : ""}`}
    >
      {/* Body */}
      <rect
        x="2"
        y="7"
        width="20"
        height="13"
        rx="2"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
      {/* Lens */}
      <circle
        cx="12"
        cy="13"
        r="4"
        stroke={color}
        strokeWidth="1.5"
        opacity="0.6"
      />
      {/* Viewfinder bump */}
      <path
        d="M8 7l1.5-3h5L16 7"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </svg>
  );
}

// ─── Suggest20kDoodle ─────────────────────────────────────────────────────────

export function Suggest20kDoodle({
  color = "#555",
  className = "",
}: Omit<DoodleProps, "size">) {
  return (
    <div
      className={`inline-flex items-end gap-0.5 whitespace-nowrap${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      {/* Arrow first — this is the anchor point aligned to the chip center */}
      <svg width="12" height="14" viewBox="0 0 12 14" fill="none" className="shrink-0">
        <path
          d="M6 1C5.5 4 5 7 5.5 11"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M3 9l2.5 4L8 9"
          stroke={color}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>

      <span className="font-accent text-[14px] leading-tight" style={{ color }}>
        20k for the 20th?
      </span>
    </div>
  );
}

// ─── PaperPlaneDoodle ─────────────────────────────────────────────────────────

export function PaperPlaneDoodle({
  size = 15,
  color = "#D76B51",
  className = "",
}: DoodleProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`inline-block align-middle${className ? ` ${className}` : ""}`}
    >
      <path
        d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.45"
      />
    </svg>
  );
}
