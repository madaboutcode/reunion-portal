// WhatsNextPanel — horizontal strip (desktop) / stacked cards (mobile)
// with watercolor background and status-aware "what's next" cards.

import { type CSSProperties, type ReactNode } from "react";

// ─── NextIcons ────────────────────────────────────────────────────────────

const NextIcons = {
  email: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="5.5"
        width="18"
        height="13"
        rx="2"
        stroke="#5B969C"
        strokeWidth="1.7"
      />
      <path
        d="M3.5 6.5L12 13L20.5 6.5"
        stroke="#5B969C"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="19" cy="18" r="4" fill="#2d9b67" />
      <path
        d="M17 18l1.5 1.5L21 17"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  ticket: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 9V7a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 100 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 100-4z"
        stroke="#D76B51"
        strokeWidth="1.7"
      />
      <path
        d="M9 7l1 2 2 .3-1.4 1.4.3 2-1.9-1-1.9 1 .3-2L6 9.3 8 9z"
        fill="#D76B51"
      />
    </svg>
  ),
  heart: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 21s-8-5.5-8-11A5 5 0 018.5 5c1.54 0 2.94.74 3.5 1.85A4.84 4.84 0 0115.5 5 5 5 0 0120 10c0 5.5-8 11-8 11z"
        stroke="#D76B51"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="#D76B5133"
      />
    </svg>
  ),
  people: (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <circle cx="13" cy="13" r="12" fill="#25D366" />
      <path
        d="M9 17l-1 3 3.2-1c1 .3 1.9.4 2.8.3a5.5 5.5 0 10-5-2.3z"
        fill="white"
      />
      <path
        d="M11 11.2c0-.4.4-.7.8-.6.4 0 .7.4.8.7l.2 1c0 .2 0 .4-.1.6l-.4.4c.4.9 1.1 1.5 1.9 1.9l.4-.4c.2-.1.4-.2.6-.1l1 .2c.3.1.6.4.6.8 0 1-.8 1.7-1.7 1.7-2.9 0-5.3-2.4-5.3-5.3 0-1 .7-1.7 1.7-1.7l.5.2v.6z"
        fill="#25D366"
      />
    </svg>
  ),
  clock: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="#D76B51" strokeWidth="1.7" />
      <polyline
        points="12,6 12,12 16,14"
        stroke="#D76B51"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  lock: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect
        x="5"
        y="11"
        width="14"
        height="10"
        rx="2"
        stroke="#5B969C"
        strokeWidth="1.7"
      />
      <path
        d="M8 11V7a4 4 0 018 0v4"
        stroke="#5B969C"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="12" cy="16" r="1.5" fill="#5B969C" />
    </svg>
  ),
  creditCard: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="5" width="20" height="14" rx="2" stroke="#D76B51" strokeWidth="1.7" />
      <path d="M2 10h20" stroke="#D76B51" strokeWidth="1.7" />
      <path d="M6 14h3" stroke="#D76B51" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

// ─── WhatsNextCard ────────────────────────────────────────────────────────

interface WhatsNextCardProps {
  icon: ReactNode;
  color: string;
  title: string;
  desc: string;
  layout?: "desktop" | "mobile";
  href?: string;
}

