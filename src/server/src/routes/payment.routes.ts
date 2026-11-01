import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { verifyToken } from '../infra/jwt.js';
import { ForbiddenError } from '../services/errors.js';
import type { ProofUploadResponse } from '@smriti/shared';
import { ALLOWED_ID_FILE_TYPES, MAX_ID_FILE_SIZE, REG_CODE_PREFIX } from '@smriti/shared';
import { rateLimitByCategory } from '../middleware/rate-limit.js';
import { setRequestMeta } from '../infra/request-meta.js';

const routes = new Hono<AppEnv>();

routes.post('/registrations/:regCode/pay/upload-proof', rateLimitByCategory("upload"), async (c) => {
  const regCode = c.req.param('regCode');
  setRequestMeta(c, { reqType: 'payment:upload-proof', regCode: regCode ?? undefined });
  if (!regCode) throw new ForbiddenError();

  const normalized = regCode.replace(/-/g, '').trim().toUpperCase();
  if (!normalized.startsWith(REG_CODE_PREFIX) || normalized.length !== 16) {
    return c.json({ error: 'Invalid registration code format' }, 400);
  }

  const { registration: reg } = await c.var.registrationService.getByRegCode(normalized);
  const regId = Number(reg.regId);

  // Auth is REQUIRED — missing or invalid Bearer token → 401
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  try {
    const token = header.slice(7);
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (payload.role !== 'attendee' || Number(payload.sub) !== regId) {
      throw new ForbiddenError();
    }
  } catch (err) {
    if (err instanceof ForbiddenError) throw err;
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  const body = await c.req.parseBody();
  const file = body['file'] as File | undefined;
  if (!file) {
    return c.json({ error: 'No file provided' }, 400);
  }

  if (!(ALLOWED_ID_FILE_TYPES as readonly string[]).includes(file.type)) {
    return c.json({
      error: 'Invalid file type',
      details: { allowedTypes: ALLOWED_ID_FILE_TYPES },
    }, 400);
  }

  if (file.size > MAX_ID_FILE_SIZE) {
    return c.json({
      error: 'File too large',
      details: { maxSizeMB: 5 },
    }, 400);
  }

  const utr = typeof body['utr'] === 'string' ? body['utr'].trim() : undefined;

  const fileData = await file.arrayBuffer();
  const metadata = {
    mimeType: file.type,
    fileName: file.name,
    sizeBytes: file.size,
  };

  const result = await c.var.paymentService.uploadProof(regId, fileData, metadata, utr || undefined);

  const response: ProofUploadResponse = {
    status: result.status,
    message: result.message,
  };
  return c.json(response, 200);
});

export { routes as paymentRoutes };
