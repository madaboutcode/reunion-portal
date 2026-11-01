/**
 * CONTRACT: Admin moderation routes for memory stories
 *   (interfaces/memory-stories.ispec.md R7-R8).
 *
 * GUARANTEE: ADMIN_ONLY — every route requires a valid JWT with role=admin,
 *   enforced by authMiddleware + requireRole('admin') at the router level
 *   (ispec R7.1).
 *
 * GUARANTEE: NO_EMAIL_LEAK — GET / returns AdminStory shapes, which never
 *   include author email (ispec R7.2). The service resolves email only
 *   internally, to send a hide notification.
 *
 * EXPECTS: c.var.memoryStoryService is set by app.ts DI middleware.
 *
 * FAILURE BEHAVIOR: 404 { error: 'Not found' } for a malformed (non-numeric)
 *   :id, matching admin.routes.ts's existing id-validation convention. 422
 *   { error: 'Invalid moderation comment', code: 'INVALID_MODERATION_COMMENT',
 *   details } on schema validation failure (ispec R8.1). All other error
 *   codes are thrown by the service as AppError and rendered by the shared
 *   error middleware.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import { moderationVisibilitySchema } from '@smriti/shared';

/** Maps zod issues to a { field: message } record, first error per field. */
function collectFieldErrors(result: { error: import('zod').ZodError }): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    if (!errors[path]) errors[path] = issue.message;
  }
  return errors;
}

export const adminMemoryStoryRoutes = new Hono<AppEnv>();

adminMemoryStoryRoutes.use('*', authMiddleware, requireRole('admin'));

adminMemoryStoryRoutes.get('/', async (c) => {
  const response = await c.var.memoryStoryService.listForAdmin();
  return c.json(response);
});

adminMemoryStoryRoutes.put('/:id/visibility', async (c) => {
  const idParam = c.req.param('id');
  if (!/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const id = Number(idParam);

  const body = await c.req.json().catch(() => ({}));
  const parsed = moderationVisibilitySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: 'Invalid moderation comment', code: 'INVALID_MODERATION_COMMENT', details: collectFieldErrors(parsed) },
      422,
    );
  }

  // requireRole('admin') guarantees this shape.
  const adminAuth = c.var.auth as { role: 'admin'; userId: number; email: string };
  const response = await c.var.memoryStoryService.changeVisibility(id, parsed.data, adminAuth);
  return c.json(response);
});
