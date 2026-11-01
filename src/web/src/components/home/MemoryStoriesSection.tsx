import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { fetchPublicStories } from "@/lib/api";
import { getAuthRole } from "@/lib/auth";
import { ScrollReveal, ScrollRevealGroup } from "@/components/ui/ScrollReveal";
import type { PublicStory } from "@smriti/shared";

/*
 * CONTRACT: MemoryStoriesSection
 *
 * GUARANTEES:
 * - Gated on the `homepage_show_memory_stories` public flag — renders
 *   nothing while the flag is off.
 * - Fetches published stories on mount and shows the 3 newest.
 * - Renders nothing on fetch failure or while the fetch is in flight, so the
 *   homepage never shows a loading placeholder or a broken section.
 * - Shows an invitation card instead of quote cards when there are 0
 *   published stories.
 *
 * EXPECTS:
 * - FeatureFlagsProvider is mounted above the homepage in the tree.
 */

const SHARE_HREF_LOGGED_OUT = "/login?returnTo=%2Fmemories%2Fstories";
const SHARE_HREF_LOGGED_IN = "/memories/stories";

function StoryQuoteCard({ story }: { story: PublicStory }) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-border-warm bg-surface p-6 shadow-[0_10px_28px_rgba(80,60,40,0.06)]">
      <span className="font-heading text-5xl leading-none text-terracotta/40">&ldquo;</span>
      <p className="mt-2 flex-1 font-body text-[15px] leading-relaxed text-charcoal line-clamp-4">
        {story.text}
      </p>
      <div className="mt-5 border-t border-border-warm pt-3">
        <p className="text-sm font-semibold text-charcoal/80">
          {story.authorName}
          <span className="font-normal text-muted"> &middot; {story.branch}</span>
        </p>
      </div>
    </div>
  );
}

export function MemoryStoriesSection() {
  const showSection = useFeatureFlag("homepage_show_memory_stories");
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [stories, setStories] = useState<PublicStory[]>([]);

  useEffect(() => {
    if (!showSection) return;
    let cancelled = false;
    setStatus("loading");
    fetchPublicStories()
      .then((res) => {
        if (cancelled) return;
        setStories(res.stories.slice(0, 3));
        setStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [showSection]);

  if (!showSection || status !== "loaded") return null;

  const isAuthenticated = getAuthRole() !== null;
  const shareHref = isAuthenticated ? SHARE_HREF_LOGGED_IN : SHARE_HREF_LOGGED_OUT;
  const isEmpty = stories.length === 0;

  return (
    <section className="border-t border-border-warm bg-[#FFF8EF] px-5 py-12 md:py-16">
      <div className="mx-auto max-w-5xl">
        <ScrollReveal>
          <div className="text-center">
            <h2 className="font-heading text-[22px] font-bold text-charcoal md:text-[28px]">
              In Our Own Words
            </h2>
            <p className="mt-2 font-accent text-lg text-terracotta">
              Small things we carried home from Smriti
            </p>
          </div>
        </ScrollReveal>

        {isEmpty ? (
          <ScrollReveal delay={80}>
            <div className="mx-auto mt-10 max-w-md rounded-2xl border border-border-warm bg-surface p-8 text-center shadow-[0_10px_28px_rgba(80,60,40,0.06)]">
              <p className="font-body text-charcoal">
                The book is still blank. Be the first to add your page.
              </p>
              <Link
                to={shareHref}
                className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-terracotta px-6 py-3 text-sm font-bold text-white no-underline transition hover:brightness-95"
              >
                Share yours
              </Link>
            </div>
          </ScrollReveal>
        ) : (
          <>
            <ScrollRevealGroup
              stagger={100}
              baseDelay={80}
              itemClassName="w-full min-w-0"
              className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3"
            >
              {stories.map((story) => (
                <StoryQuoteCard key={story.id} story={story} />
              ))}
            </ScrollRevealGroup>

            <ScrollReveal delay={160}>
              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-6">
                <Link
                  to="/memories/stories"
                  className="text-sm font-semibold text-charcoal/70 no-underline transition-colors hover:text-terracotta"
                >
                  Read the autograph book
                </Link>
                <Link
                  to={shareHref}
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-terracotta px-6 py-3 text-sm font-bold text-white no-underline transition hover:brightness-95"
                >
                  Share yours
                </Link>
              </div>
            </ScrollReveal>
          </>
        )}
      </div>
    </section>
  );
}
