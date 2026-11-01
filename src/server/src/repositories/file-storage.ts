/**
 * CONTRACT
 *
 * GUARANTEE: R2_UPLOAD — upload() calls bucket.put() with the provided key and
 *   data, setting httpMetadata.contentType to metadata.mimeType. The call
 *   awaits completion before returning.
 *
 * GUARANTEE: SIGNED_URL_STUB — getSignedUrl() throws an Error with the message
 *   "Signed URLs not implemented in V1. Use admin API when available." It never
 *   returns a URL. This is intentional per decisions.md — the spike did not
 *   test getSignedUrl() and admin access is post-V1 scope.
 *
 * GUARANTEE: GET_RETURNS_NULL — get() returns null when the R2 object does not
 *   exist. When it does exist, it returns { body, contentType, size } where
 *   contentType falls back to 'application/octet-stream' if not set on the
 *   object's httpMetadata.
 *
 * GUARANTEE: DELETE_DELEGATES — delete() delegates directly to bucket.delete()
 *   with the provided key. No additional logic.
 *
 * GUARANTEE: COPY — copy() copies the object from fromKey to toKey (preserving
 *   httpMetadata). Returns true on success, false if fromKey does not exist.
 *
 * GUARANTEE: MOVE — move() copies via copy(), then deletes fromKey only if
 *   the copy succeeded. If fromKey does not exist, move() is a no-op (does
 *   not throw). If put() fails, fromKey is NOT deleted (original preserved).
 *
 * EXPECTS: The R2Bucket binding is available and correctly configured in
 *   wrangler.toml (added in Brick 001).
 *
 * FAILURE BEHAVIOR: R2 errors from put(), get(), and delete() propagate as
 *   thrown errors. This adapter does not catch or swallow R2 failures — the
 *   service layer decides how to handle them (retry, fail-fast, etc.).
 */

import type { R2Bucket } from '@cloudflare/workers-types';
import type { IFileStorage } from './interfaces.js';
import type { FileMetadata } from '../domain/types.js';

export class R2FileStorage implements IFileStorage {
  private readonly bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async upload(key: string, data: ArrayBuffer, metadata: FileMetadata): Promise<void> {
    await this.bucket.put(key, data, {
      httpMetadata: { contentType: metadata.mimeType },
    });
  }

  async getSignedUrl(_key: string, _expiresIn: number): Promise<string> {
    throw new Error('Signed URLs not implemented in V1. Use admin API when available.');
  }

  async get(key: string): Promise<{ body: ReadableStream; contentType: string; size: number } | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- workers-types ReadableStream vs global ReadableStream mismatch
      body: object.body as any,
      contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      size: object.size,
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async copy(fromKey: string, toKey: string): Promise<boolean> {
    const obj = await this.bucket.get(fromKey);
    if (!obj) return false;
    await this.bucket.put(toKey, await obj.arrayBuffer(), {
      httpMetadata: obj.httpMetadata,
    });
    return true;
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const copied = await this.copy(fromKey, toKey);
    if (copied) await this.bucket.delete(fromKey);
  }
}
