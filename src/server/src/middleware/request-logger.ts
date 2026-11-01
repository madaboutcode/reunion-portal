import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env.js';
import { createLogger, parseLogLevel } from '../infra/logger.js';
import { resolveLogContext } from '../infra/request-meta.js';

export function requestLogger(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = Date.now();
    await next();

    const duration = Date.now() - start;
    const status = c.res.status;
    const method = c.req.method;
    const path = c.req.path;
    const ctx = resolveLogContext(c);

    const log = createLogger('http', parseLogLevel(c.env.LOG_LEVEL));
    const msg = `${status} ${method} ${path}`;

    if (path === '/api/health' && status < 400) {
      log.debug(msg, { ...ctx, status, duration });
      return;
    }

    if (status >= 500) {
      log.error(msg, { ...ctx, status, duration });
    } else if (status >= 400) {
      log.warn(msg, { ...ctx, status, duration });
    } else {
      log.info(msg, { ...ctx, status, duration });
    }
  };
}