function WhatsNextCard({
  icon,
  color,
  title,
  desc,
  layout = "desktop",
  href,
}: WhatsNextCardProps) {
  const isMobile = layout === "mobile";

  const containerStyle: CSSProperties = {
    background: isMobile ? "white" : "transparent",
    borderRadius: isMobile ? 14 : 0,
    padding: isMobile ? "18px 14px" : "4px 12px",
    border: isMobile ? "1px solid rgba(200,180,150,0.25)" : "none",
    textAlign: isMobile ? "center" : "left",
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    alignItems: isMobile ? "center" : "flex-start",
    gap: isMobile ? 12 : 14,
    textDecoration: "none",
  };

  const inner = (
    <>
      <div
        style={{
          width: 50,
          height: 50,
          borderRadius: "50%",
          background: `${color}22`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1F2A33", marginBottom: 4 }}>
          {title}
        </div>
        <div style={{ fontSize: 12.5, color: "#7a6a58", lineHeight: 1.5 }}>
          {desc}
        </div>
      </div>
    </>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={containerStyle}>
        {inner}
      </a>
    );
  }
  return <div style={containerStyle}>{inner}</div>;
}

// ─── WhatsNextPanel ───────────────────────────────────────────────────────

export interface WhatsNextPanelProps {
  layout?: "desktop" | "mobile";
  variant?: "attendee" | "donation";
  status?: "pending" | "pending_verification" | "confirmed";
}

export function WhatsNextPanel({
  layout = "desktop",
  variant = "attendee",
  status,
}: WhatsNextPanelProps) {
  const isMobile = layout === "mobile";
  const resolvedStatus = status ?? "confirmed";

  const cards = (() => {
    if (resolvedStatus === "pending_verification") {
      return [
        {
          icon: NextIcons.email,
          color: "#5B969C",
          title: isMobile ? "Check your email" : "Check your email",
          desc: isMobile
            ? "We'll notify you when your payment is verified — check spam too."
            : "We'll send you an email once we verify your payment — check your spam folder too, our emails sometimes land there.",
        },
        {
          icon: NextIcons.clock,
          color: "#D76B51",
          title: isMobile ? "Verification in progress" : "Verification in progress",
          desc: isMobile
            ? "We review payments within 24-48 hours."
            : "We review payments within 24-48 hours of submission.",
        },
        {
          icon: NextIcons.lock,
          color: "#5B969C",
          title: isMobile ? "Your data is secure" : "Your data is secure",
          desc: isMobile
            ? "Your registration details are safely stored."
            : "Your registration details are safely stored and will not be shared.",
        },
      ];
    }

    if (resolvedStatus === "pending") {
      return [
        {
          icon: NextIcons.creditCard,
          color: "#D76B51",
          title: isMobile ? "Complete payment" : "Complete payment to confirm",
          desc: isMobile
            ? "Pay via bank transfer to confirm your spot."
            : "Transfer the registration fee to confirm your spot at the reunion.",
        },
        {
          icon: NextIcons.email,
          color: "#5B969C",
          title: isMobile ? "Check your email" : "Confirmation email",
          desc: isMobile
            ? "We've sent the payment details to your email — check spam too."
            : "We've emailed the bank details and payment instructions to your registered email — check spam if you don't see it.",
        },
        {
          icon: NextIcons.clock,
          color: "#D76B51",
          title: isMobile ? "Don't wait" : "Seats are limited",
          desc: isMobile
            ? "Registration is confirmed only after payment."
            : "Your registration is confirmed only after the payment is received and verified.",
        },
      ];
    }

    // Default: confirmed
    return [
      {
        icon: NextIcons.email,
        color: "#5B969C",
        title: isMobile ? "Check your email" : "Confirmation sent",
        desc: isMobile
          ? "We've sent a confirmation email with all the details — check spam too."
          : "We've emailed your confirmation and details to your registered email — check spam if you don't see it.",
      },
      ...(variant === "donation"
        ? [
            {
              icon: NextIcons.heart,
              color: "#D76B51",
              title: isMobile ? "You made a difference" : "Your impact",
              desc: isMobile
                ? "Your contribution helps make this reunion happen."
                : "Your generosity helps cover the venue, food, and memories we'll make together.",
            },
          ]
        : [
            {
              icon: NextIcons.ticket,
              color: "#D76B51",
              title: "Bring your pass",
              desc: isMobile
                ? "Show your QR pass at the venue for smooth entry."
                : "Show your entry pass (printed or digital) at the reunion check-in.",
            },
          ]),
      {
        icon: NextIcons.people,
        color: "#25D366",
        title: isMobile ? "Stay connected" : "Join the community",
        desc: isMobile
          ? "Join our WhatsApp group for updates & fun!"
          : "Connect with batchmates and stay updated on all reunion buzz!",
        href: "https://chat.whatsapp.com/REPLACE_WITH_GROUP_INVITE",
      },
    ];
  })();

  return (
    <div
      style={{
        backgroundColor: "#F3EADA",
        backgroundImage:
          "url('/assets/confirmation/strip-bg-watercolour.png')",
        backgroundSize: "108% 130%",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        borderRadius: isMobile ? 16 : 18,
        border: "1px solid rgba(200,180,150,0.35)",
        boxShadow: isMobile
          ? "0 4px 18px rgba(60,40,20,0.1)"
          : "0 10px 28px rgba(60,40,20,0.1)",
        padding: isMobile
          ? "36px 14px 18px"
          : "22px clamp(20px, 2.5vw, 28px)",
        position: isMobile ? "relative" : undefined,
      }}
    >
      {/* Mobile: paperclip + camera decorations */}
      {isMobile && (
        <>
          <svg
            width="24"
            height="40"
            viewBox="0 0 22 34"
            style={{
              position: "absolute",
              top: -6,
              left: 22,
              zIndex: 4,
              filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.18))",
              transform: "rotate(-12deg)",
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
          <div
            style={{
              position: "absolute",
              top: 4,
              right: 14,
              zIndex: 4,
              transform: "rotate(8deg)",
            }}
          >
            <svg width="48" height="48" viewBox="0 0 60 50" fill="none">
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
              <rect
                x="44"
                y="16"
                width="6"
                height="3"
                fill="#3a2e22"
                rx="0.5"
              />
              <rect
                x="9"
                y="17"
                width="3"
                height="2"
                fill="#d76b51"
                opacity="0.7"
              />
            </svg>
          </div>
        </>
      )}

      {/* Header */}
      {isMobile ? (
        <div style={{ textAlign: "center", marginBottom: 16, position: "relative" }}>
          <h3
            style={{
              fontFamily: "'Caveat', cursive",
              fontSize: 32,
              fontWeight: 700,
              color: "#1F2A33",
              margin: 0,
              whiteSpace: "nowrap",
              display: "inline-block",
              position: "relative",
            }}
          >
            {resolvedStatus === "pending_verification"
              ? "Sit tight — committee is reviewing"
              : resolvedStatus === "pending"
                ? "Complete payment to confirm"
                : "What's next?"}
          </h3>
          <svg
            width="100"
            height="10"
            viewBox="0 0 100 10"
            style={{ display: "block", margin: "-2px auto 0" }}
          >
            <path
              d="M2 6 Q20 1 40 6 Q60 11 80 5 Q90 3 98 6"
              stroke="#D76B51"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginBottom: 14,
          }}
        >
          <span
            style={{
              fontFamily: "'Caveat', cursive",
              fontSize: 26,
              color: "#5B969C",
              fontStyle: "italic",
            }}
          >
            {resolvedStatus === "pending_verification"
              ? "Sit tight — committee is reviewing"
              : resolvedStatus === "pending"
                ? "Complete payment to confirm"
                : "What's next?"}
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <g stroke="#D76B51" strokeWidth="1.6" strokeLinecap="round">
              <line x1="12" y1="3" x2="12" y2="6" />
              <line x1="5" y1="6" x2="7" y2="8" />
              <line x1="17" y1="8" x2="19" y2="6" />
            </g>
          </svg>
        </div>
      )}

      {/* Cards grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr 1fr 1fr" : "repeat(3, 1fr)",
          gap: isMobile ? 8 : 18,
        }}
      >
        {cards.map((card, i) => (
          <WhatsNextCard
            key={i}
            icon={card.icon}
            color={card.color}
            title={card.title}
            desc={card.desc}
            layout={layout}
            href={"href" in card ? (card as { href?: string }).href : undefined}
          />
        ))}
      </div>
    </div>
  );
}
