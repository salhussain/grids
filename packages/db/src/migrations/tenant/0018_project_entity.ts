import { sql, type Kysely } from 'kysely';

// A project is itself an entity, so forms can be captured against it. It has a hidden
// system type (`this_project`) and one entity per project, kept out of the entity lists.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('entity_type').addColumn('system', 'boolean', (c) => c.notNull().defaultTo(false)).execute();
  await sql`
    insert into entity_type (id, tenant_id, project_id, key, name, plural, system, attributes, parent_types)
    select gen_random_uuid(), p.tenant_id, p.id, 'this_project', 'Project', 'Projects', true, '[]'::jsonb, '{}'
    from project p
    where not exists (select 1 from entity_type t where t.project_id = p.id and t.key = 'this_project')
  `.execute(db);
  await sql`
    insert into entity (id, tenant_id, project_id, type_id, code, name, parent_id, path, attributes)
    select i.id, p.tenant_id, p.id, t.id, p.key, p.name, null, replace(i.id::text, '-', '')::ltree, '{}'::jsonb
    from project p
    join entity_type t on t.project_id = p.id and t.key = 'this_project'
    cross join lateral (select gen_random_uuid() as id) i
    where not exists (select 1 from entity e where e.type_id = t.id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from entity where type_id in (select id from entity_type where system)`.execute(db);
  await sql`delete from entity_type where system`.execute(db);
  await db.schema.alterTable('entity_type').dropColumn('system').execute();
}
