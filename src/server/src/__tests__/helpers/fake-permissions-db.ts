/**
 * Minimal D1 fake satisfying only the one query requireScope's resolveScopes()
 * issues: `SELECT permissions FROM users WHERE id = ?`.
 *
 * Route-level tests that exercise staff/admin endpoints go through
 * authMiddleware -> requireScope, which reads c.env.DB directly (not through
 * a repo fake). Tests whose business logic runs entirely through in-memory
 * repo fakes still need *this* one query answered so requireScope doesn't
 * throw on `c.env.DB.prepare(...)`.
 *
 * Defaults every userId to permissions: null (full access — the staff/admin
 * default). Pass overrides to simulate a scoped user.
 */
export function createFakePermissionsDb(overrides: Record<number, string | null> = {}) {
  const table = new Map<number, string | null>(
    Object.entries(overrides).map(([id, permissions]) => [Number(id), permissions]),
  );

  return {
    prepare(sql: string) {
      const exec = (args: unknown[]) => ({
        async first<T>(): Promise<T | null> {
          if (sql.includes('SELECT permissions FROM users')) {
            const id = args[0] as number;
            return { permissions: table.get(id) ?? null } as T;
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: [] };
        },
        async run(): Promise<{ meta: { last_row_id: number; changes: number } }> {
          return { meta: { last_row_id: 0, changes: 0 } };
        },
      });
      return {
        bind: (...args: unknown[]) => exec(args),
        ...exec([]),
      };
    },
  };
}
