/**
 * CONTRACT: Public and author-facing memory story routes
 *   (interfaces/memory-stories.ispec.md R2-R6).
 *
 * GUARANTEE: NO_STORE — every response here sets Cache-Control: no-store. A
 *   hidden story or a submissions-disabled state must never be served stale
 *   from a browser or edge cache.
 *
 * GUARANTEE: AUTHOR_ROUTES_AUTHENTICATED — every route under
 *   authorMemoryStoryRoutes requires a valid JWT (authMiddleware). Identity
 *   resolution beyond that (registration ownership) is the service's job.
 *
 * GUARANTEE: DELETE_UNGATED — DELETE /mine/:storyId carries no
 *   requireFeatureFlag check — deletion stays available even when
 *   submissions are closed (ispec R6.3).
 *
 * EXPECTS: c.var.memoryStoryService is set by app.ts DI middleware.
 *
 * FAILURE BEHAVIOR: 422 { error: 'Invalid story', code: 'INVALID_STORY',
 *   details } on schema validation failure (ispec R4.1). 422
 *   { error: 'Invalid story id', code: 'INVALID_STORY_ID' } when :storyId is
 *   not an integer. All other error codes are thrown by the service as
 *   AppError and rendered by the shared error middleware.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { requireFeatureFlag } from '../middleware/require-feature-flag.js';
import { memoryStoryTextSchema } from '@smriti/shared';

/** Maps zod issues to a { field: message } record, first error per field. */
function collectFieldErrors(result: { error: import('zod').ZodError }): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    if (!errors[path]) errors[path] = issue.message;
  }
  return errors;
}

const SUBMISSIONS_DISABLED_BODY = {
  error: 'Story submissions are currently closed',
  code: 'SUBMISSIONS_DISABLED',
};

// ---------------------------------------------------------------------------
// Public — mounted under /public (path: GET /public/memory-stories)
// ---------------------------------------------------------------------------

export const publicMemoryStoryRoutes = new Hono<AppEnv>();

publicMemoryStoryRoutes.get(
  '/memory-stories',
  requireFeatureFlag('memories_show_stories', {
    disabledStatus: 404,
    disabledBody: { error: 'Not found', code: 'FEATURE_UNAVAILABLE' },
  }),
  async (c) => {
    c.header('Cache-Control', 'no-store');
    const response = await c.var.memoryStoryService.listPublic();
    return c.json(response);
  },
);

// ---------------------------------------------------------------------------
// Author — mounted under /memory-stories
// ---------------------------------------------------------------------------

export const authorMemoryStoryRoutes = new Hono<AppEnv>();

authorMemoryStoryRoutes.use('*', authMiddleware);

authorMemoryStoryRoutes.get('/mine', async (c) => {
  c.header('Cache-Control', 'no-store');
  const response = await c.var.memoryStoryService.getAuthorState(c.var.auth);
  return c.json(response);
});

authorMemoryStoryRoutes.post(
  '/',
  requireFeatureFlag('memory_stories_accept_submissions', {
    disabledStatus: 409,
    disabledBody: SUBMISSIONS_DISABLED_BODY,
  }),
  async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = memoryStoryTextSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid story', code: 'INVALID_STORY', details: collectFieldErrors(parsed) }, 422);
    }

    const story = await c.var.memoryStoryService.create(c.var.auth, parsed.data.text);
    c.header('Cache-Control', 'no-store');
    return c.json({ story }, 201);
  },
);

authorMemoryStoryRoutes.put(
  '/mine/:storyId',
  requireFeatureFlag('memory_stories_accept_submissions', {
    disabledStatus: 409,
    disabledBody: SUBMISSIONS_DISABLED_BODY,
  }),
  async (c) => {
    const storyId = Number.parseInt(c.req.param('storyId'), 10);
    if (!Number.isInteger(storyId)) {
      return c.json({ error: 'Invalid story id', code: 'INVALID_STORY_ID' }, 422);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = memoryStoryTextSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid story', code: 'INVALID_STORY', details: collectFieldErrors(parsed) }, 422);
    }

    const story = await c.var.memoryStoryService.updateMine(c.var.auth, storyId, parsed.data.text);
    c.header('Cache-Control', 'no-store');
    return c.json({ story });
  },
);

authorMemoryStoryRoutes.delete('/mine/:storyId', async (c) => {
  const storyId = Number.parseInt(c.req.param('storyId'), 10);
  if (!Number.isInteger(storyId)) {
    return c.json({ error: 'Invalid story id', code: 'INVALID_STORY_ID' }, 422);
  }

  await c.var.memoryStoryService.deleteMine(c.var.auth, storyId);
  return c.body(null, 204);
});
