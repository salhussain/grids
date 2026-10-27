import { assertReadOnly, cleanSql, toResult } from './util.js';
import { bigquery } from './bigquery.js';
import { clickhouse } from './clickhouse.js';
import { mssql } from './mssql.js';
import { mysql } from './mysql.js';
import { oracle } from './oracle.js';
import { postgres } from './postgres.js';
import { snowflake } from './snowflake.js';
import type { DatabaseKind, Driver, DriverConfig, QueryOptions, QueryResult } from './types.js';

export * from './types.js';
export { assertReadOnly, toResult, inferType, normalise } from './util.js';

/** One driver per database kind. Adding a database: implement `Driver`, add its kind to DATABASE_KINDS and here. */
export const DRIVERS: Record<DatabaseKind, Driver> = {
  postgres,
  redshift: { ...postgres, label: 'Amazon Redshift' },
  mysql,
  mariadb: { ...mysql, label: 'MariaDB' },
  mssql,
  oracle,
  clickhouse,
  snowflake,
  bigquery,
};

const DEFAULTS: QueryOptions = { limit: 500, timeoutMs: 30_000 };

/** Runs a read-only statement on a database. */
export async function runDatabaseQuery(cfg: DriverConfig, sql: string, opts: Partial<QueryOptions> = {}): Promise<QueryResult> {
  const text = cleanSql(sql);
  assertReadOnly(text);
  return toResult(await DRIVERS[cfg.kind].query(cfg, text, { ...DEFAULTS, ...opts }));
}

/** Connects and runs the driver's test statement; returns its row count. */
export async function testDatabase(cfg: DriverConfig, query?: string, timeoutMs = 10_000): Promise<number> {
  const d = DRIVERS[cfg.kind];
  const text = cleanSql(query || d.testQuery);
  assertReadOnly(text);
  return (await d.query(cfg, text, { limit: 1, timeoutMs })).rows.length;
}

export interface Catalog {
  tables: { schema: string; name: string; columns: { name: string; type: string }[] }[];
  truncated: boolean;
}
const CATALOG_COLUMNS = 8000;

/** The tables and columns a connection can see. */
export async function readCatalog(cfg: DriverConfig, timeoutMs = 20_000): Promise<Catalog> {
  const d = DRIVERS[cfg.kind];
  const res = await d.query(cfg, cleanSql(d.catalogSql(cfg)), { limit: CATALOG_COLUMNS, timeoutMs });
  const tables = new Map<string, Catalog['tables'][number]>();
  for (const r of res.rows) {
    const [schema, name, column, type] = r.map((v) => String(v ?? ''));
    const k = `${schema}\u0000${name}`;
    if (!tables.has(k)) tables.set(k, { schema: schema!, name: name!, columns: [] });
    tables.get(k)!.columns.push({ name: column!, type: (type ?? '').toLowerCase() });
  }
  return { tables: [...tables.values()], truncated: res.truncated };
}

/** `select * from "schema"."table"`, quoted for the database. */
export function selectAllFrom(kind: DatabaseKind, schema: string, table: string): string {
  const d = DRIVERS[kind];
  return `select * from ${schema ? `${d.quote(schema)}.` : ''}${d.quote(table)}`;
}
