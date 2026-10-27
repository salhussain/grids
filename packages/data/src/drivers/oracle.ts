import type { Driver } from './types.js';
import { cut } from './util.js';

/** Oracle Database (thin mode, no client libraries): oracle://user:{{PW}}@host:1521/service_name */
export const oracle: Driver = {
  label: 'Oracle',
  testQuery: 'select 1 from dual',
  quote: (id) => `"${id.replace(/"/g, '""')}"`,
  catalogSql: () =>
    `select owner, table_name, column_name, data_type from all_tab_columns
     where owner = sys_context('USERENV', 'CURRENT_SCHEMA') order by table_name, column_id`,
  async query(cfg, sql, opts) {
    const { default: oracledb } = await import('oracledb');
    const u = new URL(cfg.target);
    const conn = await oracledb.getConnection({
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      connectString: `${u.hostname}:${u.port || 1521}${u.pathname}`,
    });
    try {
      conn.callTimeout = opts.timeoutMs;
      await conn.execute('set transaction read only');
      const res = await conn.execute<unknown[]>(sql, [], {
        maxRows: opts.limit + 1,
        outFormat: oracledb.OUT_FORMAT_ARRAY,
        fetchInfo: undefined,
        fetchTypeHandler: (m) => (m.dbType === oracledb.DB_TYPE_CLOB ? { type: oracledb.STRING } : undefined),
      });
      return {
        columns: (res.metaData ?? []).map((m) => ({ name: m.name.toLowerCase(), type: m.dbTypeName?.toLowerCase() })),
        ...cut(res.rows ?? [], opts.limit),
      };
    } finally {
      await conn.close().catch(() => {});
    }
  },
};
