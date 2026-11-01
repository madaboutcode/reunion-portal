import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AWARDS, PAGE_META } from "@/lib/awards-data";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { AwardsHero } from "@/components/awards/AwardsHero";
import { AwardCard } from "@/components/awards/AwardCard";
import { FootballDivider } from "@/components/awards/FootballDivider";
import { TournamentPredictions } from "@/components/awards/TournamentPredictions";
import { CreditsOverlay } from "@/components/credits/CreditsOverlay";
import { useInView } from "@/hooks/useInView";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

const FIRST_REVEALS = AWARDS.slice(0, 3);
const MAIN_REVEALS = AWARDS.slice(3, 8);
const SPECIAL_REVEALS = AWARDS.slice(8, 10);

const SCROLL_TOP_THRESHOLD = 640;

function SectionIntro() {
  const { ref, visible } = useInView<HTMLDivElement>(0.2);

  return (
    <div ref={ref} className={`awards-reveal text-center${visible ? " is-visible" : ""}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--coral-deep)]">
        {PAGE_META.eyebrow}
      </p>
      <h2
        id="winners-roll-heading"
        className="font-heading mt-2 text-4xl font-bold text-[var(--ink)] sm:text-5xl"
      >
        The Winners&rsquo; Roll
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-[var(--muted)]">{PAGE_META.intro}</p>
    </div>
  );
}

function AwardsHub() {
  return (
    <section aria-label="Explore the contest" className="px-6 pt-6">
      <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          to="/leaderboard"
          className="awards-reveal is-visible group flex min-h-[44px] flex-col rounded-2xl border border-[var(--line)] bg-[var(--paper-warm)] px-6 py-5 no-underline transition-transform duration-150 hover:-translate-y-0.5"
        >
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--coral-deep)]">
            Standings
          </span>
          <span className="font-heading mt-1 text-2xl font-bold text-[var(--ink)]">
            The Leaderboard
            <span className="ml-2 inline-block transition-transform group-hover:translate-x-1">→</span>
          </span>
          <span className="mt-1 text-sm text-[var(--muted)]">final standings</span>
        </Link>

        <Link
          to="/predictions"
          className="awards-reveal is-visible group flex min-h-[44px] flex-col rounded-2xl border border-[var(--line)] bg-[var(--paper-warm)] px-6 py-5 no-underline transition-transform duration-150 hover:-translate-y-0.5"
        >
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--coral-deep)]">
            Replay
          </span>
          <span className="font-heading mt-1 text-2xl font-bold text-[var(--ink)]">
            Match Replay
            <span className="ml-2 inline-block transition-transform group-hover:translate-x-1">→</span>
          </span>
          <span className="mt-1 text-sm text-[var(--muted)]">every prediction, every match</span>
        </Link>
      </div>
    </section>
  );
}

export default function PredictionAwardsPage() {
  useDocumentTitle("Prediction Awards");
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const closerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
        setScrollProgress(Math.min(100, Math.max(0, progress)));
        setShowScrollTop(scrollTop > SCROLL_TOP_THRESHOLD);
        ticking = false;
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="awards-page flex min-h-screen flex-col">
      <div className="awards-progress-track" role="presentation">
        <div className="awards-progress-bar" style={{ width: `${scrollProgress}%` }} />
      </div>

      <SiteNav />

      <main className="flex-1">
        <AwardsHero />

        <AwardsHub />

        <section aria-labelledby="winners-roll-heading" className="px-6 py-16 sm:py-20">
          <SectionIntro />
          <div className="mt-10">
            <FootballDivider />
          </div>

          <div className="mx-auto mt-6 max-w-5xl">
            {FIRST_REVEALS.map((award) => (
              <AwardCard key={award.slug} award={award} />
            ))}
          </div>

          <div className="mx-auto my-4 max-w-5xl">
            <FootballDivider />
          </div>

          <div className="mx-auto max-w-5xl">
            {MAIN_REVEALS.map((award) => (
              <AwardCard key={award.slug} award={award} />
            ))}
          </div>

          <div className="mx-auto my-4 max-w-5xl">
            <FootballDivider />
          </div>

          <div className="mx-auto max-w-5xl">
            {SPECIAL_REVEALS.map((award) => (
              <AwardCard key={award.slug} award={award} />
            ))}
          </div>
        </section>

        <TournamentPredictions />

        <section ref={closerRef} className="px-6 py-14 text-center">
          <p className="font-accent text-3xl text-[var(--coral)]">That&rsquo;s a wrap</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Ten trophies, one bragging-rights hierarchy. See you at the next World Cup.
          </p>
        </section>
      </main>

      <SiteFooter />

      <CreditsOverlay triggerRef={closerRef} />

      <button
        type="button"
        onClick={scrollToTop}
        className={`awards-scroll-top${showScrollTop ? " is-visible" : ""}`}
        aria-label="Scroll back to top"
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}
