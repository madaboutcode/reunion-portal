import { SmritiLogo } from "@/components/ui/SmritiLogo";

interface MessageDef {
  text: string;
  top: string;
  left?: string;
  right?: string;
  rotate: number;
  size: number;
  color: string;
}

const MESSAGES: MessageDef[] = [
  // Top zone (above center name block)
  { text: "നന്ദി ❤️", top: "6%", left: "6%", rotate: 5, size: 20, color: "#D76B51" },
  { text: "You're funding the biriyani 😂", top: "7%", right: "3%", rotate: -4, size: 18, color: "#1F2A33" },
  { text: "One of the good ones.", top: "20%", left: "5%", rotate: -2, size: 20, color: "#1F2A33" },
  { text: "Still counting you in.", top: "19%", right: "5%", rotate: 3, size: 17, color: "#6B7280" },
  // Bottom zone (below center name block)
  { text: "Legend. 🫡", top: "66%", left: "6%", rotate: -5, size: 21, color: "#1F2A33" },
  { text: "Next one, no excuses!", top: "67%", right: "4%", rotate: -3, size: 17, color: "#5B969C" },
  { text: "Canteen debt settled! 😄", top: "78%", left: "5%", rotate: 6, size: 16, color: "#6B7280" },
  { text: "Distance ≠ disconnect", top: "79%", right: "6%", rotate: -2, size: 16, color: "#D76B51" },
  { text: "— your batchmates", top: "90%", right: "10%", rotate: 2, size: 15, color: "#6B7280" },
];

export interface ThankYouCardProps {
  name: string;
  amount: string;
  size?: "desktop" | "mobile";
}

export function ThankYouCard({ name, amount, size = "desktop" }: ThankYouCardProps) {
  const isDesktop = size === "desktop";
  const logoSize = isDesktop ? 100 : 80;

  return (
    <div className={`ty-card-scene ty-card-scene--${size}`}>
      <div className="ty-card-inner">

        {/* ── FRONT FACE ── */}
        <div className="ty-card-face ty-card-face--front">
          <img
            src="/assets/confirmation/building-backdrop-desktop.png"
            alt="" aria-hidden="true"
            className="ty-card-bg-image"
          />
          <img
            src="/assets/confirmation/corner-overlay-topright.png"
            alt="" aria-hidden="true"
            className="ty-card-corner ty-card-corner--tr"
          />
          <img
            src="/assets/confirmation/corner-overlay-topleft.png"
            alt="" aria-hidden="true"
            className="ty-card-corner ty-card-corner--tl"
          />
          <div className="ty-card-front-content">
            <div style={{ filter: "drop-shadow(0 2px 6px rgba(60,40,20,0.12))" }}>
              <SmritiLogo size={logoSize} />
            </div>
            <h2 className="ty-card-title">With Gratitude</h2>
            <div className="ty-card-donor-accent">{name}</div>
          </div>
        </div>

        {/* ── BACK FACE (revealed on flip) ── */}
        <div className="ty-card-face ty-card-face--back">
          <img
            src="/assets/confirmation/strip-bg-watercolour.png"
            alt="" aria-hidden="true"
            className="ty-card-watercolor"
          />

          {MESSAGES.map((msg, i) => (
            <span
              key={i}
              className="ty-card-msg"
              style={{
                top: msg.top,
                left: msg.left,
                right: msg.right,
                fontSize: `${msg.size}px`,
                color: msg.color,
                ["--msg-rotate" as string]: `${msg.rotate}deg`,
                animationDelay: `${3.5 + i * 0.15}s`,
                transform: `rotate(${msg.rotate}deg)`,
              }}
            >
              {msg.text}
            </span>
          ))}

          <div className="ty-card-donor-center">
            <div className="ty-card-donor-label">Thank you</div>
            <div className="ty-card-donor-name" style={{ fontSize: isDesktop ? "28px" : "24px" }}>
              {name}
            </div>
            <div className="ty-card-donor-amount">{amount}</div>
          </div>

          <img
            src="/assets/confirmation/signoff-overlay-bottomright.png"
            alt="" aria-hidden="true"
            className="ty-card-signoff"
          />

          <div className="ty-card-branding">Smriti 2026 · TKMCE</div>
        </div>

      </div>
    </div>
  );
}
