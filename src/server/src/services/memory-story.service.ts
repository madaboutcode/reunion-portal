/**
 * CONTRACT
 *
 * GUARANTEE: PUBLIC_LIST_GATED — listPublic() throws
 *   AppError(404, 'FEATURE_UNAVAILABLE') when memories_show_stories is off,
 *   and AppError(503, 'STORIES_UNAVAILABLE') when the story read itself
 *   fails, matching interfaces/memory-stories.ispec.md R2.3, R2.4. The route
 *   layer also gates this endpoint with requireFeatureFlag — this check is a
 *   second, defense-in-depth guard for any caller that reaches the service
 *   directly.
 *
 * GUARANTEE: IDENTITY_RESOLUTION — every author-facing method (getAuthorState,
 *   create, updateMine, deleteMine) resolves the caller's own registration
 *   before doing anything else: an attendee JWT resolves by registrationId,
 *   a staff/admin JWT resolves by email to its newest matching registration.
 *   No registration match throws AppError(403, 'REGISTRATION_REQUIRED')
 *   (ispec R3.4, R3.5).
 *
 * GUARANTEE: SUBMISSIONS_GATE_CREATE_UPDATE_ONLY — create() and updateMine()
 *   throw AppError(409, 'SUBMISSIONS_DISABLED') when
 *   memory_stories_accept_submissions is off. deleteMine() never checks this
 *   flag (ispec R6.3, R10.1).
 *
 * GUARANTEE: HIDE_NOTIFIES_BEST_EFFORT — changeVisibility() attempts a
 *   sendStoryHidden email only on a hide transition that actually changed
 *   state. Email failure never fails the request or reverts the visibility
 *   change — it downgrades `notification` to 'failed' and best-effort writes
 *   a 'memory_story_hide_notification_failed' audit entry (ispec R8.3).
 *
 * GUARANTEE: IDEMPOTENT_MODERATION_NO_EMAIL — a moderation call that does not
 *   change visibility (repeat of current state) never sends an email and
 *   always returns notification: 'not_requested' (ispec R8.5).
 *
 * EXPECTS: featureFlagService is the SAME instance used by the
 *   requireFeatureFlag middleware for this request (memoized snapshot —
 *   feature-flag.service.ts SNAPSHOT_ONE_PER_REQUEST), so re-resolving here
 *   costs no extra D1 read.
 *
 * FAILURE BEHAVIOR: All AppError throws carry the status code and code
 *   listed above; the shared error middleware renders them. Any other error
 *   propagates and is rendered as 500.
 */

import type {
  PublicStory,
  AdminStory,
  AuthorStateResponse,
  PublicStoriesResponse,
  AdminStoriesResponse,
  VisibilityChangeResponse,
} from '@smriti/shared';
import type { AuthContext } from '../env.js';
import type {
  IMemoryStoryRepository,
  MemoryStoryVisibilityTransition,
} from '../repositories/interfaces.js';
import type { IRegistrationRepository, ISystemAuditRepository, IEmailService } from '../repositories/interfaces.js';
import type { FeatureFlagSnapshot } from './feature-flag.service.js';
import type { MemoryStoryRow } from '../domain/memory-story-types.js';
import { STORIES_PER_PERSON_MAX } from '@smriti/shared';
import { AppError } from './errors.js';
import { createLogger } from '../infra/logger.js';

const log = createLogger('memory-stories');

interface RegistrationIdentity {
  registrationId: number;
  name: string;
  branch: string;
  email: string;
  hasPhoto: boolean;
}

export class MemoryStoryService {
  private storyRepo: IMemoryStoryRepository;
  private registrationRepo: IRegistrationRepository;
  private featureFlagService: { resolve(): Promise<FeatureFlagSnapshot> };
  private emailService: IEmailService;
  private systemAuditRepo: ISystemAuditRepository;
  private publicThumbsUrl: string;

