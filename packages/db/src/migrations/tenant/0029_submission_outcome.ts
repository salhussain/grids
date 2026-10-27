import { sql, type Kysely } from 'kysely';

// The end node a finished submission reached: its name is the outcome the form's author gave it
// (Verified, Escalated, …), shown in place of the generic Approved / Rejected.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table submission add column outcome_node text`.execute(db);
  await sql`update submission set outcome_node = node_id where status = 'approved' and node_id is not null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table submission drop column outcome_node`.execute(db);
}
