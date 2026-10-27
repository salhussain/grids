import { sql, type Kysely } from 'kysely';

// A member can hold several permissions, not just one.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table project_member add column permission_groups text[] not null default '{}'`.execute(db);
  await sql`update project_member set permission_groups = array[permission_group] where permission_group is not null`.execute(db);
  await sql`alter table project_member drop column permission_group`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table project_member add column permission_group text`.execute(db);
  await sql`update project_member set permission_group = permission_groups[1]`.execute(db);
  await sql`alter table project_member drop column permission_groups`.execute(db);
}
