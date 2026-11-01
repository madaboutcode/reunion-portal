import type { D1Database } from '@cloudflare/workers-types';
import type { IInventoryRepository } from './interfaces.js';

interface InventoryRow {
  night_date: string;
  total_rooms: number;
  updated_at: number;
}

export class D1InventoryRepository implements IInventoryRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async get(): Promise<Record<string, number>> {
    const { results } = await this.db
      .prepare('SELECT night_date, total_rooms FROM room_inventory')
      .all<InventoryRow>();

    const inventory: Record<string, number> = {};
    for (const row of results) {
      inventory[row.night_date] = row.total_rooms;
    }
    return inventory;
  }

  async set(inventory: Record<string, number>): Promise<void> {
    const stmts = Object.entries(inventory).map(([nightDate, totalRooms]) =>
      this.db
        .prepare(
          `INSERT INTO room_inventory (night_date, total_rooms, updated_at)
           VALUES (?, ?, unixepoch() * 1000)
           ON CONFLICT(night_date) DO UPDATE SET
             total_rooms = excluded.total_rooms,
             updated_at = excluded.updated_at`,
        )
        .bind(nightDate, totalRooms),
    );

    await this.db.batch(stmts);
  }
}
