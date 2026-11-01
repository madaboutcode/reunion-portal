// BackdropDecor — absolutely-positioned decorative image layers for the
// confirmation page. Renders corner overlays, building photo, and signoff.
// All images live at /assets/confirmation/*.png (public folder).

export function BackdropDecor() {
  return (
    <div
      className="absolute inset-0 z-0 pointer-events-none select-none"
      aria-hidden="true"
    >
      {/* Paper texture base */}
      <img
        src="/assets/confirmation/paper-texture-tile.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover opacity-90"
      />

      {/* Building backdrop — left edge, desktop only */}
      <img
        src="/assets/confirmation/building-backdrop-desktop.png"
        alt=""
        className="absolute hidden md:block animate-[memory-surface_1.8s_ease-out_0.1s_both]"
        style={{
          left: -248,
          top: 176,
          width: "clamp(700px, 54vw, 980px)",
          height: "clamp(860px, 96vh, 1120px)",
          objectFit: "cover",
          objectPosition: "66% 15%",
          opacity: 0.97,
          filter: "drop-shadow(0 16px 28px rgba(60,40,20,0.12))",
          maskImage:
            "linear-gradient(to right, black 83%, rgba(0,0,0,0.94) 89%, rgba(0,0,0,0.62) 95%, transparent 100%), linear-gradient(to bottom, black 78%, rgba(0,0,0,0.9) 86%, rgba(0,0,0,0.42) 94%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, black 83%, rgba(0,0,0,0.94) 89%, rgba(0,0,0,0.62) 95%, transparent 100%), linear-gradient(to bottom, black 78%, rgba(0,0,0,0.9) 86%, rgba(0,0,0,0.42) 94%, transparent 100%)",
        }}
      />

      {/* Top-left corner overlay */}
      <img
        src="/assets/confirmation/corner-overlay-topleft.png"
        alt=""
        className="absolute top-0 left-0 animate-[memory-surface_1.2s_ease-out_both]"
        style={{ width: "clamp(320px, 34vw, 520px)" }}
      />

      {/* Top-right corner overlay */}
      <img
        src="/assets/confirmation/corner-overlay-topright.png"
        alt=""
        className="absolute top-0 right-0 opacity-[0.96] animate-[memory-surface_1.2s_ease-out_both]"
        style={{ width: "clamp(320px, 34vw, 540px)" }}
      />

      {/* Bottom-left handwritten message on paper scrap */}
      <div
        className="absolute z-10 hidden md:block animate-[memory-surface_1.8s_ease-out_0.8s_both]"
        style={{
          left: "clamp(20px, 3vw, 52px)",
          bottom: "clamp(40px, 6vh, 90px)",
          transform: "rotate(2deg)",
          transformOrigin: "bottom left",
          pointerEvents: "none",
        }}
      >
        {/* Paper scrap */}
        <div
          style={{
            background: "linear-gradient(135deg, rgba(255,251,240,0.92) 0%, rgba(248,242,228,0.90) 60%, rgba(243,236,218,0.88) 100%)",
            borderRadius: "3px 4px 5px 2px",
            padding: "14px 16px 12px",
            maxWidth: "clamp(190px, 19vw, 280px)",
            lineHeight: 1.25,
            boxShadow: "2px 3px 12px rgba(80,60,40,0.14), 0 1px 2px rgba(80,60,40,0.1)",
            position: "relative",
            border: "1px solid rgba(180,160,130,0.2)",
          }}
        >
          {/* Washi tape strip at top */}
          <div
            style={{
              position: "absolute",
              top: -7,
              left: "50%",
              transform: "translateX(-50%) rotate(2deg)",
              width: 52,
              height: 14,
              background: "rgba(185,223,226,0.55)",
              borderRadius: 1,
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
          />

          {/* Faint coffee ring stain */}
          <div
            style={{
              position: "absolute",
              bottom: 6,
              right: 4,
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "2px solid rgba(160,120,70,0.08)",
              background: "radial-gradient(circle, rgba(160,120,70,0.03) 60%, transparent 100%)",
            }}
          />

          <span
            style={{
              fontFamily: "'Caveat', cursive",
              fontSize: "clamp(16px, 1.5vw, 22px)",
              color: "#5a4a3a",
              display: "block",
            }}
          >
            back when those corridors
          </span>
          <span
            style={{
              fontFamily: "'Caveat', cursive",
              fontSize: "clamp(16px, 1.5vw, 22px)",
              color: "#5a4a3a",
              display: "block",
            }}
          >
            held everything we needed —
          </span>
          <span
            style={{
              fontFamily: "'Caveat', cursive",
              fontSize: "clamp(16px, 1.5vw, 22px)",
              color: "#5a4a3a",
              display: "block",
              marginTop: 2,
            }}
          >
            see you there, friend.{" "}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              style={{ display: "inline", verticalAlign: "middle" }}
            >
              <path
                d="M12 21C12 21 3 14.5 3 8.5C3 5.42 5.42 3 8.5 3C10.24 3 11.91 3.81 13 5.08C14.09 3.81 15.76 3 17.5 3C20.58 3 23 5.42 23 8.5C23 14.5 12 21 12 21Z"
                fill="#D76B51"
                opacity="0.45"
              />
            </svg>
          </span>
        </div>
      </div>

      {/* Bottom-right signoff */}
      <img
        src="/assets/confirmation/signoff-overlay-bottomright.png"
        alt=""
        className="absolute right-0 bottom-1.5 animate-[memory-surface_1.5s_ease-out_0.6s_both]"
        style={{
          width: "clamp(260px, 26vw, 380px)",
          filter: "drop-shadow(0 8px 18px rgba(60,40,20,0.08))",
        }}
      />
    </div>
  );
}
