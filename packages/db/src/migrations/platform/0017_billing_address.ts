import { sql, type Kysely } from 'kysely';

// Where invoices and receipts are addressed, when that is not the registered address (null: the same).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table tenant add column billing_address jsonb`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table tenant drop column billing_address`.execute(db);
}
