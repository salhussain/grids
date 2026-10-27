import { sql, type Kysely } from 'kysely';

// An organisation whose subscription has ended is shut out: nobody signs in, and its projects leave the public pages.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table tenant add column access_blocked boolean not null default false`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table tenant drop column access_blocked`.execute(db);
}
