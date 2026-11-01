// ScrapbookCluster — desktop-only decorative cluster of polaroid photos,
// doodle note, and heart doodles. Absolutely positioned.

import { PolaroidFrame } from "@/components/polaroids/PolaroidFrame";

// ─── DoodleNote ────────────────────────────────────────────────────────────

interface DoodleNoteProps {
  text: string;
  rotation?: number;
  width?: number;
  style?: React.CSSProperties;
}

function DoodleNote({
  text,
  rotation = -2,
  width = 200,
  style = {},
}: DoodleNoteProps) {
  return (
    <div
      style={{
        width,
        transform: `rotate(${rotation}deg)`,
        ...style,
      }}
    >
      {/* Paperclip */}
      <svg
        width="22"
        height="34"
        viewBox="0 0 22 34"
        style={{
          position: "absolute",
          top: -10,
          left: 14,
          zIndex: 3,
          filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.18))",
        }}
      >
        <path
          d="M11 4 C7 4 4 7 4 11 L4 24 C4 27 6 29 9 29 C12 29 14 27 14 24 L14 12 C14 10.5 13 9 11 9 C9 9 8 10.5 8 12 L8 22"
          stroke="#a8a08c"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      {/* Paper */}
      <div
        style={{
          backgroundImage: `
            linear-gradient(to bottom, #fbf6e8 0%, #f5ecd6 100%),
            repeating-linear-gradient(to bottom, transparent 0, transparent 23px, rgba(180,150,110,0.22) 23px, rgba(180,150,110,0.22) 24px)
          `,
          backgroundBlendMode: "multiply",
          padding: "20px 18px 22px",
          boxShadow: "1px 4px 14px rgba(60,40,20,0.15)",
          position: "relative",
          clipPath:
            "polygon(0% 4%, 5% 0%, 96% 2%, 100% 6%, 99% 96%, 95% 100%, 4% 99%, 0% 94%)",
        }}
      >
        <p
          style={{
            fontFamily: "'Caveat', cursive",
            fontSize: 20,
            lineHeight: 1.25,
            color: "#4a3a2a",
            textAlign: "left",
            margin: 0,
            whiteSpace: "pre-line",
          }}
        >
          {text}
        </p>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          style={{
            position: "absolute",
            bottom: 8,
            right: 12,
            opacity: 0.65,
          }}
        >
          <path
            d="M12 21s-9-6.5-9-12A5.5 5.5 0 018.5 3c1.74 0 3.41.81 4.5 2.09A6.04 6.04 0 0115.5 3 5.5 5.5 0 0121 9c0 5.5-9 12-9 12z"
            stroke="#D76B51"
            strokeWidth="1.4"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

// ─── CameraDoodle ─────────────────────────────────────────────────────────

export interface CameraDoodleProps {
  size?: number;
}

export function CameraDoodle({ size = 56 }: CameraDoodleProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 50" fill="none">
      <rect
        x="6"
        y="14"
        width="48"
        height="30"
        rx="4"
        fill="#6b5a48"
        stroke="#3a2e22"
        strokeWidth="1.5"
      />
      <rect x="6" y="14" width="48" height="8" fill="#5a4a38" />
      <path
        d="M18 14 L22 8 L38 8 L42 14 Z"
        fill="#5a4a38"
        stroke="#3a2e22"
        strokeWidth="1.3"
      />
      <circle
        cx="30"
        cy="30"
        r="9"
        fill="#2a2018"
        stroke="#3a2e22"
        strokeWidth="1.3"
      />
      <circle cx="30" cy="30" r="6" fill="#4a3a28" />
      <circle cx="30" cy="30" r="3" fill="#1a1410" />
      <circle cx="28" cy="28" r="1.2" fill="white" opacity="0.6" />
      <rect x="44" y="16" width="6" height="3" fill="#3a2e22" rx="0.5" />
      <rect x="9" y="17" width="3" height="2" fill="#d76b51" opacity="0.7" />
    </svg>
  );
}

// ─── ScrapbookCluster ──────────────────────────────────────────────────────

export function ScrapbookCluster() {
  return (
    <div
      className="hidden md:block"
      style={{
        position: "absolute",
        left: 8,
        top: 458,
        width: "clamp(240px, 26vw, 380px)",
        height: 420,
        zIndex: 2,
        pointerEvents: "none",
      }}
      aria-hidden="true"
    >
      {/* First polaroid */}
      <div
        className="animate-[polaroid-drop_0.5s_cubic-bezier(0.34,1.56,0.64,1)_0.4s_both]"
        style={
          {
            position: "absolute",
            left: 4,
            top: 28,
            "--drop-rotation": "-5deg",
          } as React.CSSProperties
        }
      >
        <PolaroidFrame
          slotId="confirmation-0"
          rotation={0}
          width={150}
          style={{ boxShadow: "2px 6px 18px rgba(60,40,20,0.18)" }}
        />
      </div>

      {/* Second polaroid */}
      <div
        className="animate-[polaroid-drop_0.5s_cubic-bezier(0.34,1.56,0.64,1)_0.55s_both]"
        style={
          {
            position: "absolute",
            left: 148,
            top: 138,
            "--drop-rotation": "6deg",
          } as React.CSSProperties
        }
      >
        <PolaroidFrame
          slotId="confirmation-1"
          rotation={0}
          width={136}
          style={{ boxShadow: "2px 6px 18px rgba(60,40,20,0.18)" }}
        />
      </div>

      {/* Doodle note */}
      <div
        className="animate-[polaroid-drop_0.4s_ease_0.85s_both]"
        style={
          {
            position: "absolute",
            left: 8,
            top: 246,
            "--drop-rotation": "-6deg",
          } as React.CSSProperties
        }
      >
        <DoodleNote
          text={"Same idiots.\nDifferent decades."}
          rotation={0}
          width={166}
          style={{}}
        />
      </div>

      {/* Heart doodles */}
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        style={{ position: "absolute", left: 176, top: 92, opacity: 0.75 }}
      >
        <path
          d="M12 21s-9-6.5-9-12A5.5 5.5 0 018.5 3c1.74 0 3.41.81 4.5 2.09A6.04 6.04 0 0115.5 3 5.5 5.5 0 0121 9c0 5.5-9 12-9 12z"
          stroke="#D76B51"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        style={{ position: "absolute", left: 214, top: 242, opacity: 0.78 }}
      >
        <path
          d="M12 21s-9-6.5-9-12A5.5 5.5 0 018.5 3c1.74 0 3.41.81 4.5 2.09A6.04 6.04 0 0115.5 3 5.5 5.5 0 0121 9c0 5.5-9 12-9 12z"
          stroke="#D76B51"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
