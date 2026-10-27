import type { Driver } from './types.js';
import { cut, limited } from './util.js';

/** MySQL and MariaDB. */
export const mysql: Driver = {
  label: 'MySQL',
  testQuery: 'select 1',
  quote: (id) => `\`${id.replace(/`/g, '``')}\``,
  catalogSql: () =>
    `select table_schema as table_schema, table_name as table_name, column_name as column_name, data_type as data_type
     from information_schema.columns where table_schema = database() order by table_name, ordinal_position`,
  async query(cfg, sql, opts) {
    const { default: mysql2 } = await import('mysql2/promise');
    const conn = await mysql2.createConnection({
      uri: cfg.target,
      connectTimeout: Math.min(opts.timeoutMs, 15_000),
      dateStrings: true,
      decimalNumbers: true,
      supportBigNumbers: true,
      bigNumberStrings: false,
    });
    try {
      await conn.query('set session transaction read only');
      const [rows, fields] = await conn.query({ sql: limited(sql, opts.limit), rowsAsArray: true, timeout: opts.timeoutMs });
      const cut_ = cut(rows as unknown[][], opts.limit);
      return { columns: (fields as { name: string }[]).map((f) => ({ name: f.name })), ...cut_ };
    } finally {
      await conn.end().catch(() => {});
    }
  },
};
