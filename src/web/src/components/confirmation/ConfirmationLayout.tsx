// ConfirmationLayout — top-level shell that switches between desktop and
// mobile layouts. Receives derived display data from the page component.
// Accepts optional status prop to drive conditional rendering per payment state.
//
// Rendering strategy:
// - pending / pending_verification → simple centered status page (no scrapbook)
// - confirmed → full desktop/mobile split with entry pass and decorative elements

import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { RegistrationResponseData } from "@smriti/shared";
import { formatRegCodeForDisplay } from "@smriti/shared";
import { SmritiLogo } from "@/components/ui/SmritiLogo";
import { PaymentProgress } from "@/components/ui/PaymentProgress";
import { BackdropDecor } from "./BackdropDecor";
import { RegistrationDetailsCard } from "./RegistrationDetailsCard";
import { deriveDisplay } from "./deriveDisplay";
import { EntryPassCard } from "./EntryPassCard";
import { ScrapbookCluster } from "./ScrapbookCluster";
import { PassCodeBar } from "./PassCodeBar";
import { WhatsNextPanel } from "./WhatsNextPanel";
import { ConfirmationActions } from "./ConfirmationActions";

export interface ConfirmationLayoutProps {
  data: RegistrationResponseData;
  regCode: string;
  onReset?: () => void;
  status?: "pending" | "pending_verification" | "confirmed";
}

export function ConfirmationLayout({
  data,
  regCode,
  onReset,
  status,
}: ConfirmationLayoutProps) {
  const isMobile = useIsMobile();
  const displayRegCode = formatRegCodeForDisplay(regCode);
  const d = deriveDisplay(data, displayRegCode);
  const resolvedStatus = status ?? "confirmed";

  // pending and pending_verification get a minimal status page — no scrapbook
  if (resolvedStatus === "pending" || resolvedStatus === "pending_verification") {
    return (
      <StatusOnlyLayout
        status={resolvedStatus}
        regCode={data.regCode}
      />
    );
  }

  if (isMobile) {
    return (
      <ConfirmationMobile
        d={d}
        regCode={displayRegCode}
        rawCode={regCode}
        status={resolvedStatus}
        onReset={onReset}
      />
    );
  }
  return (
    <ConfirmationDesktop
      d={d}
      regCode={displayRegCode}
      rawCode={regCode}
      status={resolvedStatus}
      onReset={onReset}
    />
  );
}

// ─── StatusOnlyLayout ─────────────────────────────────────────────────────

interface StatusOnlyLayoutProps {
  status: "pending" | "pending_verification";
  regCode: string;
}

function StatusOnlyLayout({ status, regCode }: StatusOnlyLayoutProps) {
  const isPending = status === "pending";

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-6">
      <div className="w-full max-w-lg text-center">
        <div className="flex justify-center mb-6">
          <SmritiLogo size={100} href="/" />
        </div>
        {isPending ? (
          <>
            <PaymentProgress currentStatus={status} />
            <div className="mt-8">
              <p className="text-sm text-muted mb-6">
                You still need to upload your payment proof.
              </p>
              <a
                href={`/pay/${regCode}`}
                className="inline-flex items-center justify-center px-6 py-3 bg-terracotta text-white rounded-xl text-sm font-semibold no-underline hover:brightness-95"
              >
                Go to Payment
              </a>
            </div>
          </>
        ) : (
          <>
            <style>{`
              @keyframes draw-circle { to { stroke-dashoffset: 0 } }
              @keyframes draw-check { to { stroke-dashoffset: 0 } }
            `}</style>

            {/* Payment progress — always at top */}
            <PaymentProgress currentStatus={status} />

            {/* Animated checkmark — below progress */}
            <div className="flex flex-col items-center mt-8 mb-2">
              <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
                <circle
                  cx="36" cy="36" r="28"
                  stroke="#2D9B67"
                  strokeWidth="3"
                  strokeLinecap="round"
                  style={{
                    strokeDasharray: 176,
                    strokeDashoffset: 176,
                    animation: "draw-circle 0.6s ease forwards",
                  }}
                />
                <path
                  d="M24 36 L33 45 L48 27"
                  stroke="#2D9B67"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    strokeDasharray: 50,
                    strokeDashoffset: 50,
                    animation: "draw-check 0.3s ease 0.6s forwards",
                  }}
                />
              </svg>
            </div>

            <div className="mt-6">
              <h1 className="font-heading text-xl font-bold text-charcoal mb-2">
                We&apos;ve received your payment proof
              </h1>
              <p className="text-sm text-muted mb-5 leading-relaxed">
                You&apos;re all set — nothing more to do from your side.
              </p>

              <div className="text-left max-w-sm mx-auto mb-6 space-y-3">
                <div className="flex gap-3 items-start">
                  <span className="shrink-0 mt-0.5 text-[#2A7A80]" aria-hidden="true">&#9679;</span>
                  <p className="text-sm text-charcoal">
                    <strong>What happens next?</strong> We&apos;ll verify your payment — usually takes a day or two.
                  </p>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="shrink-0 mt-0.5 text-[#2A7A80]" aria-hidden="true">&#9679;</span>
                  <p className="text-sm text-charcoal">
                    <strong>How will I know?</strong> You&apos;ll get an email once your payment is confirmed — check your spam folder too, our emails sometimes land there.
                  </p>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="shrink-0 mt-0.5 text-[#2A7A80]" aria-hidden="true">&#9679;</span>
                  <p className="text-sm text-charcoal">
                    <strong>Can I check back?</strong> Yes — just visit this page anytime to see the latest status.
                  </p>
                </div>
              </div>

              <a
                href="/"
                className="inline-flex items-center justify-center px-6 py-3 bg-terracotta text-white rounded-xl text-sm font-semibold no-underline hover:brightness-95"
              >
                Go Home
              </a>
            </div>
          </>
        )}

        <div className="mt-4">
          <a
            href="/new"
            className="text-sm text-[#2A7A80] underline hover:text-terracotta transition-colors font-body"
          >
            Register another batchmate
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Desktop ──────────────────────────────────────────────────────────────

