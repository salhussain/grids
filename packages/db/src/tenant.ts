import { sql, type Kysely, type Transaction } from 'kysely';

/**
 * Runs `fn` in a transaction scoped to one tenant. Sets `app.tenant_id` with
 * transaction-local scope, which every RLS policy reads via `app_tenant_id()`.
 * This is the only sanctioned way to touch tenant data (ADR 0001).
 */
export async function withTenant<DB, T>(
  db: Kysely<DB>,
  tenantId: string,
  fn: (tx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(tx);
    return fn(tx);
  });
}
