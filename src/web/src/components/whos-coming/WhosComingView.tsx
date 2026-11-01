import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { ScrollReveal, ScrollRevealGroup } from "@/components/ui/ScrollReveal";
import { ScrollFilterChips } from "@/components/ui/ScrollFilterChips";
import { useScrollDirection } from "@/hooks/useScrollDirection";
import { useIsMobile } from "@/hooks/useIsMobile";
import { PolaroidCard, ShimmerCard } from "@/components/whos-coming/PolaroidCard";
import { formatLocation } from "@/components/whos-coming/utils";
import { publicPhotoUrl } from "@/lib/api";
import type { PublicAttendee } from "@/lib/api";
import {
  BRANCHES,
  BRANCH_COLORS,
  BRANCH_SHORT_NAMES,
  type Branch,
} from "@/lib/constants";

function isBranch(value: string): value is Branch {
  return (BRANCHES as readonly string[]).includes(value);
}

export interface WhosComingViewProps {
  people: PublicAttendee[];
  thumbsBaseUrl?: string;
  photosVersion: number;
  loading?: boolean;
  error?: string | null;
  showDebugBanner?: boolean;
}

export function WhosComingView({
  people,
  thumbsBaseUrl,
  photosVersion,
  loading = false,
  error = null,
  showDebugBanner = false,
}: WhosComingViewProps) {
  const [activeBranch, setActiveBranch] = useState("all");
  const [animEpoch, setAnimEpoch] = useState(0);
  const navHidden = useScrollDirection(false);
  const isMobile = useIsMobile();
  const showRegister = useFeatureFlag("registration_show_page");

  const cardGridClass = isMobile
    ? "grid w-full grid-cols-2 gap-x-5 gap-y-10"
    : "flex flex-wrap gap-[22px]";

  const byBranch = useMemo(() => {
    const map = new Map<Branch, PublicAttendee[]>();
    for (const person of people) {
      if (!isBranch(person.branch)) continue;
      const existing = map.get(person.branch);
      if (existing) {
        existing.push(person);
      } else {
        map.set(person.branch, [person]);
      }
    }
    // Newest registrants first within each branch.
    for (const attendees of map.values()) {
      attendees.sort((a, b) => b.createdAt - a.createdAt);
    }
    return map;
  }, [people]);

  const branchEntries = useMemo(() => {
    return Array.from(byBranch.entries()).sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      return a[0].localeCompare(b[0]);
    });
  }, [byBranch]);

  const uniqueCities = useMemo(() => {
    const cities = new Set(people.map((p) => p.city.trim().toLowerCase()).filter(Boolean));
    return cities.size;
  }, [people]);

  const filterOptions = useMemo(() => {
    const options = [
      { key: "all", label: "All", count: people.length },
      ...branchEntries.map(([branch, attendees]) => ({
        key: branch,
        label: BRANCH_SHORT_NAMES[branch],
        count: attendees.length,
      })),
    ];
    return options;
  }, [branchEntries, people.length]);

  const visibleBranches = useMemo(() => {
    if (activeBranch === "all") return branchEntries;
    return branchEntries.filter(([branch]) => branch === activeBranch);
  }, [activeBranch, branchEntries]);

  function handleBranchChange(key: string) {
    if (key === activeBranch) return;
    setActiveBranch(key);
    setAnimEpoch((n) => n + 1);
  }

  return (
    <div className="min-h-screen bg-page flex flex-col">
      {showDebugBanner && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-950">
          <span className="font-semibold">Debug mode</span>
          {" — "}
          mock data, no API calls.
          {" "}
          <Link to="/whos-coming" className="text-terracotta font-semibold underline-offset-2 hover:underline">
            View live page
          </Link>
        </div>
      )}

      <SiteNav />

      <section className="relative h-[280px] overflow-hidden flex items-end pb-9">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url(/assets/whos-coming/map-converging-routes.webp)" }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(245,240,232,0.18) 0%, rgba(245,240,232,0.55) 50%, rgba(245,240,232,0.97) 88%, #F5F0E8 100%)",
          }}
          aria-hidden="true"
        />
        <div className="relative z-[2] w-full max-w-[900px] mx-auto px-5 md:px-6">
          <ScrollReveal>
            <h1 className="font-heading text-[clamp(28px,5vw,42px)] font-bold text-charcoal leading-tight">
              Who&apos;s Coming
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={80}>
            <p className="font-accent text-[clamp(18px,3vw,24px)] text-terracotta mt-1">
              back to TKMCE once again...
            </p>
          </ScrollReveal>
          {!loading && (
            <ScrollReveal delay={160}>
              <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[13px] text-muted">
                <span>{people.length} alumni</span>
                <span className="w-[5px] h-[5px] rounded-full bg-muted/50" aria-hidden="true" />
                <span>{BRANCHES.length} branches</span>
                <span className="w-[5px] h-[5px] rounded-full bg-muted/50" aria-hidden="true" />
                <span>{uniqueCities} cities</span>
              </div>
            </ScrollReveal>
          )}
        </div>
      </section>

      <nav
        className={[
          "sticky z-30 border-b border-[rgba(200,180,150,0.22)] py-2.5",
          "transition-[top] duration-300 ease-in-out",
          navHidden ? "top-0" : "top-[52px]",
        ].join(" ")}
        style={{
          background: "rgba(245,240,232,0.95)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
        aria-label="Filter by branch"
      >
        <div
          className="max-w-[900px] mx-auto overflow-x-auto scrollbar-none px-5 md:px-6"
          style={{
            maskImage: "linear-gradient(90deg, transparent, #000 10px, #000 calc(100% - 10px), transparent)",
            WebkitMaskImage: "linear-gradient(90deg, transparent, #000 10px, #000 calc(100% - 10px), transparent)",
          }}
        >
          <ScrollFilterChips
            options={filterOptions}
            activeKey={activeBranch}
            onChange={handleBranchChange}
          />
        </div>
      </nav>

      <main className="flex-1 max-w-[900px] w-full mx-auto overflow-visible px-5 md:px-6 pt-8 pb-6">
        {loading && (
          <div className={cardGridClass}>
            {Array.from({ length: 24 }).map((_, i) => (
              <ShimmerCard key={i} fluid={isMobile} />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="py-16 text-center">
            <p className="text-muted font-body">{error}</p>
          </div>
        )}

        {!loading && !error && people.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-muted font-body text-sm">No one here yet — be the first!</p>
          </div>
        )}

        {!loading && !error && people.length > 0 && (
          <div
            key={animEpoch}
            className="transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          >
            {visibleBranches.map(([branch, attendees], sectionIdx) => {
              const color = BRANCH_COLORS[branch];
              const isFiltered = activeBranch !== "all";

              return (
                <section
                  key={branch}
                  className={[
                    isMobile ? "mb-14" : "mb-10",
                    "transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    isFiltered ? "animate-[fadeSlideIn_0.5s_cubic-bezier(0.22,1,0.36,1)_forwards]" : "",
                  ].join(" ")}
                  style={{
                    animationDelay: isFiltered ? "0ms" : `${sectionIdx * 60}ms`,
                    opacity: isFiltered ? undefined : 1,
                  }}
                >
                  <ScrollReveal delay={sectionIdx * 40}>
                    <header className={`flex items-center gap-3 ${isMobile ? "mb-7" : "mb-5"}`}>
                      <p className="font-accent text-[22px] font-semibold text-muted whitespace-nowrap">
                        ✦ {branch} — {attendees.length} coming
                      </p>
                      <div
                        className="flex-1 h-px rounded-full opacity-35"
                        style={{ backgroundColor: color }}
                        aria-hidden="true"
                      />
                    </header>
                  </ScrollReveal>

                  <ScrollRevealGroup
                    key={`${branch}-${animEpoch}`}
                    motion="fade"
                    stagger={50}
                    baseDelay={isFiltered ? 80 : sectionIdx * 60 + 100}
                    className={cardGridClass}
                    itemClassName={isMobile ? "w-full min-w-0 overflow-visible flex justify-center" : ""}
                    style={{ perspective: isMobile ? "900px" : "1200px" }}
                    threshold={0.05}
                  >
                    {attendees.map((person, idx) => (
                      <PolaroidCard
                        key={`${person.id}-${animEpoch}`}
                        variant="public"
                        index={idx}
                        fluid={isMobile}
                        branchAccentColor={BRANCH_COLORS[branch]}
                        person={{
                          id: person.id,
                          fullName: person.fullName,
                          subtitle: formatLocation(person.city, person.country),
                          hasPhoto: person.hasPhoto,
                          photoSrc: person.hasPhoto && thumbsBaseUrl
                            ? publicPhotoUrl(person.id, thumbsBaseUrl, photosVersion)
                            : undefined,
                        }}
                      />
                    ))}
                  </ScrollRevealGroup>
                </section>
              );
            })}
          </div>
        )}
      </main>

      <section className="mt-8 border-t border-[rgba(200,180,150,0.22)] bg-[rgba(185,223,226,0.08)] px-5 py-10 md:py-14 text-center">
        <ScrollReveal>
          <p className="font-heading text-[clamp(20px,3.5vw,28px)] font-semibold text-charcoal">
            Different places. Same memories.
          </p>
        </ScrollReveal>
        <ScrollReveal delay={80}>
          <p className="font-accent text-[clamp(20px,3.5vw,26px)] text-terracotta mt-1.5">
            Your batchmates are already packing their bags.
          </p>
        </ScrollReveal>
        {showRegister && (
          <ScrollReveal delay={160}>
            <Link
              to="/register"
              className="inline-flex items-center mt-6 px-9 py-3.5 rounded-full bg-terracotta text-white font-semibold text-[15px] no-underline shadow-[0_8px_20px_rgba(215,107,81,0.25)] transition hover:brightness-95 hover:-translate-y-0.5"
            >
              Count me in
            </Link>
          </ScrollReveal>
        )}
      </section>

      <SiteFooter />
    </div>
  );
}
