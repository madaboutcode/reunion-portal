import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { clearDraft } from "@/hooks/usePersistence";
import { getDefaultDraftStorage } from "@/lib/draft-storage.local";
import { clearAuth } from "@/lib/auth";
import SmritiHero from "@/components/registration/Hero";

interface Program {
  emoji: string;
  name: string;
  description: string;
  details: string[];
}

const PROGRAMS: Program[] = [
  {
    emoji: "🎉",
    name: "The Reunion",
    description: "Funding the day we've all been waiting for",
    details: [
      "Helps cover the costs of the campus programme, venue, food, and entertainment",
      "Registration fees cover the basics — donations help us do it properly",
      "Better experience for every batchmate who shows up",
    ],
  },
  {
    emoji: "☀️",
    name: "Green Energy Project",
    description: "Solar panels for TKMCE campus",
    details: [
      "Solar installation for the campus that made us engineers",
      "Saves TKM ₹30–40 lakh in electricity every year",
      "Our batch's name on a project that runs for decades",
    ],
  },
  {
    emoji: "🎓",
    name: "Scholarship Fund",
    description: "Supporting students who need a hand",
    details: [
      "Fee support for students from families that are struggling",
      "A semester saved, a career unlocked",
      "Managed through the college's existing scholarship infrastructure",
    ],
  },
];

function ProgramCard({ program }: { program: Program }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white/55">
      <div className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-soft-aqua/40 text-lg">
          {program.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold text-charcoal">
            {program.name}
          </div>
          <div className="text-[13px] leading-snug text-charcoal/70">
            {program.description}
          </div>
        </div>
      </div>
      <button
        className="flex min-h-[44px] items-center px-4 pb-3 text-xs font-semibold text-terracotta"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? "Know less ▴" : "Know more ▾"}
      </button>
      {expanded && (
        <ul className="space-y-1 px-4 pb-4 text-[13px] leading-relaxed text-charcoal/70">
          {program.details.map((detail) => (
            <li key={detail} className="relative pl-4">
              <span className="absolute left-1 font-bold text-terracotta">
                ·
              </span>
              {detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SponsorPage() {
  useDocumentTitle("Support the Reunion");
  const navigate = useNavigate();

  function handleDonate() {
    clearDraft();
    clearAuth();
    getDefaultDraftStorage().save({
      participationType: "donation_only",
      attendanceIntent: "donation_only",
      currentStep: 2,
      maxReachedStep: 2,
    });
    navigate("/register");
  }

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <SiteNav />

      <main className="flex-1">
        <SmritiHero
          title="For the Batch"
          subtitle={
            <>
              2006 <span className="text-terracotta">Batch</span> Reunion
            </>
          }
          tagline="Because some things are worth chipping in for ❤️"
        />

        {/* Body copy */}
        <section className="mx-auto max-w-lg px-7 py-8 text-[15px] leading-[1.75] text-charcoal/80">
          We&rsquo;re putting together something special for August 15th — a day
          back at campus, an evening at The Raviz, and a batch contribution to
          the college that outlasts the party. Your donation helps make all of it
          happen.
        </section>

        {/* Program cards */}
        <section className="mx-auto w-full max-w-lg px-5 pb-7">
          <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-wider text-charcoal/40">
            Where your donation goes
          </p>
          <div className="flex flex-col gap-3">
            {PROGRAMS.map((program) => (
              <ProgramCard key={program.name} program={program} />
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto w-full max-w-lg border-t border-border bg-terracotta/[0.03] px-7 py-7 text-center">
          <button
            onClick={handleDonate}
            className="inline-flex min-h-[48px] items-center gap-2 rounded-full bg-terracotta px-9 py-3.5 text-base font-bold text-white shadow-[0_10px_28px_rgba(215,107,81,0.3)] transition hover:brightness-95"
          >
            Donate →
          </button>
          <p className="mt-2.5 text-[13px] leading-relaxed text-charcoal/40">
            You&rsquo;ll pick your amount on the next page.
            <br />
            UPI &amp; bank transfer.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
