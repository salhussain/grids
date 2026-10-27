import { sql, type Kysely } from 'kysely';

// An organisation whose subscription has ended: its people can't sign in.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table org add column blocked boolean not null default false`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table org drop column blocked`.execute(db);
}
