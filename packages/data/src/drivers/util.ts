import type { QueryResult, RawResult, SqlColumn } from './types.js';

/** Statement text without comments' trailing noise: no final semicolon or whitespace. */
export const cleanSql = (sql: string): string => sql.trim().replace(/[;\s]+$/, '');

/** Blanks out comments, string literals and quoted names so keywords can be looked for in the rest. */
function skeleton(sql: string): string {
  // One pass from the left, so a comment marker inside a string (or a quote inside a comment) is read as what it is.
  return sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\//g, (m) =>
    m.startsWith("'") ? "''" : m.startsWith('"') ? '""' : m.startsWith('`') ? '``' : m.startsWith('[') ? '[]' : ' ',
  );
}

const WRITES =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|exec|execute|call|copy|into|attach|detach|vacuum|reindex|set|use|load)\b/i;

/**
 * Datasets only read. This is a guard against mistakes, not a sandbox: the connection's database user
 * should have read-only rights too, and drivers also open read-only transactions where they can.
 */
export function assertReadOnly(sql: string): void {
  const s = skeleton(sql).trim().replace(/;+\s*$/, '');
  if (!s) throw new Error('Write a query first');
  if (s.includes(';')) throw new Error('Run one statement at a time');
  if (!/^\s*\(*\s*(select|with|show|describe|desc|explain|values)\b/i.test(s))
    throw new Error('Only SELECT queries can be used (start with SELECT or WITH)');
  const bad = s.match(WRITES);
  if (bad) throw new Error(`Datasets are read-only: "${bad[1]!.toUpperCase()}" is not allowed`);
}

/** Plain JSON for any driver value. */
export function normalise(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case 'bigint':
      return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
    case 'number':
      return Number.isFinite(v) ? v : null;
    case 'string':
    case 'boolean':
      return v;
    case 'object': {
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
      if (v instanceof Uint8Array) return `\\x${Buffer.from(v).toString('hex')}`;
      if (Array.isArray(v)) return v.map(normalise);
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = normalise(x);
      return o;
    }
    default:
      return String(v);
  }
}

/** A type name from the values when the driver gave none. */
export function inferType(values: unknown[]): string {
  const seen = new Set<string>();
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'number') seen.add(Number.isInteger(v) ? 'integer' : 'number');
    else if (typeof v === 'boolean') seen.add('boolean');
    else if (typeof v === 'string')
      seen.add(/^\d{4}-\d{2}-\d{2}$/.test(v) ? 'date' : /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v) ? 'timestamp' : 'text');
    else seen.add('json');
  }
  if (!seen.size) return 'unknown';
  if (seen.size === 1) return [...seen][0]!;
  if (seen.size === 2 && seen.has('integer') && seen.has('number')) return 'number';
  return 'text';
}

/** Rows as objects, with repeated or empty column names made unique. */
export function toResult(raw: RawResult): QueryResult {
  const seen = new Map<string, number>();
  const names = raw.columns.map((c, i) => {
    const base = c.name || `column_${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base}_${n}` : base;
  });
  const columns: SqlColumn[] = names.map((name, i) => ({
    name,
    type: raw.columns[i]!.type || inferType(raw.rows.map((r) => r[i])),
  }));
  const rows = raw.rows.map((r) => Object.fromEntries(names.map((n, i) => [n, normalise(r[i])])));
  return { columns, rows, truncated: raw.truncated };
}

/** `select * from (sql) as _q limit n+1`: the usual way to cap a result. */
export const limited = (sql: string, limit: number): string => `select * from (${sql}) as _q limit ${limit + 1}`;

/** Splits off the extra row fetched to detect truncation. */
export function cut<T>(rows: T[], limit: number): { rows: T[]; truncated: boolean } {
  return rows.length > limit ? { rows: rows.slice(0, limit), truncated: true } : { rows, truncated: false };
}

/** A parsed JSON response; the shape is the service's, checked where it is used. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

/** A fetch that fails with the server's own message. */
export async function httpJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: Json }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON: the text is the message
  }
  if (res.status >= 400) {
    const o = body && typeof body === 'object' ? (body as Json) : {};
    const msg = o.message ?? o.error?.message ?? o.error ?? (typeof body === 'string' ? body : '') ?? res.statusText;
    throw new Error(`${res.status}: ${String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 300)}`);
  }
  return { status: res.status, body };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
