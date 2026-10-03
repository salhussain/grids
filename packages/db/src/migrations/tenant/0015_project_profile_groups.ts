import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// Project profile (status, logo, cover image), map-overlay groups (nested levels)
// and project-scoped form groups.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('project')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('live'))
    .addColumn('logo', 'text')
    .addColumn('cover_image', 'text')
    .execute();
  await sql`alter table project add constraint project_status_ck check (status in ('draft','live'))`.execute(db);

  await db.schema
    .createTable('map_overlay_group')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('project_id', 'uuid', (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('parent_id', 'uuid', (c) => c.references('map_overlay_group.id').onDelete('restrict'))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('sort', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await enableTenantRls(db, 'map_overlay_group');
  await db.schema.alterTable('map_overlay').addColumn('group_id', 'uuid', (c) => c.references('map_overlay_group.id').onDelete('set null')).execute();

  await db.schema.alterTable('form_group').addColumn('project_id', 'uuid', (c) => c.references('project.id').onDelete('cascade')).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('form_group').dropColumn('project_id').execute();
  await db.schema.alterTable('map_overlay').dropColumn('group_id').execute();
  await db.schema.dropTable('map_overlay_group').execute();
  await sql`alter table project drop constraint project_status_ck`.execute(db);
  await db.schema.alterTable('project').dropColumn('cover_image').dropColumn('logo').dropColumn('status').execute();
}
