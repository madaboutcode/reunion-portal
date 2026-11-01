/**
 * SqliteD1 — a real SQLite-backed D1Database adapter for tests, built on
 * node:sqlite (DatabaseSync). This is the "controlled real thing" (test
 * double ladder rung 2): it genuinely enforces foreign keys, unique
 * indexes, CHECK constraints, ON DELETE actions, and db.batch() transaction
 * atomicity — none of which a structural fake can exercise.
 *
 * The adapter implements only the D1 surface the codebase uses:
 *   - prepare(sql).bind(...).run() | .first<T>() | .all<T>()
 *   - batch(statements) — runs every statement inside one transaction
 *     (BEGIN … COMMIT / ROLLBACK on error), matching D1 semantics where
 *     statements see each other's writes.
 *
 * D1 `meta.last_row_id` / `meta.changes` map onto node:sqlite's
 * `lastInsertRowid` / `changes`.
 *
 * Foreign keys are enforced (PRAGMA foreign_keys = ON). Load schema.sql via
 * SqliteD1.loadSchema() before exercising services.
 */

import { DatabaseSync } from "node:sqlite";

interface D1LikeResult {
  results: unknown[];
  meta: { changes: number; last_row_id: number };
}

class SqliteStatement {
  private readonly db: DatabaseSync;
  private readonly sql: string;
  private readonly args: unknown[];

  constructor(db: DatabaseSync, sql: string, args: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(this.db, this.sql, values);
  }

  run(): D1LikeResult {
    const stmt = this.db.prepare(this.sql);
    // node:sqlite accepts number|string|bigint|Uint8Array|null — D1 bindings
    // in this codebase are always numbers/strings/null, so the cast is safe.
    const info = stmt.run(...this.args as Parameters<typeof stmt.run>);
    return {
      results: [],
      meta: {
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid ?? 0),
      },
    };
  }

  first<T = Record<string, unknown>>(): T | null {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.args as Parameters<typeof stmt.get>) as T | undefined;
    return row ?? null;
  }

  all<T = Record<string, unknown>>(): { results: T[] } {
    const stmt = this.db.prepare(this.sql);
    const rows = stmt.all(...this.args as Parameters<typeof stmt.all>) as T[];
    return { results: rows };
  }

  getSql(): string {
    return this.sql;
  }

  getArgs(): unknown[] {
    return this.args;
  }
}

export class SqliteD1 {
  readonly raw: DatabaseSync;

  constructor() {
    this.raw = new DatabaseSync(":memory:");
    this.raw.exec("PRAGMA foreign_keys = ON");
  }

  /** Applies the canonical schema (schema.sql) to this in-memory database. */
  loadSchema(schemaSql: string): void {
    this.raw.exec(schemaSql);
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.raw, sql);
  }

  async batch(statements: SqliteStatement[]): Promise<Array<{ meta: { changes: number; last_row_id: number } }>> {
    this.raw.exec("BEGIN");
    const results: Array<{ meta: { changes: number; last_row_id: number } }> = [];
    try {
      for (const stmt of statements) {
        const result = stmt.run();
        results.push(result);
      }
      this.raw.exec("COMMIT");
      return results;
    } catch (err) {
      this.raw.exec("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    this.raw.close();
  }
}
