import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

const id = 'uuid';
const now = sql`now()`;

// Projects and the canonical data model (M3, ADR 0003): entity types with typed
// attribute definitions, entities in one hierarchy per project (ltree paths) with
// PostGIS geometry, data elements, and observations as the analytic grain.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('project')
    .addColumn('id', id, (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    // private: project members · organisation: every member can view · public: anonymous read of public dashboards
    .addColumn('visibility', 'text', (c) => c.notNull().defaultTo('private'))
    .addColumn('template', 'text')
    .addColumn('color', 'text', (c) => c.notNull().defaultTo('#0f62fe'))
    .addColumn('icon', 'text', (c) => c.notNull().defaultTo('folder'))
    .addColumn('settings', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_by', id)
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('archived_at', 'timestamptz')
    .addCheckConstraint('project_visibility_ck', sql`visibility in ('private','organisation','public')`)
    .execute();
  await sql`create unique index project_key_uq on project (tenant_id, key)`.execute(db);
  await enableTenantRls(db, 'project');

  await db.schema
    .createTable('project_member')
    .addColumn('project_id', id, (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('user_id', id, (c) => c.notNull())
    .addColumn('role', 'text', (c) => c.notNull())
    // Optional: limits the member to one entity and its descendants.
    .addColumn('root_entity_id', id)
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addPrimaryKeyConstraint('project_member_pk', ['project_id', 'user_id'])
    .addCheckConstraint('project_member_role_ck', sql`role in ('manager','editor','viewer')`)
    .execute();
  await enableTenantRls(db, 'project_member');

  await db.schema
    .createTable('entity_type')
    .addColumn('id', id, (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('project_id', id, (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('plural', 'text', (c) => c.notNull())
    .addColumn('icon', 'text', (c) => c.notNull().defaultTo('box'))
    .addColumn('color', 'text', (c) => c.notNull().defaultTo('#0f62fe'))
    .addColumn('geometry', 'text', (c) => c.notNull().defaultTo('none'))
    .addColumn('attributes', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    // Types an entity of this type may sit under (hierarchy rules); empty = top level.
    .addColumn('parent_types', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'`))
    .addColumn('sort', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addCheckConstraint('entity_type_geometry_ck', sql`geometry in ('none','point','polygon','line')`)
    .execute();
  await sql`create unique index entity_type_key_uq on entity_type (project_id, key)`.execute(db);
  await enableTenantRls(db, 'entity_type');

  await db.schema
    .createTable('entity')
    .addColumn('id', id, (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('project_id', id, (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('type_id', id, (c) => c.notNull().references('entity_type.id').onDelete('restrict'))
    .addColumn('code', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('parent_id', id, (c) => c.references('entity.id').onDelete('restrict'))
    .addColumn('path', sql`ltree`, (c) => c.notNull())
    .addColumn('attributes', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('geom', sql`geometry(Geometry, 4326)`)
    .addColumn('version', 'integer', (c) => c.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .execute();
  await sql`create unique index entity_code_uq on entity (project_id, type_id, code)`.execute(db);
  await sql`create index entity_path_gist on entity using gist (path)`.execute(db);
  await sql`create index entity_geom_gist on entity using gist (geom)`.execute(db);
  await sql`create index entity_parent_idx on entity (parent_id)`.execute(db);
  await sql`create index entity_name_trgm on entity (project_id, lower(name) text_pattern_ops)`.execute(db);
  await enableTenantRls(db, 'entity');

  // Attribute history: who/what changed an entity, for audit and conflict review.
  await db.schema
    .createTable('entity_change')
    .addColumn('id', 'bigserial', (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('entity_id', id, (c) => c.notNull().references('entity.id').onDelete('cascade'))
    .addColumn('changes', 'jsonb', (c) => c.notNull())
    .addColumn('source', 'text', (c) => c.notNull()) // user | job | form | import
    .addColumn('source_ref', 'text')
    .addColumn('actor_id', id)
    .addColumn('at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .execute();
  await sql`create index entity_change_entity_idx on entity_change (entity_id, at desc)`.execute(db);
  await enableTenantRls(db, 'entity_change');

  await db.schema
    .createTable('data_element')
    .addColumn('id', id, (c) => c.primaryKey())
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('project_id', id, (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('key', 'text', (c) => c.notNull())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('value_type', 'text', (c) => c.notNull().defaultTo('number'))
    .addColumn('unit', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('aggregation', 'text', (c) => c.notNull().defaultTo('sum'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addCheckConstraint('data_element_type_ck', sql`value_type in ('number','text','boolean')`)
    .addCheckConstraint('data_element_agg_ck', sql`aggregation in ('sum','avg','min','max','last','count')`)
    .execute();
  await sql`create unique index data_element_key_uq on data_element (project_id, key)`.execute(db);
  await enableTenantRls(db, 'data_element');

  await db.schema
    .createTable('observation')
    .addColumn('tenant_id', id, (c) => c.notNull())
    .addColumn('project_id', id, (c) => c.notNull().references('project.id').onDelete('cascade'))
    .addColumn('entity_id', id, (c) => c.notNull().references('entity.id').onDelete('cascade'))
    .addColumn('element_id', id, (c) => c.notNull().references('data_element.id').onDelete('cascade'))
    .addColumn('at', 'timestamptz', (c) => c.notNull())
    .addColumn('value_num', 'double precision')
    .addColumn('value_text', 'text')
    .addColumn('source', 'text', (c) => c.notNull().defaultTo('user'))
    .addColumn('source_ref', 'text')
    .addColumn('recorded_at', 'timestamptz', (c) => c.notNull().defaultTo(now))
    .addPrimaryKeyConstraint('observation_pk', ['entity_id', 'element_id', 'at'])
    .execute();
  await sql`create index observation_element_at_idx on observation (project_id, element_id, at desc)`.execute(db);
  await enableTenantRls(db, 'observation');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['observation', 'data_element', 'entity_change', 'entity', 'entity_type', 'project_member', 'project'])
    await db.schema.dropTable(t).execute();
}
