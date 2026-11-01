/**
 * CONTRACT
 *
 * GUARANTEE: ROW_MIRRORS_TABLE — MemoryStoryRow mirrors the `memory_stories`
 *   D1 table (schema.sql) exactly. `visibility` is the raw TEXT column value
 *   ('visible' | 'hidden') — callers narrow to StoryVisibility at the
 *   service boundary, this row type does not.
 *
 * GUARANTEE: VISIBLE_ROW_HAS_PHOTO_FLAG — MemoryStoryVisibleRow extends
 *   MemoryStoryRow with `has_photo` (0|1), computed by
 *   D1MemoryStoryRepository.listVisible()'s JOIN against
 *   registrations.photo_thumb_key. Only listVisible() returns this shape —
 *   every other repository method returns plain MemoryStoryRow.
 */

export interface MemoryStoryRow {
  id: number;
  registration_id: number;
  author_name: string;
  author_branch: string;
  text: string;
  visibility: string;
  published_at: number;
  updated_at: number;
  hidden_at: number | null;
  hidden_by_user_id: number | null;
  moderation_comment: string | null;
}

export interface MemoryStoryVisibleRow extends MemoryStoryRow {
  has_photo: number;
}
