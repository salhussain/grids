import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// Map overlays (spec §9): indicator layers on the project explorer.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('map_overlay')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('project_id', 'uuid', (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('config', 'jsonb', (c) => c.notNull())
    .addColumn('is_public', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('sort', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index map_overlay_key_uq on map_overlay (project_id, key)`.execute(db);
  await enableTenantRls(db, 'map_overlay');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('map_overlay').execute();
}
