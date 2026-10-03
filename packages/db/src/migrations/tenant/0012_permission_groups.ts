import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// Project permission groups: a tree (most privileged at the top) attached to
// members and to visuals (dashboards, widgets, map overlays). A member sees a
// visual if it needs their group or any group below it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('permission_group')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('project_id', 'uuid', (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('parent_key', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index permission_group_key_uq on permission_group (project_id, key)`.execute(db);
  await enableTenantRls(db, 'permission_group');
  await db.schema.alterTable('project_member').addColumn('permission_group', 'text').execute();
  await db.schema.alterTable('dashboard').addColumn('permission_group', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('dashboard').dropColumn('permission_group').execute();
  await db.schema.alterTable('project_member').dropColumn('permission_group').execute();
  await db.schema.dropTable('permission_group').execute();
}
