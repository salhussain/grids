import { sql, type Kysely } from 'kysely';

// Registry of tenant data databases (shared cells and dedicated DBs). The tenant →
// cell mapping arrives with the tenants table in M1.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('cell')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('kind', 'text', (c) => c.notNull().check(sql`kind in ('shared', 'dedicated')`))
    .addColumn('connection_secret_ref', 'text', (c) => c.notNull())
    .addColumn('accepting_tenants', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('cell').execute();
}
