import { sql, type Kysely } from 'kysely';

// What a dataset adds on top of its rows: the time column dashboard dates apply to, saved metrics, and parameters.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table dataset add column settings jsonb not null default '{}'::jsonb`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table dataset drop column settings`.execute(db);
}
