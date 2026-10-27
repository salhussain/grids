import { sql, type Kysely } from 'kysely';

// Support conversations learn what Linear and Zendesk have: a message can be edited (the earlier wordings are kept),
// and the team's internal notes can be answered in a thread that is resolved when it is settled.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table support_message add column parent_id uuid references support_message(id) on delete cascade`.execute(db);
  await sql`alter table support_message add column edited_at timestamptz`.execute(db);
  // Every earlier wording: [{ body, at, by }], oldest first.
  await sql`alter table support_message add column edits jsonb not null default '[]'::jsonb`.execute(db);
  await sql`alter table support_message add column resolved_at timestamptz`.execute(db);
  await sql`alter table support_message add column resolved_by uuid`.execute(db);
  await sql`create index support_message_parent_idx on support_message (parent_id) where parent_id is not null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table support_message drop column resolved_by, drop column resolved_at, drop column edits, drop column edited_at, drop column parent_id`.execute(db);
}
