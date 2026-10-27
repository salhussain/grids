import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// Data groups: a namespace for data elements, so two groups can both have a `date`. The default group, `general`,
// holds every element made before groups existed and is written without its prefix (`malaria_cases`, not `general.malaria_cases`).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('data_group')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('project_id', 'uuid', (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index data_group_key_uq on data_group (project_id, key)`.execute(db);
  await enableTenantRls(db, 'data_group');

  await sql`alter table data_element add column group_key text not null default 'general'`.execute(db);
  // How other things refer to an element: its key, with the group in front unless it is in the default group.
  await sql`alter table data_element add column ref text generated always as (case when group_key = 'general' then key else group_key || '.' || key end) stored`.execute(db);
  await sql`drop index if exists data_element_key_uq`.execute(db);
  await sql`create unique index data_element_ref_uq on data_element (project_id, ref)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists data_element_ref_uq`.execute(db);
  await sql`create unique index data_element_key_uq on data_element (project_id, key)`.execute(db);
  await sql`alter table data_element drop column ref`.execute(db);
  await sql`alter table data_element drop column group_key`.execute(db);
  await db.schema.dropTable('data_group').execute();
}
