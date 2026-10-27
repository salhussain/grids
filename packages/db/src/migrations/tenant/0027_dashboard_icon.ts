import { sql, type Kysely } from 'kysely';

// A dashboard's icon, shown in the explorer's dashboard picker.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table dashboard add column icon text not null default 'layout-dashboard'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table dashboard drop column icon`.execute(db);
}