interface LayoutProps {
  d: ReturnType<typeof deriveDisplay>;
  regCode: string;
  rawCode: string;
  status: "pending" | "pending_verification" | "confirmed";
  onReset?: () => void;
}

function ConfirmationDesktop({ d, regCode, rawCode, status, onReset }: LayoutProps) {
  const passDock = useCenteredPassDockOffset();
  const isConfirmed = status === "confirmed";

  return (
    <div
      className="min-h-screen relative overflow-hidden animate-[fadeIn_0.4s_ease]"
      style={{ background: "#FBF6EC" }}
    >
      {/* Decorative backdrop */}
      <div className="confirmation-reveal-after-print absolute inset-0 z-0 pointer-events-none">
        <BackdropDecor />
      </div>

      {/* Scrapbook cluster — desktop only, left side */}
      <div className="confirmation-reveal-after-print">
        <ScrapbookCluster />
      </div>

      {/* Content layer */}
      <div
        className="relative z-10 max-w-[1320px] mx-auto pb-12"
        style={{
          padding: "24px clamp(24px, 3vw, 40px) 48px",
          paddingLeft: "clamp(260px, 28vw, 380px)",
        }}
      >
        {/* Header: logo + stepper row */}
        <div
          className="confirmation-reveal-after-print flex items-center gap-6 mb-6"
          style={{ marginLeft: "clamp(-220px, -22vw, -340px)" }}
        >
          <div
            className={
              isConfirmed
                ? "animate-[confetti-chk_0.65s_cubic-bezier(0.34,1.56,0.64,1)_0.1s_both] shrink-0"
                : "shrink-0"
            }
          >
            <div
              style={{
                flexShrink: 0,
                filter: "drop-shadow(0 6px 18px rgba(60,40,20,0.18))",
              }}
            >
              <SmritiLogo size={150} href="/" />
            </div>
          </div>
          {/* Stepper placeholder — steps 1-5, step 5 active */}
          <div className="flex-1">
            <ConfirmationStepperBar />
          </div>
        </div>

        {/* Main card + entry pass */}
        <div
          className="grid gap-6 items-start"
          style={{
            gridTemplateColumns: "1fr minmax(320px, 352px)",
          }}
        >
          {/* Center: details card */}
          <div className="confirmation-reveal-after-print">
            <RegistrationDetailsCard d={d} status={status} />
          </div>

          {/* Right: entry pass — only for confirmed */}
          {isConfirmed && (
            <div
              ref={passDock.ref}
              className="confirmation-entry-pass-dock confirmation-entry-pass-dock--desktop pt-1"
              style={passDock.style}
            >
              <img
                src="/assets/confirmation/strip-bg-watercolour.png"
                alt=""
                className="confirmation-reveal-after-print absolute -right-12 bottom-6 w-[300px] opacity-90 pointer-events-none"
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={() => window.open(`/api/registrations/${rawCode}/pass.pdf`, "_blank")}
                className="relative group cursor-pointer bg-transparent border-0 p-0 block"
                aria-label="Download entry pass as PDF"
              >
                <EntryPassCard reg={regCode} name={d.name} rawCode={rawCode} participationType={d.participationType} size="desktop" />
                <div className="absolute inset-0 z-30 rounded-lg bg-charcoal/0 group-hover:bg-charcoal/20 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none">
                  <div className="bg-white/95 rounded-xl px-5 py-2.5 shadow-lg flex items-center gap-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" stroke="#1F2A33" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="text-sm font-bold text-charcoal">Download PDF</span>
                  </div>
                </div>
              </button>
              <div className="confirmation-reveal-after-print flex justify-center mt-3">
                <button
                  type="button"
                  onClick={() => window.open(`/api/registrations/${rawCode}/pass.pdf`, "_blank")}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[linear-gradient(135deg,#5B969C_0%,#4E848A_100%)] text-white rounded-xl text-sm font-semibold cursor-pointer border-0 shadow-[0_4px_12px_rgba(91,150,156,0.3)] hover:brightness-95 transition-all"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Download Pass
                </button>
              </div>
            </div>
          )}
        </div>

        {/* What's next panel */}
        <div className="confirmation-reveal-after-print mt-6">
          <WhatsNextPanel layout="desktop" status={status} />
        </div>

        {/* Action buttons */}
        <div className="confirmation-reveal-after-print mt-6">
          <ConfirmationActions
            status={status}
            regCode={rawCode}
            onReset={onReset}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Mobile ───────────────────────────────────────────────────────────────

type MobileLayoutProps = LayoutProps;

function ConfirmationMobile({
  d,
  regCode,
  rawCode,
  status,
  onReset,
}: MobileLayoutProps) {
  const isConfirmed = status === "confirmed";

  return (
    <div
      className="min-h-screen relative overflow-hidden"
      style={{ background: "#FBF6EC" }}
    >
      {/* Corner overlays */}
      <img
        src="/assets/confirmation/paper-texture-tile.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover opacity-90 pointer-events-none"
        aria-hidden="true"
      />
      <img
        src="/assets/confirmation/corner-overlay-topleft.png"
        alt=""
        className="confirmation-reveal-after-print absolute top-0 left-0 pointer-events-none"
        style={{ width: "56vw", maxWidth: 250 }}
        aria-hidden="true"
      />
      <img
        src="/assets/confirmation/corner-overlay-topright.png"
        alt=""
        className="confirmation-reveal-after-print absolute top-0 right-0 pointer-events-none"
        style={{ width: "58vw", maxWidth: 270 }}
        aria-hidden="true"
      />

      <div
        className="relative z-10 px-3.5 pb-7 max-w-[520px] mx-auto"
        style={{ paddingTop: 14 }}
      >
        {/* Entry pass — only for confirmed */}
        {isConfirmed && (
          <div className="confirmation-mobile-print-stage">
            <div className="confirmation-entry-pass-dock confirmation-entry-pass-dock--mobile">
              <EntryPassCard reg={regCode} name={d.name} rawCode={rawCode} participationType={d.participationType} size="mobile" />
            </div>
          </div>
        )}

        <div className="confirmation-reveal-after-print">
        {/* Status banner */}
        <div
          className={
            isConfirmed
              ? "animate-[confetti-up_0.5s_ease_0.17s_both] rounded-2xl p-5 mb-4 relative overflow-hidden"
              : "rounded-2xl p-5 mb-4 relative overflow-hidden"
          }
          style={{
            background:
              isConfirmed
                ? "linear-gradient(135deg, #FBE4D6 0%, #F8D9C5 100%)"
                : status === "pending_verification"
                  ? "linear-gradient(135deg, #FEF3EE 0%, #FDE8E0 100%)"
                  : "linear-gradient(135deg, #F3F4F6 0%, #E5E7EB 100%)",
            border: isConfirmed
              ? "1px solid rgba(215,107,81,0.18)"
              : status === "pending_verification"
                ? "1px solid rgba(215,107,81,0.25)"
                : "1px solid rgba(107,114,128,0.18)",
          }}
        >
          <div className="flex items-center gap-3">
            {/* Icon */}
            {isConfirmed ? (
              <svg
                width="68"
                height="68"
                viewBox="0 0 80 80"
                fill="none"
                style={{ flexShrink: 0 }}
              >
                <path d="M8 68 L24 22 L40 52 Z" fill="#D76B51" />
                <path d="M14 56 L24 22 L30 36 Z" fill="#E89077" opacity="0.85" />
                <path d="M11.5 60 L36 48" stroke="white" strokeWidth="2" opacity="0.55" />
                <path d="M16 48 L34 40" stroke="white" strokeWidth="2" opacity="0.55" />
                <circle cx="46" cy="14" r="3" fill="#F5C66E" />
                <rect x="55" y="22" width="5" height="5" fill="#9CC9CE" transform="rotate(20 57.5 24.5)" />
                <circle cx="62" cy="40" r="2.5" fill="#D76B51" />
                <path d="M48 30 L52 26 L56 30 L52 34 Z" fill="#E89077" />
                <circle cx="38" cy="10" r="2" fill="#9CC9CE" />
                <rect x="32" y="22" width="3" height="3" fill="#D76B51" transform="rotate(45 33.5 23.5)" />
                <circle cx="70" cy="14" r="2" fill="#F5C66E" />
                <path d="M28 24 Q34 18 40 22 Q46 26 50 20" stroke="#9CC9CE" strokeWidth="2" fill="none" strokeLinecap="round" />
                <path d="M32 30 Q40 24 48 32" stroke="#D76B51" strokeWidth="2" fill="none" strokeLinecap="round" />
                <path d="M44 18 Q50 14 56 16" stroke="#F5C66E" strokeWidth="2" fill="none" strokeLinecap="round" />
                <g stroke="#1F2A33" strokeWidth="1.5" strokeLinecap="round" opacity="0.5">
                  <line x1="14" y1="6" x2="14" y2="14" />
                  <line x1="9" y1="10" x2="19" y2="10" />
                </g>
              </svg>
            ) : status === "pending_verification" ? (
              <svg
                width="68"
                height="68"
                viewBox="0 0 80 80"
                fill="none"
                style={{ flexShrink: 0 }}
                className="animate-pulse"
              >
                <circle cx="40" cy="40" r="30" stroke="#D76B51" strokeWidth="3" />
                <polyline
                  points="40,20 40,40 50,45"
                  stroke="#D76B51"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg
                width="68"
                height="68"
                viewBox="0 0 80 80"
                fill="none"
                style={{ flexShrink: 0 }}
              >
                <circle cx="40" cy="40" r="30" stroke="#6b7280" strokeWidth="3" />
                <line x1="40" y1="22" x2="40" y2="40" stroke="#6b7280" strokeWidth="3" strokeLinecap="round" />
                <circle cx="40" cy="48" r="2.5" fill="#6b7280" />
              </svg>
            )}
            <div className="flex-1 min-w-0">
              <h1
                style={{
                  fontFamily: "'Playfair Display', Georgia, serif",
                  fontSize: 32,
                  fontWeight: 700,
                  fontStyle: "italic",
                  color: isConfirmed
                    ? "#D76B51"
                    : status === "pending_verification"
                      ? "#D76B51"
                      : "#6b7280",
                  lineHeight: 1.0,
                  margin: "0 0 4px",
                }}
              >
                {isConfirmed
                  ? "You're Registered!"
                  : status === "pending_verification"
                    ? "Verification in Progress"
                    : "Registration Pending"}
              </h1>
              <p className="text-[13.5px] text-[#5a6b6e] m-0">
                {isConfirmed
                  ? "We can't wait to welcome you back!"
                  : status === "pending_verification"
                    ? "We're reviewing your payment."
                    : "Complete your payment to confirm registration."}
              </p>
            </div>
            {/* Fireworks doodle top-right — only for confirmed */}
            {isConfirmed && (
              <div className="absolute right-2 top-4">
                <svg
                  width="70"
                  height="70"
                  viewBox="0 0 80 80"
                  fill="none"
                  style={{ flexShrink: 0, opacity: 0.55 }}
                >
                  <g stroke="#D76B51" strokeWidth="1.4" strokeLinecap="round" fill="none">
                    <line x1="40" y1="14" x2="40" y2="24" />
                    <line x1="50" y1="20" x2="46" y2="28" />
                    <line x1="30" y1="20" x2="34" y2="28" />
                    <line x1="56" y1="32" x2="48" y2="34" />
                    <line x1="24" y1="32" x2="32" y2="34" />
                    <line x1="40" y1="38" x2="40" y2="46" />
                  </g>
                  <g stroke="#9CC9CE" strokeWidth="1.4" strokeLinecap="round" fill="none">
                    <line x1="18" y1="58" x2="18" y2="64" />
                    <line x1="14" y1="62" x2="22" y2="62" />
                    <line x1="62" y1="56" x2="62" y2="64" />
                    <line x1="58" y1="60" x2="66" y2="60" />
                  </g>
                  <path
                    d="M58 12 Q60 16 64 16"
                    stroke="#D76B51"
                    strokeWidth="1.3"
                    fill="none"
                  />
                  <circle cx="40" cy="32" r="1.5" fill="#D76B51" />
                </svg>
              </div>
            )}
          </div>

          {/* Pass code */}
          <div className="mt-3.5">
            <PassCodeBar code={d.reg} />
          </div>

          {/* Save the date pill */}
          <div
            className="mt-3.5 bg-white rounded-[30px] px-[18px] py-2.5 flex items-center justify-center gap-2.5 flex-nowrap"
            style={{ border: "1.5px dashed rgba(215,107,81,0.4)" }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              style={{ flexShrink: 0 }}
            >
              <rect
                x="3"
                y="5"
                width="18"
                height="16"
                rx="2"
                stroke="#D76B51"
                strokeWidth="1.7"
              />
              <path
                d="M3 9h18M7 3v4M17 3v4"
                stroke="#D76B51"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
            <span className="text-[13px] text-[#5a6b6e] font-semibold whitespace-nowrap">
              Save the Date:
            </span>
            <span
              className="font-bold text-[#D76B51] whitespace-nowrap"
              style={{
                fontFamily: "'Playfair Display', Georgia, serif",
                fontSize: 17,
              }}
            >
              15 August 2026
            </span>
          </div>
        </div>

        {/* Registration details */}
        <div
          className={
            isConfirmed
              ? "animate-[confetti-up_0.5s_ease_0.28s_both] grid gap-3 mb-4"
              : "grid gap-3 mb-4"
          }
          style={{ gridTemplateColumns: "1fr" }}
        >
          {/* Details card */}
          <div
            className="rounded-[14px] p-[16px_14px] shadow-[0_4px_14px_rgba(60,40,20,0.08)]"
            style={{
              background: "#FFFDF7",
              border: "1px solid rgba(200,180,150,0.3)",
            }}
          >
            <div className="flex items-center gap-1.5 mb-2.5">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                style={{ flexShrink: 0 }}
              >
                <rect
                  x="6"
                  y="3"
                  width="12"
                  height="18"
                  rx="1.5"
                  stroke="#5B969C"
                  strokeWidth="1.6"
                />
                <path
                  d="M9 7h6M9 11h6M9 15h4"
                  stroke="#5B969C"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path
                  d="M10 3v1.5h4V3"
                  stroke="#5B969C"
                  strokeWidth="1.5"
                />
              </svg>
              <h3
                className="m-0 whitespace-nowrap"
                style={{
                  fontFamily: "'Playfair Display', Georgia, serif",
                  fontSize: 15,
                  fontWeight: 700,
                  fontStyle: "italic",
                  color: "#5B969C",
                }}
              >
                Your Registration
              </h3>
            </div>
            <MobileMiniRow label="Attendee" value={d.name} />
            <MobileMiniRow
              label="Attendees"
              value={`${d.counts.total || 1} ${d.counts.total <= 1 ? "Adult" : "Total"}`}
            />
            <MobileMiniRow
              label="Food"
              value={
                <span style={{ color: d.foodLabel.color, fontWeight: 700 }}>
                  {d.foodLabel.text}
                </span>
              }
            />
            <MobileMiniRow label="Stay" value={d.accomLabel} />
            <MobileMiniRow
              label="Payment"
              value={
                status === "pending" ? (
                  <span className="text-[#6b7280] font-bold text-[12px]">
                    Awaiting Payment
                  </span>
                ) : status === "pending_verification" ? (
                  <span className="text-[#D76B51] font-bold text-[12px] animate-pulse">
                    In Review
                  </span>
                ) : (
                  <span className="text-[#2d9b67] font-bold text-[12px]">
                    Paid ✓
                  </span>
                )
              }
              last
            />
          </div>

        </div>

        {/* What's next */}
        <div
          className={
            isConfirmed
              ? "animate-[confetti-up_0.5s_ease_0.38s_both] mb-4 relative"
              : "mb-4 relative"
          }
        >
          <WhatsNextPanel layout="mobile" status={status} />
        </div>

        {/* Action buttons */}
        <div className="mb-4">
          <ConfirmationActions
            status={status}
            regCode={rawCode}
            onReset={onReset}
          />
        </div>

        {/* Footer: corridors message + signoff image */}
        <div
          className={
            isConfirmed
              ? "animate-[confetti-up_0.5s_ease_0.38s_both] relative pt-2 pb-8 min-h-[160px]"
              : "relative pt-2 pb-8 min-h-[160px]"
          }
        >
          {/* Handwritten message — centered, tilted */}
          <div
            className="text-center relative z-10"
            style={{ transform: "rotate(-3deg)", transformOrigin: "center" }}
          >
            <p
              style={{
                fontFamily: "'Caveat', cursive",
                fontSize: 23,
                color: "#7a6a58",
                opacity: 0.78,
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              back when those corridors held
              <br />
              everything we needed —
              <br />
              see you there, friend.{" "}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ display: "inline", verticalAlign: "middle" }}>
                <path
                  d="M12 21C12 21 3 14.5 3 8.5C3 5.42 5.42 3 8.5 3C10.24 3 11.91 3.81 13 5.08C14.09 3.81 15.76 3 17.5 3C20.58 3 23 5.42 23 8.5C23 14.5 12 21 12 21Z"
                  fill="#D76B51"
                  opacity="0.5"
                />
              </svg>
            </p>
          </div>

          {/* Signoff image — bottom-right corner, big, faded */}
          <img
            src="/assets/confirmation/signoff-overlay-bottomright.png"
            alt=""
            aria-hidden="true"
            className="absolute bottom-0 right-0 pointer-events-none"
            style={{ width: "65vw", maxWidth: 280, opacity: 0.55 }}
          />
        </div>
        </div>
      </div>
    </div>
  );
}

function useCenteredPassDockOffset() {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    const update = () => {
      const el = ref.current;
      const offsetParent = el?.offsetParent as HTMLElement | null;
      if (!el || !offsetParent) return;

      const parentRect = offsetParent.getBoundingClientRect();
      const dockCenter = parentRect.left + el.offsetLeft + el.offsetWidth / 2;
      const viewportCenter = window.innerWidth / 2;
      const startX = viewportCenter - dockCenter;

      setStyle({ "--pass-dock-start-x": `${startX}px` } as CSSProperties);
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return { ref, style };
}

// ─── MobileMiniRow ────────────────────────────────────────────────────────

interface MobileMiniRowProps {
  label: string;
  value: ReactNode;
  last?: boolean;
}

function MobileMiniRow({ label, value, last = false }: MobileMiniRowProps) {
  return (
    <div
      className="flex items-center gap-2 py-[7px]"
      style={{
        borderBottom: last ? "none" : "1px dashed rgba(170,140,100,0.18)",
      }}
    >
      <div className="flex-1 min-w-0">
        <div
          className="leading-[1.2] font-medium"
          style={{ fontSize: 10.5, color: "#94a3a3" }}
        >
          {label}
        </div>
        <div
          className="font-semibold leading-[1.3] mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis"
          style={{ fontSize: 12.5, color: "#1F2A33" }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

// ─── ConfirmationStepperBar ───────────────────────────────────────────────

function ConfirmationStepperBar() {
  const steps = [
    "Personal\nDetails",
    "Reunion\nPass",
    "Preferences",
    "Payment",
    "Confirmation",
  ];
  const current = 5;
  const sz = 38;

  return (
    <div className="flex items-start w-full">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        const teal = "#9CC9CE";
        const tealDark = "#2A7A80";
        const ring = active ? tealDark : done ? teal : "#cbd5d8";
        const fill = active ? tealDark : done ? teal : "#e5edee";
        const txt = active ? "white" : done ? "white" : "#94a3a3";
        const labelColor = active ? "#1F2A33" : "#6b7280";

        return (
          <Fragment key={label}>
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <div
                style={{
                  width: sz,
                  height: sz,
                  borderRadius: "50%",
                  background: fill,
                  border: `2px solid ${ring}`,
                  color: txt,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  fontWeight: 700,
                  boxShadow: active
                    ? `0 0 0 4px rgba(42,122,128,0.12)`
                    : "none",
                }}
              >
                {done ? (
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <path
                      d="M5 13l4 4L19 7"
                      stroke="white"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  n
                )}
              </div>
              <span
                className="text-[12px] leading-[1.2] text-center whitespace-pre-line max-w-[100px]"
                style={{ color: labelColor, fontWeight: active ? 700 : 500 }}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className="flex-1"
                style={{
                  height: 2,
                  marginTop: sz / 2 - 1,
                  background: n < current ? teal : "#cbd5d8",
                  minWidth: 16,
                }}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
