import type { DuckDBConnection } from '@duckdb/node-api';
import { assertReadOnly, cleanSql, toResult } from './drivers/util.js';
import type { QueryResult, Row } from './drivers/types.js';

/** A table made from rows (a form's submissions, a file, an API response, another dataset). */
export interface LocalTable {
  /** The name SQL refers to it by (lowercase, letters, digits and underscores). */
  name: string;
  rows: Row[];
  /** Columns the table has even when no row shows them (a form nobody has answered yet). */
  columns?: string[];
}

export interface LocalOptions {
  limit: number;
  timeoutMs: number;
}

const NUM = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

const blank = (v: unknown) => v === null || v === undefined || v === '';
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

/** The SQL type that fits every value of a column (text when they differ). */
export function columnType(values: unknown[]): 'BIGINT' | 'DOUBLE' | 'BOOLEAN' | 'DATE' | 'TIMESTAMP' | 'VARCHAR' {
  const v = values.filter((x) => !blank(x));
  if (!v.length) return 'VARCHAR';
  if (v.every((x) => typeof x === 'boolean' || x === 'true' || x === 'false')) return 'BOOLEAN';
  if (v.every((x) => (typeof x === 'number' && Number.isFinite(x)) || (typeof x === 'string' && NUM.test(x)))) {
    return v.every((x) => Number.isSafeInteger(Number(x)) && !String(x).includes('.')) ? 'BIGINT' : 'DOUBLE';
  }
  if (v.every((x) => typeof x === 'string' && DATE.test(x))) return 'DATE';
  if (v.every((x) => typeof x === 'string' && (STAMP.test(x) || DATE.test(x)))) return 'TIMESTAMP';
  return 'VARCHAR';
}

const text = (v: unknown): string | null => (blank(v) ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));

async function load(conn: DuckDBConnection, t: LocalTable) {
  const columns = [...new Set([...(t.columns ?? []), ...t.rows.flatMap((r) => Object.keys(r))])];
  if (!columns.length) throw new Error(`${t.name} has no rows or columns to query`);
  const raw = `${t.name}__raw`;
  // Everything lands as text, then each column is cast to the type that fits its values.
  await conn.run(`create table ${q(raw)} (${columns.map((c) => `${q(c)} varchar`).join(', ')})`);
  const app = await conn.createAppender(raw);
  for (const r of t.rows) {
    for (const c of columns) {
      const v = text(r[c]);
      if (v === null) app.appendNull();
      else app.appendVarchar(v);
    }
    app.endRow();
  }
  app.flushSync();
  app.closeSync();
  const types = columns.map((c) => columnType(t.rows.map((r) => r[c])));
  await conn.run(
    `create table ${q(t.name)} as select ${columns.map((c, i) => (types[i] === 'VARCHAR' ? q(c) : `cast(${q(c)} as ${types[i]}) as ${q(c)}`)).join(', ')} from ${q(raw)}`,
  );
  await conn.run(`drop table ${q(raw)}`);
}

/** DuckDB hands back timestamps as "2024-01-01 10:00:00" and large numbers as text: make them JSON like the drivers do. */
function fix(value: unknown, type: string): unknown {
  if (typeof value !== 'string') return value;
  if (/^(u?(tiny|small|big|huge)?int(eger)?|float|double|decimal|real)/.test(type)) return Number.isFinite(Number(value)) ? Number(value) : value;
  if (/^timestamp/.test(type) && /^\d{4}-\d{2}-\d{2} /.test(value)) return `${value.replace(' ', 'T')}${/[Z+]|-\d{2}$/.test(value.slice(10)) ? '' : 'Z'}`;
  return value;
}

/**
 * Runs read-only SQL over in-memory tables with embedded DuckDB. Nothing outside the tables is reachable:
 * file and network access are switched off and the settings locked before the user's SQL runs.
 */
export async function runLocalQuery(tables: LocalTable[], sql: string, opts: LocalOptions): Promise<QueryResult> {
  const statement = cleanSql(sql);
  assertReadOnly(statement);
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const db = await DuckDBInstance.create(':memory:', { threads: '2', memory_limit: '1GB' });
  const conn = await db.connect();
  const timer = setTimeout(() => conn.interrupt(), opts.timeoutMs);
  try {
    for (const t of tables) await load(conn, t);
    for (const s of [
      'set autoinstall_known_extensions=false',
      'set autoload_known_extensions=false',
      'set enable_external_access=false',
      'set lock_configuration=true',
    ])
      await conn.run(s);
    const parsed = await conn.extractStatements(statement);
    if (parsed.count !== 1) throw new Error('Run one statement at a time');
    const reader = await conn.runAndReadUntil(statement, opts.limit + 1);
    const types = reader.columnTypes().map((t) => t.toString().toLowerCase());
    const rows = reader.getRowsJson();
    const out = rows.length > opts.limit ? rows.slice(0, opts.limit) : rows;
    return toResult({
      columns: reader.columnNames().map((name, i) => ({ name, type: types[i]!.replace(/\(.*\)/, '') })),
      rows: out.map((r) => r.map((v, i) => fix(v, types[i]!))),
      truncated: rows.length > opts.limit,
    });
  } catch (e) {
    if (e instanceof Error && /interrupt/i.test(e.message)) throw new Error('The query took too long', { cause: e });
    throw e;
  } finally {
    clearTimeout(timer);
    conn.closeSync();
    db.closeSync();
  }
}
