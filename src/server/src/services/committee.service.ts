/**
 * CONTRACT: CommitteeService — reads/writes the committee-todo Google Sheet.
 *
 * GUARANTEES:
 *   - getBoard() returns { people, tasks, thumbsBaseUrl }. Tasks are parsed from
 *     the `todo` tab: a row whose Task cell (col A) starts with "-" is a CHILD of
 *     the nearest non-"-" row above it (position-based, one level). `id` is the
 *     1-based sheet row number (the write address); `parent` is the parent row's
 *     id, or null for a top-level task.
 *   - mutate() applies one change and returns a FRESH board (re-read after write),
 *     so the client always reconciles against current sheet state.
 *   - Every mutation that targets an existing row RE-READS that row and confirms
 *     its (cleaned) Task text still matches what the client acted on. Mismatch →
 *     AppError(409) and NO write (safe-fail; client reloads). See wireframe.md §6.
 *   - Uses the `spreadsheets` (read-write) scope. Its access token is cached at
 *     module level, SEPARATE from google-sheets.provider.ts's readonly cache —
 *     two modules, two caches, so the scopes never collide.
 *
 * EXPECTS:
 *   - base64Key: entire service account JSON, base64-encoded (GOOGLE_SA_KEY).
 *   - spreadsheetId: the committee-todo workbook id (GOOGLE_COMMITTEE_SHEET_ID).
 *   - The service account is shared as EDITOR on this workbook only.
 *   - Tabs: `todo` (Task|Assignee|Due|Done|Notes) and `users` (Name|regid).
 *   - Running on Cloudflare Workers (Web Crypto, atob/btoa, fetch globals).
 *
 * FAILURE BEHAVIOR:
 *   - Google token/API failures propagate as AppError(502).
 *   - Row-content mismatch → AppError(409). Bad input → ValidationError(400).
 */

import { AppError, ValidationError } from './errors.js';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TODO_TAB = 'todo';
const USERS_TAB = 'users';

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

// Module-level caches for the read-WRITE scope. Deliberately independent from the
// readonly cache in google-sheets.provider.ts (that is the whole point — see CONTRACT).
const tokenCache = new Map<string, CachedToken>();
const gidCache = new Map<string, number>(); // `${spreadsheetId}:${tab}` -> sheetId

