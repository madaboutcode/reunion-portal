/**
 * CONTRACT: Physical room-assignment persistence (room-assignment.spec.md).
 *
 * GUARANTEE: UPSERT_REPLACES — upsertAssignment's ON CONFLICT(registration_id,
 *   night_date) DO UPDATE means a second call for the same registration+night
 *   overwrites room_id/assigned_by/created_at on the SAME row (R2) — it never
 *   inserts a second row for that (registration, night) pair.
 *
 * GUARANTEE: NO_CAPACITY_CHECK — nothing in this repository counts or limits
 *   how many registrations share a (room_id, night_date) pair (R1.1/R2.1).
 *
 * GUARANTEE: NO_SQL_INJECTION — every query uses db.prepare().bind().
 *
 * EXPECTS: db is a live D1Database binding. Callers validate night_date
 *   against the configured event nights and room active-state BEFORE calling
 *   upsertAssignment — this repository performs no such validation itself
 *   (room-assignment.service.ts owns those checks).
 *
 * FAILURE BEHAVIOR: createRoom/updateRoom propagate the raw D1 UNIQUE
 *   constraint error on a duplicate room_number — the service layer maps it
 *   to a domain-level AppError. getRoomById/updateRoom return null when no
 *   row matches. D1 errors otherwise propagate as thrown exceptions.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { IRoomRepository } from './interfaces.js';
import {
  toRoom,
  toRoomAssignment,
  toRegistrationRoomAssignment,
  toRoomOccupant,
  type RoomRow,
  type RoomAssignmentRow,
  type RegistrationRoomAssignmentRow,
  type RoomOccupantRow,
  type Room,
  type RoomAssignment,
  type RegistrationRoomAssignment,
  type RoomOccupant,
} from '../domain/room-types.js';

const ROOM_COLUMNS = 'id, room_number, notes, is_active, created_at';

export class D1RoomRepository implements IRoomRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async createRoom(data: { roomNumber: string; notes: string | null }): Promise<Room> {
    const result = await this.db
      .prepare('INSERT INTO rooms (room_number, notes) VALUES (?, ?)')
      .bind(data.roomNumber, data.notes)
      .run();
    const id = result.meta.last_row_id as number;
    const room = await this.getRoomById(id);
    if (!room) throw new Error(`Room ${id} not found immediately after insert`);
    return room;
  }

  async listRooms(): Promise<Room[]> {
    const { results } = await this.db
      .prepare(`SELECT ${ROOM_COLUMNS} FROM rooms ORDER BY room_number ASC`)
      .all<RoomRow>();
    return (results ?? []).map(toRoom);
  }

  async getRoomById(id: number): Promise<Room | null> {
    const row = await this.db
      .prepare(`SELECT ${ROOM_COLUMNS} FROM rooms WHERE id = ?`)
      .bind(id)
      .first<RoomRow>();
    return row ? toRoom(row) : null;
  }

  async updateRoom(
    id: number,
    updates: { roomNumber?: string; notes?: string | null; isActive?: boolean },
  ): Promise<Room | null> {
    const sets: string[] = [];
    const binds: unknown[] = [];
    if (updates.roomNumber !== undefined) {
      sets.push('room_number = ?');
      binds.push(updates.roomNumber);
    }
    if (updates.notes !== undefined) {
      sets.push('notes = ?');
      binds.push(updates.notes);
    }
    if (updates.isActive !== undefined) {
      sets.push('is_active = ?');
      binds.push(updates.isActive ? 1 : 0);
    }

    if (sets.length === 0) {
      return this.getRoomById(id);
    }

    binds.push(id);
    await this.db
      .prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
    return this.getRoomById(id);
  }

  async upsertAssignment(data: {
    registrationId: number;
    roomId: number;
    nightDate: string;
    assignedBy: number;
  }): Promise<RoomAssignment> {
    await this.db
      .prepare(
        `INSERT INTO registration_room_assignments (registration_id, room_id, night_date, assigned_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(registration_id, night_date) DO UPDATE SET
           room_id = excluded.room_id,
           assigned_by = excluded.assigned_by,
           created_at = unixepoch() * 1000`,
      )
      .bind(data.registrationId, data.roomId, data.nightDate, data.assignedBy)
      .run();

    const row = await this.db
      .prepare(
        `SELECT id, registration_id, room_id, night_date, assigned_by, created_at
         FROM registration_room_assignments
         WHERE registration_id = ? AND night_date = ?`,
      )
      .bind(data.registrationId, data.nightDate)
      .first<RoomAssignmentRow>();
    if (!row) throw new Error(`Assignment for registration ${data.registrationId} / ${data.nightDate} not found immediately after upsert`);
    return toRoomAssignment(row);
  }

  async registrationExists(id: number): Promise<boolean> {
    const row = await this.db.prepare('SELECT 1 FROM registrations WHERE id = ?').bind(id).first();
    return row !== null;
  }

  async listAssignmentsByRegistration(registrationId: number): Promise<RegistrationRoomAssignment[]> {
    const { results } = await this.db
      .prepare(
        `SELECT a.id, a.registration_id, a.room_id, a.night_date, a.assigned_by, a.created_at,
                r.room_number, r.notes AS room_notes, r.is_active AS room_is_active
         FROM registration_room_assignments a
         JOIN rooms r ON r.id = a.room_id
         WHERE a.registration_id = ?
         ORDER BY a.night_date ASC`,
      )
      .bind(registrationId)
      .all<RegistrationRoomAssignmentRow>();
    return (results ?? []).map(toRegistrationRoomAssignment);
  }

  async listAssignmentsByRoom(roomId: number, nightDate?: string): Promise<RoomOccupant[]> {
    const baseQuery = `SELECT a.id, a.registration_id, a.room_id, a.night_date, a.assigned_by, a.created_at,
                r.reg_code, r.full_name
         FROM registration_room_assignments a
         JOIN registrations r ON r.id = a.registration_id
         WHERE a.room_id = ?`;

    const { results } = nightDate
      ? await this.db
          .prepare(`${baseQuery} AND a.night_date = ? ORDER BY r.full_name ASC`)
          .bind(roomId, nightDate)
          .all<RoomOccupantRow>()
      : await this.db
          .prepare(`${baseQuery} ORDER BY a.night_date ASC, r.full_name ASC`)
          .bind(roomId)
          .all<RoomOccupantRow>();

    return (results ?? []).map(toRoomOccupant);
  }
}
