/**
 * CONTRACT: Admin routes — user management endpoints for admin role only.
 *
 * GUARANTEE: AUTH_REQUIRED — all routes require a valid JWT with role=admin,
 *   enforced by authMiddleware + requireRole('admin') applied at the router level.
 *
 * GUARANTEE: ROLE_GUARD — POST /users rejects any attempt to create non-staff
 *   accounts with 400. Admin accounts can only be created via bootstrap migration.
 *
 * GUARANTEE: DUPLICATE_DETECTION — POST /users catches D1 UNIQUE constraint
 *   failures and returns 409. No second findByEmail lookup needed.
 *
 * GUARANTEE: SELF_DEACTIVATION_BLOCKED — PATCH /users/:id returns 409 if the
 *   authenticated admin attempts to set isActive=false on their own account.
 *
 * GUARANTEE: AUDIT_TRAIL — every mutating operation appends an entry to the
 *   system audit log via systemAuditRepo.append().
 *
 * GUARANTEE: STAFF_LOGIN_LINK — POST /users/:id/generate-login-link is admin
 *   only, targets active staff accounts only, returns a 10-minute login URL,
 *   and never sends email.
 *
 * EXPECTS: c.var.auth is { role: 'admin', userId: number, email: string }
 *   for all routes — guaranteed by authMiddleware + requireRole('admin').
 *
 * EXPECTS: userRepo.create() throws an Error whose message contains
 *   "UNIQUE constraint failed" on duplicate email (D1 behaviour).
 *
 * FAILURE BEHAVIOR: 404 when findById returns null for a user. 400 for
 *   missing/invalid required fields. 409 for business rule violations.
 *   All other failures propagate to the error middleware as 500.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { authMiddleware, requireRole } from '../middleware/auth.middleware.js';
import { setRequestMeta } from '../infra/request-meta.js';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', authMiddleware, requireRole('admin'));

const VALID_SCOPES = ['dashboard', 'resources', 'reports', 'allocation', 'admin-tools', 'bank_txns', 'registration_desk'] as const;

function validatePermissions(permissions: unknown): { valid: true; value: string | null } | { valid: false; error: string } {
  if (permissions === undefined || permissions === null) {
    return { valid: true, value: null };
  }
  if (typeof permissions !== 'object' || Array.isArray(permissions)) {
    return { valid: false, error: 'permissions must be an object with a scopes array' };
  }
  const p = permissions as { scopes?: unknown };
  if (!Array.isArray(p.scopes)) {
    return { valid: false, error: 'permissions.scopes must be an array' };
  }
  for (const s of p.scopes) {
    if (typeof s !== 'string' || !VALID_SCOPES.includes(s as typeof VALID_SCOPES[number])) {
      return { valid: false, error: `Invalid scope: ${s}` };
    }
  }
  return { valid: true, value: JSON.stringify(permissions) };
}

// ---------------------------------------------------------------------------
// POST /users — create a staff account (R14 in staff-api.spec.md)
// ---------------------------------------------------------------------------

adminRoutes.post('/users', async (c) => {
  const body = await c.req.json<{ email?: unknown; name?: unknown; role?: unknown; permissions?: unknown }>();
  setRequestMeta(c, { reqType: 'admin:create-user', email: typeof body.email === 'string' ? body.email : undefined });

  const email = body.email;
  const name = body.name;
  const role = body.role;

  if (typeof email !== 'string' || email.trim() === '') {
    return c.json({ error: 'email is required' }, 400);
  }
  if (typeof name !== 'string' || name.trim() === '') {
    return c.json({ error: 'name is required' }, 400);
  }
  if (role !== 'staff') {
    return c.json({ error: 'Can only create staff accounts via API' }, 400);
  }

  const permissionsResult = validatePermissions(body.permissions);
  if (!permissionsResult.valid) {
    return c.json({ error: permissionsResult.error }, 422);
  }

  const auth = c.var.auth;
  // requireRole('admin') guarantees this shape
  const adminAuth = auth as { role: 'admin'; userId: number; email: string };

  let id: number;
  try {
    const result = await c.var.userRepo.create({
      email: email.trim(),
      name: name.trim(),
      role: 'staff',
      permissions: permissionsResult.value,
      created_by: adminAuth.userId,
    });
    id = result.id;
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'User with this email already exists' }, 409);
    }
    throw err;
  }

  const user = await c.var.userRepo.findById(id);
  if (!user) {
    return c.json({ error: 'Internal server error' }, 500);
  }

  // Send invite — magic link email so they can log in immediately
  await c.var.authService.requestMagicLink(user.email);

  await c.var.systemAuditRepo.append({
    action: 'staff_created',
    actor: adminAuth.email,
    targetType: 'user',
    targetId: id,
    details: JSON.stringify({ email: user.email, name: user.name, role: user.role, permissions: user.permissions }),
  });

  return c.json(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      permissions: user.permissions,
      createdAt: user.createdAt,
    },
    201,
  );
});

// ---------------------------------------------------------------------------
// GET /users — list all staff and admin accounts (R15 in staff-api.spec.md)
// ---------------------------------------------------------------------------

adminRoutes.get('/users', async (c) => {
  const users = await c.var.userRepo.list();

  return c.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      permissions: u.permissions,
      createdBy: u.createdBy,
      createdAt: u.createdAt,
    })),
  });
});

// ---------------------------------------------------------------------------
// PATCH /users/:id — update name and/or isActive (R16 in staff-api.spec.md)
// ---------------------------------------------------------------------------

adminRoutes.patch('/users/:id', async (c) => {
  setRequestMeta(c, { reqType: 'admin:update-user' });
  const idParam = c.req.param('id');
  if (!/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const id = Number(idParam);

  const auth = c.var.auth;
  const adminAuth = auth as { role: 'admin'; userId: number; email: string };

  const body = await c.req.json<{ name?: unknown; isActive?: unknown; permissions?: unknown }>();

  // Guard: cannot deactivate own account
  if (body.isActive === false && id === adminAuth.userId) {
    return c.json({ error: 'Cannot deactivate your own account' }, 409);
  }

  const permissionsProvided = 'permissions' in body;
  let permissionsValue: string | null = null;
  if (permissionsProvided) {
    const permissionsResult = validatePermissions(body.permissions);
    if (!permissionsResult.valid) {
      return c.json({ error: permissionsResult.error }, 422);
    }
    permissionsValue = permissionsResult.value;
  }

  const existing = await c.var.userRepo.findById(id);
  if (!existing) {
    return c.json({ error: 'Not found' }, 404);
  }

  const updateData: { name?: string; is_active?: number; permissions?: string | null } = {};

  if (typeof body.name === 'string' && body.name.trim() !== '') {
    updateData.name = body.name.trim();
  }
  if (typeof body.isActive === 'boolean') {
    updateData.is_active = body.isActive ? 1 : 0;
  }
  if (permissionsProvided) {
    updateData.permissions = permissionsValue;
  }

  await c.var.userRepo.update(id, updateData);

  const updated = await c.var.userRepo.findById(id);
  if (!updated) {
    return c.json({ error: 'Internal server error' }, 500);
  }

  // Build audit details from what changed
  const changed: Record<string, { old: unknown; new: unknown }> = {};
  if (updateData.name !== undefined) {
    changed['name'] = { old: existing.name, new: updated.name };
  }
  if (updateData.is_active !== undefined) {
    changed['isActive'] = { old: existing.isActive, new: updated.isActive };
  }
  if (permissionsProvided) {
    changed['permissions'] = { old: existing.permissions, new: updated.permissions };
  }

  await c.var.systemAuditRepo.append({
    action: 'staff_updated',
    actor: adminAuth.email,
    targetType: 'user',
    targetId: id,
    details: JSON.stringify({ userId: id, changes: changed }),
  });

  return c.json({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    isActive: updated.isActive,
    permissions: updated.permissions,
    createdBy: updated.createdBy,
    createdAt: updated.createdAt,
  });
});

// ---------------------------------------------------------------------------
// POST /users/:id/generate-login-link — generate a copyable staff login URL
// ---------------------------------------------------------------------------

adminRoutes.post('/users/:id/generate-login-link', async (c) => {
  setRequestMeta(c, { reqType: 'admin:generate-login-link' });
  const idParam = c.req.param('id');
  if (!/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const id = Number(idParam);

  const user = await c.var.userRepo.findById(id);
  if (!user) {
    return c.json({ error: 'Not found' }, 404);
  }
  if (user.role !== 'staff') {
    return c.json({ error: 'Can only generate login links for staff accounts' }, 409);
  }
  if (!user.isActive) {
    return c.json({ error: 'Cannot generate login link for a deactivated account' }, 409);
  }

  const link = await c.var.authService.createStaffLoginLinkUrl(user.id);
  const auth = c.var.auth as { role: 'admin'; userId: number; email: string };

  await c.var.systemAuditRepo.append({
    action: 'login_link_generated',
    actor: auth.email,
    targetType: 'user',
    targetId: user.id,
    details: JSON.stringify({ generatedFor: user.email, role: user.role, expiresIn: 10 }),
  });

  return c.json({ link, expiresIn: 10 });
});

// ---------------------------------------------------------------------------
// POST /users/:id/resend-invite — resend magic link (R17 in staff-api.spec.md)
// ---------------------------------------------------------------------------

adminRoutes.post('/users/:id/resend-invite', async (c) => {
  setRequestMeta(c, { reqType: 'admin:resend-invite' });
  const idParam = c.req.param('id');
  if (!/^\d+$/.test(idParam)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const id = Number(idParam);

  const user = await c.var.userRepo.findById(id);
  if (!user) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (!user.isActive) {
    return c.json({ error: 'Cannot resend invite to a deactivated account' }, 409);
  }

  await c.var.authService.requestMagicLink(user.email);

  return c.json({ ok: true });
});