// ---------------------------------------------------------------------------
// JWT / token (Web Crypto — no Node crypto)
// ---------------------------------------------------------------------------

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlStr(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return crypto.subtle.importKey('pkcs8', bytes.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function mintToken(clientEmail: string, privateKey: string): Promise<CachedToken> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64urlStr(JSON.stringify({
    iss: clientEmail, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
  }));
  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(privateKey);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64url(sig)}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!resp.ok) throw new AppError(`Google token exchange failed (${resp.status}): ${await resp.text()}`, 502);
  const data = await resp.json<{ access_token: string; expires_in: number }>();
  return { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CommitteeTaskDTO {
  id: string;
  title: string;
  assignee: string | null;
  parent: string | null;
  due: string | null;
  notes: string | null;
  done: boolean;
}
export interface CommitteePersonDTO {
  name: string;
  regid: string | null;
}
export interface CommitteeBoard {
  people: CommitteePersonDTO[];
  tasks: CommitteeTaskDTO[];
  thumbsBaseUrl: string;
}

export type CommitteeMutation =
  | { op: 'toggle'; row: number; expectTask: string }
  | { op: 'add'; assignee: string; title: string; due?: string; notes?: string }
  | { op: 'addSub'; parentRow: number; expectParentTask: string; title: string }
  | { op: 'assign'; row: number; expectTask: string; assignee: string }
  | { op: 'edit'; row: number; expectTask: string; title: string; due: string | null; notes: string | null };

function cleanTask(raw: string): { isChild: boolean; title: string } {
  const isChild = raw.startsWith('-');
  return { isChild, title: isChild ? raw.replace(/^-\s*/, '').trim() : raw.trim() };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CommitteeService {
  private clientEmail: string;
  private privateKey: string;
  private spreadsheetId: string;
  private thumbsBaseUrl: string;

  constructor(base64Key: string, spreadsheetId: string, thumbsBaseUrl: string) {
    const creds = JSON.parse(atob(base64Key)) as ServiceAccountKey;
    this.clientEmail = creds.client_email;
    this.privateKey = creds.private_key;
    this.spreadsheetId = spreadsheetId;
    this.thumbsBaseUrl = thumbsBaseUrl;
  }

  // -- low-level Google Sheets --------------------------------------------

  private async token(): Promise<string> {
    const cached = tokenCache.get(this.clientEmail);
    if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
    const fresh = await mintToken(this.clientEmail, this.privateKey);
    tokenCache.set(this.clientEmail, fresh);
    return fresh.token;
  }

  private base(): string {
    return `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}`;
  }

  private async authHeaders(json = false): Promise<Record<string, string>> {
    const h: Record<string, string> = { Authorization: `Bearer ${await this.token()}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  private async readValues(rangeA1: string): Promise<string[][]> {
    const resp = await fetch(`${this.base()}/values/${encodeURIComponent(rangeA1)}`, { headers: await this.authHeaders() });
    if (!resp.ok) throw new AppError(`Sheets read failed (${resp.status}): ${await resp.text()}`, 502);
    return (await resp.json<{ values?: string[][] }>()).values ?? [];
  }

  private async writeValues(rangeA1: string, values: string[][]): Promise<void> {
    const resp = await fetch(
      `${this.base()}/values/${encodeURIComponent(rangeA1)}?valueInputOption=USER_ENTERED`,
      { method: 'PUT', headers: await this.authHeaders(true), body: JSON.stringify({ values }) },
    );
    if (!resp.ok) throw new AppError(`Sheets write failed (${resp.status}): ${await resp.text()}`, 502);
  }

  private async appendRow(values: string[]): Promise<void> {
    const resp = await fetch(
      `${this.base()}/values/${encodeURIComponent(`${TODO_TAB}!A:E`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers: await this.authHeaders(true), body: JSON.stringify({ values: [values] }) },
    );
    if (!resp.ok) throw new AppError(`Sheets append failed (${resp.status}): ${await resp.text()}`, 502);
  }

  private async insertRow(startIndex0: number): Promise<void> {
    const sheetId = await this.sheetId(TODO_TAB);
    const resp = await fetch(`${this.base()}:batchUpdate`, {
      method: 'POST', headers: await this.authHeaders(true),
      body: JSON.stringify({ requests: [{ insertDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: startIndex0, endIndex: startIndex0 + 1 },
        inheritFromBefore: true,
      } }] }),
    });
    if (!resp.ok) throw new AppError(`Sheets insertRow failed (${resp.status}): ${await resp.text()}`, 502);
  }

  private async sheetId(tab: string): Promise<number> {
    const cacheKey = `${this.spreadsheetId}:${tab}`;
    const cached = gidCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const resp = await fetch(`${this.base()}?fields=sheets.properties`, { headers: await this.authHeaders() });
    if (!resp.ok) throw new AppError(`Sheets meta failed (${resp.status}): ${await resp.text()}`, 502);
    const meta = await resp.json<{ sheets: { properties: { title: string; sheetId: number } }[] }>();
    const found = meta.sheets.find((s) => s.properties.title === tab);
    if (!found) throw new AppError(`Tab not found: ${tab}`, 502);
    gidCache.set(cacheKey, found.properties.sheetId);
    return found.properties.sheetId;
  }

  // -- domain: read -------------------------------------------------------

  async getBoard(): Promise<CommitteeBoard> {
    const [todo, users] = await Promise.all([
      this.readValues(`${TODO_TAB}!A1:E`),
      this.readValues(`${USERS_TAB}!A2:B`),
    ]);

    const tasks: CommitteeTaskDTO[] = [];
    let lastTopId: string | null = null;
    todo.slice(1).forEach((row, i) => {
      const rawTask = row[0] ?? '';
      if (rawTask.trim() === '') return; // skip blank rows
      const sheetRow = i + 2; // header is row 1
      const id = String(sheetRow);
      const { isChild, title } = cleanTask(rawTask);
      const assignee = (row[1] ?? '').trim() || null;
      const due = (row[2] ?? '').trim() || null;
      const done = (row[3] ?? '').toUpperCase() === 'TRUE';
      const notes = (row[4] ?? '').trim() || null;
      if (isChild) {
        tasks.push({ id, title, assignee, parent: lastTopId, due, notes, done });
      } else {
        tasks.push({ id, title, assignee, parent: null, due, notes, done });
        lastTopId = id;
      }
    });

    const people: CommitteePersonDTO[] = users
      .map((row) => ({ name: (row[0] ?? '').trim(), regid: (row[1] ?? '').trim() || null }))
      .filter((p) => p.name !== '');

    return { people, tasks, thumbsBaseUrl: this.thumbsBaseUrl };
  }

  // -- domain: write ------------------------------------------------------

  async mutate(m: CommitteeMutation): Promise<CommitteeBoard> {
    switch (m.op) {
      case 'toggle':
        await this.toggle(m.row, m.expectTask);
        break;
      case 'assign':
        await this.assertKnownAssignee(m.assignee);
        await this.assign(m.row, m.expectTask, m.assignee);
        break;
      case 'add':
        await this.assertKnownAssignee(m.assignee);
        await this.appendRow([m.title, m.assignee, m.due ?? '', 'FALSE', m.notes ?? '']);
        break;
      case 'addSub':
        await this.addSub(m.parentRow, m.expectParentTask, m.title);
        break;
      case 'edit':
        await this.edit(m.row, m.expectTask, m.title, m.due, m.notes);
        break;
    }
    return this.getBoard();
  }

  private async assertKnownAssignee(name: string): Promise<void> {
    const users = await this.readValues(`${USERS_TAB}!A2:A`);
    const known = new Set(users.map((r) => (r[0] ?? '').trim()).filter(Boolean));
    if (!known.has(name)) throw new ValidationError({ assignee: `Unknown assignee: ${name}` });
  }

  /** Read a single row A:E and confirm its cleaned Task matches. Returns the row. */
  private async confirmRow(row: number, expectTitle: string): Promise<string[]> {
    const cur = await this.readValues(`${TODO_TAB}!A${row}:E${row}`);
    const cells = cur[0] ?? [];
    const raw = cells[0] ?? '';
    if (raw.trim() === '') throw new AppError('Row no longer exists — reload.', 409);
    if (cleanTask(raw).title !== expectTitle.trim()) {
      throw new AppError('This item changed in the sheet — reload.', 409);
    }
    return cells;
  }

  private async toggle(row: number, expectTask: string): Promise<void> {
    const cells = await this.confirmRow(row, expectTask);
    const done = (cells[3] ?? '').toUpperCase() === 'TRUE';
    await this.writeValues(`${TODO_TAB}!D${row}`, [[done ? 'FALSE' : 'TRUE']]);
  }

  private async assign(row: number, expectTask: string, assignee: string): Promise<void> {
    const cells = await this.confirmRow(row, expectTask);
    if ((cells[0] ?? '').startsWith('-')) {
      throw new ValidationError({ row: 'Cannot assign a subtask directly.' });
    }
    await this.writeValues(`${TODO_TAB}!B${row}`, [[assignee]]);
    // Keep contiguous children in sync (they inherit the owner).
    const below = await this.readValues(`${TODO_TAB}!A${row + 1}:A`);
    let n = 0;
    for (const r of below) {
      if ((r[0] ?? '').startsWith('-')) n++;
      else break;
    }
    if (n > 0) {
      await this.writeValues(`${TODO_TAB}!B${row + 1}:B${row + n}`, Array.from({ length: n }, () => [assignee]));
    }
  }

  private async addSub(parentRow: number, expectParentTask: string, title: string): Promise<void> {
    const cells = await this.confirmRow(parentRow, expectParentTask);
    if ((cells[0] ?? '').startsWith('-')) {
      throw new ValidationError({ parentRow: 'A subtask cannot own subtasks.' });
    }
    const parentAssignee = (cells[1] ?? '').trim();
    // Count contiguous existing children to insert AFTER the last one.
    const below = await this.readValues(`${TODO_TAB}!A${parentRow + 1}:A`);
    let n = 0;
    for (const r of below) {
      if ((r[0] ?? '').startsWith('-')) n++;
      else break;
    }
    const newSheetRow = parentRow + n + 1; // 1-based
    await this.insertRow(newSheetRow - 1); // insertDimension startIndex is 0-based
    await this.writeValues(`${TODO_TAB}!A${newSheetRow}:E${newSheetRow}`, [[`- ${title}`, parentAssignee, '', 'FALSE', '']]);
  }

  /** Edit a task's text (A), due (C) and notes (E). Assignee (B) and Done (D)
   *  are left untouched. A subtask keeps its `- ` prefix so it stays a child. */
  private async edit(
    row: number,
    expectTask: string,
    title: string,
    due: string | null,
    notes: string | null,
  ): Promise<void> {
    const cells = await this.confirmRow(row, expectTask);
    const trimmed = title.trim();
    if (trimmed === '') throw new ValidationError({ title: 'Task text cannot be empty.' });
    const isChild = (cells[0] ?? '').startsWith('-');
    // C and E are not contiguous (D=Done sits between), so write them separately
    // rather than a C:E range that would clobber Done.
    await this.writeValues(`${TODO_TAB}!A${row}`, [[isChild ? `- ${trimmed}` : trimmed]]);
    await this.writeValues(`${TODO_TAB}!C${row}`, [[due ?? '']]);
    await this.writeValues(`${TODO_TAB}!E${row}`, [[notes ?? '']]);
  }
}
