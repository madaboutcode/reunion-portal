import { useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { PolaroidFrame } from "@/components/polaroids/PolaroidFrame";
import { SmritiLogo } from "@/components/ui/SmritiLogo";
import { ScrollReveal, ScrollRevealGroup } from "@/components/ui/ScrollReveal";
import { MemoryStoriesSection } from "@/components/home/MemoryStoriesSection";

function SandSettleText({
  children,
  baseDelay = 0,
  decorationClass = "",
  className = "",
}: {
  children: string;
  baseDelay?: number;
  decorationClass?: string;
  className?: string;
}) {
  const words = children.split(" ").filter((w) => w.length > 0);
  return (
    <span className={className}>
      {words.map((word, i) => {
        // Deterministic jitter: ±20ms based on word index (no Math.random)
        const jitter = ((i * 17 + 7) % 41 - 20) / 1000;
        const delay = baseDelay + i * 0.06 + jitter;
        return (
          <span
            key={i}
            className={decorationClass}
            style={{
              display: "inline-block",
              opacity: 0,
              marginRight: i < words.length - 1 ? "0.25em" : undefined,
              animation: `memory-copy-slide 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) ${delay.toFixed(3)}s both`,
            }}
          >
            {word}
          </span>
        );
      })}
    </span>
  );
}

function HeroPolaroids() {
  return (
    <div className="pointer-events-none hidden lg:block opacity-80">
      <div className="absolute left-[6%] top-[24%] opacity-0 animate-[fadeIn_1s_ease_0.5s_forwards]">
        <PolaroidFrame slotId="home-desktop-0" rotation={-11} width={164} />
      </div>
      <div className="absolute left-[7%] top-[57%] opacity-0 animate-[fadeIn_1s_ease_0.7s_forwards]">
        <PolaroidFrame slotId="home-desktop-1" rotation={6.6} width={154} />
      </div>
      <div className="absolute right-[6%] top-[24%] opacity-0 animate-[fadeIn_1s_ease_0.9s_forwards]">
        <PolaroidFrame slotId="home-desktop-2" rotation={8.8} width={160} />
      </div>
      <div className="absolute right-[7%] top-[62%] opacity-0 animate-[fadeIn_1s_ease_1.1s_forwards]">
        <PolaroidFrame slotId="home-desktop-3" rotation={-7.7} width={150} />
      </div>
    </div>
  );
}

function MobilePolaroidStrip() {
  return (
    <div className="flex justify-center gap-4 lg:hidden">
      <PolaroidFrame slotId="home-mobile-0" rotation={-5} width={120} />
      <PolaroidFrame slotId="home-mobile-1" rotation={4} width={116} />
    </div>
  );
}

function useParallax(ref: React.RefObject<HTMLElement | null>, speed = 0.3) {
  const ticking = useRef(false);

  const onScroll = useCallback(() => {
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      if (ref.current) {
        const scrollY = window.scrollY;
        ref.current.style.transform = `translateY(${scrollY * speed}px)`;
      }
      ticking.current = false;
    });
  }, [ref, speed]);

  useEffect(() => {
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [onScroll]);
}