  constructor(deps: {
    storyRepo: IMemoryStoryRepository;
    registrationRepo: IRegistrationRepository;
    featureFlagService: { resolve(): Promise<FeatureFlagSnapshot> };
    emailService: IEmailService;
    systemAuditRepo: ISystemAuditRepository;
    publicThumbsUrl: string;
  }) {
    this.storyRepo = deps.storyRepo;
    this.registrationRepo = deps.registrationRepo;
    this.featureFlagService = deps.featureFlagService;
    this.emailService = deps.emailService;
    this.systemAuditRepo = deps.systemAuditRepo;
    this.publicThumbsUrl = deps.publicThumbsUrl;
  }

  async listPublic(): Promise<PublicStoriesResponse> {
    const snapshot = await this.featureFlagService.resolve();
    if (!snapshot.isEnabled('memories_show_stories')) {
      throw new AppError('Not found', 404, 'FEATURE_UNAVAILABLE');
    }

    let rows;
    try {
      rows = await this.storyRepo.listVisible();
    } catch (err) {
      log.error('Failed to list visible stories', { error: (err as Error).message });
      throw new AppError('Stories unavailable', 503, 'STORIES_UNAVAILABLE');
    }

    const stories = rows.map((row) => this.toPublicStory(row, row.has_photo === 1));
    return { stories, count: stories.length };
  }

  async getAuthorState(auth: AuthContext): Promise<AuthorStateResponse> {
    const identity = await this.resolveIdentity(auth);
    const rows = await this.storyRepo.findByRegistrationId(identity.registrationId);
    const snapshot = await this.featureFlagService.resolve();
    const submissionsEnabled = snapshot.isEnabled('memory_stories_accept_submissions');

    return {
      stories: rows.map((row) => this.toPublicStory(row, identity.hasPhoto)),
      author: { name: identity.name, branch: identity.branch },
      submissionsEnabled,
      canAddMore: rows.length < STORIES_PER_PERSON_MAX && submissionsEnabled,
    };
  }

  async create(auth: AuthContext, text: string): Promise<PublicStory> {
    const identity = await this.resolveIdentity(auth);
    await this.assertSubmissionsEnabled();

    const existingCount = await this.storyRepo.countByRegistrationId(identity.registrationId);
    if (existingCount >= STORIES_PER_PERSON_MAX) {
      throw new AppError('Maximum stories reached', 409, 'MAX_STORIES_REACHED');
    }

    const row: MemoryStoryRow = await this.storyRepo.create({
      registrationId: identity.registrationId,
      authorName: identity.name,
      authorBranch: identity.branch,
      text,
      now: Date.now(),
    });

    return this.toPublicStory(row, identity.hasPhoto);
  }

  async updateMine(auth: AuthContext, storyId: number, text: string): Promise<PublicStory> {
    const identity = await this.resolveIdentity(auth);
    await this.assertSubmissionsEnabled();

    const row = await this.storyRepo.updateOwned(storyId, identity.registrationId, text, Date.now());
    if (!row) {
      throw new AppError('Story not found', 404, 'STORY_NOT_FOUND');
    }

    return this.toPublicStory(row, identity.hasPhoto);
  }

  async deleteMine(auth: AuthContext, storyId: number): Promise<void> {
    const identity = await this.resolveIdentity(auth);
    const deleted = await this.storyRepo.deleteOwned(storyId, identity.registrationId, identity.email);
    if (!deleted) {
      throw new AppError('Story not found', 404, 'STORY_NOT_FOUND');
    }
  }

  async listForAdmin(): Promise<AdminStoriesResponse> {
    const rows = await this.storyRepo.listAllForAdmin();
    return { stories: rows.map((row) => this.toAdminStory(row)) };
  }

