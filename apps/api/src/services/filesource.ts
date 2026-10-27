import { createHash, createHmac } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import { readSheet } from 'read-excel-file/universal';
import { safeFetch } from './safe-fetch.js';
import type { FilePreview } from '@grids/schema';

// Reads a CSV or Excel file from where it is hosted: a URL, S3 (and S3-compatible stores), Azure Blob, Google Cloud Storage or Google Drive.
// Values arriving here already have their {{VARIABLES}} filled in. Nothing here logs or returns a credential.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const PREVIEW_ROWS = 5;
const PREVIEW_COLUMNS = 20;

export interface FileSpec {
  kind: 'file' | 's3' | 'azure_blob' | 'gcs' | 'gdrive';
  target: string;
  headers: { name: string; value: string }[];
  options: Partial<Record<string, string>>;
}

/** Throws when a host must not be contacted. */
export type HostGuard = (host: string) => Promise<void>;

interface Fetched {
  bytes: Uint8Array;
  name: string;
  type: string;
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();
/** Percent-encoding as AWS signs it. */
const awsEncode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const lastSegment = (path: string) =>
  decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');

/** GET with a size cap, a timeout and redirects followed one hop at a time (each hop is checked, credentials are not forwarded to another origin). */
async function get(
  start: URL,
  startHeaders: Record<string, string>,
  guard: HostGuard,
): Promise<Fetched> {
  let url = start;
  let headers = startHeaders;
  for (let hop = 0; ; hop++) {
    await guard(url.hostname);
    const res = await safeFetch(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      if (hop >= MAX_REDIRECTS) throw new Error('Too many redirects');
      const next = new URL(location, url);
      if (!/^https?:$/.test(next.protocol)) throw new Error('Redirected to an unsupported address');
      if (next.origin !== url.origin) headers = {};
      url = next;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(
        `${url.host} answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${res.status === 401 || res.status === 403 ? ' (check the credentials and permissions)' : ''}`,
      );
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_FILE_BYTES)
      throw new Error(`The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_FILE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error(`The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
      }
      chunks.push(value);
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
    return {
      bytes: Buffer.concat(chunks),
      name: named ? decodeURIComponent(named) : lastSegment(url.pathname),
      type: (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(),
    };
  }
}

// ------------------------------------------------------------ providers

function s3Request(spec: FileSpec, now: Date): { url: URL; headers: Record<string, string> } {
  const m = /^s3:\/\/([^/]+)\/(.+)$/i.exec(spec.target);
  if (!m) throw new Error('Use s3://bucket/path/to/file.csv');
  const [, bucket, key] = m as unknown as [string, string, string];
  const region = spec.options.region || 'us-east-1';
  const base = spec.options.endpoint
    ? new URL(spec.options.endpoint)
    : new URL(`https://s3.${region}.amazonaws.com`);
  if (base.protocol !== 'https:' && base.protocol !== 'http:')
    throw new Error('The endpoint must start with https://');
  // Path style works for every store and every bucket name.
  const path = `${base.pathname.replace(/\/$/, '')}/${[bucket, ...key.split('/')].map(awsEncode).join('/')}`;
  const url = new URL(path, base.origin);
  const { accessKeyId: id, secretAccessKey: secret, sessionToken: session } = spec.options;
  if (!id && !secret) return { url, headers: {} }; // a public object
  if (!id || !secret)
    throw new Error('Both the access key id and the secret access key are needed');
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const signed: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': sha256(''),
    'x-amz-date': stamp,
    ...(session ? { 'x-amz-security-token': session } : {}),
  };
  const names = Object.keys(signed).sort();
  // The canonical headers block ends with a blank line before the signed header list.
  const canonical = [
    'GET',
    url.pathname,
    '',
    `${names.map((n) => `${n}:${signed[n]}`).join('\n')}\n`,
    names.join(';'),
    sha256(''),
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const { host: _host, ...send } = signed;
  return {
    url,
    headers: {
      ...send,
      authorization: `AWS4-HMAC-SHA256 Credential=${id}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
    },
  };
}

function azureRequest(spec: FileSpec, now: Date): { url: URL; headers: Record<string, string> } {
  const url = new URL(spec.target);
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('Use https://account.blob.core.windows.net/container/file.csv');
  if (url.pathname.split('/').filter(Boolean).length < 2)
    throw new Error('The address must include the container and the file name');
  const version = '2021-08-06';
  const { sasToken, accountKey, token } = spec.options;
  if (sasToken) {
    for (const [k, v] of new URLSearchParams(sasToken.replace(/^\?/, '')))
      url.searchParams.set(k, v);
    return { url, headers: { 'x-ms-version': version } };
  }
  if (token) return { url, headers: { authorization: `Bearer ${token}`, 'x-ms-version': version } };
  if (accountKey) {
    const account = url.hostname.split('.')[0]!;
    const ms = { 'x-ms-date': now.toUTCString(), 'x-ms-version': version };
    const canonicalHeaders = Object.entries(ms)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}\n`)
      .join('');
    const query = [...url.searchParams.keys()]
      .sort()
      .map((k) => `\n${k.toLowerCase()}:${url.searchParams.getAll(k).sort().join(',')}`)
      .join('');
    const toSign = `GET${'\n'.repeat(12)}${canonicalHeaders}/${account}${decodeURIComponent(url.pathname)}${query}`;
    const signature = createHmac('sha256', Buffer.from(accountKey, 'base64'))
      .update(toSign)
      .digest('base64');
    return { url, headers: { ...ms, authorization: `SharedKey ${account}:${signature}` } };
  }
  return { url, headers: { 'x-ms-version': version } }; // a public container
}

/** An OAuth access token for a Google service account (a JSON key held in a variable). */
async function googleToken(
  serviceAccount: string,
  scope: string,
  guard: HostGuard,
): Promise<string> {
  let key: { client_email?: string; private_key?: string };
  try {
    key = JSON.parse(serviceAccount);
  } catch {
    throw new Error('The service account variable must hold the JSON key file');
  }
  if (!key.client_email || !key.private_key)
    throw new Error('The service account key has no client_email or private_key');
  const audience = 'https://oauth2.googleapis.com/token';
  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(key.client_email)
    .setSubject(key.client_email)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('55m')
    .sign(await importPKCS8(key.private_key, 'RS256'));
  await guard('oauth2.googleapis.com');
  const res = await safeFetch(audience, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !body.access_token)
    throw new Error(
      `Google refused the service account: ${body.error_description ?? body.error ?? res.status}`,
    );
  return body.access_token;
}

async function gcs(spec: FileSpec, guard: HostGuard): Promise<Fetched> {
  const m = /^gs:\/\/([^/]+)\/(.+)$/i.exec(spec.target);
  if (!m) throw new Error('Use gs://bucket/path/to/file.csv');
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(m[1]!)}/o/${encodeURIComponent(m[2]!)}?alt=media`,
  );
  const { token, serviceAccount } = spec.options;
  const bearer =
    token ||
    (serviceAccount
      ? await googleToken(
          serviceAccount,
          'https://www.googleapis.com/auth/devstorage.read_only',
          guard,
        )
      : '');
  const got = await get(
    url,
    bearer ? { authorization: `Bearer ${bearer}` } : ({} as Record<string, string>),
    guard,
  );
  return { ...got, name: lastSegment(m[2]!) };
}

const DRIVE_ID = [/\/d\/([\w-]{10,})/, /[?&]id=([\w-]{10,})/, /^([\w-]{20,})$/];
const GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet';

async function drive(spec: FileSpec, guard: HostGuard): Promise<Fetched> {
  const id = DRIVE_ID.map((r) => r.exec(spec.target.trim())?.[1]).find(Boolean);
  if (!id) throw new Error('Paste the file’s Google Drive link or its id');
  const { apiKey, token, serviceAccount } = spec.options;
  const bearer =
    token ||
    (serviceAccount
      ? await googleToken(serviceAccount, 'https://www.googleapis.com/auth/drive.readonly', guard)
      : '');
  if (!bearer && !apiKey) {
    // Shared with “anyone with the link”: no credentials needed.
    const got = await get(
      new URL(`https://drive.google.com/uc?export=download&id=${id}`),
      {},
      guard,
    );
    if (got.type === 'text/html')
      throw new Error('The file is not shared publicly. Add an API key or a service account');
    return got;
  }
  const api = (path: string, extra = '') =>
    new URL(
      `https://www.googleapis.com/drive/v3/files/${id}${path}?supportsAllDrives=true${extra}${bearer ? '' : `&key=${encodeURIComponent(apiKey!)}`}`,
    );
  const headers: Record<string, string> = bearer ? { authorization: `Bearer ${bearer}` } : {};
  const meta = JSON.parse(
    Buffer.from((await get(api('', '&fields=name,mimeType'), headers, guard)).bytes).toString(
      'utf8',
    ),
  ) as { name: string; mimeType: string };
  if (meta.mimeType === GOOGLE_SHEET) {
    const got = await get(api('/export', '&mimeType=text%2Fcsv'), headers, guard); // the first sheet
    return { ...got, name: `${meta.name}.csv`, type: 'text/csv' };
  }
  if (meta.mimeType.startsWith('application/vnd.google-apps.'))
    throw new Error('Only Google Sheets and uploaded CSV or Excel files can be read');
  return { ...(await get(api('', '&alt=media'), headers, guard)), name: meta.name };
}

