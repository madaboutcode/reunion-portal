import { Link } from "react-router-dom";
import { useIsMobile } from "@/hooks/useIsMobile";
import { calculateTotal, getAttendeeCounts, toRegistration } from "@/lib/pricing";
import { formatINR, ACCOMMODATION_LABELS } from "@/lib/constants";
import { SmritiLogo } from "@/components/ui/SmritiLogo";
import { formatRegCodeForDisplay } from "@smriti/shared";
import type { WizardDraft } from "@/types/registration";

const ASSETS = {
  paperTexture: "/assets/generated/paper-texture-background.png",
  topLeftCorner: "/assets/generated/corner-top-left-overlay.png",
  topRightCorner: "/assets/generated/corner-top-right-overlay.png",
  bottomLeftCollage: "/assets/generated/bottom-left-collage-overlay.png",
  passWash: "/assets/generated/pass-right-watercolor-wash.png",
  whatsNextStrip: "/assets/generated/whats-next-strip-background.png",
  bottomRightSignoff: "/assets/generated/bottom-right-signoff-overlay.png",
  buildingDesktop: "/assets/tkmce-building-hero-desktop.png",
  buildingCentered: "/assets/tkmce-building-hero-centered.png",
} as const;

interface EntryPassPreviewProps {
  reg: string;
  name: string;
  counts: { veg: number; nonveg: number; total: number };
}

function DetailIcon({ label }: { label: string }) {
  const common = "h-5 w-5 text-[#4e8f95]";

  switch (label) {
    case "Pass code":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
          <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 7h8M8 11h8M8 15h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "Attendee Name":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
          <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 20c1.6-3.4 4.1-5 7-5s5.4 1.6 7 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "Attendees":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
          <circle cx="9" cy="9" r="2.7" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="16.5" cy="10.5" r="2.2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3.5 19c1.4-2.8 3.5-4.2 5.8-4.2 2.4 0 4.5 1.4 5.9 4.2M14.5 18.5c.8-1.7 2-2.6 3.7-2.6 1.2 0 2.2.5 3.1 1.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "Food Preference":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
          <path d="M7 4v7M10 4v7M7 8h3M8.5 11v9M15 4c2 2.2 2.4 4.3 1.1 6.2-.5.7-1.2 1.2-2.1 1.5V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "Accommodation":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
          <path d="M4 18v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6M4 14h16M7 10V7.5A1.5 1.5 0 0 1 8.5 6H11a2 2 0 0 1 2 2v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "Payment Status":
      return (
        <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden="true">
          <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3 10h18M7.5 14h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    default:
      return <span className="block h-2.5 w-2.5 rounded-full bg-[#4e8f95]" aria-hidden="true" />;
  }
}

function NextStepIcon({ kind }: { kind: "instagram" | "facebook" | "whatsapp" }) {
  const iconClass = "h-7 w-7";

  if (kind === "instagram") {
    return (
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/70 bg-[rgba(215,107,81,0.12)] shadow-[0_8px_20px_rgba(82,62,35,0.08)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`${iconClass} text-terracotta`} aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      </div>
    );
  }

  if (kind === "facebook") {
    return (
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/70 bg-[rgba(185,223,226,0.25)] shadow-[0_8px_20px_rgba(82,62,35,0.08)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`${iconClass} text-[#2a7a80]`} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M13.5 8H12a1 1 0 0 0-1 1v2H9.5M11 11h3.5" />
          <path d="M11 11v6" />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/70 bg-[rgba(130,190,130,0.2)] shadow-[0_8px_20px_rgba(82,62,35,0.08)]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`${iconClass} text-emerald-600`} aria-hidden="true">
        <path d="M3 20l1.5-4.5A8.5 8.5 0 1 1 8 18.5L3 20Z" />
        <path d="M9.5 10c.3.8.9 1.6 1.7 2.2.8.6 1.6 1 2.3 1.2" />
      </svg>
    </div>
  );
}

function EntryPassPreview({ reg, name, counts }: EntryPassPreviewProps) {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/80 bg-white/88 p-4 shadow-[0_20px_50px_rgba(95,74,44,0.12)] backdrop-blur-sm">
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          backgroundImage: `url(${ASSETS.passWash})`,
          backgroundPosition: "right bottom",
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
        }}
      />
      <div className="relative z-[1] overflow-hidden rounded-[24px] border border-[rgba(58,128,136,0.16)] bg-white/92 shadow-[0_10px_30px_rgba(85,65,35,0.08)]">
        <div className="bg-[#4b9aa2] px-4 py-3 text-center text-sm font-bold uppercase tracking-[0.28em] text-white">
          Entry Pass
        </div>

        <div className="p-5 text-center">
          <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-[#d8eff2]/90 shadow-[0_10px_24px_rgba(68,127,134,0.18)]">
            <SmritiLogo size={66} />
          </div>

          <div className="font-heading text-[1.95rem] font-bold italic leading-none text-[#243138]">
            Smriti
          </div>
          <div className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#5c8f95]">
            Reunion Entry Pass
          </div>

          <div className="mt-5 rounded-[20px] border border-dashed border-[rgba(75,154,162,0.34)] bg-white/75 px-4 py-3">
            <div className="font-mono text-[0.95rem] font-bold tracking-[0.12em] text-[#3a5157]">
              {reg}
            </div>
            <div className="mt-2 text-lg font-semibold text-[#1f2a33]">{name}</div>
            {counts.total > 0 && (
              <div className="mt-1 text-sm text-[#607078]">
                {counts.total} attendee{counts.total !== 1 ? "s" : ""} · {counts.veg} Veg · {counts.nonveg} Non-veg
              </div>
            )}
          </div>

          <div className="mt-5 inline-flex rounded-full bg-[#de7d5b] px-5 py-2 text-sm font-bold text-white shadow-[0_8px_20px_rgba(222,125,91,0.24)]">
            15 August 2026
          </div>
        </div>
      </div>
    </div>
  );
}

