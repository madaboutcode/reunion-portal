/**
 * CONTRACT: Data sources proxy routes.
 *
 * GUARANTEES:
 *   - PUBLIC — No authentication required. Data is read-only and non-sensitive.
 *
 *   - GET_SHEET — GET /:sourceId/:sheetName returns sheet data for a known source.
 *     Default response: { source, sheet, rows, data: Record<string, string>[] }
 *     With ?raw=true: { source, sheet, data: string[][] }
 *     With ?range=A:D: restricts columns to the given A1 range.
 *
 *   - SOURCE_NOT_FOUND — 404 when sourceId is not registered in the registry.
 *
 *   - SHEET_NOT_FOUND — 404 when the sheet tab does not exist in the source.
 *     (Propagated from provider's NotFoundError.)
 *
 *   - INPUT_VALIDATION — 400 when sheetName is empty, longer than 100 chars,
 *     or contains characters outside [a-zA-Z0-9 _-].
 *
 *   - UPSTREAM_ERROR — 502 when the upstream provider (e.g. Google) fails.
 *
 * EXPECTS:
 *   - dataSourceRegistry is set on context by the DI middleware in app.ts.
 *     Routes are only mounted when the registry is present (app.ts guards this).
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { NotFoundError, ValidationError } from '../services/errors.js';

export const datasourcesRoutes = new Hono<AppEnv>();

const SHEET_NAME_RE = /^[a-zA-Z0-9 _-]+$/;
const SHEET_NAME_MAX_LEN = 100;

datasourcesRoutes.get(
  '/:sourceId/:sheetName',
  async (c) => {
    const sourceId = c.req.param('sourceId');
    const sheetName = c.req.param('sheetName');

    // Validate sheetName
    if (!sheetName || sheetName.length === 0) {
      throw new ValidationError({ sheetName: 'Sheet name is required' });
    }
    if (sheetName.length > SHEET_NAME_MAX_LEN) {
      throw new ValidationError({ sheetName: `Sheet name must be ${SHEET_NAME_MAX_LEN} characters or fewer` });
    }
    if (!SHEET_NAME_RE.test(sheetName)) {
      throw new ValidationError({ sheetName: 'Sheet name contains invalid characters. Allowed: letters, digits, spaces, underscores, hyphens.' });
    }

    const registry = c.get('dataSourceRegistry');
    if (!registry) {
      throw new NotFoundError(`Unknown data source: ${sourceId}`);
    }
    const provider = registry.get(sourceId);
    if (!provider) {
      throw new NotFoundError(`Unknown data source: ${sourceId}`);
    }

    const raw = c.req.query('raw') === 'true';
    const range = c.req.query('range') || undefined;

    if (raw) {
      const values = await provider.getRawValues(sheetName, range);
      return c.json({ source: sourceId, sheet: sheetName, data: values });
    }

    const result = await provider.getRows(sheetName, range);
    return c.json({ source: sourceId, ...result });
  },
);
