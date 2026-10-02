import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

// Return bigint/numeric as strings is pg's default; keep it (no silent precision loss).
export function createDb<DB = unknown>(connectionString: string, opts: { max?: number } = {}) {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10 });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
