import { sql, type Kysely } from 'kysely';

// Shared entities: entities of organisation-wide types belong to the organisation (project_id is null)
// and are visible in every project. Their types get one shared row beside the per-project linked ones.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table entity alter column project_id drop not null`.execute(db);
  await sql`alter table entity_type alter column project_id drop not null`.execute(db);
  await sql`create unique index entity_code_shared_uq on entity (type_id, code) where project_id is null`.execute(db);
  await sql`create unique index entity_type_shared_uq on entity_type (org_type_id) where project_id is null`.execute(db);
  await sql`
    insert into entity_type (id, tenant_id, project_id, key, name, plural, icon, color, geometry, marker, attributes, parent_types, max_per_project, sort, org_type_id)
    select gen_random_uuid(), o.tenant_id, null, o.key, o.name, o.plural, o.icon, o.color, o.geometry, o.marker, o.attributes, o.parent_types, null, o.sort, o.id
    from org_entity_type o
    where not exists (select 1 from entity_type t where t.org_type_id = o.id and t.project_id is null)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from entity where project_id is null`.execute(db);
  await sql`delete from entity_type where project_id is null`.execute(db);
  await sql`drop index if exists entity_type_shared_uq`.execute(db);
  await sql`drop index if exists entity_code_shared_uq`.execute(db);
  await sql`alter table entity_type alter column project_id set not null`.execute(db);
  await sql`alter table entity alter column project_id set not null`.execute(db);
}
