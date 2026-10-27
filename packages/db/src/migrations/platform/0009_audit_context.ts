import { sql, type Kysely } from 'kysely';

// The activity log learns where each entry came from and what it was about: the project, a category to filter by,
// the address and rough location of whoever did it, and the browser.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('platform_audit_log')
    .addColumn('project_key', 'text')
    .addColumn('category', 'text', (c) => c.notNull().defaultTo('change'))
    .addColumn('ip', 'text')
    .addColumn('country', 'text')
    .addColumn('region', 'text')
    .addColumn('city', 'text')
    .addColumn('user_agent', 'text')
    .execute();
  // Entries from before: the project is in the details; the category follows the action.
  await sql`update platform_audit_log set project_key = details ->> 'project' where jsonb_typeof(details -> 'project') = 'string'`.execute(db);
  await sql`update platform_audit_log set category = case
    when action like '%.viewed' then 'view'
    when action like 'public.%' then 'public'
    when action in ('submission.reviewed') then 'approval'
    when action like 'submission.%' or action like 'submissions.%' then 'submission'
    when action like 'invitation.%' or action like 'form.link_%' or action = 'staff.invited' then 'invitation'
    when action like 'entity.%' or action like 'entities.%' or action like 'shared_entity.%' or action = 'project.imported' then 'entity'
    when action like 'access.%' or action like 'project.member_%' or action like 'member.%' or action like 'permission_group.%' then 'access'
    else 'change' end`.execute(db);
  await sql`create index platform_audit_project_idx on platform_audit_log (tenant_id, project_key, id desc)`.execute(db);
  await sql`create index platform_audit_category_idx on platform_audit_log (tenant_id, category, id desc)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index platform_audit_category_idx`.execute(db);
  await sql`drop index platform_audit_project_idx`.execute(db);
  await db.schema
    .alterTable('platform_audit_log')
    .dropColumn('user_agent')
    .dropColumn('city')
    .dropColumn('region')
    .dropColumn('country')
    .dropColumn('ip')
    .dropColumn('category')
    .dropColumn('project_key')
    .execute();
}
