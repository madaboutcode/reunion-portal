/**
 * CONTRACT
 *
 * GUARANTEE: VISIBLE_ONLY_PUBLIC_READ — listVisible() returns only rows with
 *   visibility='visible', newest published_at first, joined with a computed
 *   has_photo flag from registrations.photo_thumb_key (memory-stories
 *   .spec.md, interfaces/memory-stories.ispec.md R2, R2.2).
 *
 * GUARANTEE: OWNED_MUTATIONS_SCOPED — updateOwned() and deleteOwned() only
 *   ever touch the row whose id AND registration_id both match — ownership is
 *   enforced by the WHERE clause, not by a pre-read-then-compare check.
 *
 * GUARANTEE: DELETE_ATOMIC — deleteOwned() deletes the row and appends the
 *   'memory_story_deleted' audit entry in a single db.batch() call.
 *
 * GUARANTEE: VISIBILITY_GUARDED — setVisibility() only changes the row when
 *   its CURRENT visibility differs from the requested one (mirrors
 *   desk.repo.ts markPresent/markAbsent's guarded-UPDATE pattern). The audit
 *   INSERT and the UPDATE share the same pre-transition WHERE guard so an
 *   idempotent repeat writes no audit row and reports changed:false.
 *
 * EXPECTS: db is a live D1Database. memory_stories has the schema in
 *   schema.sql (registration_id index is non-unique — up to
 *   STORIES_PER_PERSON_MAX rows per registration; the count check is the
 *   service layer's job, not this repository's).
 *
 * FAILURE BEHAVIOR: findByRegistrationId returns [] when none found; findById
 *   returns null when not found. updateOwned() returns null when no row
 *   matches (id, registration_id). deleteOwned() returns false when no row
 *   matches. setVisibility() returns {changed: false, row: null} when the id
 *   does not exist at all. All other D1 errors propagate as thrown errors.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { MemoryStoryRow, MemoryStoryVisibleRow } from '../domain/memory-story-types.js';
import type { IMemoryStoryRepository, MemoryStoryVisibilityTransition } from './interfaces.js';

export class D1MemoryStoryRepository implements IMemoryStoryRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async listVisible(): Promise<MemoryStoryVisibleRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ms.*, CASE WHEN r.photo_thumb_key IS NOT NULL THEN 1 ELSE 0 END AS has_photo
         FROM memory_stories ms
         LEFT JOIN registrations r ON r.id = ms.registration_id
         WHERE ms.visibility = 'visible'
         ORDER BY ms.published_at DESC`,
      )
      .all<MemoryStoryVisibleRow>();
    return results;
  }

  async listAllForAdmin(): Promise<MemoryStoryRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM memory_stories ORDER BY published_at DESC')
      .all<MemoryStoryRow>();
    return results;
  }

  async findByRegistrationId(registrationId: number): Promise<MemoryStoryRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM memory_stories WHERE registration_id = ? ORDER BY published_at DESC')
      .bind(registrationId)
      .all<MemoryStoryRow>();
    return results;
  }

  async countByRegistrationId(registrationId: number): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS count FROM memory_stories WHERE registration_id = ?')
      .bind(registrationId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  private async findById(id: number): Promise<MemoryStoryRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM memory_stories WHERE id = ?')
      .bind(id)
      .first<MemoryStoryRow>();
    return row ?? null;
  }

  async create(input: {
    registrationId: number;
    authorName: string;
    authorBranch: string;
    text: string;
    now: number;
  }): Promise<MemoryStoryRow> {
    const result = await this.db
      .prepare(
        `INSERT INTO memory_stories
           (registration_id, author_name, author_branch, text, visibility, published_at, updated_at)
         VALUES (?, ?, ?, ?, 'visible', ?, ?)`,
      )
      .bind(input.registrationId, input.authorName, input.authorBranch, input.text, input.now, input.now)
      .run();

    const row = await this.findById(result.meta.last_row_id as number);
    if (!row) {
      throw new Error(
        `memory-story.repo: create() succeeded but no row found for registration ${input.registrationId}`,
      );
    }
    return row;
  }

  async updateOwned(storyId: number, registrationId: number, text: string, now: number): Promise<MemoryStoryRow | null> {
    const result = await this.db
      .prepare('UPDATE memory_stories SET text = ?, updated_at = ? WHERE id = ? AND registration_id = ?')
      .bind(text, now, storyId, registrationId)
      .run();
    if (result.meta.changes === 0) return null;
    return this.findById(storyId);
  }

  async deleteOwned(storyId: number, registrationId: number, actor: string): Promise<boolean> {
    // Audit INSERT runs BEFORE the DELETE (both in one db.batch()) — its
    // SELECT...FROM memory_stories must see the row before it is gone, or
    // it would insert zero audit rows for a real deletion.
    const audit = this.db
      .prepare(
        `INSERT INTO system_audit_log (action, actor, target_type, target_id, details)
         SELECT 'memory_story_deleted', ?, 'memory_story', id, ?
         FROM memory_stories WHERE id = ? AND registration_id = ?`,
      )
      .bind(actor, JSON.stringify({ storyId, registrationId }), storyId, registrationId);
    const del = this.db
      .prepare('DELETE FROM memory_stories WHERE id = ? AND registration_id = ?')
      .bind(storyId, registrationId);

    const [, delResult] = await this.db.batch([audit, del]);
    return delResult.meta.changes > 0;
  }

  async setVisibility(
    id: number,
    transition: MemoryStoryVisibilityTransition,
  ): Promise<{ changed: boolean; row: MemoryStoryRow | null }> {
    let audit;
    let update;

    if (transition.visibility === 'hidden') {
      // Audit INSERT is evaluated BEFORE the UPDATE runs (both in one
      // db.batch()), so its WHERE clause reads the PRE-transition state —
      // it must NOT be re-checked after the UPDATE has already applied, or
      // an idempotent repeat would see its own post-update state and write
      // a duplicate audit row. Mirrors desk.repo.ts markPresent's ordering.
      audit = this.db
        .prepare(
          `INSERT INTO system_audit_log (action, actor, target_type, target_id, details)
           SELECT 'memory_story_hidden', ?, 'memory_story', id, ?
           FROM memory_stories WHERE id = ? AND visibility = 'visible'`,
        )
        .bind(transition.adminEmail, JSON.stringify({ comment: transition.comment }), id);
      update = this.db
        .prepare(
          `UPDATE memory_stories
           SET visibility = 'hidden', hidden_at = ?, hidden_by_user_id = ?, moderation_comment = ?
           WHERE id = ? AND visibility = 'visible'`,
        )
        .bind(transition.now, transition.adminUserId, transition.comment, id);
    } else {
      audit = this.db
        .prepare(
          `INSERT INTO system_audit_log (action, actor, target_type, target_id, details)
           SELECT 'memory_story_unhidden', ?, 'memory_story', id, NULL
           FROM memory_stories WHERE id = ? AND visibility = 'hidden'`,
        )
        .bind(transition.adminEmail, id);
      update = this.db
        .prepare(
          `UPDATE memory_stories
           SET visibility = 'visible', hidden_at = NULL, hidden_by_user_id = NULL, moderation_comment = NULL
           WHERE id = ? AND visibility = 'hidden'`,
        )
        .bind(id);
    }

    const [, updateResult] = await this.db.batch([audit, update]);
    const changed = updateResult.meta.changes > 0;
    const row = await this.findById(id);
    return { changed, row };
  }
}
