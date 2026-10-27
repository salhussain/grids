import type { Driver } from './types.js';

/** SQL Server and Azure SQL: mssql://user:{{PW}}@host:1433/database?encrypt=true&trustServerCertificate=false */
export const mssql: Driver = {
  label: 'SQL Server',
  testQuery: 'select 1',
  quote: (id) => `[${id.replace(/]/g, ']]')}]`,
  catalogSql: () =>
    `select table_schema as table_schema, table_name as table_name, column_name as column_name, data_type as data_type
     from information_schema.columns where table_schema not in ('sys', 'INFORMATION_SCHEMA') order by table_schema, table_name, ordinal_position`,
  async query(cfg, sql, opts) {
    const { Connection, Request } = await import('tedious');
    const u = new URL(cfg.target);
    const conn = new Connection({
      server: u.hostname,
      authentication: {
        type: 'default',
        options: { userName: decodeURIComponent(u.username), password: decodeURIComponent(u.password) },
      },
      options: {
        port: Number(u.port || 1433),
        database: u.pathname.slice(1) || undefined,
        encrypt: u.searchParams.get('encrypt') !== 'false',
        trustServerCertificate: u.searchParams.get('trustServerCertificate') === 'true',
        connectTimeout: Math.min(opts.timeoutMs, 15_000),
        requestTimeout: opts.timeoutMs,
        rowCollectionOnRequestCompletion: false,
        useColumnNames: false,
        readOnlyIntent: true,
      },
    });
    await new Promise<void>((ok, fail) => conn.connect((e) => (e ? fail(e) : ok())));
    try {
      // SQL Server can't wrap a statement in a subquery (CTEs, order by), so rows are counted as they arrive.
      return await new Promise((ok, fail) => {
        const columns: { name: string; type?: string }[] = [];
        const rows: unknown[][] = [];
        let truncated = false;
        const req = new Request(sql, (e) => (e && !truncated ? fail(e) : ok({ columns, rows, truncated })));
        req.on('columnMetadata', (meta) => {
          for (const c of Array.isArray(meta) ? meta : Object.values(meta))
            columns.push({ name: (c as { colName: string }).colName, type: (c as { type: { name: string } }).type.name.toLowerCase() });
        });
        req.on('row', (cols) => {
          if (truncated) return;
          if (rows.length >= opts.limit) {
            truncated = true;
            conn.cancel();
            return;
          }
          rows.push((cols as { value: unknown }[]).map((c) => c.value));
        });
        conn.execSql(req);
      });
    } finally {
      conn.close();
    }
  },
};