export interface ConfirmationProps {
  data: WizardDraft & { registrationRef?: string };
  onReset: () => void;
}

export default function Confirmation({ data, onReset }: ConfirmationProps) {
  const isMobile = useIsMobile();
  const registeredRef = formatRegCodeForDisplay((data as { registrationRef?: string }).registrationRef || "SMRT000000000000");
  const registration = toRegistration(data);
  const bd = calculateTotal(registration);
  const counts = getAttendeeCounts(registration);

  // Build accurate attendees label counting spouse / children / guests separately
  const hasSpouse = !!(data.spouseName?.trim());
  const childCount = data.children.length;
  const guestCount = data.guests.length;
  const additionalParts: string[] = [];
  if (hasSpouse) additionalParts.push("Spouse");
  if (childCount > 0) additionalParts.push(`${childCount} Child${childCount !== 1 ? "ren" : ""}`);
  if (guestCount > 0) additionalParts.push(`${guestCount} Guest${guestCount !== 1 ? "s" : ""}`);
  const additionalLabel = additionalParts.length > 0
    ? ` (You + ${additionalParts.join(", ")})`
    : "";

  const detailRows = [
    ["Pass code", registeredRef],
    ["Attendee Name", data.fullName || "\u2014"],
    counts.total > 0
      ? ["Attendees", `${counts.total}${additionalLabel}`]
      : null,
    counts.total > 0
      ? ["Food Preference", `${counts.veg} Veg, ${counts.nonveg} Non-veg`]
      : null,
    data.accommodation !== "none"
      ? ["Accommodation", ACCOMMODATION_LABELS[data.accommodation]]
      : null,
    ["Payment Status", "PAID"],
  ].filter((r): r is [string, string] => r !== null);

  const nextSteps = [
    {
      kind: "instagram" as const,
      title: "Follow along",
      desc: "Behind-the-scenes and countdown on Instagram",
    },
    {
      kind: "facebook" as const,
      title: "Stay updated",
      desc: "Photos, announcements, and batch news",
    },
    {
      kind: "whatsapp" as const,
      title: "Join the group",
      desc: "The batch group where it all happens",
    },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#fbf6ec]">
      <div
        className="pointer-events-none absolute inset-0 opacity-75"
        style={{
          backgroundImage: `url(${ASSETS.paperTexture})`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
        }}
      />

      <img
        src={ASSETS.topLeftCorner}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 z-[1] w-[260px] max-w-[42vw] md:w-[420px] xl:w-[500px]"
      />
      <img
        src={ASSETS.topRightCorner}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute right-0 top-0 z-[1] w-[270px] max-w-[44vw] md:w-[430px] xl:w-[520px]"
      />
      {!isMobile && (
        <>
          <img
            src={ASSETS.bottomLeftCollage}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[7.5rem] left-0 z-[1] w-[260px] xl:w-[340px]"
          />
          <img
            src={ASSETS.bottomRightSignoff}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 right-0 z-[1] w-[280px] xl:w-[360px]"
          />
        </>
      )}

      <div className={`relative z-[2] mx-auto max-w-[1280px] pb-16 ${isMobile ? "px-4 pt-6" : "px-8 pt-10 xl:px-14"}`}>
        <div className={isMobile ? "mx-auto max-w-[720px]" : ""}>
          <div className={isMobile ? "mb-5 overflow-hidden rounded-[28px] border border-white/80 bg-white/68 shadow-[0_12px_36px_rgba(88,67,39,0.12)]" : "mb-8 hidden"} />

          {isMobile && (
            <div className="mb-5 overflow-hidden rounded-[28px] border border-white/80 bg-white/68 shadow-[0_12px_36px_rgba(88,67,39,0.12)] backdrop-blur-sm">
              <img src={ASSETS.buildingCentered} alt="TKM College building" className="h-[240px] w-full object-cover" />
            </div>
          )}

          <div className={isMobile ? "mb-6 text-center" : "mb-8 px-[320px] text-center xl:px-[350px]"}>
            <div className="inline-flex items-center rounded-full border border-[rgba(78,143,149,0.15)] bg-white/80 px-4 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#4e8f95] shadow-[0_6px_20px_rgba(95,74,44,0.07)]">
              Confirmation
            </div>
            <h1 className={`mt-4 font-heading font-bold italic text-[#d86e4d] ${isMobile ? "text-[2.35rem] leading-tight" : "text-[4rem] leading-none"}`}>
              You&apos;re Registered!
            </h1>
            <p className={`mt-3 text-[#44545a] ${isMobile ? "text-base" : "text-[1.3rem]"}`}>
              We can&apos;t wait to welcome you back home.
            </p>
            <p className={`mt-2 font-accent text-[#4b9aa2] ${isMobile ? "text-lg" : "text-[1.8rem]"}`}>
              Two decades later, the memories continue...
            </p>
          </div>

          <div className={isMobile ? "space-y-5" : "grid grid-cols-[300px_minmax(0,1fr)_300px] gap-6 xl:grid-cols-[330px_minmax(0,1fr)_320px]"}>
            {!isMobile && (
              <div className="relative">
                <div className="overflow-hidden rounded-[32px] border border-white/80 bg-white/65 shadow-[0_20px_52px_rgba(89,68,40,0.12)] backdrop-blur-sm">
                  <img src={ASSETS.buildingDesktop} alt="TKM College building" className="h-[620px] w-full object-cover object-right" />
                </div>
              </div>
            )}

            <div className="rounded-[30px] border border-white/80 bg-white/82 p-5 shadow-[0_22px_56px_rgba(89,68,40,0.12)] backdrop-blur-sm md:p-7">
              <div className="rounded-[22px] border border-[rgba(222,125,91,0.18)] bg-[rgba(255,248,242,0.92)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] md:flex md:items-center md:gap-4">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-[14px] bg-[#fff1e9] text-[#d86e4d] shadow-[0_10px_22px_rgba(216,110,77,0.1)] md:mb-0">
                  <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" aria-hidden="true">
                    <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold uppercase tracking-[0.15em] text-[#4b9aa2]">Save the Date</div>
                  <div className="mt-1 font-heading text-[2rem] font-bold leading-none text-[#d86e4d] md:text-[2.55rem]">
                    15 August 2026
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-2">
                {detailRows.map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[auto_minmax(0,132px)_minmax(0,1fr)] items-center gap-3 rounded-[18px] border border-[rgba(76,143,149,0.08)] bg-white/76 px-3 py-3 shadow-[0_8px_18px_rgba(88,67,39,0.04)] md:px-4"
                  >
                    <DetailIcon label={label} />
                    <span className="text-sm font-medium text-[#6d777c]">{label}</span>
                    {label === "Payment Status" ? (
                      <span className="justify-self-start rounded-full bg-[#e5f6eb] px-3 py-1 text-sm font-bold text-[#2e8c59]">
                        Paid ✓
                      </span>
                    ) : label === "Pass code" ? (
                      <span className="font-mono text-sm font-bold tracking-[0.08em] text-[#2e3d43]">{value}</span>
                    ) : (
                      <span className="text-sm font-semibold text-[#26343a] md:text-[0.96rem]">{value}</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-[24px] border border-[rgba(75,154,162,0.12)] bg-[linear-gradient(135deg,rgba(230,245,246,0.95),rgba(247,251,251,0.95))] px-4 py-4 shadow-[0_12px_26px_rgba(70,122,129,0.08)]">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold uppercase tracking-[0.15em] text-[#4b9aa2]">Total Paid</div>
                    <div className="mt-1 text-sm text-[#69757a]">
                      Payment confirmed and locked in.
                      {(bd.donation > 0 || bd.collegeContribution > 0) && (() => {
                        const isDonationOnly = data.participationType === "donation_only";
                        const segments: string[] = [];
                        if (!isDonationOnly) {
                          const regAmount = bd.total - bd.donation - bd.collegeContribution;
                          segments.push(`Registration: ${formatINR(regAmount)}`);
                        }
                        if (bd.collegeContribution > 0) {
                          segments.push(`College contribution: ${formatINR(bd.collegeContribution)}`);
                        }
                        if (bd.donation > 0) {
                          segments.push(`Donation: ${formatINR(bd.donation)}`);
                        }
                        return (
                          <span className="mt-1 block text-xs text-[#8a9196]">
                            {segments.join(" · ")}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="text-[2rem] font-bold text-[#d86e4d]">{formatINR(bd.total)}</div>
                </div>
              </div>

              <div className="mt-6 rounded-[22px] bg-[rgba(75,154,162,0.08)] px-4 py-4 text-[#4d5f66] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                <p className="text-sm leading-6 md:text-[0.95rem]">
                  Thank you for being part of Smriti. Let&apos;s make this reunion unforgettable.
                </p>
                <p className="mt-3 text-sm">
                  Confirmation sent to <strong className="text-[#25333a]">{data.email || "your email"}</strong> — check spam if you don&apos;t see it.
                </p>
              </div>
            </div>

            <div className="relative">
              {!isMobile && (
                <img
                  src={ASSETS.passWash}
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute -bottom-8 -right-4 z-0 w-[300px] opacity-90"
                />
              )}
              <div className="relative z-[1]">
                <EntryPassPreview reg={registeredRef} name={data.fullName || "Attendee"} counts={counts} />
              </div>
            </div>
          </div>

          <div className="relative mt-8 md:mt-10">
            <div
              className="overflow-hidden rounded-[30px] border border-white/80 bg-white/66 shadow-[0_18px_40px_rgba(89,68,40,0.1)]"
              style={{
                backgroundImage: `url(${ASSETS.whatsNextStrip})`,
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "cover",
              }}
            >
              <div className="px-5 py-6 md:px-8 md:py-7">
                <div className="mb-5 font-accent text-[2.3rem] leading-none text-[#1f2a33] md:text-[2.7rem]">
                  What&apos;s next?
                </div>
                <div className={isMobile ? "space-y-4" : "grid grid-cols-3 gap-4"}>
                  {nextSteps.map((step) => {
                    const cardClass = "rounded-[24px] border border-white/85 bg-white/78 p-4 shadow-[0_12px_26px_rgba(88,67,39,0.06)] backdrop-blur-sm";
                    return (
                      <Link
                        key={step.title}
                        to="/connect"
                        className={`${cardClass} block no-underline hover:brightness-[0.97] transition-[filter]`}
                      >
                        <NextStepIcon kind={step.kind} />
                        <div className="mt-4 text-[1.1rem] font-bold text-[#223038]">{step.title}</div>
                        <div className="mt-2 text-sm leading-6 text-[#56636a]">{step.desc}</div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className={`mt-7 flex flex-wrap gap-3 ${isMobile ? "justify-stretch" : "justify-center"}`}>
            <button
              type="button"
              className={`rounded-[18px] border border-[#4b9aa2] bg-[#4b9aa2] px-8 py-4 text-base font-bold text-white shadow-[0_14px_28px_rgba(75,154,162,0.22)] transition-colors hover:bg-[#40858c] ${isMobile ? "flex-1" : ""}`}
            >
              Download Pass
            </button>
            <button
              type="button"
              className={`rounded-[18px] border border-[rgba(75,154,162,0.35)] bg-white/75 px-8 py-4 text-base font-semibold text-[#4b7f85] shadow-[0_10px_24px_rgba(88,67,39,0.06)] transition-colors hover:bg-white ${isMobile ? "flex-1" : ""}`}
            >
              Share with Friends
            </button>
          </div>

          {isMobile && (
            <div className="mt-8 overflow-hidden rounded-[26px] border border-white/80 bg-white/60 shadow-[0_12px_30px_rgba(88,67,39,0.08)]">
              <img src={ASSETS.bottomRightSignoff} alt="" aria-hidden="true" className="w-full" />
            </div>
          )}

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={onReset}
              className="border-none bg-transparent text-sm text-[#9d8f83] underline underline-offset-4"
            >
              Register another batchmate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
