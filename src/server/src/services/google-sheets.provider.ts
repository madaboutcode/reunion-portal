/**
 * CONTRACT: GoogleSheetsProvider — implements DataSourceProvider for Google Sheets.
 *
 * GUARANTEES:
 *   - Implements DataSourceProvider (getRows, getRawValues).
 *   - Access token is cached at module level and refreshed 60 seconds before expiry.
 *     A single isolate reuses the cached token across all requests (~minutes lifetime).
 *   - getRows() treats the first row as headers and maps remaining rows to objects.
 *     Empty cells in a row produce an empty string value, not undefined.
 *   - getRawValues() returns the raw string[][] from the Sheets API valueRanges.
 *   - Throws NotFoundError when Google returns 400 with "Unable to parse range"
 *     (the sheet tab does not exist in the spreadsheet).
 *   - Throws AppError (502) for all other upstream Google API failures.
 *
 * EXPECTS:
 *   - base64Key: the entire service account JSON file, base64-encoded.
 *   - spreadsheetId: the Google Sheets spreadsheet ID (plain string).
 *   - The service account has at least Viewer access to the spreadsheet.
 *   - Running on Cloudflare Workers — uses Web Crypto API, NOT Node crypto.
 *     atob() and crypto.subtle are available globally in CF Workers.
 *
 * FAILURE BEHAVIOR:
 *   - Token fetch failures propagate as AppError 502 with the upstream message.
 *   - If Google returns an unexpected non-200, AppError 502 is thrown.
 */

import type { DataSourceProvider, SheetResult } from './datasource.types.js';
import { AppError, NotFoundError } from './errors.js';

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

interface CachedToken {
  token: string;
  expiresAt: number; // Unix ms
}

// Module-level token cache — survives across requests within a CF Worker isolate.
let cachedToken: CachedToken | null = null;

// ---------------------------------------------------------------------------
// JWT helpers (Web Crypto API — no Node crypto)
// ---------------------------------------------------------------------------

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlFromString(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Strip PEM header/footer and whitespace, then decode to ArrayBuffer.
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');

  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function buildJwt(clientEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64urlFromString(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));

  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(privateKey);

  const encoder = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(signingInput),
  );

  return `${signingInput}.${base64url(signatureBuffer)}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

async function fetchAccessToken(clientEmail: string, privateKey: string): Promise<CachedToken> {
  const jwt = await buildJwt(clientEmail, privateKey);

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new AppError(`Google token exchange failed (${resp.status}): ${body}`, 502);
  }

  const data = await resp.json<{ access_token: string; expires_in: number }>();
  return {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// ---------------------------------------------------------------------------
// GoogleSheetsProvider
// ---------------------------------------------------------------------------

export class GoogleSheetsProvider implements DataSourceProvider {
  private clientEmail: string;
  private privateKey: string;
  private spreadsheetId: string;

  constructor(base64Key: string, spreadsheetId: string) {
    const creds = JSON.parse(atob(base64Key)) as ServiceAccountKey;
    this.clientEmail = creds.client_email;
    this.privateKey = creds.private_key;
    this.spreadsheetId = spreadsheetId;
  }

  // -------------------------------------------------------------------------
  // Token management
  // -------------------------------------------------------------------------

  private async getToken(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
      return cachedToken.token;
    }
    cachedToken = await fetchAccessToken(this.clientEmail, this.privateKey);
    return cachedToken.token;
  }

  // -------------------------------------------------------------------------
  // Sheets API fetch
  // -------------------------------------------------------------------------

  private buildRange(sheetName: string, range?: string): string {
    // Encode sheet names that contain spaces or special chars.
    // A1 notation: 'Sheet Name'!A:ZZ
    const quotedSheet = `'${sheetName.replace(/'/g, "\\'")}'`;
    return range ? `${quotedSheet}!${range}` : `${quotedSheet}!A:ZZ`;
  }

  private async fetchValues(sheetName: string, range?: string): Promise<string[][]> {
    const token = await this.getToken();
    const encodedRange = encodeURIComponent(this.buildRange(sheetName, range));
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${encodedRange}`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      const body = await resp.text();

      // Google returns 400 with "Unable to parse range" when the sheet tab doesn't exist.
      if (resp.status === 400 && body.includes('Unable to parse range')) {
        throw new NotFoundError(`Sheet not found: ${sheetName}`);
      }

      throw new AppError(`Google Sheets API error (${resp.status}): ${body}`, 502);
    }

    const data = await resp.json<{ values?: string[][] }>();
    return data.values ?? [];
  }

  // -------------------------------------------------------------------------
  // DataSourceProvider implementation
  // -------------------------------------------------------------------------

  async getRows(sheetName: string, range?: string): Promise<SheetResult> {
    const values = await this.fetchValues(sheetName, range);

    if (values.length === 0) {
      return { sheet: sheetName, rows: 0, data: [] };
    }

    const headers = values[0];
    const dataRows = values.slice(1);

    const data = dataRows.map((row) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = row[i] ?? '';
      }
      return obj;
    });

    return { sheet: sheetName, rows: data.length, data };
  }

  async getRawValues(sheetName: string, range?: string): Promise<string[][]> {
    return this.fetchValues(sheetName, range);
  }
}