function TimelineItem({
  time,
  title,
  details,
  highlight,
  last,
}: {
  time: string;
  title: string;
  details?: string[];
  highlight?: boolean;
  last?: boolean;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center pt-1.5">
        <div
          className={`h-3 w-3 shrink-0 rounded-full ${
            highlight ? "bg-terracotta" : "bg-[rgba(215,107,81,0.35)]"
          }`}
        />
        {!last && (
          <div className="min-h-[24px] w-px flex-1 bg-[rgba(200,180,150,0.3)]" />
        )}
      </div>

      <div className="pb-6">
        <span
          className={`font-body text-[15px] font-bold tracking-wide md:text-[17px] ${
            highlight ? "text-terracotta" : "text-charcoal/70"
          }`}
        >
          {time}
        </span>
        <p
          className={`mt-0.5 font-body text-sm md:text-base ${
            highlight ? "font-semibold text-charcoal" : "text-charcoal"
          }`}
        >
          {title}
        </p>
        {details && (
          <ul className="mt-1 space-y-0.5">
            {details.map((detail) => (
              <li
                key={detail}
                className="flex items-start gap-1.5 text-sm text-muted"
              >
                <span className="mt-1 text-terracotta/50">&middot;</span>
                {detail}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ScheduleSection() {
  return (
    <section className="relative z-10 border-t border-[rgba(200,180,150,0.2)] bg-page px-5 py-12 md:py-16">
      <div className="mx-auto max-w-2xl">
        <ScrollReveal>
          <h2 className="mb-10 text-center font-heading text-[22px] font-bold text-charcoal md:text-[28px]">
            Schedule &amp; Events
          </h2>
        </ScrollReveal>

        <div className="mb-12">
          <ScrollReveal delay={80}>
            <div className="mb-6 inline-flex items-center rounded-full border border-[rgba(215,107,81,0.25)] bg-[rgba(215,107,81,0.12)] px-5 py-2">
              <span className="text-sm font-bold text-terracotta">
                15th August 2026 - TKMCE Campus
              </span>
            </div>
          </ScrollReveal>
          <ScrollRevealGroup stagger={80} baseDelay={160}>
            <TimelineItem time="09:00 AM" title="Registration & Welcome Hampers" />
            <TimelineItem
              time="10:00 AM"
              title="Inaugural Function"
              details={[
                "Welcome & Felicitation",
                "Batch Contribution to TKMCE",
                "Photograph & Cultural Performances",
              ]}
            />
            <TimelineItem
              time="12:00 - 1:30 PM"
              title="Buffet Lunch (Veg & Non-Veg)"
            />
            <TimelineItem time="1:30 - 3:00 PM" title="Walk Along the Corridors" />
            <TimelineItem
              time="3:30 PM"
              title="Departure to The Raviz Ashtamudi"
              last
            />
          </ScrollRevealGroup>
        </div>

        <div className="mb-10">
          <ScrollReveal delay={80}>
            <div className="mb-6 inline-flex items-center rounded-full border border-[rgba(185,223,226,0.4)] bg-[rgba(185,223,226,0.2)] px-5 py-2">
              <span className="text-sm font-bold text-[#2a7a80]">
                15th August 2026 - The Raviz Ashtamudi
              </span>
            </div>
          </ScrollReveal>
          <ScrollRevealGroup stagger={80} baseDelay={160}>
            <TimelineItem time="04:30 PM" title="Check-in & Seating" />
            <TimelineItem time="05:30 PM" title="Batchmates Cultural Programs" />
            <TimelineItem
              time="07:30 PM - 09:00 PM"
              title="Violin Concert by Roopa Revathy & Team"
              highlight
            />
            <TimelineItem time="08:00 PM" title="Buffet Dinner" />
            <TimelineItem time="09:00 PM" title="DJ Night with Akhil Kakkur" highlight />
            <TimelineItem time="10:30 PM" title="Official Programs Conclude" />
            <TimelineItem
              time="11:00 PM"
              title="Non-Staying Participants Return"
              last
            />
          </ScrollRevealGroup>
        </div>

        <div className="mb-10">
          <ScrollReveal delay={80}>
            <div className="mb-6 inline-flex items-center rounded-full border border-[rgba(185,223,226,0.4)] bg-[rgba(185,223,226,0.2)] px-5 py-2">
              <span className="text-sm font-bold text-[#2a7a80]">
                16th August 2026 - The Raviz Ashtamudi
              </span>
            </div>
          </ScrollReveal>
          <ScrollRevealGroup stagger={80} baseDelay={160}>
            <TimelineItem
              time="One last morning"
              title="There's still so much to say"
              details={[
                "Relaxing around the Raviz facilities",
                "Informal games & group activities",
                "More memories, stories & laughter",
              ]}
            />
            <TimelineItem
              time="08:00 AM - 10:00 AM"
              title="Breakfast"
            />
            <TimelineItem
              time="11:00 AM"
              title="Check-Out"
              last
            />
          </ScrollRevealGroup>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  useDocumentTitle("Home");
  const bgRef = useRef<HTMLDivElement>(null);
  useParallax(bgRef, 0.4);
  const showRegister = useFeatureFlag("registration_show_page");
  return (
    <div className="min-h-screen bg-page flex flex-col">
      <SiteNav glass />

      <section className="relative isolate overflow-hidden min-h-screen -mt-[52px]">
        {/* Parallax wrapper — absolute, out of flow, receives scroll transform */}
        <div ref={bgRef} className="absolute inset-[-15%_0_0_0] will-change-transform">
          <div
            className="memory-hero-image absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(180deg, rgba(24,18,13,0.58) 0%, rgba(37,27,19,0.52) 18%, rgba(42,31,22,0.48) 42%, rgba(22,17,13,0.62) 70%, rgba(12,10,8,0.82) 88%, rgba(4,4,4,0.96) 100%), url("/assets/home-memory-corridor.jpg")',
              backgroundPosition: "center 34%",
              backgroundRepeat: "no-repeat",
              backgroundSize: "cover",
            }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,244,228,0.06),transparent_22%),linear-gradient(180deg,rgba(8,7,6,0.28)_0%,rgba(8,7,6,0.2)_24%,rgba(8,7,6,0.18)_46%,rgba(6,6,6,0.36)_70%,rgba(4,4,4,0.62)_100%)]" />
          <HeroPolaroids />
        </div>

        {/* Content layer — flows from top */}
        <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-5 py-24">
          <div className="memory-hero-content flex flex-col items-center text-center">
            <div className="max-w-3xl space-y-5 px-3 text-center md:px-8">
              {/* P1 */}
              <p className="font-accent text-[clamp(22px,3.2vw,30px)] font-bold leading-[1.8] text-[#fff7eb] [text-shadow:0_2px_6px_rgba(20,14,9,0.78),0_10px_26px_rgba(20,14,9,0.46)]">
                <SandSettleText baseDelay={0.3}>Back in 2006, we walked the corridors of TKM</SandSettleText>
                <br />
                <SandSettleText baseDelay={0.42}>without smartphones in our pockets.</SandSettleText>
              </p>

              {/* P2 */}
              <p className="font-accent text-[clamp(20px,2.8vw,26px)] font-bold leading-[1.8] text-[rgba(255,247,235,0.95)] [text-shadow:0_2px_5px_rgba(20,14,9,0.78),0_10px_24px_rgba(20,14,9,0.42)]">
                <SandSettleText baseDelay={0.54}>Many beautiful moments of our lives lay uncaptured,</SandSettleText>
                <br />
                <SandSettleText baseDelay={0.66} decorationClass="underline decoration-[rgba(215,238,240,0.4)] decoration-2 underline-offset-4" className="[text-shadow:0_2px_5px_rgba(20,14,9,0.82),0_10px_24px_rgba(20,14,9,0.46)]">living only in us, in our memories.</SandSettleText>
              </p>

              {/* P3 */}
              <p className="font-accent text-[clamp(20px,2.8vw,26px)] font-bold leading-[1.8] text-[rgba(255,247,235,0.95)] [text-shadow:0_2px_5px_rgba(20,14,9,0.78),0_10px_24px_rgba(20,14,9,0.42)]">
                <SandSettleText baseDelay={0.78}>Conversations in courtyards, last-minute lab records,</SandSettleText>
                <br />
                <SandSettleText baseDelay={0.9}>shared canteen tea, crowded bus rides.</SandSettleText>
                <br />
                <SandSettleText baseDelay={1.02} decorationClass="underline decoration-[rgba(215,238,240,0.4)] decoration-2 underline-offset-4" className="[text-shadow:0_2px_5px_rgba(20,14,9,0.82),0_10px_24px_rgba(20,14,9,0.46)]">Friendships, laughter, and dreams.</SandSettleText>
              </p>

              {/* P4 */}
              <p className="font-accent text-[clamp(20px,2.8vw,26px)] font-bold leading-[1.8] text-[rgba(255,247,235,0.95)] [text-shadow:0_2px_5px_rgba(20,14,9,0.78),0_10px_24px_rgba(20,14,9,0.42)]">
                <SandSettleText baseDelay={1.14}>The walls and arched verandahs still stand.</SandSettleText>
                <br />
                <SandSettleText baseDelay={1.26}>Some memories fade.</SandSettleText>
                <br />
                <SandSettleText baseDelay={1.38} decorationClass="underline decoration-[rgba(255,210,197,0.4)] decoration-2 underline-offset-4" className="[text-shadow:0_2px_5px_rgba(20,14,9,0.82),0_10px_24px_rgba(20,14,9,0.46)]">The best ones return when old friends meet again.</SandSettleText>
              </p>
            </div>

            <div className="memory-copy-line mt-6" style={{ animationDelay: "0.78s" }}>
              <MobilePolaroidStrip />
            </div>

            <div className="mt-7 flex items-center justify-center md:mt-8">
              <div className="memory-hero-logo-sticker">
                <SmritiLogo size={120} />
              </div>
            </div>

            <h1 className="mt-3 font-heading text-lg font-bold text-[rgba(255,247,235,0.95)] [text-shadow:0_2px_5px_rgba(20,14,9,0.76),0_10px_24px_rgba(20,14,9,0.42)] animate-[settle-down_0.5s_ease_0.35s_both] md:text-xl">
              TKMCE 2006 Batch Reunion
            </h1>

            {showRegister && (
              <Link
                to="/register"
                className="mt-3 inline-flex items-center rounded-full bg-terracotta px-8 py-3.5 text-base font-bold text-white no-underline shadow-[0_10px_28px_rgba(215,107,81,0.3)] transition hover:brightness-95 animate-[settle-down_0.5s_ease_0.4s_both]"
              >
                Register Now
              </Link>
            )}
            <Link
              to="/magazine"
              className="mt-3 inline-flex min-h-11 items-center rounded-full border border-white/35 px-6 py-3 text-sm font-bold text-white no-underline transition hover:bg-white/10 animate-[settle-down_0.5s_ease_0.46s_both]"
            >
              Read the souvenir magazine
            </Link>
          </div>
        </div>
      </section>

      <ScheduleSection />

      <MemoryStoriesSection />

      <section className="border-t border-[rgba(200,180,150,0.2)] bg-[rgba(215,107,81,0.03)] px-5 py-12 text-center">
        {showRegister ? (
          <>
            <p className="mb-4 font-accent text-[20px] text-terracotta">
              Ready to relive the memories?
            </p>
            <Link
              to="/register"
              className="inline-flex items-center rounded-full bg-terracotta px-8 py-3.5 text-base font-bold text-white no-underline shadow-[0_10px_28px_rgba(215,107,81,0.3)] transition hover:brightness-95"
            >
              Register Now
            </Link>
          </>
        ) : (
          <p className="mb-4 font-accent text-[20px] text-terracotta">
            See you at the reunion!
          </p>
        )}
        <div className="mt-4 flex flex-col items-center gap-2">
          <Link
            to="/sponsor"
            className="text-sm text-charcoal/60 no-underline transition-colors hover:text-charcoal/80"
          >
            Want to support the reunion? →
          </Link>
          <Link
            to="/connect"
            className="text-sm text-charcoal/50 no-underline transition-colors hover:text-charcoal/70"
          >
            Stay connected -&gt;
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
