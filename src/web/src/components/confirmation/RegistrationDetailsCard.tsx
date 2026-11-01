// RegistrationDetailsCard — the main content card showing registration
// summary: status badge, detail rows, and a thank-you callout.

import type { ReactNode } from "react";
import type { DerivedDisplay } from "./deriveDisplay";
import { PassCodeBar } from "./PassCodeBar";

// ─── Icons ────────────────────────────────────────────────────────────────

const Ic = {
  user: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.5" stroke="#5B969C" strokeWidth="1.5" />
      <path d="M4 20c0-3.3 3.6-5 8-5s8 1.7 8 5" stroke="#5B969C" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  users: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="8" r="3" stroke="#5B969C" strokeWidth="1.4" />
      <circle cx="16" cy="9" r="2.4" stroke="#5B969C" strokeWidth="1.3" />
      <path d="M2 20c0-2.5 3-4 7-4s7 1.5 7 4" stroke="#5B969C" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M16 16c3 0 6 1 6 4" stroke="#5B969C" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  food: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 3v8a3 3 0 003 3v7M6 3v6h3V3M9 3v6M15 3v5c0 2 1 3 2 3v10"
        stroke="#5B969C"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  bed: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 18v-7c0-1.5 1-2.5 2.5-2.5h13c1.5 0 2.5 1 2.5 2.5v7M3 14h18M3 19v2M21 19v2"
        stroke="#5B969C"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11" r="2" stroke="#5B969C" strokeWidth="1.3" />
    </svg>
  ),
  card: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="2.5" y="6" width="19" height="12" rx="2" stroke="#5B969C" strokeWidth="1.5" />
      <path d="M2.5 10h19" stroke="#5B969C" strokeWidth="1.5" />
      <path d="M6 14h4" stroke="#5B969C" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  tshirt: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M8 2l-6 4 3 3 2-1v12h10V8l2 1 3-3-6-4c0 1.5-1.5 3-4 3S8 3.5 8 2z" stroke="#5B969C" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  heart: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 20s-7-5.2-7-9.7A4.3 4.3 0 019.3 6c1.3 0 2.4.6 3.2 1.6A4.1 4.1 0 0115.7 6 4.3 4.3 0 0120 10.3C20 14.8 12 20 12 20z"
        stroke="#5B969C"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

// ─── StatusBadge ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: "pending" | "pending_verification" | "confirmed" }) {
  if (status === "pending") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 700,
          color: "#6b7280",
          background: "#F3F4F6",
          border: "1.5px solid rgba(107,114,128,0.3)",
          padding: "4px 12px 4px 14px",
          borderRadius: 22,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#6b7280" strokeWidth="2" />
          <line x1="12" y1="8" x2="12" y2="13" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="1" fill="#6b7280" />
        </svg>
        AWAITING PAYMENT
      </span>
    );
  }

  if (status === "pending_verification") {
    return (
      <span
        className="animate-pulse"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 700,
          color: "#D76B51",
          background: "#FEF3EE",
          border: "1.5px solid rgba(215,107,81,0.3)",
          padding: "4px 12px 4px 14px",
          borderRadius: 22,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#D76B51" strokeWidth="2" />
          <polyline points="12,6 12,12 16,14" stroke="#D76B51" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        VERIFICATION IN PROGRESS
      </span>
    );
  }

  // Default: confirmed
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        fontWeight: 700,
        color: "#2d9b67",
        background: "#E5F4ED",
        border: "1.5px solid rgba(45,155,103,0.3)",
        padding: "4px 12px 4px 14px",
        borderRadius: 22,
      }}
    >
      Paid
      <svg width="14" height="14" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="7" fill="#2d9b67" />
        <path
          d="M4.5 8.2 L6.8 10.5 L11.5 5.5"
          stroke="white"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

// ─── DetailRow ────────────────────────────────────────────────────────────

interface DetailRowProps {
  icon: ReactNode;
  label: string;
  value?: string;
  valueNode?: ReactNode;
}

