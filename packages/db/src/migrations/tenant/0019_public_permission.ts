import { sql, type Kysely } from 'kysely';

// Every project gets a built-in "Public" permission beside its admin one.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    insert into permission_group (id, tenant_id, project_id, key, name, description, parent_key, system)
    select gen_random_uuid(), p.tenant_id, p.id, 'public', 'Public', 'Open to anyone who can view the project’s public items.', null, true
    from project p
    where not exists (select 1 from permission_group g where g.project_id = p.id and g.key = 'public')
  `.execute(db);
  await sql`update permission_group set system = true, parent_key = null where key = 'public'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from permission_group where key = 'public' and system`.execute(db);
}
