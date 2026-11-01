/**
 * CONTRACT: Committee Todo routes (public, honor-system — no auth).
 *
 * GUARANTEES:
 *   - GET /todos → { people, tasks, thumbsBaseUrl } from the committee sheet.
 *     404 when the committee sheet is not configured (no GOOGLE_COMMITTEE_SHEET_ID).
 *   - POST /todos/mutate → applies one { op } mutation and returns the FRESH board.
 *     Rate-limited under the "mutation" category. Validates all input; a stale
 *     row (content changed in the sheet) returns 409 (client reloads).
 *
 * EXPECTS:
 *   - committeeService is set on context by the DI middleware in app.ts when the
 *     credentials + sheet id are present.
 *
 * NOTE: Writes are unauthenticated by design (honor system). The server still
 *   validates every field and bounds sizes to keep the sheet well-formed.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { NotFoundError, ValidationError } from '../services/errors.js';
import type { CommitteeMutation } from '../services/committee.service.js';
import { rateLimitByCategory } from '../middleware/rate-limit.js';

export const committeeRoutes = new Hono<AppEnv>();

const MAX_TITLE = 500;
const MAX_NOTES = 5000;
const MAX_DUE = 100;
const MAX_NAME = 100;
const MAX_ROW = 100_000;

/** Reject formula-injection leads and (for task titles) a leading dash that would
 *  be misparsed as a subtask marker. */
function safeText(field: string, value: unknown, max: number, opts: { allowEmpty?: boolean; noLeadingDash?: boolean } = {}): string {
  if (typeof value !== 'string') throw new ValidationError({ [field]: `${field} must be a string` });
  const v = value.trim();
  if (!v) {
    if (opts.allowEmpty) return '';
    throw new ValidationError({ [field]: `${field} is required` });
  }
  if (v.length > max) throw new ValidationError({ [field]: `${field} must be ${max} characters or fewer` });
  if (/^[=+@]/.test(v)) throw new ValidationError({ [field]: `${field} may not start with = + or @` });
  if (opts.noLeadingDash && v.startsWith('-')) throw new ValidationError({ [field]: `${field} may not start with a dash` });
  return v;
}

function intRow(field: string, value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 2 || n > MAX_ROW) {
    throw new ValidationError({ [field]: `${field} must be a valid row number` });
  }
  return n;
}

function parseMutation(body: unknown): CommitteeMutation {
  if (typeof body !== 'object' || body === null) throw new ValidationError({ op: 'Body must be an object' });
  const b = body as Record<string, unknown>;
  switch (b.op) {
    case 'toggle':
      return { op: 'toggle', row: intRow('row', b.row), expectTask: safeText('expectTask', b.expectTask, MAX_TITLE) };
    case 'assign':
      return { op: 'assign', row: intRow('row', b.row), expectTask: safeText('expectTask', b.expectTask, MAX_TITLE), assignee: safeText('assignee', b.assignee, MAX_NAME) };
    case 'add':
      return {
        op: 'add',
        assignee: safeText('assignee', b.assignee, MAX_NAME),
        title: safeText('title', b.title, MAX_TITLE, { noLeadingDash: true }),
        // Optional fields: absent (undefined) and empty string mean the same thing.
        due: safeText('due', b.due ?? '', MAX_DUE, { allowEmpty: true }),
        notes: safeText('notes', b.notes ?? '', MAX_NOTES, { allowEmpty: true }),
      };
    case 'addSub':
      return {
        op: 'addSub',
        parentRow: intRow('parentRow', b.parentRow),
        expectParentTask: safeText('expectParentTask', b.expectParentTask, MAX_TITLE),
        title: safeText('title', b.title, MAX_TITLE, { noLeadingDash: true }),
      };
    case 'edit':
      return {
        op: 'edit',
        row: intRow('row', b.row),
        expectTask: safeText('expectTask', b.expectTask, MAX_TITLE),
        title: safeText('title', b.title, MAX_TITLE, { noLeadingDash: true }),
        due: safeText('due', b.due ?? '', MAX_DUE, { allowEmpty: true }),
        notes: safeText('notes', b.notes ?? '', MAX_NOTES, { allowEmpty: true }),
      };
    default:
      throw new ValidationError({ op: `Unknown op: ${String(b.op)}` });
  }
}

committeeRoutes.get('/todos', async (c) => {
  const service = c.get('committeeService');
  if (!service) throw new NotFoundError('Committee todo is not configured');
  return c.json(await service.getBoard());
});

committeeRoutes.post('/todos/mutate', rateLimitByCategory('mutation'), async (c) => {
  const service = c.get('committeeService');
  if (!service) throw new NotFoundError('Committee todo is not configured');
  const mutation = parseMutation(await c.req.json().catch(() => null));
  return c.json(await service.mutate(mutation));
});
