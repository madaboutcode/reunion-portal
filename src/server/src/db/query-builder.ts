/**
 * Fluent query builder for D1 SQLite.
 *
 * Builds parameterized SQL + bindings for D1's prepare(sql).bind(...bindings) pattern.
 * No JOIN support — write JOIN SQL directly in repos that need it.
 * All user values are bound via ?, never interpolated.
 */

export interface QueryResult {
  sql: string;
  bindings: unknown[];
}

type Direction = 'ASC' | 'DESC';
type CompareOp = '=' | '!=' | 'IN';

interface WhereClause {
  sql: string;
  bindings: unknown[];
}

export class QueryBuilder {
  private readonly table: string;
  private readonly clauses: WhereClause[] = [];
  private orderByClause: string | null = null;
  private limitClause: string | null = null;
  private limitBindings: unknown[] = [];

  constructor(table: string) {
    this.table = table;
  }

  where(column: string, op: CompareOp, value: unknown | unknown[]): this {
    if (op === 'IN') {
      const arr = value as unknown[];
      const placeholders = arr.map(() => '?').join(', ');
      this.clauses.push({ sql: `${column} IN (${placeholders})`, bindings: arr });
    } else {
      this.clauses.push({ sql: `${column} ${op} ?`, bindings: [value] });
    }
    return this;
  }

  whereLike(columns: string[], search: string): this {
    if (columns.length === 0) return this;
    const escaped = search.replace(/[%_\\]/g, '\\$&');
    const term = `%${escaped.toLowerCase()}%`;
    const parts = columns.map((col) => `LOWER(${col}) LIKE ? ESCAPE '\\'`);
    this.clauses.push({
      sql: `(${parts.join(' OR ')})`,
      bindings: columns.map(() => term),
    });
    return this;
  }

  whereRaw(sql: string, bindings: unknown[]): this {
    this.clauses.push({ sql, bindings });
    return this;
  }

  orderBy(column: string, direction: Direction): this {
    this.orderByClause = `ORDER BY ${column} ${direction}`;
    return this;
  }

  limit(limit: number, offset: number): this {
    this.limitClause = 'LIMIT ? OFFSET ?';
    this.limitBindings = [limit, offset];
    return this;
  }

  private buildWhere(): { fragment: string; bindings: unknown[] } {
    if (this.clauses.length === 0) return { fragment: '', bindings: [] };
    const fragment = ' WHERE ' + this.clauses.map((c) => c.sql).join(' AND ');
    const bindings = this.clauses.flatMap((c) => c.bindings);
    return { fragment, bindings };
  }

  toSelect(columns = '*'): QueryResult {
    const { fragment, bindings } = this.buildWhere();
    const parts = [`SELECT ${columns} FROM ${this.table}${fragment}`];
    if (this.orderByClause) parts.push(this.orderByClause);
    if (this.limitClause) parts.push(this.limitClause);
    return { sql: parts.join(' '), bindings: [...bindings, ...this.limitBindings] };
  }

  toCount(): QueryResult {
    const { fragment, bindings } = this.buildWhere();
    return {
      sql: `SELECT COUNT(*) as count FROM ${this.table}${fragment}`,
      bindings,
    };
  }
}

export function query(table: string): QueryBuilder {
  return new QueryBuilder(table);
}
