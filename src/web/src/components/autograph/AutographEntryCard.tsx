import { useState } from "react";

import type { PublicStory } from "@smriti/shared";
import { Button } from "@/components/ui/Button";

export interface AutographEntryCardProps {
  entry: PublicStory;
  owned?: {
    canEdit: boolean;
    onEdit: () => void;
    onDelete: () => void;
  };
}

const DAY_MS = 1000 * 60 * 60 * 24;

function isMalayalamText(text: string): boolean {
  const malayalamChars = text.match(/[ഀ-ൿ]/g);
  return !!malayalamChars && malayalamChars.length > text.length * 0.2;
}

function relativeTime(publishedAt: number): string {
  const diffDays = Math.floor((Date.now() - publishedAt) / DAY_MS);

  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 7) return `${diffDays} days ago`;

  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks === 1) return "1 week ago";
  if (diffWeeks < 5) return `${diffWeeks} weeks ago`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths <= 1) return "1 month ago";
  return `${diffMonths} months ago`;
}

function AuthorInitial({ name }: { name: string }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-soft-aqua-light font-heading text-lg font-bold text-soft-aqua-deep">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function AuthorPhoto({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <AuthorInitial name={name} />;
  return (
    <img
      src={url}
      alt=""
      className="h-11 w-11 shrink-0 rounded-full border-2 border-white object-cover shadow-sm"
      onError={() => setFailed(true)}
    />
  );
}

export function AutographEntryCard({ entry, owned }: AutographEntryCardProps) {
  const isMalayalam = isMalayalamText(entry.text);
  const fontClass = isMalayalam ? "font-malayalam" : "font-body";

  return (
    <article className={`autograph-ruled-page ${owned ? "ring-2 ring-soft-aqua/50" : ""}`}>
      {owned && (
        <span className="mb-3 inline-block rounded-full bg-soft-aqua-light px-2.5 py-0.5 text-xs font-semibold text-soft-aqua-deep">
          Yours
        </span>
      )}
      <p
        lang={isMalayalam ? "ml" : undefined}
        className={`whitespace-pre-line ${fontClass} text-[15px] leading-[28px] text-[var(--ink)]`}
      >
        {entry.text}
      </p>
      <div className="mt-6 flex items-center justify-end gap-3">
        {entry.photoUrl
          ? <AuthorPhoto url={entry.photoUrl} name={entry.authorName} />
          : <AuthorInitial name={entry.authorName} />}
        <div className="text-right">
          <span className="block font-accent text-2xl text-[var(--coral-deep)]">
            {entry.authorName}
          </span>
          <span className="block text-xs text-[var(--muted)]">
            {entry.branch} · {relativeTime(entry.publishedAt)}
          </span>
        </div>
      </div>
      {owned && (
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--line)] pt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={owned.canEdit ? owned.onEdit : undefined}
            aria-disabled={!owned.canEdit || undefined}
          >
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={owned.onDelete}>
            Delete
          </Button>
        </div>
      )}
    </article>
  );
}
