import pg from 'pg';

/** Opens a connection to an external Postgres, runs one read-only query and closes it. Returns the row count. */
export async function probePostgres(connectionString: string, query: string, timeoutMs = 8000): Promise<number> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: timeoutMs, statement_timeout: timeoutMs, query_timeout: timeoutMs });
  await client.connect();
  try {
    await client.query('begin read only');
    const res = await client.query(query);
    return res.rowCount ?? res.rows.length;
  } finally {
    await client.end().catch(() => {});
  }
}
