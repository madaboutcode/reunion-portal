import type { Context } from 'hono';
import type { AppEnv } from '../env.js';
import { AppError, ValidationError } from '../services/errors.js';
import { createLogger } from '../infra/logger.js';
import { ConfigError } from '../lib/site-config.js';
import { resolveLogContext } from '../infra/request-meta.js';

const log = createLogger('error-handler');

export function handleError(err: Error, c: Context<AppEnv>): Response {
  const ctx = resolveLogContext(c);

  if (err instanceof ConfigError) {
    log.error('Missing configuration', { ...ctx, status: 500, variable: err.variable, error: err.message });
    return c.json({ error: `Server configuration error: ${err.variable} is not set` }, 500);
  }
  if (err instanceof ValidationError) {
    log.warn('Validation error', { ...ctx, status: 400, fieldErrors: err.fieldErrors });
    return c.json({ error: err.message, details: { fieldErrors: err.fieldErrors } }, 400);
  }
  if (err instanceof AppError) {
    log.warn('App error', { ...ctx, status: err.statusCode, error: err.message, code: err.code });
    const body: { error: string; code?: string } = { error: err.message };
    if (err.code) body.code = err.code;
    return c.json(body, err.statusCode as 403);
  }
  log.error('Unhandled error', { ...ctx, status: 500, error: err.message, stack: err.stack });
  return c.json({ error: 'Internal server error' }, 500);
}
