/**
 * CONTRACT: Physical room-assignment application service (room-assignment.spec.md).
 *
 * GUARANTEE: NIGHT_BOUNDARY — assignRoom and listAssignmentsByRoom reject any
 *   night_date that is not in @smriti/shared's CHECKIN_OPTIONS with a 422
 *   AppError (R2.3). No default night is ever invented — an unrecognized or
 *   missing night_date always hard-fails.
 *
 * GUARANTEE: INACTIVE_ROOM_GUARD — assignRoom rejects assigning ANY
 *   registration+night to a room whose is_active is false with a 409
 *   AppError. This never blocks reads: an inactive room's EXISTING
 *   assignments remain visible via listAssignmentsByRegistration /
 *   listAssignmentsByRoom (Edge Cases: "Inactive rooms cannot receive new
 *   assignments but remain visible on existing historical assignments").
 *
 * GUARANTEE: AUDITED — createRoom, updateRoom, and assignRoom each append
 *   exactly one system_audit_log entry (R2.4) after their write succeeds.
 *   No audit entry is written if the write throws.
 *
 * GUARANTEE: NOT_FOUND_ON_MISSING_REFS — assignRoom/listAssignmentsByRegistration
 *   throw NotFoundError for an unknown registrationId; assignRoom/
 *   updateRoom/listAssignmentsByRoom throw NotFoundError for an unknown
 *   roomId. Never silently no-ops.
 *
 * EXPECTS: the caller has already authenticated as staff/admin and holds the
 *   allocation scope (route-level requireScope). actor.userId/actor.email
 *   come from the verified JWT.
 *
 * FAILURE BEHAVIOR:
 *   - NotFoundError (404) for missing registration/room references.
 *   - AppError 409 for a duplicate room_number and for an inactive-room
 *     assignment attempt.
 *   - AppError 422 for an unconfigured night_date.
 *   - D1 errors propagate.
 */

import { CHECKIN_OPTIONS } from '@smriti/shared';
import type { IRoomRepository, ISystemAuditRepository } from '../repositories/interfaces.js';
import { AppError, NotFoundError } from './errors.js';
import type {
  Room,
  RoomAssignment,
  RegistrationRoomAssignment,
  RoomOccupant,
} from '../domain/room-types.js';

const CONFIGURED_NIGHTS = new Set<string>(CHECKIN_OPTIONS);

function isDuplicateRoomNumber(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed: rooms.room_number');
}

export class RoomAssignmentService {
  private roomRepo: IRoomRepository;
  private systemAuditRepo: ISystemAuditRepository;

  constructor(deps: { roomRepo: IRoomRepository; systemAuditRepo: ISystemAuditRepository }) {
    this.roomRepo = deps.roomRepo;
    this.systemAuditRepo = deps.systemAuditRepo;
  }

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------

  async createRoom(input: { roomNumber: string; notes: string | null }, actor: { email: string }): Promise<Room> {
    let room: Room;
    try {
      room = await this.roomRepo.createRoom(input);
    } catch (error) {
      if (isDuplicateRoomNumber(error)) {
        throw new AppError('A room with this number already exists', 409);
      }
      throw error;
    }

    await this.systemAuditRepo.append({
      action: 'room_created',
      actor: actor.email,
      targetType: 'room',
      targetId: room.id,
      details: JSON.stringify({ roomNumber: room.roomNumber, notes: room.notes }),
    });

    return room;
  }

  async listRooms(): Promise<Room[]> {
    return this.roomRepo.listRooms();
  }

  async updateRoom(
    id: number,
    updates: { roomNumber?: string; notes?: string | null; isActive?: boolean },
    actor: { email: string },
  ): Promise<Room> {
    const existing = await this.roomRepo.getRoomById(id);
    if (!existing) throw new NotFoundError('Room not found');

    let updated: Room | null;
    try {
      updated = await this.roomRepo.updateRoom(id, updates);
    } catch (error) {
      if (isDuplicateRoomNumber(error)) {
        throw new AppError('A room with this number already exists', 409);
      }
      throw error;
    }
    if (!updated) throw new NotFoundError('Room not found');

    await this.systemAuditRepo.append({
      action: 'room_updated',
      actor: actor.email,
      targetType: 'room',
      targetId: id,
      details: JSON.stringify({ before: existing, updates }),
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Assignments
  // -------------------------------------------------------------------------

  async assignRoom(input: {
    registrationId: number;
    roomId: number;
    nightDate: string;
    assignedBy: { userId: number; email: string };
  }): Promise<RoomAssignment & { roomNumber: string }> {
    // R2.3 — reject unknown event nights at the boundary. No default is invented.
    if (!CONFIGURED_NIGHTS.has(input.nightDate)) {
      throw new AppError('night_date must be one of the configured event nights', 422);
    }

    const registrationExists = await this.roomRepo.registrationExists(input.registrationId);
    if (!registrationExists) throw new NotFoundError('Registration not found');

    const room = await this.roomRepo.getRoomById(input.roomId);
    if (!room) throw new NotFoundError('Room not found');
    if (!room.isActive) {
      throw new AppError('Room is inactive and cannot receive new assignments', 409);
    }

    const assignment = await this.roomRepo.upsertAssignment({
      registrationId: input.registrationId,
      roomId: input.roomId,
      nightDate: input.nightDate,
      assignedBy: input.assignedBy.userId,
    });

    await this.systemAuditRepo.append({
      action: 'room_assignment_created',
      actor: input.assignedBy.email,
      targetType: 'registration',
      targetId: input.registrationId,
      details: JSON.stringify({ roomId: room.id, roomNumber: room.roomNumber, nightDate: input.nightDate }),
    });

    return { ...assignment, roomNumber: room.roomNumber };
  }

  async listAssignmentsByRegistration(registrationId: number): Promise<RegistrationRoomAssignment[]> {
    const registrationExists = await this.roomRepo.registrationExists(registrationId);
    if (!registrationExists) throw new NotFoundError('Registration not found');
    return this.roomRepo.listAssignmentsByRegistration(registrationId);
  }

  async listAssignmentsByRoom(roomId: number, nightDate?: string): Promise<RoomOccupant[]> {
    const room = await this.roomRepo.getRoomById(roomId);
    if (!room) throw new NotFoundError('Room not found');
    if (nightDate !== undefined && !CONFIGURED_NIGHTS.has(nightDate)) {
      throw new AppError('night must be one of the configured event nights', 422);
    }
    return this.roomRepo.listAssignmentsByRoom(roomId, nightDate);
  }
}
