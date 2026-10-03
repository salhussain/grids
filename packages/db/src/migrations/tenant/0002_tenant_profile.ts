import { sql, type Kysely } from 'kysely';

// First tenant-scoped table in a data cell. Written during provisioning so a
// tenant's cell is initialised; holds the tenant-local profile and theme (M2).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('tenant_profile')
    .addColumn('tenant_id', 'uuid', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('theme', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await enableTenantRls(db, 'tenant_profile');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('tenant_profile').execute();
}

/** The standard isolation policy every tenant-scoped table gets (ADR 0001). */
export async function enableTenantRls(db: Kysely<unknown>, table: string): Promise<void> {
  await sql`alter table ${sql.table(table)} enable row level security`.execute(db);
  await sql`
    create policy tenant_isolation on ${sql.table(table)}
      using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())
  `.execute(db);
}
