import { sql, type Kysely } from 'kysely';

// The help desk belongs to the organisation, not to a project, so the project-level columns made in 0041 go again.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists support_attachment`.execute(db);
  await sql`alter table work_event drop column if exists attachments, drop column if exists author_kind, drop column if exists author_name`.execute(db);
  await sql`drop index if exists work_item_requester_idx`.execute(db);
  await sql`alter table work_item drop column if exists escalated, drop column if exists channel, drop column if exists requester_email`.execute(db);
}

export async function down(): Promise<void> {
  // Nothing to bring back: 0041 made them.
}
