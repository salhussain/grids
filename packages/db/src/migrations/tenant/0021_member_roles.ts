import { sql, type Kysely } from 'kysely';

// A project member's role now follows their permission: the Admin permission makes a manager,
// everyone else is a plain member. (Editors become members: data is edited by managers and
// through forms.) Managers who had no permission join Admin.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    update project_member m set permission_group = g.id::text
    from permission_group g
    where g.project_id = m.project_id and g.kind = 'admin' and m.role = 'manager' and m.permission_group is null
  `.execute(db);
  await sql`
    update project_member m set role = case
      when exists (select 1 from permission_group g where g.project_id = m.project_id and g.kind = 'admin' and g.id::text = m.permission_group) then 'manager'
      else 'viewer' end
  `.execute(db);
}

export async function down(): Promise<void> {
  throw new Error('0021_member_roles cannot be reversed: editors were folded into members.');
}
