import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// Every saved change to what a dataset is (its name, query or code, sources, settings) is kept, so earlier ones can be read and restored.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('dataset_version')
    .addColumn('dataset_id', 'uuid', (c) => c.notNull().references('dataset.id').onDelete('cascade'))
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('version', 'integer', (c) => c.notNull())
    .addColumn('definition', 'jsonb', (c) => c.notNull())
    .addColumn('saved_by', 'uuid')
    .addColumn('saved_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('dataset_version_pk', ['dataset_id', 'version'])
    .execute();
  await enableTenantRls(db, 'dataset_version');
  // Datasets that already exist start at version 1, as they are now.
  await sql`
    insert into dataset_version (dataset_id, tenant_id, version, definition, saved_at)
    select id, tenant_id, 1,
      jsonb_build_object('name', name, 'description', description, 'freshnessMinutes', freshness_minutes, 'source', source, 'settings', settings),
      created_at
    from dataset`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists dataset_version`.execute(db);
}
