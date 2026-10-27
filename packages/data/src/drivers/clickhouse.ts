import type { Driver } from './types.js';
import { cut, httpJson, limited } from './util.js';

/** ClickHouse over its HTTP interface: http(s)://user:{{PW}}@host:8123/database */
export const clickhouse: Driver = {
  label: 'ClickHouse',
  testQuery: 'select 1',
  quote: (id) => `\`${id.replace(/`/g, '``')}\``,
  catalogSql: () =>
    `select database as table_schema, table as table_name, name as column_name, type as data_type from system.columns
     where database not in ('system', 'INFORMATION_SCHEMA', 'information_schema') order by database, table, position`,
  async query(cfg, sql, opts) {
    const u = new URL(cfg.target);
    const headers: Record<string, string> = { 'content-type': 'text/plain' };
    if (u.username) headers.authorization = `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')}`;
    const params = new URLSearchParams({
      default_format: 'JSONCompact',
      readonly: '1',
      max_execution_time: String(Math.ceil(opts.timeoutMs / 1000)),
      ...(u.pathname.length > 1 ? { database: u.pathname.slice(1) } : {}),
    });
    const { body } = await httpJson(`${u.protocol}//${u.host}/?${params}`, { method: 'POST', headers, body: limited(sql, opts.limit) }, opts.timeoutMs);
    const meta = (body?.meta ?? []) as { name: string; type: string }[];
    return { columns: meta.map((m) => ({ name: m.name, type: m.type.toLowerCase() })), ...cut((body?.data ?? []) as unknown[][], opts.limit) };
  },
};
