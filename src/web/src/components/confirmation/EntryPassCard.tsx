// EntryPassCard — scalloped-edge ticket pass with logo, QR, reg ID, name,
// and date ribbon. Desktop shows full ticket; mobile shows compact version.

import { SmritiLogo } from "@/components/ui/SmritiLogo";
import { QRCode } from "./QRCode";
import { PARTICIPATION_LABELS } from "@/lib/constants";
import type { ParticipationType } from "@/types/registration";

// ─── Star ──────────────────────────────────────────────────────────────────

function Star({ color = "white" }: { color?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <path
        d="M5 0 L6.2 3.6 L10 3.8 L7 6.2 L8.1 10 L5 7.8 L1.9 10 L3 6.2 L0 3.8 L3.8 3.6 Z"
        fill={color}
      />
    </svg>
  );
}

// ─── RibbonDate ───────────────────────────────────────────────────────────

function RibbonDate() {
  return (
    <svg width="200" height="38" viewBox="0 0 200 38">
      <defs>
        <linearGradient id="rib" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E08770" />
          <stop offset="100%" stopColor="#C7593C" />
        </linearGradient>
      </defs>
      <path d="M16 4 L184 4 L196 19 L184 34 L16 34 L4 19 Z" fill="url(#rib)" />
      <path d="M16 4 L184 4 L188 7 L16 7 Z" fill="white" opacity="0.18" />
      <path
        d="M22 19 L24 13 L26 19 L32 19 L27 22 L29 28 L24 24 L19 28 L21 22 L16 19 Z"
        fill="white"
      />
      <path
        d="M178 19 L180 13 L182 19 L188 19 L183 22 L185 28 L180 24 L175 28 L177 22 L172 19 Z"
        fill="white"
      />
      <text
        x="100"
        y="24"
        textAnchor="middle"
        fontFamily="'Playfair Display', Georgia, serif"
        fontSize="13"
        fontWeight="700"
        fill="white"
        letterSpacing="0.5"
      >
        15 August 2026
      </text>
    </svg>
  );
}

// ─── PaperSideTear ────────────────────────────────────────────────────────

function PaperSideTear({ side }: { side: "left" | "right" }) {
  return (
    <svg
      className={`entry-pass-side-tear entry-pass-side-tear--${side}`}
      viewBox="0 0 8 548"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d="M0 0 L5 0 L6 18 L4 36 L7 58 L5 82 L7 109 L4 136 L6 162 L4 189 L7 217 L5 246 L7 276 L4 305 L6 334 L4 364 L7 394 L5 423 L7 454 L4 484 L6 515 L5 548 L0 548 Z" />
      <line x1="4.8" y1="58" x2="7.5" y2="64" />
      <line x1="4.2" y1="137" x2="7" y2="143" />
      <line x1="5" y1="247" x2="7.5" y2="253" />
      <line x1="4.2" y1="365" x2="7" y2="372" />
      <line x1="4.4" y1="485" x2="7.3" y2="491" />
    </svg>
  );
}

// ─── EntryPassCard ────────────────────────────────────────────────────────

export interface EntryPassCardProps {
  reg: string;
  name: string;
  rawCode?: string;
  participationType?: ParticipationType;
  size?: "desktop" | "mobile";
}

export function EntryPassCard({ reg, name, rawCode, participationType, size = "desktop" }: EntryPassCardProps) {
  const isDesktop = size === "desktop";
  const logoSize = isDesktop ? 154 : 136;
  const qrSize = isDesktop ? 164 : 146;

  return (
    <div
      className={`entry-pass-print entry-pass-print--${size}`}
      aria-label="Entry pass printing from thermal printer"
    >
      <div className="entry-pass-printer" aria-hidden="true">
        <div className="entry-pass-printer-body" />
        <div className="entry-pass-printer-slot" />
      </div>
      <div className="entry-pass-slot-shadow" aria-hidden="true" />
      <div className="entry-pass-confirmation-note" aria-hidden="true">
        You&apos;re on the list!
      </div>

      <div className="entry-pass-output-clip">
        <div className="entry-pass-feed-center">
          <div className="entry-pass-feed-sheet">
            <div className="entry-pass-ticket">
              <div className="entry-pass-ticket-paper">
                <div className="entry-pass-watercolor" />
                <PaperSideTear side="left" />
                <PaperSideTear side="right" />

                <div className="entry-pass-ticket-header">
                  <Star /> <span>ENTRY PASS</span> <Star />
                </div>

                <div className="entry-pass-logo">
                  <div
                    style={{
                      flexShrink: 0,
                      filter: "drop-shadow(0 2px 7px rgba(60,40,20,0.12))",
                    }}
                  >
                    <SmritiLogo size={logoSize} />
                  </div>
                </div>

                <div className="entry-pass-qr">
                  <QRCode value={`${window.location.origin}/pass#${rawCode ?? reg}`} size={qrSize} />
                </div>

                <div className="entry-pass-reg">{reg}</div>
                <div className="entry-pass-name">{name}</div>
                {participationType && participationType !== "donation_only" && (
                  <div className="entry-pass-participation-type">
                    {PARTICIPATION_LABELS[participationType]}
                  </div>
                )}

                <div className="entry-pass-ribbon">
                  <RibbonDate />
                </div>
              </div>
              <div className="entry-pass-leading-edge" aria-hidden="true" />
            </div>
          </div>
          <div className="entry-pass-print-sheen" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
