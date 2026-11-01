import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv, ImagesBinding } from '../env.js';
import type { Registration } from '../domain/types.js';
import type { IFileStorage } from '../repositories/interfaces.js';
import { handleError } from '../middleware/error.middleware.js';
import { _scopeCache } from '../middleware/auth.middleware.js';
import { createFakePermissionsDb } from './helpers/fake-permissions-db.js';
import { signToken } from '../infra/jwt.js';
import { staffRoutes } from '../routes/staff.routes.js';
import { RegistrationService } from '../services/registration.service.js';
import { createEmptyTshirtRepo, createEmptyChargeRepo } from './helpers/fake-tshirt-charge-repos.js';

const JWT_SECRET = 'photo-replacement-test-secret-at-least-32-bytes';
const ORIGINAL_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]).buffer;
const THUMB_BYTES = new Uint8Array([9, 8, 7, 6]).buffer;

function registration(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 42,
    regCode: 'SMRT0042',
    status: 'confirmed',
    fullName: 'Omar M',
    branch: 'CSE',
    email: 'omar@example.com',
    whatsapp: '9999999999',
    mobileAlternate: null,
    city: 'Kochi',
    country: 'India',
    attendanceIntent: 'attending',
    participationType: 'full_celebration',
    gender: 'female',
    tshirtSize: 'M',
    alumniMeal: 'veg',
    accommodation: 'none',
    checkIn: null,
    checkOut: null,
    extraBed: false,
    breakfastAdult: 0,
    breakfastChild: 0,
    donationAmount: 0,
    publicAck: false,
    ackDisplayName: null,
    felicitation: false,
    contributionSplits: {},
    pricingSnapshot: { total: 0 } as Registration['pricingSnapshot'],
    totalAmount: 0,
    idNote: null,
    photoFileKey: 'registrations/SMRT0042/photo.png',
    photoThumbKey: 'registrations/SMRT0042/photo-thumb.jpg',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

class ObservableStorage {
  uploads: Array<{ key: string; bytes: Uint8Array; metadata: unknown }> = [];
  deletes: string[] = [];
  failOnceAtKey: string | null = null;

  async upload(key: string, data: ArrayBuffer, metadata: unknown): Promise<void> {
    this.uploads.push({ key, bytes: new Uint8Array(data.slice(0)), metadata });
    if (this.failOnceAtKey === key) {
      this.failOnceAtKey = null;
      throw new Error(`temporary write failure: ${key}`);
    }
  }

  async delete(key: string): Promise<void> { this.deletes.push(key); }
  async get(): Promise<null> { return null; }
  async move(): Promise<void> {}
  async getSignedUrl(): Promise<string> { return ''; }
}

function imagesBinding(options: { corrupt?: boolean } = {}): ImagesBinding {
  return {
    input() {
      return {
        transform(transformOptions) {
          expect(transformOptions).toEqual({ width: 200, height: 200, fit: 'cover', gravity: 'face' });
          return this;
        },
        async output(outputOptions) {
          expect(outputOptions).toEqual({ format: 'image/jpeg', quality: 80 });
          if (options.corrupt) throw new Error('decoder rejected image');
          return { response: () => new Response(THUMB_BYTES) };
        },
      };
    },
  };
}

function serviceHarness(options: {
  corrupt?: boolean;
  failOnceAtKey?: string;
  notFound?: boolean;
  omitBinding?: 'storage' | 'images' | 'publicBucket';
  publicWriteFails?: boolean;
  auditFails?: boolean;
} = {}) {
  let current: Registration | null = options.notFound ? null : registration();
  const updates: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const storage = new ObservableStorage();
  storage.failOnceAtKey = options.failOnceAtKey ?? null;
  const publicWrites: Array<{ key: string; bytes: Uint8Array; options: unknown }> = [];

  const registrationRepo = {
    async findById(id: number) { return id === current?.id ? current : null; },
    async update(id: number, data: Record<string, unknown>) {
      expect(id).toBe(current?.id);
      updates.push(data);
      current = {
        ...current!,
        photoFileKey: data.photo_file_key as string,
        photoThumbKey: data.photo_thumb_key as string,
        updatedAt: current!.updatedAt + 1,
      };
    },
  };
  const attendeeRepo = { async findByRegistration() { return []; } };
  const auditRepo = {
    async append(entry: Record<string, unknown>) {
      audits.push(entry);
      if (options.auditFails) throw new Error('audit unavailable');
    },
  };
  const publicBucket = {
    async put(key: string, bytes: ArrayBuffer, putOptions: unknown) {
      publicWrites.push({ key, bytes: new Uint8Array(bytes.slice(0)), options: putOptions });
      if (options.publicWriteFails) throw new Error('public bucket unavailable');
    },
  };

  const service = new RegistrationService({
    registrationRepo: registrationRepo as never,
    attendeeRepo: attendeeRepo as never,
    auditRepo: auditRepo as never,
    documentRepo: {} as never,
    emailService: {} as never,
    fileStorage: options.omitBinding === 'storage' ? undefined : storage as unknown as IFileStorage,
    publicThumbsBucket: options.omitBinding === 'publicBucket' ? undefined : publicBucket as unknown as R2Bucket,
    imagesBinding: options.omitBinding === 'images' ? undefined : imagesBinding({ corrupt: options.corrupt }),
    pricingService: {} as never,
    availabilityService: {} as never,
    authService: {} as never,
  });

  return { service, storage, publicWrites, updates, audits, current: () => current };
}

describe('RegistrationService.replacePhoto', () => {
  it('replaces the original, private thumbnail, public thumbnail, DB keys, and audit entry', async () => {
    const h = serviceHarness();

    await h.service.replacePhoto(42, 'staff@example.com', {
      bytes: ORIGINAL_BYTES,
      mimeType: 'image/jpeg',
      sizeBytes: ORIGINAL_BYTES.byteLength,
    });

    expect(h.storage.uploads.map((write) => write.key)).toEqual([
      'registrations/SMRT0042/photo.jpg',
      'registrations/SMRT0042/photo-thumb.jpg',
    ]);
    expect(h.storage.uploads[0].bytes).toEqual(new Uint8Array(ORIGINAL_BYTES));
    expect(h.storage.uploads[1].bytes).toEqual(new Uint8Array(THUMB_BYTES));
    expect(h.publicWrites).toEqual([expect.objectContaining({
      key: '42.jpg',
      bytes: new Uint8Array(THUMB_BYTES),
      options: { httpMetadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, immutable',
      } },
    })]);
    expect(h.updates).toEqual([{
      photo_file_key: 'registrations/SMRT0042/photo.jpg',
      photo_thumb_key: 'registrations/SMRT0042/photo-thumb.jpg',
    }]);
    expect(h.storage.deletes).toEqual(['registrations/SMRT0042/photo.png']);
    expect(h.audits).toEqual([expect.objectContaining({
      registration_id: 42,
      action: 'photo_replaced',
      actor: 'staff@example.com',
    })]);
    expect(JSON.parse(h.audits[0].changes as string)).toEqual({
      photoFileKey: {
        old: 'registrations/SMRT0042/photo.png',
        new: 'registrations/SMRT0042/photo.jpg',
      },
    });
  });

  it('rejects MIME-valid corrupt image bytes before any storage, DB, public bucket, or audit write', async () => {
    const h = serviceHarness({ corrupt: true });

    await expect(h.service.replacePhoto(42, 'staff@example.com', {
      bytes: new Uint8Array([1, 2, 3]).buffer,
      mimeType: 'image/jpeg',
      sizeBytes: 3,
    })).rejects.toMatchObject({ statusCode: 422, message: 'Could not process image' });

    expect(h.storage.uploads).toEqual([]);
    expect(h.storage.deletes).toEqual([]);
    expect(h.publicWrites).toEqual([]);
    expect(h.updates).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it('returns not found without attempting any write for an unknown registration', async () => {
    const h = serviceHarness({ notFound: true });

    await expect(h.service.replacePhoto(999, 'staff@example.com', {
      bytes: ORIGINAL_BYTES,
      mimeType: 'image/jpeg',
      sizeBytes: ORIGINAL_BYTES.byteLength,
    })).rejects.toMatchObject({ statusCode: 404, message: 'Registration not found' });

    expect(h.storage.uploads).toEqual([]);
    expect(h.publicWrites).toEqual([]);
    expect(h.updates).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it.each(['storage', 'images', 'publicBucket'] as const)(
    'rejects before writes when the %s binding is missing',
    async (omitBinding) => {
      const h = serviceHarness({ omitBinding });

      await expect(h.service.replacePhoto(42, 'staff@example.com', {
        bytes: ORIGINAL_BYTES,
        mimeType: 'image/jpeg',
        sizeBytes: ORIGINAL_BYTES.byteLength,
      })).rejects.toMatchObject({ statusCode: 500, message: 'Photo replacement is not configured' });

      expect(h.storage.uploads).toEqual([]);
      expect(h.publicWrites).toEqual([]);
      expect(h.updates).toEqual([]);
      expect(h.audits).toEqual([]);
    },
  );

  it('does not update DB keys when the strict public thumbnail write fails', async () => {
    const h = serviceHarness({ publicWriteFails: true });

    await expect(h.service.replacePhoto(42, 'staff@example.com', {
      bytes: ORIGINAL_BYTES,
      mimeType: 'image/jpeg',
      sizeBytes: ORIGINAL_BYTES.byteLength,
    })).rejects.toThrow('public bucket unavailable');

    expect(h.storage.uploads.map((write) => write.key)).toEqual([
      'registrations/SMRT0042/photo.jpg',
      'registrations/SMRT0042/photo-thumb.jpg',
    ]);
    expect(h.publicWrites.map((write) => write.key)).toEqual(['42.jpg']);
    expect(h.updates).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it('reports success when audit append fails after all canonical writes and the DB update', async () => {
    const h = serviceHarness({ auditFails: true });

    await expect(h.service.replacePhoto(42, 'staff@example.com', {
      bytes: ORIGINAL_BYTES,
      mimeType: 'image/jpeg',
      sizeBytes: ORIGINAL_BYTES.byteLength,
    })).resolves.toBeUndefined();

    expect(h.storage.uploads).toHaveLength(2);
    expect(h.publicWrites).toHaveLength(1);
    expect(h.updates).toHaveLength(1);
    expect(h.audits).toHaveLength(1);
    expect(h.current()).toEqual(expect.objectContaining({
      photoFileKey: 'registrations/SMRT0042/photo.jpg',
      photoThumbKey: 'registrations/SMRT0042/photo-thumb.jpg',
    }));
  });

  it('converges on deterministic assets and DB keys when retried after a partial private-storage write', async () => {
    const h = serviceHarness({ failOnceAtKey: 'registrations/SMRT0042/photo-thumb.jpg' });
    const file = { bytes: ORIGINAL_BYTES, mimeType: 'image/jpeg', sizeBytes: ORIGINAL_BYTES.byteLength };

    await expect(h.service.replacePhoto(42, 'staff@example.com', file)).rejects.toThrow('temporary write failure');
    expect(h.storage.uploads.map((write) => write.key)).toEqual([
      'registrations/SMRT0042/photo.jpg',
      'registrations/SMRT0042/photo-thumb.jpg',
    ]);
    expect(h.publicWrites).toEqual([]);
    expect(h.updates).toEqual([]);

    await expect(h.service.replacePhoto(42, 'staff@example.com', file)).resolves.toBeUndefined();

    expect(h.storage.uploads.map((write) => write.key)).toEqual([
      'registrations/SMRT0042/photo.jpg',
      'registrations/SMRT0042/photo-thumb.jpg',
      'registrations/SMRT0042/photo.jpg',
      'registrations/SMRT0042/photo-thumb.jpg',
    ]);
    expect(h.publicWrites.map((write) => write.key)).toEqual(['42.jpg']);
    expect(h.current()).toEqual(expect.objectContaining({
      photoFileKey: 'registrations/SMRT0042/photo.jpg',
      photoThumbKey: 'registrations/SMRT0042/photo-thumb.jpg',
    }));
    expect(h.audits).toHaveLength(1);
  });
});

// =============================================================================
// RegistrationService.regenerateMissingThumbnails — counting fix
//
// PhotoThumbnailService.generateAndStore() never throws (it swallows and
// logs). Before this fix, regenerateMissingThumbnails() counted succeeded++
// on every call that didn't throw — which was EVERY call, including silent
// no-ops and failures — so a row whose photo was missing from storage was
// counted as succeeded even though photo_thumb_key was never set. This
// proves the fix: counting now comes from generateAndStore()'s returned
// { ok, error } result, not from the absence of a thrown exception.
// =============================================================================

class SelectivePhotoStorage implements IFileStorage {
  private readonly available: Set<string>;
  constructor(available: Set<string>) { this.available = available; }
  async get(key: string) {
    if (!this.available.has(key)) return null;
    return { body: new Response(ORIGINAL_BYTES).body!, contentType: 'image/jpeg', size: ORIGINAL_BYTES.byteLength };
  }
  uploads: Array<{ key: string }> = [];
  async upload(key: string): Promise<void> { this.uploads.push({ key }); }
  async getSignedUrl(): Promise<string> { throw new Error('not implemented'); }
  async delete(): Promise<void> {}
  async copy(): Promise<boolean> { return true; }
  async move(): Promise<void> {}
}

describe('RegistrationService.regenerateMissingThumbnails', () => {
  it('counts a row whose source photo is missing from storage as failed, not succeeded (bug fix)', async () => {
    const missing = [
      { id: 1, regCode: 'SMRT0001', photoFileKey: 'registrations/SMRT0001/photo.jpg' },
      { id: 2, regCode: 'SMRT0002', photoFileKey: 'registrations/SMRT0002/photo.jpg' },
    ];
    // Only reg 1's photo actually exists in storage — reg 2 simulates the
    // real-world case (photo row present, R2 object gone) that the old
    // try/catch miscounted as a success.
    const storage = new SelectivePhotoStorage(new Set(['registrations/SMRT0001/photo.jpg']));
    const updates: Array<{ id: number; data: Record<string, unknown> }> = [];
    const publicWrites: string[] = [];

    const registrationRepo = {
      async findMissingThumbnails() { return missing; },
      async update(id: number, data: Record<string, unknown>) { updates.push({ id, data }); },
    };
    const publicBucket = {
      async put(key: string) { publicWrites.push(key); },
    };

    const service = new RegistrationService({
      registrationRepo: registrationRepo as never,
      attendeeRepo: {} as never,
      auditRepo: {} as never,
      documentRepo: {} as never,
      emailService: {} as never,
      fileStorage: storage,
      publicThumbsBucket: publicBucket as unknown as R2Bucket,
      imagesBinding: imagesBinding(),
      pricingService: {} as never,
      availabilityService: {} as never,
      authService: {} as never,
    });

    const result = await service.regenerateMissingThumbnails();

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([{
      id: 2,
      regCode: 'SMRT0002',
      error: expect.stringContaining('registrations/SMRT0002/photo.jpg'),
    }]);

    // The succeeding row actually got its thumbnail stored + published; the
    // failing row touched neither.
    expect(updates).toEqual([{ id: 1, data: { photo_thumb_key: 'registrations/SMRT0001/photo-thumb.jpg' } }]);
    expect(publicWrites).toEqual(['1.jpg']);
  });

  it('counts every row as failed when the Images binding is absent, without throwing', async () => {
    const missing = [{ id: 5, regCode: 'SMRT0005', photoFileKey: 'registrations/SMRT0005/photo.jpg' }];
    const storage = new SelectivePhotoStorage(new Set(['registrations/SMRT0005/photo.jpg']));

    const service = new RegistrationService({
      registrationRepo: { async findMissingThumbnails() { return missing; }, async update() {} } as never,
      attendeeRepo: {} as never,
      auditRepo: {} as never,
      documentRepo: {} as never,
      emailService: {} as never,
      fileStorage: storage,
      publicThumbsBucket: { async put() {} } as unknown as R2Bucket,
      // No imagesBinding — matches the "binding not configured" no-op guard.
      pricingService: {} as never,
      availabilityService: {} as never,
      authService: {} as never,
    });

    const result = await service.regenerateMissingThumbnails();

    expect(result).toEqual({
      total: 1,
      succeeded: 0,
      failed: 1,
      errors: [{ id: 5, regCode: 'SMRT0005', error: 'Images binding not configured' }],
    });
  });
});

async function token(role: 'staff' | 'admin' | 'attendee'): Promise<string> {
  return signToken(
    role === 'attendee'
      ? { sub: '42', role }
      : { sub: '7', role, email: `${role}@example.com` },
    JWT_SECRET,
    '1h',
  );
}

function routeHarness() {
  _scopeCache.clear();
  const calls: Array<{ id: number; actor: string; file: { bytes: ArrayBuffer; mimeType: string; sizeBytes: number } }> = [];
  const editCalls: Array<{ id: number; request: Record<string, unknown>; actor: string }> = [];
  const app = new Hono<AppEnv>().basePath('/api');
  app.onError(handleError);
  app.use('*', async (c, next) => {
    c.set('registrationService', {
      async replacePhoto(id: number, actor: string, file: { bytes: ArrayBuffer; mimeType: string; sizeBytes: number }) {
        calls.push({ id, actor, file });
      },
    } as never);
    c.set('editService', {
      async edit(id: number, request: Record<string, unknown>, actor: string) {
        editCalls.push({ id, request, actor });
        return {
          registration: registration({ id }),
          pricingBreakup: { total: 0 },
          paymentDelta: 0,
          paymentAction: 'none',
        };
      },
    } as never);
    // PUT /registrations/:id always reads tshirts/charges back for the
    // response (single-save rework) — this route test predates that
    // feature and doesn't exercise it, so wire empty fakes per the pattern
    // in helpers/fake-tshirt-charge-repos.ts.
    c.set('tshirtRepo', createEmptyTshirtRepo());
    c.set('chargeRepo', createEmptyChargeRepo());
    await next();
  });
  app.route('/staff', staffRoutes);

  const request = (path: string, init: RequestInit = {}) => app.request(path, init, {
    JWT_SECRET,
    DB: createFakePermissionsDb(),
  } as AppEnv['Bindings']);
  return { request, calls, editCalls };
}

function multipart(file?: File): FormData {
  const form = new FormData();
  if (file) form.set('file', file);
  return form;
}

describe('POST /api/staff/registrations/:id/photo', () => {
  it('requires authentication and a staff/admin role', async () => {
    const h = routeHarness();
    const file = new File([ORIGINAL_BYTES], 'photo.jpg', { type: 'image/jpeg' });

    expect((await h.request('/api/staff/registrations/42/photo', { method: 'POST', body: multipart(file) })).status).toBe(401);
    expect((await h.request('/api/staff/registrations/42/photo', {
      method: 'POST', body: multipart(file), headers: { Authorization: `Bearer ${await token('attendee')}` },
    })).status).toBe(403);
    expect(h.calls).toEqual([]);
  });

  it.each([
    ['missing file', multipart(), 422, { error: 'Validation failed', details: { fieldErrors: { file: 'Required' } } }],
    ['unsupported type', multipart(new File(['text'], 'photo.gif', { type: 'image/gif' })), 400, { error: 'Invalid file type', details: { allowedTypes: ['image/jpeg', 'image/png'] } }],
    ['empty file', multipart(new File([], 'photo.jpg', { type: 'image/jpeg' })), 400, { error: 'File is empty' }],
    ['oversized file', multipart(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'photo.png', { type: 'image/png' })), 400, { error: 'File too large', details: { maxSizeMB: 5 } }],
  ])('rejects %s before invoking the service', async (_name, body, status, responseBody) => {
    const h = routeHarness();
    const response = await h.request('/api/staff/registrations/42/photo', {
      method: 'POST',
      body: body as FormData,
      headers: { Authorization: `Bearer ${await token('staff')}` },
    });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(responseBody);
    expect(h.calls).toEqual([]);
  });

  it('rejects a non-numeric registration ID before invoking the service', async () => {
    const h = routeHarness();
    const response = await h.request('/api/staff/registrations/not-a-number/photo', {
      method: 'POST',
      body: multipart(new File([ORIGINAL_BYTES], 'photo.jpg', { type: 'image/jpeg' })),
      headers: { Authorization: `Bearer ${await token('admin')}` },
    });

    expect(response.status).toBe(404);
    expect(h.calls).toEqual([]);
  });

  it('buffers an accepted JPEG once and returns the success contract', async () => {
    const h = routeHarness();
    const response = await h.request('/api/staff/registrations/42/photo', {
      method: 'POST',
      body: multipart(new File([ORIGINAL_BYTES], 'portrait.jpg', { type: 'image/jpeg' })),
      headers: { Authorization: `Bearer ${await token('staff')}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', message: 'Photo updated.' });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toEqual(expect.objectContaining({ id: 42, actor: 'staff@example.com' }));
    expect(h.calls[0].file.mimeType).toBe('image/jpeg');
    expect(new Uint8Array(h.calls[0].file.bytes)).toEqual(new Uint8Array(ORIGINAL_BYTES));
  });

  it('rejects an over-limit whole request before multipart parsing or service invocation', async () => {
    const h = routeHarness();
    const maxMultipartBodySize = 5 * 1024 * 1024 + 64 * 1024;
    const invalidMultipartBody = new Uint8Array(maxMultipartBodySize + 1);
    const response = await h.request('/api/staff/registrations/42/photo', {
      method: 'POST',
      body: invalidMultipartBody,
      headers: {
        Authorization: `Bearer ${await token('staff')}`,
        'Content-Type': 'multipart/form-data; boundary=intentionally-invalid',
        'Content-Length': String(invalidMultipartBody.byteLength),
      },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'File too large', details: { maxSizeMB: 5 } });
    expect(h.calls).toEqual([]);
  });
});

describe('PUT /api/staff/registrations/:id photo isolation', () => {
  it('does not pass photoFileKey from generic edit input to EditService', async () => {
    const h = routeHarness();
    const response = await h.request('/api/staff/registrations/42', {
      method: 'PUT',
      body: JSON.stringify({
        updatedAt: 1_700_000_000_000,
        fields: {
          fullName: 'Updated Name',
          photoFileKey: 'registrations/SMRT0042/uncoordinated-photo.jpg',
        },
      }),
      headers: {
        Authorization: `Bearer ${await token('staff')}`,
        'Content-Type': 'application/json',
      },
    });

    expect(response.status).toBe(200);
    expect(h.editCalls).toHaveLength(1);
    const request = h.editCalls[0].request as { fields: Record<string, unknown> };
    expect(request.fields.fullName).toBe('Updated Name');
    expect(request.fields).not.toHaveProperty('photoFileKey');
  });
});
