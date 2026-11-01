/**
 * CONTRACT
 *
 * GUARANTEE: PLAIN_TEXT_ONLY — memoryStoryTextSchema and
 *   moderationCommentSchema use `.strict()`, rejecting any field beyond the
 *   documented ones (e.g. `html`, `media`). Story and moderation text are
 *   always plain strings, never rich content (memory-stories.spec.md R11,
 *   R6.1; interfaces/memory-stories.ispec.md R9).
 *
 * GUARANTEE: NO_DATE_OBJECTS — publishedAt/updatedAt/hiddenAt on every shape
 *   below are Unix epoch milliseconds (number), matching server convention.
 *
 * EXPECTS: Callers trim story/comment text themselves before persisting if
 *   they need the trimmed value outside Zod parsing — `z.string().trim()`
 *   only affects the parsed output, not the raw input.
 */

import { z } from "zod";

export const STORY_TEXT_MIN = 50;
export const STORY_TEXT_MAX = 2000;
export const STORIES_PER_PERSON_MAX = 3;
export const MODERATION_COMMENT_MIN = 10;
export const MODERATION_COMMENT_MAX = 1000;

export const memoryStoryTextSchema = z
  .object({
    text: z.string().trim().min(STORY_TEXT_MIN).max(STORY_TEXT_MAX),
  })
  .strict();

export const moderationCommentSchema = z
  .object({
    visibility: z.literal("hidden"),
    comment: z.string().trim().min(MODERATION_COMMENT_MIN).max(MODERATION_COMMENT_MAX),
  })
  .strict();

export const unhideRequestSchema = z
  .object({
    visibility: z.literal("visible"),
  })
  .strict();

export const moderationVisibilitySchema = z.discriminatedUnion("visibility", [
  moderationCommentSchema,
  unhideRequestSchema,
]);

export type StoryVisibility = "visible" | "hidden";

export interface PublicStory {
  id: number;
  text: string;
  authorName: string;
  branch: string;
  photoUrl: string | null;
  publishedAt: number;
  updatedAt: number;
}

export interface AuthorStateResponse {
  stories: PublicStory[];
  author: {
    name: string;
    branch: string;
  };
  submissionsEnabled: boolean;
  canAddMore: boolean;
}

export interface AdminStory {
  id: number;
  text: string;
  authorName: string;
  branch: string;
  publishedAt: number;
  updatedAt: number;
  visibility: StoryVisibility;
  hiddenAt: number | null;
  hiddenBy: number | null;
  moderationComment: string | null;
}

export interface PublicStoriesResponse {
  stories: PublicStory[];
  count: number;
}

export interface AdminStoriesResponse {
  stories: AdminStory[];
}

export interface StoryMutationResponse {
  story: PublicStory;
}

export interface VisibilityChangeResponse {
  story: { id: number; visibility: StoryVisibility };
  notification: "sent" | "failed" | "not_requested";
}
