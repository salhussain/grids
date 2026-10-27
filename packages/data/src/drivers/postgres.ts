import type { Driver, DriverConfig } from './types.js';
import { cut, limited } from './util.js';

const NAMES: Record<number, string> = {
  16: 'boolean', 20: 'bigint', 21: 'smallint', 23: 'integer', 25: 'text', 114: 'json', 700: 'real', 701: 'double',
  1043: 'varchar', 1082: 'date', 1114: 'timestamp', 1184: 'timestamptz', 1700: 'numeric', 2950: 'uuid', 3802: 'jsonb',
};

/** PostgreSQL and Amazon Redshift (which speaks the same protocol). */
export const postgres: Driver = {
  label: 'PostgreSQL',
  testQuery: 'select 1',
  quote: (id) => `"${id.replace(/"/g, '""')}"`,
  catalogSql: (cfg: DriverConfig) =>
    `select table_schema, table_name, column_name, data_type from information_schema.columns
     where table_schema not in ('pg_catalog', 'information_schema'${cfg.kind === 'redshift' ? ", 'pg_internal'" : ''}) and table_schema not like 'pg\\_%'
     order by table_schema, table_name, ordinal_position`,
  async query(cfg, sql, opts) {
    const { default: pg } = await import('pg');
    const client = new pg.Client({
      connectionString: cfg.target,
      connectionTimeoutMillis: Math.min(opts.timeoutMs, 15_000),
      statement_timeout: opts.timeoutMs,
      query_timeout: opts.timeoutMs,
      types: {
        getTypeParser: ((oid: number, format?: string) => {
          // Counts and sums arrive as text; dates stay as written so no time zone shifts them.
          if (oid === 20 || oid === 1700) return (v: string) => (Number.isSafeInteger(Number(v)) || v.includes('.') ? Number(v) : v);
          if (oid === 1082) return (v: string) => v;
          return pg.types.getTypeParser(oid, (format as 'text') ?? 'text');
        }) as never,
      },
    });
    await client.connect();
    try {
      await client.query('begin read only');
      // A default schema on the connection: unqualified table names are looked up there first, then in public.
      const schema = (cfg.options.schema ?? '').trim();
      if (schema) {
        const path = schema === 'public' ? 'public' : `${postgres.quote(schema)}, public`;
        await client.query({ text: "select set_config('search_path', $1, true)", values: [path] });
      }
      const res = await client.query({ text: limited(sql, opts.limit), rowMode: 'array' });
      const { rows, truncated } = cut(res.rows as unknown[][], opts.limit);
      return { columns: res.fields.map((f) => ({ name: f.name, type: NAMES[f.dataTypeID] })), rows, truncated };
    } finally {
      await client.end().catch(() => {});
    }
  },
};
