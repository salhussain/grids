import { sql, type Kysely } from 'kysely';

// Each organisation sets its own idle timeout, warning and longest session (null: the platform defaults).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table tenant add column session_policy jsonb`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table tenant drop column session_policy`.execute(db);
}
