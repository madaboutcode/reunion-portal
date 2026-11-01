import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { memoryStoryTextSchema, STORY_TEXT_MAX } from "@smriti/shared";
import type { AuthorStateResponse } from "@smriti/shared";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { createStory, updateStory, deleteStory } from "@/lib/api";
import { ApiError } from "@/lib/http";

/*
 * CONTRACT: AuthorPanel
 *
 * GUARANTEES:
 * - Renders the author-facing panel: sign-in (anonymous), write form (no
 *   stories yet), edit form for a specific story (triggered from wall card),
 *   a "Write another" action (has stories, canAddMore, not editing), or
 *   nothing visible (has stories, can't add more, not editing — the wall
 *   card shows each story with controls).
 * - Owns the delete confirmation dialog, triggered via requestDelete().
 * - Calls onStoryChanged() after every successful create/update/delete.
 *
 * EXPECTS:
 * - viewState and editingStoryId are owned by the parent (AutographPage).
 */

interface StoryFormValues {
  text: string;
}

function StoryForm({
  defaultText,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  defaultText: string;
  submitLabel: string;
  onCancel?: () => void;
  onSubmit: (text: string) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<StoryFormValues>({
    resolver: zodResolver(memoryStoryTextSchema),
    defaultValues: { text: defaultText },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const text = watch("text") ?? "";
  const count = text.length;
  const overLimit = count > STORY_TEXT_MAX;

  async function onValid(values: StoryFormValues) {
    setSubmitError(null);
    try {
      await onSubmit(values.text);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "MAX_STORIES_REACHED") {
          setSubmitError("You've reached the maximum number of stories.");
          return;
        }
        if (err.code === "SUBMISSIONS_DISABLED") {
          setSubmitError("Story submissions are currently closed.");
          return;
        }
        if (err.code === "INVALID_STORY") {
          const details = (err.details as { details?: Record<string, string> })?.details;
          if (details?.text) {
            setError("text", { message: details.text });
            return;
          }
          setSubmitError("That story couldn't be saved. Please check the text and try again.");
          return;
        }
      }
      setSubmitError("Something went wrong. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onValid)} className="text-left">
      <label htmlFor="story-text" className="sr-only">
        Your story
      </label>
      <Textarea
        id="story-text"
        rows={6}
        placeholder="What stayed with you after Smriti?"
        error={!!errors.text}
        aria-describedby={errors.text ? "story-text-error story-text-count" : "story-text-count"}
        className="font-body leading-relaxed"
        {...register("text")}
      />
      <div className="mt-1.5 flex items-start justify-between gap-3">
        <p id="story-text-error" className="text-sm text-terracotta" role={errors.text ? "alert" : undefined}>
          {errors.text?.message}
        </p>
        <p
          id="story-text-count"
          className={`shrink-0 text-xs ${overLimit ? "text-terracotta" : "text-[var(--muted)]"}`}
        >
          {count.toLocaleString()} / {STORY_TEXT_MAX.toLocaleString()}
        </p>
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm text-terracotta">
          {submitError}
        </p>
      )}

      <div className="mt-4 flex items-center justify-center gap-3">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export type AuthorViewState =
  | { kind: "anonymous" }
  | { kind: "loading" }
  | { kind: "fetch-error" }
  | { kind: "unmatched" }
  | { kind: "ready"; authorState: AuthorStateResponse };

export interface AuthorPanelProps {
  viewState: AuthorViewState;
  editingStoryId: number | null;
  confirmingDeleteStoryId: number | null;
  onStoryChanged: () => void;
  onLoad: () => void;
  onCancelEdit: () => void;
  onCancelDelete: () => void;
}

export function AuthorPanel({
  viewState,
  editingStoryId,
  confirmingDeleteStoryId,
  onStoryChanged,
  onLoad,
  onCancelEdit,
  onCancelDelete,
}: AuthorPanelProps) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showingCreateForm, setShowingCreateForm] = useState(false);

  async function handleDelete() {
    if (confirmingDeleteStoryId === null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteStory(confirmingDeleteStoryId);
      onCancelDelete();
      onStoryChanged();
      onLoad();
    } catch {
      setDeleteError("Couldn't delete your story right now. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  // Delete dialog — always rendered so it can be triggered from the wall card
  const deleteDialog = (
    <ConfirmDialog
      open={confirmingDeleteStoryId !== null}
      title="Delete your story?"
      message={deleteError ?? "This removes your page from the book. This can't be undone."}
      confirmLabel="Delete my story"
      confirmVariant="danger"
      loading={deleting}
      onConfirm={handleDelete}
      onCancel={onCancelDelete}
    />
  );

  if (viewState.kind === "anonymous") {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <p className="font-heading text-2xl font-bold text-[var(--ink)]">
          What stayed with you after Smriti?
        </p>
        <p className="mt-2 text-[var(--muted)]">
          Sign in with your registration to add your page to the book.
        </p>
        <Link
          to="/login?returnTo=%2Fmemories%2Fstories"
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-terracotta px-6 py-3 text-sm font-bold text-white no-underline transition hover:brightness-95"
        >
          Sign in to share yours
        </Link>
      </div>
    );
  }

  if (viewState.kind === "loading") {
    return (
      <div aria-busy="true" className="mx-auto max-w-2xl text-center">
        <div className="mx-auto h-4 w-40 animate-pulse rounded bg-[var(--line)]" />
      </div>
    );
  }

  if (viewState.kind === "fetch-error") {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-[var(--muted)]">Couldn't load your story panel right now.</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={onLoad}>
          Try again
        </Button>
      </div>
    );
  }

  if (viewState.kind === "unmatched") {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-[var(--muted)]">
          You're signed in as staff, but story authorship requires a matching registration.
        </p>
      </div>
    );
  }

  const { authorState } = viewState;

  // Editing a specific story (triggered from wall card)
  if (editingStoryId !== null) {
    const editingStory = authorState.stories.find((s) => s.id === editingStoryId);
    if (!editingStory) return deleteDialog;

    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-center font-heading text-xl font-bold text-[var(--ink)]">
          Edit your story
        </p>
        <div className="mt-5">
          <StoryForm
            defaultText={editingStory.text}
            submitLabel="Save changes"
            onCancel={onCancelEdit}
            onSubmit={async (text) => {
              await updateStory(editingStoryId, text);
              onCancelEdit();
              onStoryChanged();
              onLoad();
            }}
          />
        </div>
        {deleteDialog}
      </div>
    );
  }

  // No stories yet
  if (authorState.stories.length === 0) {
    if (!authorState.submissionsEnabled) {
      return (
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-heading text-2xl font-bold text-[var(--ink)]">
            What stayed with you after Smriti?
          </p>
          <p className="mt-2 text-[var(--muted)]">Story submissions are currently closed.</p>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-center font-heading text-2xl font-bold text-[var(--ink)]">
          What stayed with you after Smriti?
        </p>
        <div className="mt-5">
          <StoryForm
            defaultText=""
            submitLabel="Add to the book"
            onSubmit={async (text) => {
              await createStory(text);
              onStoryChanged();
              onLoad();
            }}
          />
        </div>
      </div>
    );
  }

  // Has at least one story, not editing — offer "Write another" if room remains
  if (showingCreateForm && authorState.canAddMore) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-center font-heading text-xl font-bold text-[var(--ink)]">
          Write another page
        </p>
        <div className="mt-5">
          <StoryForm
            defaultText=""
            submitLabel="Add to the book"
            onCancel={() => setShowingCreateForm(false)}
            onSubmit={async (text) => {
              await createStory(text);
              setShowingCreateForm(false);
              onStoryChanged();
              onLoad();
            }}
          />
        </div>
        {deleteDialog}
      </div>
    );
  }

  if (authorState.canAddMore) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <Button variant="secondary" size="sm" onClick={() => setShowingCreateForm(true)}>
          Write another
        </Button>
        {deleteDialog}
      </div>
    );
  }

  // At the story limit, not editing — panel renders nothing visible, but keeps the delete dialog available
  return deleteDialog;
}
