/**
 * CONTRACT
 *
 * GUARANTEE: THUMBNAIL_SHAPE — render() always produces a 200×200,
 *   fit:cover, gravity:face JPEG at quality 80 via the Cloudflare Images
 *   binding. This is the single definition of the thumbnail shape — every
 *   caller (self-registration, desk spot-registration, staff photo
 *   replacement, thumbnail backfill) gets the identical output.
 *
 * GUARANTEE: GENERATE_NO_OP_GUARD — generateAndStore() is a no-op when the
 *   Images binding, fileStorage, or photoKey is absent. It never throws in
 *   that case.
 *
 * GUARANTEE: GENERATE_NEVER_THROWS — generateAndStore() swallows all
 *   failures (missing source file, transform failure, upload failure,
 *   public-bucket publish failure) and logs a warning. A thumbnail failure
 *   must never fail the caller's registration flow (self-registration or
 *   desk spot-registration).
 *
 * GUARANTEE: GENERATE_RESULT_REFLECTS_OUTCOME — generateAndStore() returns
 *   `{ ok: boolean; error?: string }`. `ok` is true only when the private
 *   thumbnail was uploaded AND photo_thumb_key was set — a no-op guard
 *   (missing binding/fileStorage/photoKey), a missing source file, and a
 *   render/upload failure all return `ok: false` with a message. Callers that
 *   need to count real successes vs. silent failures (thumbnail backfill)
 *   MUST branch on this return value, not on whether the call threw — it
 *   never throws (GENERATE_NEVER_THROWS). A public-bucket publish failure
 *   does not flip `ok` to false — it is already independently logged by
 *   publishToPublicBucket and has its own reconciliation path
 *   (RegistrationService.syncThumbsToPublicBucket).
 *
 * GUARANTEE: GENERATE_STORAGE_SHAPE — on success, the JPEG is uploaded to
 *   `registrations/{regCode}/photo-thumb.jpg` in the private bucket via
 *   fileStorage, `photo_thumb_key` is set on the registration via
 *   registrationRepo.update(), and the same bytes are published to the
 *   public thumbs bucket at `{regId}.jpg`.
 *
 * EXPECTS: registrationRepo is fully initialised and bound to the current
 *   request's D1 before generateAndStore() is called.
 *
 * FAILURE BEHAVIOR: render() throws AppError(500) when the Images binding
 *   is absent — callers that need a hard failure (e.g. staff photo
 *   replacement) let it propagate. generateAndStore() never throws; see
 *   GENERATE_NEVER_THROWS.
 */

import type { IFileStorage, IRegistrationRepository } from '../repositories/interfaces.js';
import type { ImagesBinding } from '../env.js';
import { AppError } from './errors.js';
import { createLogger, parseLogLevel, type Logger } from '../infra/logger.js';

export const PUBLIC_THUMB_CACHE_CONTROL =
  'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, immutable';

export interface ThumbnailResult {
  ok: boolean;
  /** Present when ok is false — a short, loggable reason. */
  error?: string;
}

export class PhotoThumbnailService {
  private fileStorage: IFileStorage | null;
  private imagesBinding: ImagesBinding | null;
  private publicThumbsBucket: R2Bucket | null;
  private registrationRepo: IRegistrationRepository;
  private log: Logger;

  constructor(deps: {
    registrationRepo: IRegistrationRepository;
    fileStorage?: IFileStorage;
    imagesBinding?: ImagesBinding;
    publicThumbsBucket?: R2Bucket;
    logLevel?: string;
  }) {
    this.registrationRepo = deps.registrationRepo;
    this.fileStorage = deps.fileStorage ?? null;
    this.imagesBinding = deps.imagesBinding ?? null;
    this.publicThumbsBucket = deps.publicThumbsBucket ?? null;
    this.log = createLogger('photo-thumbnail', parseLogLevel(deps.logLevel));
  }

  /**
   * Renders the canonical 200×200 face-cropped JPEG thumbnail from an image
   * stream. Throws AppError(500) if the Images binding is not configured.
   */
  async render(input: ReadableStream): Promise<ArrayBuffer> {
    if (!this.imagesBinding) {
      throw new AppError('Image processing is not configured', 500);
    }

    const outputHandle = await this.imagesBinding
      .input(input)
      .transform({ width: 200, height: 200, fit: 'cover', gravity: 'face' })
      .output({ format: 'image/jpeg', quality: 80 });

    return outputHandle.response().arrayBuffer();
  }

  /**
   * Best-effort: reads the already-uploaded photo at photoKey, renders the
   * thumbnail, uploads it, sets photo_thumb_key, and publishes to the public
   * thumbs bucket. No-op when imagesBinding/fileStorage/photoKey is absent.
   * Never throws — failures are logged and swallowed (GENERATE_NEVER_THROWS).
   * Returns `{ ok, error? }` reflecting the real outcome — see
   * GENERATE_RESULT_REFLECTS_OUTCOME. Fire-and-forget callers may ignore the
   * return value; callers that count successes (thumbnail backfill) must not.
   */
  async generateAndStore(regId: number, regCode: string, photoKey: string | null): Promise<ThumbnailResult> {
    if (!this.imagesBinding) return { ok: false, error: 'Images binding not configured' };
    if (!this.fileStorage) return { ok: false, error: 'File storage not configured' };
    if (!photoKey) return { ok: false, error: 'No photo to generate a thumbnail from' };

    const thumbKey = `registrations/${regCode}/photo-thumb.jpg`;
    try {
      const file = await this.fileStorage.get(photoKey);
      if (!file) return { ok: false, error: `Source photo not found at ${photoKey}` };

      const thumbBytes = await this.render(file.body);
      await this.fileStorage.upload(thumbKey, thumbBytes, {
        mimeType: 'image/jpeg',
        fileName: 'photo-thumb.jpg',
        sizeBytes: thumbBytes.byteLength,
      });
      await this.registrationRepo.update(regId, { photo_thumb_key: thumbKey });
      this.log.info(`Generated photo thumbnail: ${thumbKey}`);

      await this.publishToPublicBucket(regId, thumbBytes);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`Thumbnail generation failed for reg_id=${regId}: ${message}`);
      return { ok: false, error: message };
    }
  }

  /**
   * Publishes already-rendered thumbnail bytes to the public thumbs bucket.
   * No-op when publicThumbsBucket is absent. Failures are logged, not thrown.
   */
  async publishToPublicBucket(regId: number, thumbBytes: ArrayBuffer): Promise<void> {
    if (!this.publicThumbsBucket) return;
    try {
      await this.publicThumbsBucket.put(`${regId}.jpg`, thumbBytes, {
        httpMetadata: {
          contentType: 'image/jpeg',
          cacheControl: PUBLIC_THUMB_CACHE_CONTROL,
        },
      });
    } catch (err) {
      this.log.warn(`Public thumb publish failed for reg_id=${regId}: ${String(err)}`);
    }
  }
}
