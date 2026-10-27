import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// Organisation-wide entity types: defined once, present in every project (a linked row per project,
// edited centrally). Entity types can also cap how many entities a project may hold of that type.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('org_entity_type')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('plural', 'text', (c) => c.notNull())
    .addColumn('icon', 'text', (c) => c.notNull().defaultTo('box'))
    .addColumn('color', 'text', (c) => c.notNull().defaultTo('#0f62fe'))
    .addColumn('geometry', 'text', (c) => c.notNull().defaultTo('none'))
    .addColumn('marker', 'jsonb', (c) => c.notNull().defaultTo(sql`'{"style":"dot","rotateBy":null}'::jsonb`))
    .addColumn('attributes', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('parent_types', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'`))
    .addColumn('max_per_project', 'integer')
    .addColumn('sort', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('org_entity_type_geometry_ck', sql`geometry in ('none','point','polygon','line')`)
    .addCheckConstraint('org_entity_type_max_ck', sql`max_per_project is null or max_per_project >= 1`)
    .execute();
  await sql`create unique index org_entity_type_key_uq on org_entity_type (tenant_id, key)`.execute(db);
  await enableTenantRls(db, 'org_entity_type');
  await sql`
    alter table entity_type
      add column org_type_id uuid references org_entity_type (id),
      add column max_per_project integer check (max_per_project is null or max_per_project >= 1)
  `.execute(db);
  await sql`create index entity_type_org_idx on entity_type (org_type_id) where org_type_id is not null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table entity_type drop column org_type_id, drop column max_per_project`.execute(db);
  await db.schema.dropTable('org_entity_type').execute();
}
