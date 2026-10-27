import { sql, type Kysely } from 'kysely';

// The plan's allowances, copied here by the platform so the worker (which only sees the data cell) can hold runs to them.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table tenant_profile add column limits jsonb`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table tenant_profile drop column limits`.execute(db);
}
