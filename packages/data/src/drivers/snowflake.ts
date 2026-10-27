import type { Driver } from './types.js';
import { cut, httpJson, limited, sleep } from './util.js';

interface Meta {
  resultSetMetaData: { rowType: { name: string; type: string; scale?: number | null }[]; partitionInfo?: unknown[] };
  data: (string | null)[][];
  statementStatusUrl?: string;
  statementHandle?: string;
}

/** Converts what Snowflake sends (everything as text) according to the column type. */
function value(v: string | null, type: string, scale: number | null | undefined): unknown {
  if (v === null) return null;
  switch (type) {
    case 'fixed':
    case 'real': {
      const n = Number(v);
      return Number.isSafeInteger(n) || !Number.isInteger(n) ? n : v;
    }
    case 'boolean':
      return v === 'true' || v === '1';
    case 'date':
      return new Date(Number(v) * 86_400_000).toISOString().slice(0, 10);
    case 'timestamp_ntz':
    case 'timestamp_ltz':
    case 'timestamp_tz':
      return new Date(Number(v.split(' ')[0]) * 1000).toISOString();
    default:
      return scale === undefined ? v : v;
  }
}

/**
 * Snowflake over its SQL API. The target is the account (xy12345.eu-west-1); the token is an OAuth,
 * programmatic access or key-pair JWT token (`tokenType`, default PROGRAMMATIC_ACCESS_TOKEN).
 */
export const snowflake: Driver = {
  label: 'Snowflake',
  testQuery: 'select 1',
  quote: (id) => `"${id.replace(/"/g, '""')}"`,
  catalogSql: () =>
    `select table_schema, table_name, column_name, data_type from information_schema.columns
     where table_schema <> 'INFORMATION_SCHEMA' order by table_schema, table_name, ordinal_position`,
  async query(cfg, sql, opts) {
    const host = /snowflakecomputing\.com$/i.test(cfg.target) ? cfg.target : `${cfg.target}.snowflakecomputing.com`;
    const base = `https://${host}/api/v2/statements`;
    if (!cfg.options.token) throw new Error('Set the connection’s token option');
    const headers = {
      authorization: `Bearer ${cfg.options.token}`,
      'x-snowflake-authorization-token-type': cfg.options.tokenType || 'PROGRAMMATIC_ACCESS_TOKEN',
      'content-type': 'application/json',
      accept: 'application/json',
    };
    const deadline = Date.now() + opts.timeoutMs;
    let { status, body } = await httpJson(
      base,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          statement: limited(sql, opts.limit),
          timeout: Math.ceil(opts.timeoutMs / 1000),
          ...(cfg.options.database ? { database: cfg.options.database } : {}),
          ...(cfg.options.schema ? { schema: cfg.options.schema } : {}),
          ...(cfg.options.warehouse ? { warehouse: cfg.options.warehouse } : {}),
          ...(cfg.options.role ? { role: cfg.options.role } : {}),
        }),
      },
      opts.timeoutMs,
    );
    while (status === 202 && body?.statementStatusUrl && Date.now() < deadline) {
      await sleep(800);
      ({ status, body } = await httpJson(`https://${host}${body.statementStatusUrl}`, { headers }, Math.max(1000, deadline - Date.now())));
    }
    if (status === 202) throw new Error('The query did not finish in time');
    const first = body as Meta;
    const types = first.resultSetMetaData.rowType;
    const parts = first.resultSetMetaData.partitionInfo?.length ?? 1;
    const rows: unknown[][] = [];
    const take = (data: (string | null)[][]) => data.forEach((r) => rows.push(r.map((v, i) => value(v, types[i]!.type, types[i]!.scale))));
    take(first.data);
    for (let p = 1; p < parts && rows.length <= opts.limit; p++) {
      const next = await httpJson(`${base}/${first.statementHandle}?partition=${p}`, { headers }, Math.max(1000, deadline - Date.now()));
      take((next.body as Meta).data);
    }
    return { columns: types.map((t) => ({ name: t.name.toLowerCase(), type: t.type })), ...cut(rows, opts.limit) };
  },
};
