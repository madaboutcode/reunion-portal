/**
 * CONTRACT: Physical room-assignment API (room-assignment.spec.md).
 * Mounted at /api/staff/allocation alongside allocation.routes.ts — same
 * scope, disjoint paths (/rooms*, /registrations/:id/room-assignments).
 *
 * GUARANTEES:
 *   - AUTH_GUARD — every route requires a valid JWT with role 'staff' or
 *     'admin' and the 'allocation' scope, identical to allocation.routes.ts.
 *
 *   - CREATE_ROOM — POST /rooms (R1) creates a room with a unique room
 *     number, optional notes, defaulting active. 422 on a missing/empty
 *     roomNumber. 409 on a duplicate roomNumber. Audits 'room_created'.
 *
 *   - LIST_ROOMS — GET /rooms (R1) returns every room (active and inactive)
 *     with number, notes, and active state, ordered by room number.
 *
 *   - UPDATE_ROOM — PUT /rooms/:id updates roomNumber/notes/isActive
 *     (partial — only provided keys change). 404 unknown id. 422 empty body
 *     or empty roomNumber. 409 duplicate roomNumber. Audits 'room_updated'.
 *
 *   - ASSIGN_ROOM — PUT /registrations/:id/room-assignments/:night (R2)
 *     assigns registration :id to the given roomId for night :night,
 *     REPLACING any existing assignment for that (registration, night) pair
 *     (R2) — never creating a second row. 404 unknown registration or room.
 *     422 unrecognized :night (R2.3) or missing/malformed roomId. 409 if the
 *     target room is inactive (Edge Cases). Audits 'room_assignment_created'
 *     with the actor (R2.4).
 *
 *   - LIST_BY_REGISTRATION — GET /registrations/:id/room-assignments (R2.2)
 *     returns every night-assignment for a registration, joined with room
 *     number/notes/active-state. 404 unknown registration.
 *
 *   - LIST_BY_ROOM — GET /rooms/:id/assignments[?night=] (R1.1/R2.1) returns
 *     every occupant of a room, optionally filtered to one night, joined
 *     with registration regCode/fullName. 404 unknown room. 422 an
 *     unrecognized ?night value.
 *
 * EXPECTS:
 *   - c.var.roomAssignmentService is set by the DI middleware in app.ts.
 *   - Auth context: c.var.auth.role === 'staff' | 'admin', c.var.auth.userId,
 *     c.var.auth.email.
 *
 * FAILURE BEHAVIOR:
 *   - AppError/NotFoundError thrown by RoomAssignmentService propagate
 *     verbatim (status + message) through the global error handler — this
 *     file re-implements none of the service's guards.
 *   - D1 errors propagate through the global error handler as 500.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { authMiddleware, requireRole, requireScope } from '../middleware/auth.middleware.js';
import { setRequestMeta } from '../infra/request-meta.js';

export const roomAssignmentRoutes = new Hono<AppEnv>();

roomAssignmentRoutes.use('*', authMiddleware, requireRole('staff', 'admin'), requireScope('allocation'));

function parseNumericId(idParam: string | undefined): number | null {
  if (!idParam || !/^\d+$/.test(idParam)) return null;
  return Number(idParam);
}

function roomResponse(room: { id: number; roomNumber: string; notes: string | null; isActive: boolean; createdAt: number }) {
  return {
    id: room.id,
    roomNumber: room.roomNumber,
    notes: room.notes,
    isActive: room.isActive,
    createdAt: room.createdAt,
  };
}

// ---------------------------------------------------------------------------
// POST /rooms (spec room-assignment.spec.md R1)
// ---------------------------------------------------------------------------

roomAssignmentRoutes.post('/rooms', async (c) => {
  setRequestMeta(c, { reqType: 'room-assignment:create-room' });

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'roomNumber is required' }, 422);
  }

  const roomNumber = body['roomNumber'];
  if (typeof roomNumber !== 'string' || roomNumber.trim() === '') {
    return c.json({ error: 'roomNumber is required' }, 422);
  }
  const notesRaw = body['notes'];
  if (notesRaw !== undefined && notesRaw !== null && typeof notesRaw !== 'string') {
    return c.json({ error: 'notes must be a string or null' }, 422);
  }
  const notes = (notesRaw as string | null | undefined) ?? null;

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  const room = await c.var.roomAssignmentService.createRoom({ roomNumber: roomNumber.trim(), notes }, { email: staffEmail });
  return c.json(roomResponse(room), 201);
});

// ---------------------------------------------------------------------------
// GET /rooms (spec room-assignment.spec.md R1)
// ---------------------------------------------------------------------------

roomAssignmentRoutes.get('/rooms', async (c) => {
  const rooms = await c.var.roomAssignmentService.listRooms();
  return c.json({ rooms: rooms.map(roomResponse), total: rooms.length });
});

// ---------------------------------------------------------------------------
// PUT /rooms/:id
// ---------------------------------------------------------------------------

roomAssignmentRoutes.put('/rooms/:id', async (c) => {
  setRequestMeta(c, { reqType: 'room-assignment:update-room' });

  const id = parseNumericId(c.req.param('id'));
  if (id === null) {
    return c.json({ error: 'Not found' }, 404);
  }

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const updates: { roomNumber?: string; notes?: string | null; isActive?: boolean } = {};

  if ('roomNumber' in body) {
    const roomNumber = body['roomNumber'];
    if (typeof roomNumber !== 'string' || roomNumber.trim() === '') {
      return c.json({ error: 'roomNumber must be a non-empty string' }, 422);
    }
    updates.roomNumber = roomNumber.trim();
  }
  if ('notes' in body) {
    const notes = body['notes'];
    if (notes !== null && typeof notes !== 'string') {
      return c.json({ error: 'notes must be a string or null' }, 422);
    }
    updates.notes = notes;
  }
  if ('isActive' in body) {
    const isActive = body['isActive'];
    if (typeof isActive !== 'boolean') {
      return c.json({ error: 'isActive must be a boolean' }, 422);
    }
    updates.isActive = isActive;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'At least one of roomNumber, notes, isActive is required' }, 422);
  }

  const auth = c.var.auth;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  const room = await c.var.roomAssignmentService.updateRoom(id, updates, { email: staffEmail });
  return c.json(roomResponse(room));
});

// ---------------------------------------------------------------------------
// PUT /registrations/:id/room-assignments/:night (spec room-assignment.spec.md R2)
// ---------------------------------------------------------------------------

roomAssignmentRoutes.put('/registrations/:id/room-assignments/:night', async (c) => {
  setRequestMeta(c, { reqType: 'room-assignment:assign' });

  const registrationId = parseNumericId(c.req.param('id'));
  if (registrationId === null) {
    return c.json({ error: 'Not found' }, 404);
  }
  const nightDate = c.req.param('night');

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'roomId is required' }, 422);
  }

  const roomId = body['roomId'];
  if (typeof roomId !== 'number' || !Number.isInteger(roomId)) {
    return c.json({ error: 'roomId is required' }, 422);
  }

  // requireRole('staff', 'admin') above guarantees auth.role !== 'attendee'
  // here; this narrows the AuthContext union the same way allocation.routes.ts does.
  const auth = c.var.auth;
  const staffUserId = auth.role !== 'attendee' ? auth.userId : 0;
  const staffEmail = auth.role !== 'attendee' ? auth.email : '';

  const assignment = await c.var.roomAssignmentService.assignRoom({
    registrationId,
    roomId,
    nightDate,
    assignedBy: { userId: staffUserId, email: staffEmail },
  });

  return c.json({
    registrationId: assignment.registrationId,
    nightDate: assignment.nightDate,
    roomId: assignment.roomId,
    roomNumber: assignment.roomNumber,
    assignedBy: assignment.assignedBy,
    assignedAt: assignment.createdAt,
  });
});

// ---------------------------------------------------------------------------
// GET /registrations/:id/room-assignments (spec room-assignment.spec.md R2.2)
// ---------------------------------------------------------------------------

roomAssignmentRoutes.get('/registrations/:id/room-assignments', async (c) => {
  const registrationId = parseNumericId(c.req.param('id'));
  if (registrationId === null) {
    return c.json({ error: 'Not found' }, 404);
  }

  const assignments = await c.var.roomAssignmentService.listAssignmentsByRegistration(registrationId);
  return c.json({
    assignments: assignments.map((a) => ({
      nightDate: a.nightDate,
      roomId: a.roomId,
      roomNumber: a.roomNumber,
      roomIsActive: a.roomIsActive,
      assignedBy: a.assignedBy,
      assignedAt: a.createdAt,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /rooms/:id/assignments (spec room-assignment.spec.md R1.1/R2.1)
// ---------------------------------------------------------------------------

roomAssignmentRoutes.get('/rooms/:id/assignments', async (c) => {
  const roomId = parseNumericId(c.req.param('id'));
  if (roomId === null) {
    return c.json({ error: 'Not found' }, 404);
  }
  const night = c.req.query('night');

  const occupants = await c.var.roomAssignmentService.listAssignmentsByRoom(roomId, night);
  return c.json({
    assignments: occupants.map((o) => ({
      registrationId: o.registrationId,
      regCode: o.regCode,
      fullName: o.fullName,
      nightDate: o.nightDate,
      assignedBy: o.assignedBy,
      assignedAt: o.createdAt,
    })),
  });
});
