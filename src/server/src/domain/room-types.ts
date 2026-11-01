/**
 * CONTRACT: Physical room-assignment domain types (room-assignment.spec.md).
 *
 * GUARANTEE: ROW_BOUNDARY — *Row interfaces mirror the D1 column shapes
 *   exactly (is_active as 0|1). Converters (toRoom, toRoomAssignment, ...)
 *   are the only place that boundary is crossed into domain types (isActive
 *   as boolean), matching the src/server/CLAUDE.md D1-boolean convention.
 *
 * EXPECTS: night_date values are one of @smriti/shared's CHECKIN_OPTIONS —
 *   enforced by the service layer (room-assignment.service.ts), never by
 *   these types.
 */

export interface RoomRow {
  id: number;
  room_number: string;
  notes: string | null;
  is_active: 0 | 1;
  created_at: number;
}

export interface Room {
  id: number;
  roomNumber: string;
  notes: string | null;
  isActive: boolean;
  createdAt: number;
}

export function toRoom(row: RoomRow): Room {
  return {
    id: row.id,
    roomNumber: row.room_number,
    notes: row.notes,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

export interface RoomAssignmentRow {
  id: number;
  registration_id: number;
  room_id: number;
  night_date: string;
  assigned_by: number;
  created_at: number;
}

export interface RoomAssignment {
  id: number;
  registrationId: number;
  roomId: number;
  nightDate: string;
  assignedBy: number;
  createdAt: number;
}

export function toRoomAssignment(row: RoomAssignmentRow): RoomAssignment {
  return {
    id: row.id,
    registrationId: row.registration_id,
    roomId: row.room_id,
    nightDate: row.night_date,
    assignedBy: row.assigned_by,
    createdAt: row.created_at,
  };
}

/** Assignment joined with its room's display fields — for the "my registration's nights" view. */
export interface RegistrationRoomAssignmentRow extends RoomAssignmentRow {
  room_number: string;
  room_notes: string | null;
  room_is_active: 0 | 1;
}

export interface RegistrationRoomAssignment extends RoomAssignment {
  roomNumber: string;
  roomNotes: string | null;
  roomIsActive: boolean;
}

export function toRegistrationRoomAssignment(row: RegistrationRoomAssignmentRow): RegistrationRoomAssignment {
  return {
    ...toRoomAssignment(row),
    roomNumber: row.room_number,
    roomNotes: row.room_notes,
    roomIsActive: row.room_is_active === 1,
  };
}

/** Assignment joined with its registration's identifying fields — for the "who's in this room" view. */
export interface RoomOccupantRow extends RoomAssignmentRow {
  reg_code: string;
  full_name: string;
}

export interface RoomOccupant extends RoomAssignment {
  regCode: string;
  fullName: string;
}

export function toRoomOccupant(row: RoomOccupantRow): RoomOccupant {
  return {
    ...toRoomAssignment(row),
    regCode: row.reg_code,
    fullName: row.full_name,
  };
}
