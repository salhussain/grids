import { sql, type Kysely } from 'kysely';

// Every tenant-scoped table's RLS policy uses `tenant_id = app_tenant_id()`.
// Returns NULL when unset, so a query outside withTenant() sees zero rows (fail closed).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create function app_tenant_id() returns uuid
    language sql stable as $$
      select nullif(current_setting('app.tenant_id', true), '')::uuid
    $$
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop function app_tenant_id()`.execute(db);
}
