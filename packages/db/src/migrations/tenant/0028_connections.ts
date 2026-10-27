import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// External connections (an API or a database) and the encrypted variables they refer to.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('project_variable')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('project_id', 'uuid', (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    // AES-256-GCM, never returned by the API.
    .addColumn('value_enc', 'text', (c) => c.notNull())
    .addColumn('updated_by', 'uuid')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index project_variable_key_uq on project_variable (project_id, key)`.execute(db);
  await enableTenantRls(db, 'project_variable');

  await db.schema
    .createTable('project_connection')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('project_id', 'uuid', (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('target', 'text', (c) => c.notNull())
    .addColumn('headers', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('test', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('last_test', 'jsonb')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('project_connection_kind_ck', sql`kind in ('http','postgres')`)
    .execute();
  await sql`create unique index project_connection_key_uq on project_connection (project_id, key)`.execute(db);
  await enableTenantRls(db, 'project_connection');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('project_connection').execute();
  await db.schema.dropTable('project_variable').execute();
}