/** Dropbox and similar share links open a web page unless asked for the file. */
function direct(url: URL): URL {
  if (/(^|\.)dropbox\.com$/.test(url.hostname)) {
    url.searchParams.delete('dl');
    url.searchParams.set('dl', '1');
  }
  return url;
}

export async function fetchFile(
  spec: FileSpec,
  guard: HostGuard,
  now = new Date(),
): Promise<Fetched> {
  switch (spec.kind) {
    case 'file': {
      const url = direct(new URL(spec.target));
      if (!/^https?:$/.test(url.protocol))
        throw new Error('The address must start with http:// or https://');
      return get(url, Object.fromEntries(spec.headers.map((h) => [h.name, h.value])), guard);
    }
    case 's3': {
      const r = s3Request(spec, now);
      const got = await get(r.url, r.headers, guard);
      return { ...got, name: lastSegment(spec.target) };
    }
    case 'azure_blob': {
      const r = azureRequest(spec, now);
      return get(r.url, r.headers, guard);
    }
    case 'gcs':
      return gcs(spec, guard);
    case 'gdrive':
      return drive(spec, guard);
  }
}

// ------------------------------------------------------------ parsing

/** RFC 4180: quoted fields, doubled quotes, newlines inside quotes. The delimiter is guessed from the first line unless given. */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const d =
    delimiter ||
    [',', ';', '\t', '|']
      .map((c) => [c, first.split(c).length] as const)
      .sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface Table {
  format: 'csv' | 'xlsx';
  columns: string[];
  rows: string[][];
}

