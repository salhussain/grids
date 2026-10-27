import { sql, type Kysely } from 'kysely';

// The built-in public permission is named after its project, like the admin one.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    update permission_group g set name = p.name || ' Public'
    from project p where p.id = g.project_id and g.kind = 'public' and g.name = 'Public'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`update permission_group set name = 'Public' where kind = 'public'`.execute(db);
}
