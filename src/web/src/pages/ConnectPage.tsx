import { Link } from "react-router-dom";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { ScrollReveal, ScrollRevealGroup } from "@/components/ui/ScrollReveal";

interface SocialChannel {
  id: string;
  name: string;
  handle?: string;
  description: string;
  url: string;
  icon: React.ReactNode;
}

function InstagramIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-7 h-7"
      aria-hidden="true"
    >
      {/* Rounded square */}
      <rect x="3" y="3" width="18" height="18" rx="5" />
      {/* Circle */}
      <circle cx="12" cy="12" r="4" />
      {/* Dot */}
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-7 h-7"
      aria-hidden="true"
    >
      {/* Circle outline */}
      <circle cx="12" cy="12" r="9" />
      {/* f letterform */}
      <path d="M13.5 8H12a1 1 0 0 0-1 1v2H9.5M11 11h3.5" />
      <path d="M11 11v6" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-7 h-7"
      aria-hidden="true"
    >
      {/* Chat bubble */}
      <path d="M3 20l1.5-4.5A8.5 8.5 0 1 1 8 18.5L3 20Z" />
      {/* Phone handset inside */}
      <path d="M9.5 10c.3.8.9 1.6 1.7 2.2.8.6 1.6 1 2.3 1.2" />
    </svg>
  );
}

const CHANNELS: SocialChannel[] = [
  {
    id: "instagram",
    name: "Instagram",
    handle: "@smriti_2026_tkmce",
    description: "Event updates, behind-the-scenes, and countdown",
    url: "https://www.instagram.com/smriti_2026_tkmce",
    icon: <InstagramIcon />,
  },
  {
    id: "facebook",
    name: "Facebook",
    handle: "Smriti 2026",
    description: "Photos, announcements, and batch news",
    url: "https://www.facebook.com/REPLACE_WITH_PAGE",
    icon: <FacebookIcon />,
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    handle: "TKMCE 2006 Batch Group",
    description: "The batch group where it all happens",
    url: "https://chat.whatsapp.com/REPLACE_WITH_GROUP_INVITE",
    icon: <WhatsAppIcon />,
  },
];

export default function ConnectPage() {
  useDocumentTitle("Connect");
  const showRegister = useFeatureFlag("registration_show_page");

  return (
    <div className="min-h-screen bg-page flex flex-col">
      <SiteNav />

      {/* ── Header ── */}
      <section className="px-5 pt-16 pb-10 md:pt-20 md:pb-12 text-center">
        <ScrollReveal>
          <p className="font-accent text-terracotta text-[28px] md:text-[36px] leading-tight mb-3">
            Find your people
          </p>
        </ScrollReveal>
        <ScrollReveal delay={80}>
          <p className="font-body text-charcoal/60 text-base md:text-lg max-w-sm mx-auto">
            Stay in the loop as we count down to August 15th.
          </p>
        </ScrollReveal>
      </section>

      {/* ── Channel cards ── */}
      <section className="flex-1 px-5 pb-16">
        <div className="max-w-lg mx-auto">
          <ScrollRevealGroup stagger={80} baseDelay={120}>
            {CHANNELS.map((channel) => (
              <a
                key={channel.id}
                href={channel.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group mb-4 rounded-2xl border border-[rgba(200,180,150,0.25)] bg-white/80 p-5 shadow-[0_4px_16px_rgba(80,60,40,0.06)] backdrop-blur-sm block no-underline transition-all duration-200 ease-out hover:shadow-[0_8px_28px_rgba(80,60,40,0.14)] hover:border-[rgba(200,180,150,0.45)] hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.98] active:shadow-[0_2px_8px_rgba(80,60,40,0.1)]"
              >
                <div className="flex items-start gap-4">
                  <div className="shrink-0 w-12 h-12 rounded-xl bg-[rgba(185,223,226,0.2)] border border-[rgba(185,223,226,0.35)] flex items-center justify-center text-charcoal/70 transition-all duration-200 group-hover:bg-[rgba(185,223,226,0.35)] group-hover:text-charcoal group-hover:scale-110">
                    {channel.icon}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-heading font-bold text-charcoal text-[17px] leading-tight">
                        {channel.name}
                      </span>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="w-3.5 h-3.5 text-charcoal/30 transition-all duration-200 group-hover:text-terracotta group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                        aria-hidden="true"
                      >
                        <path d="M7 17L17 7M17 7H7M17 7v10" />
                      </svg>
                    </div>
                    {channel.handle && (
                      <div className="font-body text-xs font-semibold text-terracotta/80 mt-0.5 truncate">
                        {channel.handle}
                      </div>
                    )}
                    <p className="font-body text-sm text-charcoal/60 mt-1 leading-snug">
                      {channel.description}
                    </p>
                  </div>
                </div>
              </a>
            ))}
          </ScrollRevealGroup>
        </div>
      </section>

      {/* ── Bottom nudge ── */}
      {showRegister && (
        <section className="border-t border-[rgba(200,180,150,0.2)] px-5 py-10 text-center bg-[rgba(185,223,226,0.05)]">
          <p className="font-accent text-charcoal/50 text-[17px] mb-3">
            Haven&apos;t registered yet?
          </p>
          <Link
            to="/register"
            className="inline-flex items-center px-7 py-3 rounded-full bg-terracotta text-white font-bold text-sm shadow-[0_8px_20px_rgba(215,107,81,0.25)] transition hover:brightness-95 no-underline"
          >
            Register Now
          </Link>
        </section>
      )}

      <SiteFooter />
    </div>
  );
}