const cell = (v: unknown): string =>
  v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);

function formatOf(file: Fetched, wanted: string | undefined): 'csv' | 'xlsx' {
  const w = (wanted ?? '').toLowerCase().replace(/^\./, '');
  if (w === 'csv' || w === 'tsv') return 'csv';
  if (w === 'xlsx') return 'xlsx';
  const b = file.bytes;
  if (b.length > 3 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0)
    throw new Error('Old .xls files are not supported: save the file as .xlsx or .csv');
  if (b.length > 1 && b[0] === 0x50 && b[1] === 0x4b) return 'xlsx'; // a zip container
  return 'csv';
}

/** Header row plus data rows, with empty rows dropped and unnamed or repeated headers made unique. */
export async function parseTable(file: Fetched, options: FileSpec['options']): Promise<Table> {
  const format = formatOf(file, options.format);
  let grid: string[][];
  if (format === 'xlsx') {
    const sheet = options.sheet?.trim();
    const data = await readSheet(
      new Blob([Buffer.from(file.bytes)]),
      sheet ? (/^\d+$/.test(sheet) ? Number(sheet) : sheet) : 1,
    ).catch((e: unknown) => {
      throw new Error(
        e instanceof Error && /sheet/i.test(e.message)
          ? e.message
          : 'The file is not a valid .xlsx workbook',
      );
    });
    grid = data.map((r) => r.map(cell));
  } else {
    const delimiter = options.format?.toLowerCase() === 'tsv' ? '\t' : undefined;
    grid = parseCsv(new TextDecoder('utf-8').decode(file.bytes), delimiter);
  }
  grid = grid.filter((r) => r.some((v) => v.trim() !== ''));
  if (!grid.length) throw new Error('The file has no rows');
  const seen = new Map<string, number>();
  const columns = grid[0]!.map((h, i) => {
    const base = h.trim() || `column_${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base}_${n}` : base;
  });
  return { format, columns, rows: grid.slice(1).map((r) => columns.map((_, i) => r[i] ?? '')) };
}

export const previewOf = (t: Table): FilePreview => ({
  format: t.format,
  total: t.rows.length,
  columns: t.columns.slice(0, PREVIEW_COLUMNS),
  rows: t.rows
    .slice(0, PREVIEW_ROWS)
    .map((r) => r.slice(0, PREVIEW_COLUMNS).map((v) => v.slice(0, 80))),
});