function DetailRow({ icon, label, value, valueNode }: DetailRowProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "24px minmax(130px, max-content) 1fr",
        alignItems: "center",
        gap: 10,
        padding: "9px 0",
        borderBottom: "1px dashed rgba(170,140,100,0.18)",
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#5B969C",
        }}
      >
        {icon}
      </div>
      <span style={{ fontSize: 12.5, color: "#5a6b6e", fontWeight: 500 }}>
        {label}
      </span>
      <div
        style={{
          textAlign: "right",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {valueNode ?? (
          <span style={{ fontSize: 13.5, color: "#1F2A33", fontWeight: 600 }}>
            {value}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── RegistrationDetailsCard ──────────────────────────────────────────────

export interface RegistrationDetailsCardProps {
  d: DerivedDisplay;
  status?: "pending" | "pending_verification" | "confirmed";
}

export function RegistrationDetailsCard({ d, status }: RegistrationDetailsCardProps) {
  const resolvedStatus = status ?? "confirmed";

  return (
    <div
      style={{
        background: "rgba(255,253,247,0.96)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        borderRadius: 20,
        border: "1px solid rgba(200,180,150,0.35)",
        boxShadow: "0 16px 50px rgba(60,40,20,0.14)",
        padding: "clamp(24px, 3vw, 36px) clamp(24px, 3vw, 40px)",
        position: "relative",
      }}
    >
      {/* Headline */}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <h1
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: "clamp(28px, 3.6vw, 42px)",
            fontWeight: 700,
            fontStyle: "italic",
            color: "#D76B51",
            lineHeight: 1.0,
            margin: "0 0 10px",
            letterSpacing: "-0.02em",
            whiteSpace: "nowrap",
          }}
        >
          {resolvedStatus === "confirmed"
            ? "You're Registered!"
            : resolvedStatus === "pending_verification"
              ? "Verification in Progress"
              : "Registration Pending"}
        </h1>
        <p style={{ fontSize: 14, color: "#5a6b6e", margin: "0 0 3px" }}>
          {resolvedStatus === "confirmed"
            ? "We can't wait to welcome you back home."
            : resolvedStatus === "pending_verification"
              ? "Your proof has been received. We're reviewing it."
              : "Complete your payment to confirm your registration."}
        </p>
        <p
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: 15,
            color: "#5B969C",
            fontStyle: "italic",
            margin: 0,
          }}
        >
          Two decades later, the memories continue…
        </p>
      </div>

      {/* Pass code — only shown once confirmed */}
      {resolvedStatus === "confirmed" && (
        <div className="mb-3.5">
          <PassCodeBar code={d.reg} />
        </div>
      )}

      {/* Save the date */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: "16px 24px",
          background: "linear-gradient(135deg, #FBE4D6 0%, #FAEBDD 100%)",
          borderRadius: 14,
          marginBottom: 18,
          border: "1px solid rgba(215,107,81,0.25)",
        }}
      >
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: "#b85a3d",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Save the Date
        </span>
        <span
          style={{
            fontFamily: "'Playfair Display', Georgia, serif",
            fontSize: "clamp(22px, 3vw, 30px)",
            fontWeight: 700,
            color: "#D76B51",
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          15 August 2026
        </span>
      </div>

      {/* Detail rows */}
      <div style={{ marginBottom: 16 }}>
        <DetailRow icon={Ic.user} label="Attendee Name" value={d.name} />
        {d.tshirtLabel && (
          <DetailRow icon={Ic.tshirt} label="T-Shirt" value={d.tshirtLabel} />
        )}
        <DetailRow icon={Ic.heart} label="Joining As" value={d.attendanceLabel} />
        <DetailRow
          icon={Ic.users}
          label="Tickets / Attendees"
          value={d.ticketsLabel}
        />
        <DetailRow
          icon={Ic.food}
          label="Food Preference"
          valueNode={
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: d.foodLabel.color,
              }}
            >
              {d.foodLabel.text}
            </span>
          }
        />
        <DetailRow
          icon={Ic.bed}
          label="Accommodation"
          value={d.accomLabel}
        />
        <DetailRow icon={Ic.card} label="Donation" value={d.donationLabel} />
        <DetailRow
          icon={Ic.card}
          label="Payment Status"
          valueNode={<StatusBadge status={resolvedStatus} />}
        />
      </div>

      {/* Thank you callout */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          padding: "12px 14px",
          background: "rgba(155,205,210,0.18)",
          border: "1px solid rgba(155,205,210,0.4)",
          borderRadius: 12,
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          style={{ flexShrink: 0, marginTop: 1 }}
        >
          <path
            d="M12 21s-9-6.5-9-12A5.5 5.5 0 018.5 3c1.74 0 3.41.81 4.5 2.09A6.04 6.04 0 0115.5 3 5.5 5.5 0 0121 9c0 5.5-9 12-9 12z"
            stroke="#2A7A80"
            strokeWidth="1.6"
            fill="rgba(155,205,210,0.4)"
            strokeLinejoin="round"
          />
        </svg>
        <div style={{ fontSize: 13, color: "#3a5256", lineHeight: 1.55 }}>
          Thank you for being part of <strong>Smriti</strong>.
          <br />
          Let&apos;s make this reunion unforgettable!
        </div>
      </div>
    </div>
  );
}
