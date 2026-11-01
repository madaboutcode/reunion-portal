/**
 * CONTRACT
 *
 * GUARANTEE: CREATE_RETURNS_ID — create() inserts a row into id_documents and
 *   returns { id: number } derived from meta.last_row_id. The inserted row is
 *   never re-fetched.
 *
 * GUARANTEE: FIND_RETURNS_ARRAY — findByRegistration() returns an array of
 *   IdDocument objects (empty if none exist). It does not throw on no results.
 *
 * GUARANTEE: ROW_MAPPED — findByRegistration() maps each raw D1 row through
 *   toIdDocument() before returning, producing camelCase IdDocument objects.
 *
 * GUARANTEE: UPDATE_R2_KEY — updateR2Key() updates the r2_key for the given
 *   document id. Used after file relocation to keep DB in sync with R2.
 *
 * GUARANTEE: PARAMETERIZED_SQL — all SQL uses prepared statements with .bind().
 *   No string interpolation is used in SQL queries.
 *
 * EXPECTS: The id_documents table exists with the schema defined in db/schema.sql.
 *
 * FAILURE BEHAVIOR: D1 errors propagate as thrown errors. This class does not
 *   swallow failures — the caller decides how to handle them.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { IDocumentRepository } from './interfaces.js';
import type { IdDocument, IdDocumentRow, NewIdDocument } from '../domain/types.js';
import { toIdDocument } from '../domain/types.js';

export class D1DocumentRepository implements IDocumentRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async create(doc: NewIdDocument): Promise<{ id: number }> {
    const result = await this.db
      .prepare(
        `INSERT INTO id_documents (registration_id, file_name, mime_type, size_bytes, r2_key)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(doc.registration_id, doc.file_name, doc.mime_type, doc.size_bytes, doc.r2_key)
      .run();

    return { id: result.meta.last_row_id as number };
  }

  async findByRegistration(registrationId: number): Promise<IdDocument[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, registration_id, file_name, mime_type, size_bytes, r2_key, created_at
         FROM id_documents
         WHERE registration_id = ?
         ORDER BY created_at ASC`
      )
      .bind(registrationId)
      .all<IdDocumentRow>();

    return results.map(toIdDocument);
  }

  async updateR2Key(docId: number, newKey: string): Promise<void> {
    await this.db
      .prepare(`UPDATE id_documents SET r2_key = ? WHERE id = ?`)
      .bind(newKey, docId)
      .run();
  }
}
