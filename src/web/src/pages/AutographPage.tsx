import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { AutographHero } from "@/components/autograph/AutographHero";
import { AutographEntryCard } from "@/components/autograph/AutographEntryCard";
import { AuthorPanel } from "@/components/autograph/AuthorPanel";
import type { AuthorViewState } from "@/components/autograph/AuthorPanel";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { fetchPublicStories, fetchAuthorState } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { ApiError } from "@/lib/http";
import type { PublicStory } from "@smriti/shared";

/*
 * CONTRACT: AutographPage
 *
 * GUARANTEES:
 * - Renders the /memories/stories autograph book: hero, author panel, story wall.
 * - Each of the author's own stories (up to STORIES_PER_PERSON_MAX) is
 *   highlighted in the wall with a "Yours" tag and inline edit/delete
 *   controls — no separate display section.
 * - Gates on `memories_show_stories` flag.
 */

function AutographSkeleton() {
  return (
    <div
      aria-busy="true"
      className="mx-auto grid max-w-5xl grid-cols-1 gap-x-10 gap-y-14 md:grid-cols-2"
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="autograph-ruled-page animate-pulse">
          <div className="h-4 w-11/12 rounded bg-[var(--line)]" />
          <div className="mt-3 h-4 w-10/12 rounded bg-[var(--line)]" />
          <div className="mt-3 h-4 w-9/12 rounded bg-[var(--line)]" />
          <div className="mt-6 flex items-center justify-end gap-3">
            <div className="h-11 w-11 shrink-0 rounded-full bg-[var(--line)]" />
            <div className="h-8 w-24 rounded bg-[var(--line)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AutographPage() {
  useDocumentTitle("Autograph");
  const showStories = useFeatureFlag("memories_show_stories");
  const panelRef = useRef<HTMLElement>(null);

  const [stories, setStories] = useState<PublicStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [authorView, setAuthorView] = useState<AuthorViewState>(() =>
    getToken() ? { kind: "loading" } : { kind: "anonymous" },
  );
  const [editingStoryId, setEditingStoryId] = useState<number | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);

  const loadStories = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetchPublicStories();
      setStories(res.stories);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAuthor = useCallback(async () => {
    if (!getToken()) {
      setAuthorView({ kind: "anonymous" });
      return;
    }
    setAuthorView({ kind: "loading" });
    try {
      const authorState = await fetchAuthorState();
      setAuthorView({ kind: "ready", authorState });
      setEditingStoryId(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === "REGISTRATION_REQUIRED") {
        setAuthorView({ kind: "unmatched" });
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setAuthorView({ kind: "anonymous" });
        return;
      }
      setAuthorView({ kind: "fetch-error" });
    }
  }, []);

  useEffect(() => {
    if (!showStories) return;
    loadStories();
    loadAuthor();
  }, [showStories, loadStories, loadAuthor]);

  const myStoryIds = new Set(
    authorView.kind === "ready" ? authorView.authorState.stories.map((s) => s.id) : [],
  );

  const canEdit =
    authorView.kind === "ready" && authorView.authorState.submissionsEnabled;

  function handleEdit(storyId: number) {
    setEditingStoryId(storyId);
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleDeleteRequest(storyId: number) {
    setConfirmingDeleteId(storyId);
  }

  if (!showStories) {
    return (
      <div className="autograph-page min-h-screen">
        <SiteNav />
        <main className="flex items-center justify-center px-6 py-24">
          <p className="text-[var(--muted)]">This page is not available yet.</p>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="autograph-page min-h-screen">
      <SiteNav />

      <main>
        <AutographHero />

        <section
          ref={panelRef}
          aria-label="Share your story"
          className="border-b border-[var(--line)] bg-[var(--paper-warm)] px-6 py-10"
        >
          <AuthorPanel
            viewState={authorView}
            editingStoryId={editingStoryId}
            confirmingDeleteStoryId={confirmingDeleteId}
            onStoryChanged={loadStories}
            onLoad={loadAuthor}
            onCancelEdit={() => setEditingStoryId(null)}
            onCancelDelete={() => setConfirmingDeleteId(null)}
          />
        </section>

        <section aria-label="Stories from batchmates" className="px-5 py-12 sm:px-8">
          {loading && <AutographSkeleton />}

          {!loading && error && (
            <p className="mx-auto max-w-md text-center text-[var(--muted)]">
              Couldn't load stories right now. Please refresh and try again.
            </p>
          )}

          {!loading && !error && stories.length === 0 && (
            <p className="mx-auto max-w-md text-center text-[var(--muted)]">
              Be the first to sign the book.
            </p>
          )}

          {!loading && !error && stories.length > 0 && (
            <div className="autograph-wall mx-auto max-w-5xl">
              {stories.map((entry) => (
                <AutographEntryCard
                  key={entry.id}
                  entry={entry}
                  owned={
                    myStoryIds.has(entry.id)
                      ? {
                          canEdit,
                          onEdit: () => handleEdit(entry.id),
                          onDelete: () => handleDeleteRequest(entry.id),
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </section>

        {!getToken() && stories.length > 0 && (
          <section className="px-6 py-16 text-center">
            <p className="font-heading text-2xl font-bold text-[var(--ink)]">
              Your page is still blank.
            </p>
            <p className="mt-2 text-[var(--muted)]">
              Add what you'll remember, twenty years from now.
            </p>
            <Link
              to="/login?returnTo=%2Fmemories%2Fstories"
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-terracotta px-6 py-3 text-sm font-bold text-white no-underline transition hover:brightness-95"
            >
              Write your story
            </Link>
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