  async changeVisibility(
    storyId: number,
    transition: { visibility: 'hidden'; comment: string } | { visibility: 'visible' },
    adminAuth: { role: 'admin'; userId: number; email: string },
  ): Promise<VisibilityChangeResponse> {
    const now = Date.now();
    const repoTransition: MemoryStoryVisibilityTransition =
      transition.visibility === 'hidden'
        ? {
            visibility: 'hidden',
            comment: transition.comment,
            adminUserId: adminAuth.userId,
            adminEmail: adminAuth.email,
            now,
          }
        : { visibility: 'visible', adminEmail: adminAuth.email, now };

    const { changed, row } = await this.storyRepo.setVisibility(storyId, repoTransition);
    if (!row) {
      throw new AppError('Story not found', 404, 'STORY_NOT_FOUND');
    }

    if (!changed || transition.visibility === 'visible') {
      return { story: { id: row.id, visibility: transition.visibility }, notification: 'not_requested' };
    }

    // Changed to hidden — attempt a best-effort author notification.
    let notification: 'sent' | 'failed' = 'failed';
    try {
      const registration = await this.registrationRepo.findById(row.registration_id);
      if (!registration) {
        throw new Error(`registration ${row.registration_id} not found for story ${row.id}`);
      }
      await this.emailService.sendStoryHidden(registration.email, {
        authorName: row.author_name,
        comment: transition.comment,
      });
      notification = 'sent';
    } catch (err) {
      log.error('Failed to send story-hidden notification', {
        storyId: row.id,
        error: (err as Error).message,
      });
      try {
        await this.systemAuditRepo.append({
          action: 'memory_story_hide_notification_failed',
          actor: adminAuth.email,
          targetType: 'memory_story',
          targetId: row.id,
          details: JSON.stringify({ error: (err as Error).message }),
        });
      } catch (auditErr) {
        log.error('Failed to write hide-notification-failed audit', {
          storyId: row.id,
          error: (auditErr as Error).message,
        });
      }
      notification = 'failed';
    }

    return { story: { id: row.id, visibility: 'hidden' }, notification };
  }

  private async assertSubmissionsEnabled(): Promise<void> {
    const snapshot = await this.featureFlagService.resolve();
    if (!snapshot.isEnabled('memory_stories_accept_submissions')) {
      throw new AppError('Story submissions are currently closed', 409, 'SUBMISSIONS_DISABLED');
    }
  }

  private async resolveIdentity(auth: AuthContext): Promise<RegistrationIdentity> {
    if (auth.role === 'attendee') {
      const reg = await this.registrationRepo.findById(auth.registrationId);
      if (!reg) {
        throw new AppError('A matching registration is required', 403, 'REGISTRATION_REQUIRED');
      }
      return {
        registrationId: reg.id,
        name: reg.fullName,
        branch: reg.branch,
        email: reg.email,
        hasPhoto: reg.photoThumbKey !== null,
      };
    }

    const regs = await this.registrationRepo.findByEmail(auth.email);
    if (regs.length === 0) {
      throw new AppError('A matching registration is required', 403, 'REGISTRATION_REQUIRED');
    }
    const newest = regs.reduce((a, b) => (b.id > a.id ? b : a));
    return {
      registrationId: newest.id,
      name: newest.fullName,
      branch: newest.branch,
      email: newest.email,
      hasPhoto: newest.photoThumbKey !== null,
    };
  }

  private toPublicStory(row: MemoryStoryRow, hasPhoto: boolean): PublicStory {
    return {
      id: row.id,
      text: row.text,
      authorName: row.author_name,
      branch: row.author_branch,
      photoUrl: this.buildPhotoUrl(row.registration_id, hasPhoto),
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
    };
  }

  private toAdminStory(row: MemoryStoryRow): AdminStory {
    if (row.visibility !== 'visible' && row.visibility !== 'hidden') {
      throw new Error(`memory-story.service: unexpected visibility "${row.visibility}" for story ${row.id}`);
    }
    return {
      id: row.id,
      text: row.text,
      authorName: row.author_name,
      branch: row.author_branch,
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
      visibility: row.visibility,
      hiddenAt: row.hidden_at,
      hiddenBy: row.hidden_by_user_id,
      moderationComment: row.moderation_comment,
    };
  }

  private buildPhotoUrl(registrationId: number, hasPhoto: boolean): string | null {
    if (!hasPhoto || !this.publicThumbsUrl) return null;
    return `${this.publicThumbsUrl}/${registrationId}.jpg`;
  }
}
