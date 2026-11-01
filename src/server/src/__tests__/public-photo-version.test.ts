import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { D1RegistrationRepository } from '../repositories/registration.repo.js';
import { publicRoutes } from '../routes/public.routes.js';

interface PublicRow {
  id: number;
  full_name: string;
  branch: string;
  city: string;
  country: string;
  email: string | null;
  has_photo: number;
  created_at: number;
  updated_at: number;
}

class ReadStatement {
  readonly sql: string;
  private readonly rows: PublicRow[];

  constructor(
    sql: string,
    rows: PublicRow[],
  ) {
    this.sql = sql;
    this.rows = rows;
  }

  bind(): this { return this; }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.rows as T[] }; }
  async first<T>(): Promise<T | null> { return null; }
}

function publicApp(rows: PublicRow[]) {
  const db = { prepare: (sql: string) => new ReadStatement(sql, rows) } as unknown as D1Database;
  const app = new Hono<AppEnv>().basePath('/api');
  app.route('/public', publicRoutes);
  return () => app.request('/api/public/whos-coming', undefined, {
    DB: db,
    STORAGE: {} as R2Bucket,
    JWT_SECRET: 'unused',
    ENVIRONMENT: 'development',
  });
}

const row = (id: number, updatedAt: number): PublicRow => ({
  id,
  full_name: `Person ${id}`,
  branch: 'CSE',
  city: 'Kochi',
  country: 'India',
  email: `person${id}@example.com`,
  has_photo: 1,
  created_at: 1_700_000_000_000 + id,
  updated_at: updatedAt,
});

describe('GET /api/public/whos-coming photosVersion', () => {
  it('returns the maximum updated_at globally without exposing it on individual people', async () => {
    const response = await publicApp([
      row(1, 1_750_000_000_001),
      row(2, 1_750_000_000_009),
      row(3, 1_750_000_000_004),
    ])();

    expect(response.status).toBe(200);
    const body = await response.json() as {
      photosVersion: number;
      count: number;
      people: Array<Record<string, unknown>>;
    };
    expect(body.photosVersion).toBe(1_750_000_000_009);
    expect(body.count).toBe(3);
    expect(body.people.every((person) => !('updatedAt' in person))).toBe(true);
  });

  it('returns photosVersion 0 for an empty result', async () => {
    const response = await publicApp([])();
    expect(await response.json()).toEqual({
      people: [],
      count: 0,
      thumbsBaseUrl: '/api/public/photos',
      photosVersion: 0,
    });
  });
});

class MutationStatement {
  args: unknown[] = [];
  readonly sql: string;

  constructor(sql: string) {
    this.sql = sql;
  }

  bind(...args: unknown[]): this {
    this.args = args;
    return this;
  }
}

class MonotonicD1 {
  readonly rows: PublicRow[];
  readonly updateSql: string[] = [];
  private readonly wallClockMs: number;

  constructor(rows: PublicRow[], wallClockMs: number) {
    this.rows = rows;
    this.wallClockMs = wallClockMs;
  }

  prepare(sql: string): MutationStatement | ReadStatement {
    if (sql.includes('SELECT id, full_name') && sql.includes('updated_at')) {
      return new ReadStatement(sql, this.rows);
    }
    return new MutationStatement(sql);
  }

  async batch(statements: MutationStatement[]): Promise<unknown[]> {
    for (const statement of statements) {
      if (!statement.sql.includes('UPDATE registrations SET')) continue;
      this.updateSql.push(statement.sql);
      if (!statement.sql.includes('COALESCE(MAX(updated_at), 0) + 1')) {
        throw new Error('registration update is not globally monotonic');
      }

      const id = Number(statement.args.at(-1));
      const target = this.rows.find((candidate) => candidate.id === id);
      if (!target) continue;
      const currentMax = Math.max(0, ...this.rows.map((candidate) => candidate.updated_at));
      target.updated_at = Math.max(this.wallClockMs, currentMax + 1);
    }
    return statements.map(() => ({ success: true }));
  }
}

describe('same-second registration updates', () => {
  it('produce strictly increasing public photosVersion values', async () => {
    const wallClockMs = 1_750_000_000_000;
    const db = new MonotonicD1([
      row(1, wallClockMs - 10),
      row(2, wallClockMs - 5),
    ], wallClockMs);
    const repo = new D1RegistrationRepository(db as unknown as D1Database);
    const app = new Hono<AppEnv>().basePath('/api');
    app.route('/public', publicRoutes);
    const request = () => app.request('/api/public/whos-coming', undefined, {
      DB: db as unknown as D1Database,
      STORAGE: {} as R2Bucket,
      JWT_SECRET: 'unused',
      ENVIRONMENT: 'development',
    });

    await repo.update(1, { photo_thumb_key: 'registrations/ONE/photo-thumb.jpg' });
    const first = await (await request()).json() as { photosVersion: number };

    await repo.update(2, { photo_thumb_key: 'registrations/TWO/photo-thumb.jpg' });
    const second = await (await request()).json() as { photosVersion: number };

    expect(first.photosVersion).toBe(wallClockMs);
    expect(second.photosVersion).toBe(wallClockMs + 1);
    expect(second.photosVersion).toBeGreaterThan(first.photosVersion);
    expect(db.updateSql).toHaveLength(2);
  });
});
