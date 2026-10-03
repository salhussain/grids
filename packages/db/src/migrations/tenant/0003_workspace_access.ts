import { sql, type Kysely } from 'kysely';
import { enableTenantRls } from './0002_tenant_profile.js';

// Organisation workspace (M2): org-unit hierarchy (ltree paths for subtree
// checks), workspace roles, scoped role grants and member placement.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('org_unit')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('parent_id', 'uuid', (c) => c.references('org_unit.id').onDelete('restrict'))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('code', 'text')
    .addColumn('level_label', 'text')
    // Root-to-self labels (ids without dashes): subtree = path <@ ancestor.path
    .addColumn('path', sql`ltree`, (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create index org_unit_path_gist on org_unit using gist (path)`.execute(db);
  await sql`create unique index org_unit_sibling_name_uq on org_unit (tenant_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))`.execute(
    db,
  );
  await enableTenantRls(db, 'org_unit');

  await db.schema
    .createTable('workspace_role')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('key', 'text')
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('permissions', sql`text[]`, (c) => c.notNull())
    .addColumn('is_system', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index workspace_role_name_uq on workspace_role (tenant_id, lower(name))`.execute(
    db,
  );
  await sql`create unique index workspace_role_key_uq on workspace_role (tenant_id, key) where key is not null`.execute(
    db,
  );
  await enableTenantRls(db, 'workspace_role');

  await db.schema
    .createTable('role_grant')
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    // Platform identity id (control plane); not an FK across databases.
    .addColumn('user_id', 'uuid', (c) => c.notNull())
    .addColumn('role_id', 'uuid', (c) =>
      c.notNull().references('workspace_role.id').onDelete('cascade'),
    )
    .addColumn('org_unit_id', 'uuid', (c) => c.references('org_unit.id').onDelete('cascade'))
    .addColumn('created_by', 'uuid')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index role_grant_uq on role_grant (tenant_id, user_id, role_id, org_unit_id) nulls not distinct`.execute(
    db,
  );
  await sql`create index role_grant_user_idx on role_grant (tenant_id, user_id)`.execute(db);
  await enableTenantRls(db, 'role_grant');

  await db.schema
    .createTable('member_placement')
    .addColumn('tenant_id', 'uuid', (c) => c.notNull())
    .addColumn('user_id', 'uuid', (c) => c.notNull())
    .addColumn('org_unit_id', 'uuid', (c) =>
      c.notNull().references('org_unit.id').onDelete('cascade'),
    )
    .addPrimaryKeyConstraint('member_placement_pk', ['tenant_id', 'user_id'])
    .execute();
  await enableTenantRls(db, 'member_placement');
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['member_placement', 'role_grant', 'workspace_role', 'org_unit'])
    await db.schema.dropTable(t).execute();
}
